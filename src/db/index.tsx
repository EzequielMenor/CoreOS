import * as SQLite from 'expo-sqlite';
import { File } from 'expo-file-system';
import { RouteType } from '../services/llm';
import type { InboxErrorCode } from '../services/inbox-diagnostics';
import { setTagsForNoteNoTx } from './queries/tags';
import { normalizedName } from './queries/collections';
import { FTS_REINDEX_SQL, FTS_TRIGGER_DDL } from './fts-triggers';

import { getDb, closeDb, DB_NAME, DB_DIR } from './client';
export { getDb, closeDb, DB_NAME, DB_DIR };

export interface InboxRow {
  id: number;
  raw_text: string;
  created_at: number;
  status: 'pending' | 'processed' | 'archived';
  error_code: InboxErrorCode | null;
  last_attempt_at: number | null;
  attempt_count: number;
  next_retry_at: number | null;
}

export interface PendingInboxSummary {
  total: number;
  failed: number;
  latest_error_code: InboxErrorCode | null;
}

export interface AudioCaptureRow {
  id: number;
  file_uri: string;
  created_at: number;
  status: 'recorded' | 'transcribing' | 'transcribed' | 'failed' | 'completed' | 'discarded';
  transcription: string | null;
  error_message: string | null;
}

export interface NoteRow {
  id: number;
  title: string;
  content: string;
  tags: string; // JSON string[]
  section: string | null;
  content_type: string;
  created_at: number;
}

export interface NoteLinkRow {
  id: number;
  source_id: number;
  target_id: number;
  link_type: string;
  created_at: number;
}

export interface GastosRow {
  id: number;
  amount: number;
  description: string | null;
  category: string | null;
  date: string | null;
  created_at: number;
}

export interface TareasRow {
  id: number;
  title: string;
  due_date: string | null;
  priority: string | null;
  status: string;
  created_at: number;
}

export type { SuenoRow } from './queries/sueno';

// Snapshot defensivo del fichero SQLite antes de cualquier migración.
// ponytail: si .bak ya existe no se sobreescribe (linea 165 del spec).
async function backupDatabase(): Promise<void> {
  const src = new File(DB_DIR, DB_NAME);
  const dst = new File(DB_DIR, `${DB_NAME}.bak`);
  if (src.exists && !dst.exists) {
    await src.copy(dst);
  }
}

// Migración idempotente del esquema notes legacy → v1 (spec §Schema + §Migration).
// Idempotencia garantizada por la key `notes_v1_migration` en schema_meta: si
// existe y las tablas nuevas están, la tx v1 se salta; v2 corre siempre.
// Cada paso tiene su propio guard + auto-recovery.
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Recogemos las columnas de notes UNA SOLA VEZ para dos usos:
  //   1. Guard pre-tx: añade body_md si falta (rollback parcial de v1).
  //   2. Dentro de la tx: helper addColIfMissing evita duplicados.
  // PRAGMA sobre tabla inexistente devuelve [] → no ALTER; v1 luego crea
  // la tabla con body_md incluida.
  const notesCols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(notes)",
  );
  const existingNoteCols = new Set(notesCols.map((c) => c.name));

  // Helper: ALTER TABLE solo si la columna no existe (SQLite no soporta ADD COLUMN IF NOT EXISTS).
  const addColIfMissing = async (col: string, ddl: string) => {
    if (!existingNoteCols.has(col)) {
      await db.execAsync(`ALTER TABLE notes ADD COLUMN ${ddl};`);
      existingNoteCols.add(col);
    }
  };

  // Guard pre-tx: necesario cuando v1 quedó parcialmente aplicada sin body_md.
  if (notesCols.length > 0 && !existingNoteCols.has('body_md')) {
    await db.execAsync(
      "ALTER TABLE notes ADD COLUMN body_md TEXT NOT NULL DEFAULT ''",
    );
    existingNoteCols.add('body_md');
  }

  // Guard: si la migración está marcada como hecha pero las tablas
  // nuevas no existen (estado parcial por SQLite FAIL silencioso
  // dentro de withTransactionAsync), forzamos re-ejecución limpiando
  // la key para que la transacción se reintente.
  const existingTables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tags', 'note_tags', 'ideas')",
  );
  const haveNewTables = existingTables.length >= 3;

  const done = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key = 'notes_v1_migration'",
  );
  const v1Done = !!(done?.value && haveNewTables);
  if (done?.value && !haveNewTables) {
    await db.execAsync(
      "DELETE FROM schema_meta WHERE key = 'notes_v1_migration'",
    );
  }

  if (!v1Done) {
    await backupDatabase();

    await db.withTransactionAsync(async () => {
    // 1. Columnas nuevas en notes — addColIfMissing evita duplicados si
    //    alguna ya fue añadida en un run anterior (idempotente por columna).
    await addColIfMissing('body_md',         "body_md TEXT NOT NULL DEFAULT ''");
    await addColIfMissing('status',          "status TEXT NOT NULL DEFAULT 'active'");
    await addColIfMissing('pinned',          "pinned INTEGER NOT NULL DEFAULT 0");
    await addColIfMissing('parent_id',       "parent_id INTEGER REFERENCES notes(id) ON DELETE SET NULL");
    await addColIfMissing('updated_at',      "updated_at INTEGER NOT NULL DEFAULT 0");
    await addColIfMissing('deleted_at',      "deleted_at INTEGER");
    await addColIfMissing('sync_status',     "sync_status TEXT");
    await addColIfMissing('server_id',       "server_id TEXT");
    await addColIfMissing('server_updated_at', "server_updated_at INTEGER");

    // Rellenar updated_at para filas legacy (ALTER TABLE no permite DEFAULT función).
    await db.execAsync(`UPDATE notes SET updated_at = created_at WHERE updated_at = 0;`);

    // 2. Tablas nuevas (idempotentes vía IF NOT EXISTS).
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE IF NOT EXISTS note_tags (
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'inbox'
          CHECK (status IN ('inbox','processed','discarded')),
        created_at INTEGER NOT NULL,
        converted_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL
      );
    `);

    // 3. Índices secundarios.
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_notes_status_created
        ON notes(status, created_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notes_pinned
        ON notes(pinned, created_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status, created_at DESC);
    `);

    // 4. Migración de tags JSON legacy → tags + note_tags.
    //    Parse con try/catch por si alguna fila tiene JSON inválido.
    const legacyNotes = await db.getAllAsync<{ id: number; tags: string }>(
      "SELECT id, tags FROM notes WHERE tags IS NOT NULL AND tags != '[]' AND tags != ''",
    );
    for (const row of legacyNotes) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.tags);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const raw of parsed) {
        if (typeof raw !== 'string') continue;
        const name = raw.trim();
        if (!name) continue;
        await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
        const tagRow = await db.getFirstAsync<{ id: number }>(
          'SELECT id FROM tags WHERE name = ?',
          name,
        );
        if (!tagRow) continue;
        await db.runAsync(
          'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
          row.id,
          tagRow.id,
        );
      }
    }

    // 5. DROP + recreate notes_fts con el esquema nuevo (title, body_md, tags_names).
    await db.execAsync(`
      DROP TABLE IF EXISTS notes_fts;
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title, body_md, tags_names,
        tokenize='porter unicode61'
      );
    `);
    await db.execAsync(`INSERT INTO notes_fts(rowid, title, body_md, tags_names)
      SELECT id, title, body_md,
        COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
          FROM note_tags nt JOIN tags t ON t.id=nt.tag_id
          WHERE nt.note_id=notes.id), '')
      FROM notes`);

    // 6. Triggers nuevos (mantienen consistencia notes ↔ notes_fts ↔ tags_names).
    await db.execAsync(FTS_TRIGGER_DDL);

    // 7. Reconstruir índice FTS5 para reparar cualquier inconsistencia previa.
    //    No swallow: el rebuild outer (más abajo en este archivo) reintenta; si ambos fallan
    //    se loguea arriba con severidad error.
    try {
      await db.execAsync("INSERT INTO notes_fts(notes_fts) VALUES('rebuild');");
    } catch (err) {
      console.warn('[db] FTS5 rebuild failed during v1 tx (will retry outside):', err);
    }

    // 8. Marcar la migración como hecha (dentro de la tx → atómica).
    await db.runAsync(
      "INSERT INTO schema_meta (key, value) VALUES ('notes_v1_migration', '1')",
    );
  });
  }

  // Re-asegurar TODOS los triggers FTS5 en cada initDb.
  await db.execAsync(FTS_TRIGGER_DDL);

  // Curación v3: reconstruir tags_names tras corregir los triggers de etiquetas.
  const ftsTagHeal = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='notes_fts_tag_heal_v3'",
  );
  if (!ftsTagHeal) {
    try {
      await db.execAsync(FTS_REINDEX_SQL);
      await db.runAsync(
        "INSERT INTO schema_meta (key, value) VALUES ('notes_fts_tag_heal_v3', '1')",
      );
      console.log('[db] FTS5 tag index healed and repopulated');
    } catch (err) {
      console.error('[db] FTS5 tag heal failed:', err);
    }
  }

  // Healing de una sola vez: limpiar el FTS corrupto y llenarlo de nuevo con DML normal.
  const ftsHeal = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='notes_fts_heal_v2'",
  );
  if (!ftsHeal) {
    try {
      await db.execAsync(`
        DELETE FROM notes_fts;
        INSERT INTO notes_fts(rowid, title, body_md, tags_names)
        SELECT id, title, body_md,
          COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
            FROM note_tags nt JOIN tags t ON t.id=nt.tag_id
            WHERE nt.note_id=notes.id), '')
        FROM notes;
      `);
      await db.runAsync(
        "INSERT INTO schema_meta (key, value) VALUES ('notes_fts_heal_v2', '1')",
      );
      console.log('[db] FTS5 table completely healed and repopulated');
    } catch (err) {
      console.error('[db] FTS5 heal failed:', err);
    }
  }

  // Rebuild incondicional: re-tokeniza el contenido que ya está en notes_fts;
  // la curación versionada notes_fts_tag_heal_v3 actualiza tags_names desde notes.
  // ponytail: si falla aquí es seña de trigger corrupto o schema_meta
  // desincronizado. Subimos a error para no enmascarar la causa raíz.
  try {
    await db.execAsync("INSERT INTO notes_fts(notes_fts) VALUES('rebuild');");
    console.log('[db] FTS5 rebuild complete');
  } catch (err) {
    console.error('[db] FTS5 rebuild failed', err);
  }

  // La recuperación va después de re-asegurar FTS y su rebuild: el UPDATE dispara
  // notes_au y rederiva notes_fts; antes de crear notes_fts fallaría la migración.
  const bodyFromContentDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='notes_body_from_content_v1'",
  );
  if (!bodyFromContentDone?.value) {
    await db.execAsync(
      "UPDATE notes SET body_md = content WHERE body_md = '' AND content <> ''",
    );
    await db.runAsync(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('notes_body_from_content_v1', '1')",
    );
  }

  // Migration v2: tabla note_embeddings (spec design.md §2.3).
  // Auto-recovery (F13): si la key existe pero la tabla no, limpiamos la
  // key para que la creación se reintente en este mismo arranque.
  // ponytail: future v3 migration guard naming: notes_embeddings_v3
  const v2Done = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='notes_embeddings_v2'",
  );
  const v2TableExists = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='note_embeddings'",
  );
  if (v2Done?.value && !v2TableExists) {
    await db.runAsync(
      "DELETE FROM schema_meta WHERE key='notes_embeddings_v2'",
    );
  }
  if (!v2Done?.value || !v2TableExists) {
    await db.execAsync(`
      CREATE TABLE note_embeddings (
        note_id     INTEGER PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
        model       TEXT NOT NULL,
        dimensions  INTEGER NOT NULL,
        vector      BLOB NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,
        last_retry_at INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_note_embeddings_created
        ON note_embeddings(created_at DESC);
      CREATE INDEX idx_note_embeddings_model
        ON note_embeddings(model, dimensions);
    `);
    await db.runAsync(
      "INSERT INTO schema_meta (key, value) VALUES ('notes_embeddings_v2', '1')",
    );
  }

  // Migration v3 (V1 simplificación): SIN DROPs. Dos pasos idempotentes, cada
  // uno con su key en schema_meta. Orden: backfill ideas→notes (copia) →
  // normalizar timestamps de notes a segundos. backupDatabase() cubre rollback.
  const v3IdeasDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='v3_ideas_to_notes'",
  );
  const v3TsDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='v3_notes_ts_seconds'",
  );
  if (!v3IdeasDone?.value || !v3TsDone?.value) {
    await backupDatabase();
  }

  if (!v3IdeasDone?.value) {
    await db.withTransactionAsync(async () => {
      // Copia (no mueve) las ideas aún en inbox a notes para que no
      // desaparezcan al eliminar la pantalla Ideas. Las 'processed' ya
      // tienen nota (converted_note_id); las 'discarded' se quedan como están.
      // ideas.created_at ya está en segundos (unixepoch()).
      await db.execAsync(`
        INSERT INTO notes (title, content, body_md, tags, created_at, updated_at)
        SELECT '', text, text, '[]', created_at, created_at
        FROM ideas
        WHERE status = 'inbox';
      `);
      await db.runAsync(
        "INSERT INTO schema_meta (key, value) VALUES ('v3_ideas_to_notes', '1')",
      );
    });
  }

  if (!v3TsDone?.value) {
    await db.withTransactionAsync(async () => {
      // Notas legacy del dispatcher escribían ms (~1.7e12); getSections
      // compara en segundos. Umbral 1e10 separa ambas eras sin ambigüedad.
      await db.execAsync(`
        UPDATE notes SET created_at = created_at / 1000 WHERE created_at > 10000000000;
        UPDATE notes SET updated_at = updated_at / 1000 WHERE updated_at > 10000000000;
      `);
      await db.runAsync(
        "INSERT INTO schema_meta (key, value) VALUES ('v3_notes_ts_seconds', '1')",
      );
    });
  }

  // Diagnóstico seguro del inbox. El guard por columnas permite recuperar una
  // migración parcial sin tocar ni duplicar capturas existentes.
  const inboxCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(inbox)');
  const existingInboxCols = new Set(inboxCols.map((column) => column.name));
  const inboxDiagnosticColumns = [
    ['error_code', 'error_code TEXT'],
    ['last_attempt_at', 'last_attempt_at INTEGER'],
    ['attempt_count', 'attempt_count INTEGER NOT NULL DEFAULT 0'],
    ['next_retry_at', 'next_retry_at INTEGER'],
  ] as const;
  const inboxDiagnosticsDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='inbox_diagnostics_v1'",
  );
  const haveInboxDiagnostics = inboxDiagnosticColumns.every(([name]) => (
    existingInboxCols.has(name)
  ));
  if (!inboxDiagnosticsDone?.value || !haveInboxDiagnostics) {
    await db.withTransactionAsync(async () => {
      for (const [name, ddl] of inboxDiagnosticColumns) {
        if (!existingInboxCols.has(name)) {
          await db.execAsync(`ALTER TABLE inbox ADD COLUMN ${ddl};`);
          existingInboxCols.add(name);
        }
      }
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_inbox_retry
          ON inbox(status, next_retry_at, created_at);
      `);
      await db.runAsync(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('inbox_diagnostics_v1', '1')",
      );
    });
  }

  // Backfill: re-sincroniza tags JSON legacy → note_tags para notas
  // creadas antes de que dispatchRoutedResult escribiera a note_tags.
  // Idempotente por key 'tags_dispatch_backfill_v1'. Nunca aborta el
  // arranque: un fallo de parseo en una nota no rompe el lote entero.
  const backfillDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key = 'tags_dispatch_backfill_v1'",
  );
  if (!backfillDone?.value) {
    try {
      const legacy = await db.getAllAsync<{ id: number; tags: string }>(
        "SELECT id, tags FROM notes WHERE tags IS NOT NULL AND tags != '[]' AND tags != 'null'",
      );
      for (const row of legacy) {
        try {
          const parsed = JSON.parse(row.tags) as unknown;
          if (!Array.isArray(parsed)) continue;
          await setTagsForNoteNoTx(
            db,
            row.id,
            parsed.filter((t): t is string => typeof t === 'string' && t.length > 0),
          );
        } catch (parseErr) {
          console.warn('[migrations] skip note', row.id, parseErr);
        }
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('tags_dispatch_backfill_v1', '1')",
      );
    } catch (e) {
      console.warn('[migrations] tags_backfill_v1 failed (no-op):', e instanceof Error ? e.message : String(e));
    }
  }

  // Migración v4 (EZE-260): tabla audio_captures para persistir audio y estado
  // antes de la transcripción y permitir reintentos.
  const v4AudioDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='audio_captures_v4'",
  );
  const v4TableExists = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='audio_captures'",
  );
  if (v4AudioDone?.value && !v4TableExists) {
    await db.runAsync(
      "DELETE FROM schema_meta WHERE key='audio_captures_v4'",
    );
  }
  if (!v4AudioDone?.value || !v4TableExists) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS audio_captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_uri TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('recorded', 'transcribing', 'transcribed', 'failed', 'completed', 'discarded')),
        transcription TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audio_captures_status
        ON audio_captures(status, created_at DESC);
    `);
    await db.runAsync(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('audio_captures_v4', '1')",
    );
  }

  // Organización de notas: colecciones, membresías y sección textual.
  const notesOrgDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='notes_org_v1'",
  );
  const collectionsTableExists = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='collections'",
  );
  const orgNoteCols = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(notes)',
  );
  const orgNoteColNames = new Set(orgNoteCols.map((column) => column.name));
  const haveOrgNoteCols = orgNoteColNames.has('section') && orgNoteColNames.has('content_type');

  if (notesOrgDone?.value && !collectionsTableExists) {
    await db.runAsync("DELETE FROM schema_meta WHERE key='notes_org_v1'");
  }
  if (!notesOrgDone?.value || !collectionsTableExists || !haveOrgNoteCols) {
    if (!notesOrgDone?.value) await backupDatabase();

    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS collections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS note_collections (
          note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          position INTEGER,
          added_at INTEGER NOT NULL,
          PRIMARY KEY (note_id, collection_id)
        );
        CREATE INDEX IF NOT EXISTS idx_note_collections_collection
          ON note_collections(collection_id, position);
      `);
      if (!orgNoteColNames.has('section')) {
        await db.execAsync('ALTER TABLE notes ADD COLUMN section TEXT;');
      }
      if (!orgNoteColNames.has('content_type')) {
        await db.execAsync(
          "ALTER TABLE notes ADD COLUMN content_type TEXT NOT NULL DEFAULT 'markdown';",
        );
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('notes_org_v1', '1')",
      );
    });
  }

  const collectionsDescriptionDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='collections_description_v1'",
  );
  const collectionCols = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(collections)',
  );
  const hasCollectionDescription = collectionCols.some(
    (column) => column.name === 'description',
  );

  if (collectionsDescriptionDone?.value && !hasCollectionDescription) {
    await db.runAsync(
      "DELETE FROM schema_meta WHERE key='collections_description_v1'",
    );
  }
  if (!collectionsDescriptionDone?.value || !hasCollectionDescription) {
    if (!hasCollectionDescription) await backupDatabase();

    await db.withTransactionAsync(async () => {
      if (!hasCollectionDescription) {
        await db.execAsync('ALTER TABLE collections ADD COLUMN description TEXT;');
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('collections_description_v1', '1')",
      );
    });
  }

  const collectionsNameDedupeDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='collections_name_dedupe_v1'",
  );
  if (!collectionsNameDedupeDone?.value) {
    await db.withExclusiveTransactionAsync(async () => {
      type CollectionNameRow = { id: number; name: string };
      type MembershipRow = {
        note_id: number;
        collection_id: number;
        position: number | null;
        added_at: number;
      };
      type CollectionGroup = {
        keeper: CollectionNameRow;
        absorbed: CollectionNameRow[];
      };

      const collectionRows = await db.getAllAsync<CollectionNameRow>(
        'SELECT id, name FROM collections ORDER BY id ASC',
      );
      const membershipRows = await db.getAllAsync<MembershipRow>(
        'SELECT note_id, collection_id, position, added_at FROM note_collections',
      );
      const groups = new Map<string, CollectionGroup>();

      for (const row of collectionRows) {
        const key = normalizedName(row.name);
        const group = groups.get(key);
        if (group) group.absorbed.push(row);
        else groups.set(key, { keeper: row, absorbed: [] });
      }

      for (const group of groups.values()) {
        if (group.absorbed.length === 0) continue;

        const groupIds = [group.keeper.id, ...group.absorbed.map((row) => row.id)];
        const groupIdSet = new Set(groupIds);
        const mergedMemberships = new Map<number, MembershipRow>();

        for (const row of membershipRows) {
          if (!groupIdSet.has(row.collection_id)) continue;
          const existing = mergedMemberships.get(row.note_id);
          if (!existing) {
            mergedMemberships.set(row.note_id, { ...row, collection_id: group.keeper.id });
            continue;
          }
          if (row.position !== null && (existing.position === null || row.position < existing.position)) {
            existing.position = row.position;
          }
          if (row.added_at < existing.added_at) existing.added_at = row.added_at;
        }

        if (group.keeper.name !== group.keeper.name.trim()) {
          await db.runAsync(
            'UPDATE collections SET name = TRIM(name) WHERE id = ?',
            group.keeper.id,
          );
        }
        const groupPlaceholders = groupIds.map(() => '?').join(', ');
        await db.runAsync(
          `DELETE FROM note_collections WHERE collection_id IN (${groupPlaceholders})`,
          ...groupIds,
        );
        for (const membership of mergedMemberships.values()) {
          await db.runAsync(
            'INSERT INTO note_collections (note_id, collection_id, position, added_at) VALUES (?, ?, ?, ?)',
            membership.note_id,
            group.keeper.id,
            membership.position,
            membership.added_at,
          );
        }
        const absorbedPlaceholders = group.absorbed.map(() => '?').join(', ');
        await db.runAsync(
          `DELETE FROM collections WHERE id IN (${absorbedPlaceholders})`,
          ...group.absorbed.map((row) => row.id),
        );
      }

      await db.runAsync(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('collections_name_dedupe_v1', '1')",
      );
    });
  }

  // El índice debe crearse después de deduplicar: si no, los duplicados existentes
  // abortan initDb y rompen el arranque.
  await db.execAsync(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name_unique ON collections (name COLLATE NOCASE)',
  );

  // Migración para relaciones entre notas (EZE-297 / Related Notes).
  const relationsDone = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM schema_meta WHERE key='note_relations_v1'",
  );
  const relationsTableExists = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='note_relations'",
  );

  if (relationsDone?.value && !relationsTableExists) {
    await db.runAsync("DELETE FROM schema_meta WHERE key='note_relations_v1'");
  }
  if (!relationsDone?.value || !relationsTableExists) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS note_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        origin TEXT NOT NULL CHECK (origin IN ('manual', 'ai', 'semantic')),
        status TEXT NOT NULL CHECK (status IN ('suggested', 'confirmed', 'rejected')),
        similarity_score REAL,
        reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (source_note_id != target_note_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_note_relations_pair
        ON note_relations(source_note_id, target_note_id);
      CREATE INDEX IF NOT EXISTS idx_note_relations_source
        ON note_relations(source_note_id, status);
      CREATE INDEX IF NOT EXISTS idx_note_relations_target
        ON note_relations(target_note_id, status);
    `);
    await db.runAsync(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('note_relations_v1', '1')",
    );
  }
}

export async function initDb(): Promise<void> {
  const db = await getDb();

  // Esquema legacy (inbox, notes, gastos, tareas, habitos_log, sueno_log).
  // CREATE TABLE IF NOT EXISTS es no-op cuando la tabla ya existe (incluso con
  // columnas extra añadidas por migración posterior).
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error_code TEXT,
      last_attempt_at INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      section TEXT,
      content_type TEXT NOT NULL DEFAULT 'markdown',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'reference',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS note_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      origin TEXT NOT NULL CHECK (origin IN ('manual', 'ai', 'semantic')),
      status TEXT NOT NULL CHECK (status IN ('suggested', 'confirmed', 'rejected')),
      similarity_score REAL,
      reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (source_note_id != target_note_id)
    );

    CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_note_relations_pair ON note_relations(source_note_id, target_note_id);
    CREATE INDEX IF NOT EXISTS idx_note_relations_source ON note_relations(source_note_id, status);
    CREATE INDEX IF NOT EXISTS idx_note_relations_target ON note_relations(target_note_id, status);

    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      description TEXT,
      category TEXT,
      date TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tareas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      due_date TEXT,
      priority TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habitos_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done', 'missed')),
      date TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sueno_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hours REAL NOT NULL,
      deep_sleep_percentage REAL NOT NULL,
      quality TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gastos_created_at ON gastos(created_at);
    CREATE INDEX IF NOT EXISTS idx_tareas_created_at ON tareas(created_at);
    CREATE INDEX IF NOT EXISTS idx_habitos_log_created_at ON habitos_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_sueno_log_created_at ON sueno_log(created_at);
  `);

  // FTS5 y triggers viven dentro de runMigrations() (DROP+recreate con schema
  // nuevo). Mantenerlos fuera evita conflicto de schema entre runs.

  await runMigrations(db);
}

export async function updateInboxStatus(id: number, status: InboxRow['status']): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE inbox SET status = ? WHERE id = ?', status, id);
}

export async function deleteInboxItem(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync(
    "DELETE FROM inbox WHERE id = ? AND status = 'pending'",
    id,
  );
  return result.changes > 0;
}

export async function updatePendingInboxText(id: number, rawText: string): Promise<boolean> {
  const normalizedText = rawText.trim();
  if (!normalizedText) return false;
  const db = await getDb();
  const result = await db.runAsync(
    `UPDATE inbox
      SET raw_text=?, error_code=NULL, last_attempt_at=NULL,
          attempt_count=0, next_retry_at=NULL
      WHERE id=? AND status='pending'`,
    normalizedText,
    id,
  );
  return result.changes > 0;
}

export async function insertInbox(raw_text: string): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO inbox (raw_text, created_at, status) VALUES (?, ?, ?)',
    raw_text,
    Date.now(),
    'pending',
  );
  return result.lastInsertRowId;
}

export async function getPendingInbox(force = false): Promise<InboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<InboxRow>(
    `SELECT * FROM inbox
      WHERE status = 'pending'
        AND (? = 1 OR attempt_count = 0 OR (next_retry_at IS NOT NULL AND next_retry_at <= ?))
      ORDER BY created_at ASC`,
    force ? 1 : 0,
    Date.now(),
  );
}

export async function getNextPendingInboxRetryAt(): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ next_retry_at: number | null }>(
    `SELECT MIN(next_retry_at) AS next_retry_at
       FROM inbox
      WHERE status = 'pending'
        AND next_retry_at IS NOT NULL`,
  );
  return row?.next_retry_at ?? null;
}

export async function getPendingInboxSummary(): Promise<PendingInboxSummary> {
  const db = await getDb();
  const row = await db.getFirstAsync<PendingInboxSummary>(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS failed,
      (
        SELECT error_code
        FROM inbox AS latest
        WHERE latest.status = 'pending' AND latest.error_code IS NOT NULL
        ORDER BY COALESCE(latest.last_attempt_at, latest.created_at) DESC
        LIMIT 1
      ) AS latest_error_code
    FROM inbox
    WHERE status = 'pending'
  `);
  return row ?? { total: 0, failed: 0, latest_error_code: null };
}

export async function countPendingInbox(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM inbox WHERE status = 'pending'",
  );
  return row?.count ?? 0;
}

export async function getGastos(): Promise<GastosRow[]> {
  const db = await getDb();
  return db.getAllAsync<GastosRow>('SELECT * FROM gastos ORDER BY created_at DESC');
}

export async function getTareas(): Promise<TareasRow[]> {
  const db = await getDb();
  return db.getAllAsync<TareasRow>('SELECT * FROM tareas ORDER BY created_at DESC');
}

export async function verifyDb(): Promise<boolean> {
  try {
    const db = await getDb();
    const result = await db.getFirstAsync<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'"
    );
    return (result?.cnt ?? 0) >= 7;
  } catch {
    return false;
  }
}

// V1: dispatchRoutedResult retorna `number[]` con los rowids insertados.
// Para type='nota' el cuerpo es SIEMPRE `rawText` (inbox.raw_text); el LLM
// solo aporta metadata (title/tags sugeridos) vía `content`. Sin fila
// "fuente", sin notas atómicas, sin escrituras en note_links.
// I1 (no negociable): no usar withTransactionAsync dentro — el caller es
// quien gestiona la transacción (ver processInboxItem en src/services/inbox.ts).
export async function dispatchRoutedResult(
  type: RouteType,
  content: Record<string, unknown>,
  rawText: string,
): Promise<number[]> {
  const db = await getDb();
  const now = Date.now();

  switch (type) {
    case 'nota': {
      // Título: sugerido por el LLM o primera línea del original (≤80 chars).
      const suggested = typeof content.title === 'string' ? content.title.trim() : '';
      const firstLine = rawText.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
      const title = (suggested || firstLine).slice(0, 80) || 'Nota sin título';
      const tags = Array.isArray(content.tags)
        ? (content.tags as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t.trim().length > 0,
          )
        : [];
      // Timestamps en segundos (alineado con getSections / queries/notes.ts).
      const nowSec = Math.floor(now / 1000);
      const res = await db.runAsync(
        'INSERT INTO notes (title, content, body_md, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        title,
        rawText,
        rawText,
        JSON.stringify(tags),
        nowSec,
        nowSec,
      );
      const noteId = Number(res.lastInsertRowId);
      await setTagsForNoteNoTx(db, noteId, tags);
      return [noteId];
    }
    case 'gasto': {
      const amount = content.amount as number;
      const description = content.description as string | null;
      const category = content.category as string | null;
      const date = content.date as string | null;
      const res = await db.runAsync(
        'INSERT INTO gastos (amount, description, category, date, created_at) VALUES (?, ?, ?, ?, ?)',
        amount,
        description,
        category,
        date,
        now,
      );
      return [res.lastInsertRowId];
    }
    case 'tarea': {
      const title = content.title as string;
      const due_date = content.due_date as string | null;
      const priority = content.priority as string | null;
      const res = await db.runAsync(
        'INSERT INTO tareas (title, due_date, priority, created_at) VALUES (?, ?, ?, ?)',
        title,
        due_date,
        priority,
        now,
      );
      return [res.lastInsertRowId];
    }
    case 'habito': {
      const habit_name = content.habit_name as string;
      const status = content.status as string;
      const date = content.date as string;
      const res = await db.runAsync(
        'INSERT INTO habitos_log (habit_name, status, date, created_at) VALUES (?, ?, ?, ?)',
        habit_name,
        status,
        date,
        now,
      );
      return [res.lastInsertRowId];
    }
    case 'sueno': {
      const hours = content.hours as number;
      const deep_sleep_percentage = content.deep_sleep_percentage as number;
      const quality = content.quality as string;
      const date = content.date as string;
      const res = await db.runAsync(
        'INSERT INTO sueno_log (hours, deep_sleep_percentage, quality, date, created_at) VALUES (?, ?, ?, ?, ?)',
        hours,
        deep_sleep_percentage,
        quality,
        date,
        now,
      );
      return [res.lastInsertRowId];
    }
  }
}
