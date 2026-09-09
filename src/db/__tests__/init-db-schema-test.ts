/* eslint-disable @typescript-eslint/no-require-imports */
// Los requires de abajo son deliberados: cada test necesita un registry limpio
// tras jest.resetModules(), y un import estático quedaría hoisted y cacheado.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));

type DbModule = typeof import('@/db');
type NotesModule = typeof import('@/db/queries/notes');
type TagsModule = typeof import('@/db/queries/tags');
type RawRow = Record<string, unknown>;

let dbModule!: DbModule;
let notes!: NotesModule;
let tags!: TagsModule;
let db!: Awaited<ReturnType<DbModule['getDb']>>;
let raw!: DatabaseSync;
let testNumber = 0;

beforeEach(async () => {
  const directory = join(tmpdir(), `coreos-db-${process.pid}-${Date.now()}-${testNumber++}`);
  mkdirSync(directory, { recursive: true });
  process.env.COREOS_DB_PATH = join(directory, 'coreos.db');
  jest.resetModules();
  dbModule = require('@/db') as DbModule;
  notes = require('@/db/queries/notes') as NotesModule;
  tags = require('@/db/queries/tags') as TagsModule;
  await dbModule.initDb();
  db = await dbModule.getDb();
  raw = (jest.requireMock('expo-sqlite') as typeof import('../testing/sqlite-node-shim')).__raw();
});

async function count(sql: string): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(sql);
  return row?.count ?? 0;
}

function rawRows<T extends RawRow>(sql: string): T[] {
  return raw.prepare(sql).all() as unknown as T[];
}

function rawFirst<T extends RawRow>(sql: string, ...params: (number | string | null)[]): T | null {
  return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
}

describe('initDb with node:sqlite', () => {
  it('materialises the production schema', () => {
    const names = rawRows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
    ).map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining([
      'notes', 'notes_fts', 'tags', 'note_tags', 'collections',
      'note_collections', 'inbox', 'note_relations',
    ]));
  });

  it('keeps exactly the five canonical FTS triggers', () => {
    const names = rawRows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    ).map((row) => row.name);
    // Ningún trigger extra: es el lock contra la doble definición de
    // src/db/index.tsx que rompió la sincronización de tags.
    expect(names).toEqual([
      'note_tags_ad',
      'note_tags_ai',
      'notes_ad',
      'notes_ai',
      'notes_au',
    ]);
  });

  it('rederives tags_names when a tag is added after the note', async () => {
    const id = await notes.createNote({ title: 'Protocolo', body_md: 'Contenido' });
    await tags.setTagsForNote(id, ['protocolo']);

    expect((await notes.searchNotesWithScore('protocolo')).map(({ note }) => note.id)).toEqual([id]);
    expect(
      rawFirst<{ tags_names: string }>(
        'SELECT tags_names FROM notes_fts WHERE rowid = ?',
        id,
      )?.tags_names,
    ).toBe('protocolo');
  });

  it('removes a tag from FTS when the relation is removed', async () => {
    const id = await notes.createNote({ title: 'Sin coincidencia', body_md: 'Contenido' });
    await tags.setTagsForNote(id, ['protocolo']);
    await tags.setTagsForNote(id, []);

    expect(await notes.searchNotesWithScore('protocolo')).toEqual([]);
  });

  it('is idempotent on a second initDb call', async () => {
    const first = await notes.createNote({ title: 'Uno' });
    await notes.createNote({ title: 'Dos' });
    await tags.setTagsForNote(first, ['uno']);

    const snapshot = async () => [
      await count('SELECT COUNT(*) AS count FROM notes'),
      await count('SELECT COUNT(*) AS count FROM notes_fts'),
      await count('SELECT COUNT(*) AS count FROM schema_meta'),
    ];

    const before = await snapshot();
    await dbModule.initDb();

    expect(await snapshot()).toEqual(before);
    expect(
      rawRows<{ rowid: number }>('SELECT rowid FROM notes_fts GROUP BY rowid HAVING COUNT(*) > 1'),
    ).toEqual([]);
  });

  it('keeps one FTS row per non-deleted note after tag edits', async () => {
    for (const tagName of ['uno', 'dos', 'tres']) {
      const id = await notes.createNote({ title: tagName });
      await tags.setTagsForNote(id, [tagName]);
    }
    const notasVivas = await count('SELECT COUNT(*) AS count FROM notes WHERE deleted_at IS NULL');
    expect(await count('SELECT COUNT(*) AS count FROM notes_fts')).toBe(notasVivas);
  });
});
