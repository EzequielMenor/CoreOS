// Regresión para findCandidateNotes con FTS5 real (node:sqlite = mismo motor
// FTS5 del dispositivo y del CLI sqlite3). Reproduce el bug: el gate 0.2
// descartaba el top de FTS porque la normalización |bm25|*0.05 da un piso de
// 0.1 cuando bm25 es minúsculo (SQLite clampa el IDF si el término aparece en
// >= 50% de los documentos).
import type { DatabaseSync } from 'node:sqlite';
import { findCandidateNotes } from '../note-relations';

// Esquema fidélito a notes_org_v1 / note_relations_v1 (src/db/index.tsx).
// El factory expone __db para que el test inserte las notas del escenario.
jest.mock('@/db', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');

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
    CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts (title, body_md, tags_names) VALUES (new.title, new.body_md, new.tags);
    END;
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE note_tags (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );
    CREATE TABLE note_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      origin TEXT NOT NULL DEFAULT 'semantic',
      status TEXT NOT NULL DEFAULT 'suggested',
      similarity_score REAL,
      reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const adapter = {
    getAllAsync: async <T>(sql: string, ...params: unknown[]): Promise<T[]> =>
      sqlite.prepare(sql).all(...(params as never[])) as unknown as T[],
    getFirstAsync: async <T>(sql: string, ...params: unknown[]): Promise<T | null> =>
      (sqlite.prepare(sql).get(...(params as never[])) ?? null) as T | null,
    runAsync: async (): Promise<{ lastInsertRowId: number }> => {
      throw new Error('runAsync not expected in findCandidateNotes');
    },
  };

  return { getDb: async () => adapter, __db: sqlite };
});

const NOW = 1700000000;

// Notas del caso de regresión: claramente relacionadas por contenido, sin tags.
const NOTE_A =
  'Ideas para mejorar CoreOS: captura rápida, notas relacionadas y búsqueda local-first.';
const NOTE_B =
  'CoreOS debería sugerir conexiones entre notas sin obligarme a usar enlaces tipo wiki.';
const NOTE_UNRELATED = 'Receta de lentejas: sofreír cebolla, añadir lentejas, agua y laurel.';

describe('findCandidateNotes with real FTS5 (node:sqlite)', () => {
  let noteAId: number;
  let noteBId: number;
  let unrelatedId: number;

  beforeEach(() => {
    const mocked = jest.requireMock('@/db') as { __db: DatabaseSync };
    const insert = mocked.__db.prepare(
      'INSERT INTO notes (title, body_md, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    // Limpiar el esquema singleton entre tests (DELETE dispara notes_ad vía trigger solo en DELETE FROM notes;
    // aquí las tablas se recrean una vez, así que borramos filas directamente).
    mocked.__db.exec('DELETE FROM note_relations; DELETE FROM notes;');
    noteAId = Number(insert.run('Ideas para mejorar CoreOS', NOTE_A, 'active', NOW, NOW).lastInsertRowid);
    noteBId = Number(insert.run('Sugerir conexiones entre notas', NOTE_B, 'active', NOW, NOW).lastInsertRowid);
    unrelatedId = Number(insert.run('Receta de lentejas', NOTE_UNRELATED, 'active', NOW, NOW).lastInsertRowid);
  });

  it('keeps an FTS-related note as a local candidate instead of dropping it', async () => {
    const candidates = await findCandidateNotes(noteAId, 6);

    const candidateIds = candidates.map((c) => c.note.id);
    expect(candidateIds).toContain(noteBId);
    expect(candidateIds).not.toContain(unrelatedId);
    expect(candidateIds).not.toContain(noteAId);
    // Retrieval permisivo, ranking ordena: el mejor match va primero.
    expect(candidates[0]?.note.id).toBe(noteBId);
  });

  it('still rejects lexically unrelated notes (noise control intact)', async () => {
    const candidates = await findCandidateNotes(noteAId, 6);
    expect(candidates.map((c) => c.note.id)).not.toContain(unrelatedId);
  });
});
