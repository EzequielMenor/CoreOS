import { bootDb, type BootedDb } from '../testing/boot-db';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));

type RawRow = Record<string, unknown>;

let dbModule!: BootedDb['dbModule'];
let notes!: BootedDb['notes'];
let tags!: BootedDb['tags'];
let db!: BootedDb['db'];
let raw!: BootedDb['raw'];

beforeEach(async () => {
  ({ dbModule, notes, tags, db, raw } = await bootDb());
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
