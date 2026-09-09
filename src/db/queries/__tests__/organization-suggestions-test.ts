// Sugerencias de organización basadas solo en datos locales (EZE-297). Sin LLM:
// una Biblioteca sin API key configurada tiene que seguir recibiendo ayudas.
// node:sqlite = mismo motor SQLite del dispositivo.
import type { DatabaseSync } from 'node:sqlite';

import { suggestOrganization } from '../organization-suggestions';

interface Harness {
  __db: DatabaseSync;
}

jest.mock('@/db', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body_md TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      pinned INTEGER NOT NULL DEFAULT 0,
      parent_id INTEGER,
      section TEXT,
      content_type TEXT NOT NULL DEFAULT 'markdown',
      created_at INTEGER NOT NULL DEFAULT 1700000000,
      updated_at INTEGER NOT NULL DEFAULT 1700000000,
      deleted_at INTEGER
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE note_tags (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT 1700000000,
      updated_at INTEGER NOT NULL DEFAULT 1700000000
    );
    CREATE TABLE note_collections (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      position INTEGER,
      added_at INTEGER NOT NULL DEFAULT 1700000000,
      PRIMARY KEY (note_id, collection_id)
    );
  `);

  const adapter = {
    getAllAsync: async <T>(sql: string, ...params: unknown[]): Promise<T[]> =>
      sqlite.prepare(sql).all(...(params as never[])) as unknown as T[],
    getFirstAsync: async <T>(sql: string, ...params: unknown[]): Promise<T | null> =>
      (sqlite.prepare(sql).get(...(params as never[])) ?? null) as T | null,
    runAsync: async (sql: string, ...params: unknown[]) => {
      const info = sqlite.prepare(sql).run(...(params as never[]));
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
    },
  };

  return { getDb: async () => adapter, __db: sqlite };
});

const harness = (): Harness => jest.requireMock('@/db') as Harness;

function addNote(
  title: string,
  options: { section?: string; tags?: string[]; collections?: string[]; deletedAt?: number } = {},
): number {
  const { __db } = harness();
  const id = Number(
    __db
      .prepare('INSERT INTO notes (title, body_md, section, deleted_at) VALUES (?, ?, ?, ?)')
      .run(title, `${title} cuerpo`, options.section ?? null, options.deletedAt ?? null)
      .lastInsertRowid,
  );
  for (const tag of options.tags ?? []) {
    const tagRow = __db
      .prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id')
      .get(tag) as { id: number };
    __db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(id, Number(tagRow.id));
  }
  for (const name of options.collections ?? []) {
    // collections.name NO es UNIQUE en produccion (notes_org_v1), pero una
    // coleccion existente se reutiliza por id: el arnés replica eso, no la
    // creación duplicada.
    const existing = __db
      .prepare('SELECT id FROM collections WHERE name = ?')
      .get(name) as { id: number } | undefined;
    const collId = existing
      ? Number(existing.id)
      : Number(
          __db.prepare('INSERT INTO collections (name) VALUES (?)').run(name).lastInsertRowid,
        );
    __db
      .prepare('INSERT INTO note_collections (note_id, collection_id) VALUES (?, ?)')
      .run(id, collId);
  }
  return id;
}

function reset(): void {
  const { __db } = harness();
  __db.exec(
    'DELETE FROM note_collections; DELETE FROM collections; DELETE FROM note_tags; DELETE FROM tags; DELETE FROM notes;',
  );
}

describe('suggestOrganization (local-first, EZE-297)', () => {
  beforeEach(reset);

  it('suggests the section the tag peers agree on', async () => {
    const target = addNote('Nota nueva sin sección', { tags: ['lectura'] });
    addNote('Par 1', { tags: ['lectura'], section: 'Estudio' });
    addNote('Par 2', { tags: ['lectura'], section: 'Estudio' });

    const suggestion = await suggestOrganization(target);

    expect(suggestion.section).toBe('Estudio');
  });

  it('suggests the collection the peers agree on', async () => {
    const target = addNote('Otra sin colección', { tags: ['proyecto'] });
    addNote('Par A', { tags: ['proyecto'], collections: ['CoreOS'] });
    addNote('Par B', { tags: ['proyecto'], collections: ['CoreOS'] });

    const suggestion = await suggestOrganization(target);

    expect(suggestion.collection?.name).toBe('CoreOS');
  });

  it('suggests tags the peers carry that the note does not have yet', async () => {
    const target = addNote('Sin tags', { tags: ['unica'] });
    addNote('Par X', { tags: ['unica', 'arquitectura'] });
    addNote('Par Y', { tags: ['unica', 'arquitectura'] });

    const suggestion = await suggestOrganization(target);

    expect(suggestion.tags).toContain('arquitectura');
    expect(suggestion.tags).not.toContain('unica');
  });

  it('falls back to collection siblings when the note has no tags', async () => {
    const target = addNote('Hermano sin tags', { collections: ['Curso de SQL'] });
    addNote('Hermana 1', { tags: ['sql'], section: 'Estudio' });
    addNote('Hermana 2', { tags: ['sql'], section: 'Estudio' });
    // ambas dentro del mismo curso que target
    const { __db } = harness();
    const collRow = __db
      .prepare('SELECT id FROM collections WHERE name = ?')
      .get('Curso de SQL') as { id: number };
    for (const title of ['Hermana 1', 'Hermana 2']) {
      const noteRow = __db
        .prepare('SELECT id FROM notes WHERE title = ?')
        .get(title) as { id: number };
      __db
        .prepare('INSERT INTO note_collections (note_id, collection_id) VALUES (?, ?)')
        .run(Number(noteRow.id), Number(collRow.id));
    }

    const suggestion = await suggestOrganization(target);

    expect(suggestion.section).toBe('Estudio');
    expect(suggestion.tags).toContain('sql');
  });

  it('stays quiet when there is not enough agreement to be useful', async () => {
    const target = addNote('Aislada', { tags: ['raro'] });
    // un solo par, con un solo tag compartido: ruido, no señal
    addNote('Par único', { tags: ['raro'], section: 'Capricho', collections: ['Sueltos'] });

    const suggestion = await suggestOrganization(target);

    expect(suggestion.section).toBeNull();
    expect(suggestion.collection).toBeNull();
    expect(suggestion.tags).toEqual([]);
  });

  it('ignores soft-deleted peers', async () => {
    const target = addNote('Viva', { tags: ['compartido'] });
    addNote('Borrada 1', { tags: ['compartido'], section: 'Estudio', deletedAt: 1700000000 });
    addNote('Borrada 2', { tags: ['compartido'], section: 'Estudio', deletedAt: 1700000000 });

    const suggestion = await suggestOrganization(target);

    expect(suggestion.section).toBeNull();
  });

  it('returns an empty suggestion for an unknown note id instead of throwing', async () => {
    await expect(suggestOrganization(9999)).resolves.toEqual({
      section: null,
      collection: null,
      tags: [],
    });
  });

  it('breaks ties deterministically so chips do not jump between opens', async () => {
    const target = addNote('Empatada', { tags: ['pivot'] });
    addNote('P1', { tags: ['pivot'], section: 'Beta' });
    addNote('P2', { tags: ['pivot'], section: 'Alfa' });
    addNote('P3', { tags: ['pivot'], section: 'Alfa' });
    addNote('P4', { tags: ['pivot'], section: 'Beta' });

    const first = await suggestOrganization(target);
    const second = await suggestOrganization(target);

    expect(first.section).toBe(second.section);
    expect(first.section).toBe('Alfa');
  });
});
