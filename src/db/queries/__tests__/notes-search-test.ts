// Regresión para searchNotesWithScore con FTS5 real (node:sqlite = mismo motor
// FTS5 del dispositivo). Cubre EZE-297 «buscar por título y contenido de todas
// las notas»: la query se envolvía entera como frase exacta, así que
// «arquitectura alpha» no encontraba una nota que tenía ambas palabras separadas.
import type { DatabaseSync } from 'node:sqlite';
import { searchNotesWithScore } from '../notes';
import { FTS_REINDEX_SQL } from '../../fts-triggers';

// Esquema fidélito a notes_org_v1 / collections (src/db/index.tsx). Los triggers
// NO se copian a mano: se importa el mismo FTS_TRIGGER_DDL que ejecuta initDb,
// así el test no puede quedarse verde con triggers de producción rotos.
jest.mock('@/db', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { FTS_TRIGGER_DDL } = jest.requireActual('../../fts-triggers') as typeof import('../../fts-triggers');

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      body_md TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      pinned INTEGER NOT NULL DEFAULT 0,
      parent_id INTEGER,
      section TEXT,
      content_type TEXT NOT NULL DEFAULT 'markdown',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE VIRTUAL TABLE notes_fts USING fts5(title, body_md, tags_names, tokenize = 'porter unicode61');
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE note_tags (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE note_collections (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      position INTEGER,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (note_id, collection_id)
    );
  `);
  sqlite.exec(FTS_TRIGGER_DDL);

  const stats = { getAllAsync: 0 };
  const adapter = {
    getAllAsync: async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      stats.getAllAsync += 1;
      return sqlite.prepare(sql).all(...(params as never[])) as unknown as T[];
    },
    getFirstAsync: async <T>(sql: string, ...params: unknown[]): Promise<T | null> =>
      (sqlite.prepare(sql).get(...(params as never[])) ?? null) as T | null,
    runAsync: async (): Promise<{ lastInsertRowId: number }> => {
      throw new Error('runAsync not expected in searchNotesWithScore');
    },
  };

  return { getDb: async () => adapter, __db: sqlite, __stats: stats };
});

const NOW = 1700000000;

function insertNote(
  title: string,
  body: string,
  options: { section?: string; deletedAt?: number } = {},
): number {
  const { __db } = jest.requireMock('@/db') as { __db: DatabaseSync };
  return Number(
    __db
      .prepare(
        'INSERT INTO notes (title, body_md, status, section, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        title,
        body,
        'active',
        options.section ?? null,
        NOW,
        NOW,
        options.deletedAt ?? null,
      ).lastInsertRowid,
  );
}

function tagNote(noteId: number, name: string): void {
  const { __db } = jest.requireMock('@/db') as { __db: DatabaseSync };
  const tagRow = __db
    .prepare(
      'INSERT INTO tags (name) VALUES (?) ON CONFLICT DO UPDATE SET name = excluded.name RETURNING id',
    )
    .get(name) as { id: number };
  const tagId = Number(tagRow.id);
  __db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tagId);
}

function putInCollection(noteId: number, collectionName: string): void {
  const { __db } = jest.requireMock('@/db') as { __db: DatabaseSync };
  const info = __db
    .prepare('INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?) RETURNING id')
    .get(collectionName, NOW, NOW) as { id: number };
  __db
    .prepare(
      'INSERT INTO note_collections (note_id, collection_id, position, added_at) VALUES (?, ?, ?, ?)',
    )
    .run(noteId, Number(info.id), 0, NOW);
}

function resetTables(): void {
  const { __db, __stats } = jest.requireMock('@/db') as {
    __db: DatabaseSync;
    __stats: { getAllAsync: number };
  };
  __stats.getAllAsync = 0;
  __db.exec(
    'DELETE FROM note_collections; DELETE FROM collections; DELETE FROM note_tags; DELETE FROM tags; DELETE FROM notes;',
  );
}

const idsOf = (hits: { note: { id: number } }[]) => hits.map((hit) => hit.note.id);

describe('searchNotesWithScore with real FTS5 (node:sqlite)', () => {
  beforeEach(resetTables);

  it('matches several words that are not adjacent in the body', async () => {
    const target = insertNote(
      'Notas del proyecto',
      'La arquitectura de CoreOS todavía no tiene capa semántica.',
    );
    insertNote('Receta de lentejas', 'Sofreír cebolla y añadir lentejas.');

    const hits = await searchNotesWithScore('arquitectura semántica');

    expect(idsOf(hits)).toContain(target);
  });

  it('matches a prefix while the user is still typing', async () => {
    const target = insertNote('Diseño de UI', 'Pensado para captura rápida en móvil.');

    const hits = await searchNotesWithScore('dis');

    expect(idsOf(hits)).toContain(target);
  });
  it('combines a full word with a half-typed last word', async () => {
    const target = insertNote('Arquitectura', 'todavía sin la palabra núcleo');
    insertNote('Otra', 'nada que ver aquí');

    const hits = await searchNotesWithScore('arquitectura núcle');

    expect(idsOf(hits)).toEqual([target]);
  });

  it('searches title and body', async () => {
    const byTitle = insertNote('Protocolo TCP', 'texto sin la palabra clave');
    const byBody = insertNote('Otra cosa', 'repaso el protocolo mañana');
    insertNote('Ruido', 'no tiene nada que ver');

    const hits = await searchNotesWithScore('protocolo');

    expect(idsOf(hits).sort()).toEqual([byTitle, byBody].sort());
    expect(hits.length).toBe(2);
  });

  it('finds a note by a tag added after it was created (EZE-298)', async () => {
    const tagged = insertNote('Apunte etiquetado', 'cuerpo neutro');
    tagNote(tagged, 'protocolo');

    const hits = await searchNotesWithScore('protocolo');

    expect(idsOf(hits)).toContain(tagged);
  });

  it('drops a tag from the index when the tag is removed', async () => {
    const tagged = insertNote('Apunte etiquetado', 'cuerpo neutro');
    tagNote(tagged, 'retirable');

    const { __db } = jest.requireMock('@/db') as { __db: DatabaseSync };
    __db.prepare('UPDATE notes SET title = ? WHERE id = ?').run('Apunte actualizado', tagged);

    const taggedHits = await searchNotesWithScore('retirable');
    expect(idsOf(taggedHits)).toContain(tagged);

    __db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(tagged);

    const untaggedHits = await searchNotesWithScore('retirable');
    expect(idsOf(untaggedHits)).not.toContain(tagged);
  });

  // FTS_REINDEX_SQL es lo que repara los dispositivos donde tags_names quedó
  // stale: corregir los triggers no alcanza para las notas ya etiquetadas.
  it('repairs an already-stale tag index with the versioned reindex', async () => {
    const stale = insertNote('Nota anterior al fix', 'cuerpo neutro');
    tagNote(stale, 'legado');

    const { __db } = jest.requireMock('@/db') as { __db: DatabaseSync };
    __db.prepare("UPDATE notes_fts SET tags_names = '' WHERE rowid = ?").run(stale);

    const beforeHits = await searchNotesWithScore('legado');
    expect(idsOf(beforeHits)).not.toContain(stale);

    __db.exec(FTS_REINDEX_SQL);

    const afterHits = await searchNotesWithScore('legado');
    expect(idsOf(afterHits)).toContain(stale);
  });

  it('carries the organization context of each result', async () => {
    const organized = insertNote('Capítulo 3', 'Resumen del capítulo tres.', {
      section: 'Estudio',
    });
    putInCollection(organized, 'Libro de hábitos');
    putInCollection(organized, 'Lectura 2026');
    const loose = insertNote('Apunte suelto', 'Nota sin organizar todavía.');

    const organizedHits = await searchNotesWithScore('capítulo');
    expect(organizedHits[0]?.note.section).toBe('Estudio');
    // Orden estable por nombre para que el chip no salte entre búsquedas.
    expect(organizedHits[0]?.note.collectionNames).toEqual([
      'Lectura 2026',
      'Libro de hábitos',
    ]);

    const looseHits = await searchNotesWithScore('suelto');
    expect(looseHits[0]?.note.id).toBe(loose);
    expect(looseHits[0]?.note.collectionNames).toEqual([]);
  });

  it('loads collection context in one batch query, not one per row', async () => {
    for (let i = 0; i < 6; i += 1) {
      const id = insertNote(`Parte ${i}`, `capitulo ${i} del mismo libro`);
      putInCollection(id, 'Curso de SQLite');
    }

    const { __stats } = jest.requireMock('@/db') as { __stats: { getAllAsync: number } };
    __stats.getAllAsync = 0;
    const hits = await searchNotesWithScore('capitulo');

    expect(hits.length).toBe(6);
    // 1 para los matches + 1 para el contexto de colecciones, pase lo que pase.
    expect(__stats.getAllAsync).toBe(2);
  });

  // El titulo es la señal mas fuerte de una biblioteca de conocimiento. Con los
  // pesos por defecto de bm25, una nota que solo repite la palabra en el cuerpo
  // le ganaba a la que se LLAMA asi.
  it('ranks a title match above a body that repeats the term', async () => {
    const byTitle = insertNote('Arquitectura del motor', 'capitulo uno del libro de fisica');
    const byBody = insertNote(
      'Reunion',
      'arquitectura arquitectura arquitectura arquitectura arquitectura',
    );
    for (let i = 0; i < 8; i += 1) {
      insertNote(`Relleno ${i}`, 'texto variado del dia a dia sin relacion');
    }

    const hits = await searchNotesWithScore('arquitectura');

    expect(hits.map((hit) => hit.note.id)).toEqual([
      byTitle,
      byBody,
      ...hits.map((hit) => hit.note.id).filter((id) => id !== byTitle && id !== byBody),
    ]);
  });

  it('caps the result set so a large library stays responsive', async () => {
    for (let i = 0; i < 120; i += 1) {
      insertNote(`Nota grande ${i}`, `comparte la palabra manifiesto ${i}`);
    }

    const hits = await searchNotesWithScore('manifiesto');

    expect(hits.length).toBeLessThanOrEqual(50);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('excludes soft-deleted notes', async () => {
    const gone = insertNote('Papelera', 'contenido borrado', { deletedAt: NOW });

    const hits = await searchNotesWithScore('borrado');

    expect(idsOf(hits)).not.toContain(gone);
  });

  it('does not throw on FTS5 operator characters coming from the keyboard', async () => {
    insertNote('Sintaxis', 'El usuario escribe "comillas" y (paréntesis) y * asteriscos.');

    for (const raw of ['"comillas"', 'AND OR NOT', '(paréntesis)', '* asterisco', 'NEAR/x', '-']) {
      const hits = await searchNotesWithScore(raw);
      expect(Array.isArray(hits)).toBe(true);
    }
  });

  it('returns nothing for an empty or whitespace-only query', async () => {
    insertNote('Algo', 'cualquier cosa');

    expect(await searchNotesWithScore('')).toEqual([]);
    expect(await searchNotesWithScore('   ')).toEqual([]);
  });
});
