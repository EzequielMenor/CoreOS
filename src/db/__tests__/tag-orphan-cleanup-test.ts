import { bootDb, type BootedDb } from '../testing/boot-db';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));

let notes!: BootedDb['notes'];
let tags!: BootedDb['tags'];
let raw!: BootedDb['raw'];

beforeEach(async () => {
  ({ notes, tags, raw } = await bootDb());
});

describe('tag orphan cleanup', () => {
  it('deletes a tag when its last note association is removed', async () => {
    const noteId = await notes.createNote({ title: 'Apunte' });
    await tags.setTagsForNote(noteId, ['retirable']);

    await tags.setTagsForNote(noteId, []);

    const tag = raw.prepare('SELECT id FROM tags WHERE name = ?').get('retirable');
    expect(tag).toBeUndefined();
  });

  it('keeps a tag that is still associated with another note', async () => {
    const firstNoteId = await notes.createNote({ title: 'Primera' });
    const secondNoteId = await notes.createNote({ title: 'Segunda' });
    await tags.setTagsForNote(firstNoteId, ['compartida', 'retirable']);
    await tags.setTagsForNote(secondNoteId, ['compartida']);

    await tags.setTagsForNote(firstNoteId, ['compartida']);

    expect(raw.prepare('SELECT id FROM tags WHERE name = ?').get('retirable')).toBeUndefined();
    expect(raw.prepare('SELECT id FROM tags WHERE name = ?').get('compartida')).toBeDefined();
  });

  it('removes the deleted tag from tags_names and FTS search results', async () => {
    const noteId = await notes.createNote({ title: 'Apunte', body_md: 'Contenido' });
    await tags.setTagsForNote(noteId, ['retirable']);
    expect((await notes.searchNotesWithScore('retirable')).map(({ note }) => note.id)).toEqual([noteId]);

    await tags.setTagsForNote(noteId, []);

    expect(raw.prepare('SELECT tags_names FROM notes_fts WHERE rowid = ?').get(noteId)).toEqual({ tags_names: '' });
    expect(await notes.searchNotesWithScore('retirable')).toEqual([]);
  });

  it('preserves tags when a note is soft-deleted', async () => {
    const noteId = await notes.createNote({ title: 'Archivado' });
    await tags.setTagsForNote(noteId, ['conservada']);

    await notes.deleteNote(noteId);

    const tag = raw.prepare('SELECT id FROM tags WHERE name = ?').get('conservada');
    const association = raw.prepare('SELECT note_id FROM note_tags WHERE note_id = ?').get(noteId);
    expect(tag).toBeDefined();
    expect(association).toEqual({ note_id: noteId });
  });

  it('cleans pre-existing orphans once and skips the migration after it is marked done', async () => {
    const booted = await bootDb((seededDb) => {
      seededDb.exec(`
        CREATE TABLE notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
        CREATE TABLE tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE
        );
        CREATE TABLE note_tags (
          note_id INTEGER NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (note_id, tag_id)
        );
        INSERT INTO notes (id, title, created_at) VALUES (1, 'Legado', 1);
        INSERT INTO tags (id, name) VALUES (1, 'huérfano'), (2, 'usado');
        INSERT INTO note_tags (note_id, tag_id) VALUES (1, 2);
      `);
    });

    expect(booted.raw.prepare('SELECT id FROM tags WHERE name = ?').get('huérfano')).toBeUndefined();
    expect(booted.raw.prepare('SELECT id FROM tags WHERE name = ?').get('usado')).toEqual({ id: 2 });
    expect(booted.raw.prepare("SELECT value FROM schema_meta WHERE key = 'tags_orphan_cleanup_v1'").get()).toEqual({ value: '1' });

    booted.raw.prepare('INSERT INTO tags (name) VALUES (?)').run('nuevo huérfano');
    await booted.dbModule.initDb();

    expect(booted.raw.prepare('SELECT id FROM tags WHERE name = ?').get('nuevo huérfano')).toBeDefined();
  });
});
