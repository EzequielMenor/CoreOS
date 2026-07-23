import * as SQLite from 'expo-sqlite';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import { File } from 'expo-file-system';
import { RouteType } from '../services/llm';

const DB_NAME = 'coreos.db';
const DB_DIR: string = defaultDatabaseDirectory as string;

export interface InboxRow {
  id: number;
  raw_text: string;
  created_at: number;
  status: 'pending' | 'processed' | 'archived';
}

export interface NoteRow {
  id: number;
  title: string;
  content: string;
  tags: string; // JSON string[]
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

export interface SuenoRow {
  id: number;
  hours: number;
  deep_sleep_percentage: number;
  quality: string;
  date: string;
  created_at: number;
}

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  return _db;
}

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
// existe, la función retorna sin tocar nada. Sin key → toda la mutación corre
// dentro de una transacción atómica.
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

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
  if (done?.value && haveNewTables) return;
  if (done?.value && !haveNewTables) {
    await db.execAsync(
      "DELETE FROM schema_meta WHERE key = 'notes_v1_migration'",
    );
  }

  await backupDatabase();

  await db.withTransactionAsync(async () => {
    // 1. Columnas nuevas en notes (defaults rellenan para filas legacy).
    await db.execAsync(`
      ALTER TABLE notes ADD COLUMN body_md TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE notes ADD COLUMN parent_id INTEGER REFERENCES notes(id) ON DELETE SET NULL;
      ALTER TABLE notes ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE notes ADD COLUMN deleted_at INTEGER;
      ALTER TABLE notes ADD COLUMN sync_status TEXT;
      ALTER TABLE notes ADD COLUMN server_id TEXT;
      ALTER TABLE notes ADD COLUMN server_updated_at INTEGER;
    `);

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
    //    Los triggers referencian body_md (ya añadido en paso 1).
    await db.execAsync(`
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body_md, tags_names)
        VALUES (new.id, new.title, new.body_md,
          COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
            FROM note_tags nt JOIN tags t ON t.id=nt.tag_id
            WHERE nt.note_id=new.id), ''));
      END;
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body_md, tags_names)
        VALUES ('delete', old.id, old.title, old.body_md, '');
      END;
      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body_md, tags_names)
        VALUES ('delete', old.id, old.title, old.body_md, '');
        INSERT INTO notes_fts(rowid, title, body_md, tags_names)
        VALUES (new.id, new.title, new.body_md,
          COALESCE((SELECT GROUP_CONCAT(t.name, ' ')
            FROM note_tags nt JOIN tags t ON t.id=nt.tag_id
            WHERE nt.note_id=new.id), ''));
      END;
      CREATE TRIGGER IF NOT EXISTS note_tags_ai AFTER INSERT ON note_tags BEGIN
        UPDATE notes SET updated_at = (unixepoch()) WHERE id = new.note_id;
        INSERT INTO notes_fts(notes_fts, rowid, title, body_md, tags_names)
          VALUES ('delete', new.note_id,
            (SELECT title FROM notes WHERE id=new.note_id),
            (SELECT body_md FROM notes WHERE id=new.note_id), '');
        INSERT INTO notes_fts(rowid, title, body_md, tags_names)
          VALUES (new.note_id,
            (SELECT title FROM notes WHERE id=new.note_id),
            (SELECT body_md FROM notes WHERE id=new.note_id),
            (SELECT GROUP_CONCAT(t.name, ' ') FROM tags t
              JOIN note_tags nt ON nt.tag_id=t.id WHERE nt.note_id=new.note_id));
      END;
      CREATE TRIGGER IF NOT EXISTS note_tags_ad AFTER DELETE ON note_tags BEGIN
        UPDATE notes SET updated_at = (unixepoch()) WHERE id = old.note_id;
        INSERT INTO notes_fts(notes_fts, rowid, title, body_md, tags_names)
          VALUES ('delete', old.note_id,
            (SELECT title FROM notes WHERE id=old.note_id),
            (SELECT body_md FROM notes WHERE id=old.note_id), '');
        INSERT INTO notes_fts(rowid, title, body_md, tags_names)
          VALUES (old.note_id,
            (SELECT title FROM notes WHERE id=old.note_id),
            (SELECT body_md FROM notes WHERE id=old.note_id),
            (SELECT GROUP_CONCAT(t.name, ' ') FROM tags t
              JOIN note_tags nt ON nt.tag_id=t.id WHERE nt.note_id=old.note_id));
      END;
    `);

    // 7. Marcar la migración como hecha (dentro de la tx → atómica).
    await db.runAsync(
      "INSERT INTO schema_meta (key, value) VALUES ('notes_v1_migration', '1')",
    );
  });
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
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
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

    CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_id);

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

export async function deleteInboxItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM inbox WHERE id = ?', id);
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

export async function getPendingInbox(): Promise<InboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<InboxRow>(
    "SELECT * FROM inbox WHERE status = 'pending' ORDER BY created_at DESC",
  );
}

export async function getNotes(): Promise<NoteRow[]> {
  const db = await getDb();
  return db.getAllAsync<NoteRow>('SELECT * FROM notes ORDER BY created_at DESC');
}

export async function getAtomicNotes(): Promise<NoteRow[]> {
  // Mini-ensayos: excluye notas crudas marcadas como "fuente"
  const db = await getDb();
  return db.getAllAsync<NoteRow>(
    `SELECT * FROM notes WHERE tags NOT LIKE '%"fuente"%' ORDER BY created_at DESC`
  );
}

export async function getGastos(): Promise<GastosRow[]> {
  const db = await getDb();
  return db.getAllAsync<GastosRow>('SELECT * FROM gastos ORDER BY created_at DESC');
}

export async function getTareas(): Promise<TareasRow[]> {
  const db = await getDb();
  return db.getAllAsync<TareasRow>('SELECT * FROM tareas ORDER BY created_at DESC');
}

export async function getSueno(): Promise<SuenoRow[]> {
  const db = await getDb();
  return db.getAllAsync<SuenoRow>('SELECT * FROM sueno_log ORDER BY created_at DESC');
}

export async function resetDatabase(): Promise<void> {
  if (_db) {
    await _db.closeAsync();
    _db = null;
  }
  await SQLite.deleteDatabaseAsync(DB_NAME);
  console.log('[db] database deleted, ready for fresh initDb');
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

export async function dispatchRoutedResult(
  type: RouteType,
  content: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  switch (type) {
    case 'nota': {
      const originalText = (content.original_text as string) ?? '';
      const atomicNotes = (content.atomic_notes as Array<{ title: string; body: string; tags: string[] }>) ?? [];

      // a) Insertar nota fuente
      const hoy = new Date().toISOString().slice(0, 10);
      const fuenteRes = await db.runAsync(
        'INSERT INTO notes (title, content, tags, created_at) VALUES (?, ?, ?, ?)',
        `Fuente: ${hoy}`,
        originalText,
        JSON.stringify(['fuente']),
        now,
      );
      const sourceId = fuenteRes.lastInsertRowId;

      // b) Insertar notas atómicas + c) crear enlaces
      for (const note of atomicNotes) {
        const notaRes = await db.runAsync(
          'INSERT INTO notes (title, content, tags, created_at) VALUES (?, ?, ?, ?)',
          note.title,
          note.body,
          JSON.stringify(note.tags ?? []),
          now,
        );
        const atomicId = notaRes.lastInsertRowId;

        await db.runAsync(
          'INSERT INTO note_links (source_id, target_id, link_type, created_at) VALUES (?, ?, ?, ?)',
          sourceId,
          atomicId,
          'extract',
          now,
        );
      }
      break;
    }
    case 'gasto': {
      const amount = content.amount as number;
      const description = content.description as string | null;
      const category = content.category as string | null;
      const date = content.date as string | null;
      await db.runAsync(
        'INSERT INTO gastos (amount, description, category, date, created_at) VALUES (?, ?, ?, ?, ?)',
        amount,
        description,
        category,
        date,
        now,
      );
      break;
    }
    case 'tarea': {
      const title = content.title as string;
      const due_date = content.due_date as string | null;
      const priority = content.priority as string | null;
      await db.runAsync(
        'INSERT INTO tareas (title, due_date, priority, created_at) VALUES (?, ?, ?, ?)',
        title,
        due_date,
        priority,
        now,
      );
      break;
    }
    case 'habito': {
      const habit_name = content.habit_name as string;
      const status = content.status as string;
      const date = content.date as string;
      await db.runAsync(
        'INSERT INTO habitos_log (habit_name, status, date, created_at) VALUES (?, ?, ?, ?)',
        habit_name,
        status,
        date,
        now,
      );
      break;
    }
    case 'sueno': {
      const hours = content.hours as number;
      const deep_sleep_percentage = content.deep_sleep_percentage as number;
      const quality = content.quality as string;
      const date = content.date as string;
      await db.runAsync(
        'INSERT INTO sueno_log (hours, deep_sleep_percentage, quality, date, created_at) VALUES (?, ?, ?, ?, ?)',
        hours,
        deep_sleep_percentage,
        quality,
        date,
        now,
      );
      break;
    }
  }
}
