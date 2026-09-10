import { bootDb, type BootedDb } from '../testing/boot-db';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));

const NOTE_COUNT = 800;
const BODY = 'cuerpo de prueba '.repeat(15);
const LIST_BODY_LIMIT = 160;
const MAX_PAYLOAD_BYTES = 350_000;

describe('payload de las listas de notas', () => {
  let booted!: BootedDb;

  beforeEach(async () => {
    booted = await bootDb();
  });

  function seedNotes(): number[] {
    const ids: number[] = [];
    const createdAt = Math.floor(Date.now() / 1000) - 8 * 86_400;
    const insertNote = booted.raw.prepare(
      `INSERT INTO notes
       (title, content, tags, section, content_type, created_at, body_md,
        status, pinned, parent_id, updated_at, deleted_at)
       VALUES (?, '', '[]', 'Rendimiento', 'markdown', ?, ?, 'active', 0, NULL, ?, NULL)`,
    );
    const insertTag = booted.raw.prepare(
      'INSERT INTO tags (name) VALUES (?)',
    );
    const insertNoteTag = booted.raw.prepare(
      'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)',
    );
    const insertCollection = booted.raw.prepare(
      'INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)',
    );
    const insertNoteCollection = booted.raw.prepare(
      `INSERT INTO note_collections
       (note_id, collection_id, position, added_at) VALUES (?, ?, ?, ?)`,
    );

    booted.raw.exec('BEGIN');
    try {
      const tagId = Number(insertTag.run('rendimiento').lastInsertRowid);
      const collectionId = Number(
        insertCollection.run('Lote D', createdAt, createdAt).lastInsertRowid,
      );
      for (let index = 1; index <= NOTE_COUNT; index += 1) {
        const noteId = Number(
          insertNote.run(`Nota ${index}`, createdAt, BODY, createdAt).lastInsertRowid,
        );
        ids.push(noteId);
        if (index % 3 === 0) {
          insertNoteTag.run(noteId, tagId);
        }
        if (index % 10 === 0) {
          insertNoteCollection.run(noteId, collectionId, index, createdAt);
        }
      }
      booted.raw.exec('COMMIT');
    } catch (error) {
      booted.raw.exec('ROLLBACK');
      throw error;
    }

    return ids;
  }

  function expectBoundedBodies(rows: { body_md: string }[]): void {
    expect(rows.every((row) => row.body_md.length <= LIST_BODY_LIMIT)).toBe(true);
  }

  it('keeps list payloads bounded while detail queries retain the full body', async () => {
    const ids = seedNotes();
    const sections = await booted.notes.getSections(null);
    const listedNotes = Object.values(sections).flat();

    expect(listedNotes).toHaveLength(NOTE_COUNT);
    expect(new Set(listedNotes.map((note) => note.id))).toEqual(new Set(ids));
    expect(JSON.stringify(listedNotes).length).toBeLessThan(MAX_PAYLOAD_BYTES);
    expectBoundedBodies(listedNotes);

    const sectionNotes = await booted.notes.getNotesBySection('Rendimiento', null);
    const collectionId = Number(
      (booted.raw.prepare('SELECT id FROM collections WHERE name = ?').get('Lote D') as {
        id: number;
      }).id,
    );
    const collectionNotes = await booted.notes.getNotesByCollection(collectionId, null);
    expectBoundedBodies(sectionNotes);
    expectBoundedBodies(collectionNotes);
    expect(collectionNotes).toHaveLength(NOTE_COUNT / 10);

    expect((await booted.notes.getById(ids[0]))?.body_md).toBe(BODY);
  });
});
