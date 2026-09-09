import { getDb } from '../index';

export interface CollectionRow {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

export type CollectionWithCount = CollectionRow & {
  note_count: number;
};

export async function listCollections(): Promise<CollectionWithCount[]> {
  const db = await getDb();
  return db.getAllAsync<CollectionWithCount>(
    `SELECT c.id, c.name, c.created_at, c.updated_at,
            COUNT(n.id) AS note_count
     FROM collections c
     LEFT JOIN note_collections nc ON nc.collection_id = c.id
     LEFT JOIN notes n ON n.id = nc.note_id AND n.deleted_at IS NULL
     GROUP BY c.id, c.name, c.created_at, c.updated_at
     ORDER BY c.name COLLATE NOCASE ASC`,
  );
}

function requiredName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Collection name is required');
  return trimmed;
}

export async function createCollection(name: string): Promise<number> {
  const db = await getDb();
  const trimmed = requiredName(name);
  const result = await db.runAsync(
    'INSERT INTO collections (name, created_at, updated_at) VALUES (?, unixepoch(), unixepoch())',
    trimmed,
  );
  return result.lastInsertRowId;
}

export async function renameCollection(id: number, name: string): Promise<void> {
  const db = await getDb();
  const trimmed = requiredName(name);
  await db.runAsync(
    'UPDATE collections SET name = ?, updated_at = unixepoch() WHERE id = ?',
    trimmed,
    id,
  );
}

export async function deleteCollection(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM collections WHERE id = ?', id);
}

// Una posición nula significa que la nota no está ordenada y aparece al final.
export async function addNoteToCollection(
  noteId: number,
  collectionId: number,
  position: number | null = null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO note_collections
       (note_id, collection_id, position, added_at)
     VALUES (?, ?, ?, unixepoch())`,
    noteId,
    collectionId,
    position,
  );
}

export async function removeNoteFromCollection(
  noteId: number,
  collectionId: number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'DELETE FROM note_collections WHERE note_id = ? AND collection_id = ?',
    noteId,
    collectionId,
  );
}

export async function setCollectionOrder(
  collectionId: number,
  orderedNoteIds: number[],
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [position, noteId] of orderedNoteIds.entries()) {
      await db.runAsync(
        'UPDATE note_collections SET position = ? WHERE collection_id = ? AND note_id = ?',
        position,
        collectionId,
        noteId,
      );
    }
  });
}

export async function listCollectionNotes(
  collectionId: number,
): Promise<{ note_id: number; position: number | null; created_at: number }[]> {
  const db = await getDb();
  return db.getAllAsync<{ note_id: number; position: number | null; created_at: number }>(
    `SELECT nc.note_id, nc.position, n.created_at
     FROM note_collections nc
     JOIN notes n ON n.id = nc.note_id
     WHERE nc.collection_id = ? AND n.deleted_at IS NULL
     ORDER BY nc.position IS NULL ASC, nc.position ASC, n.created_at DESC`,
    collectionId,
  );
}

export async function getNoteCollections(noteId: number): Promise<CollectionRow[]> {
  const db = await getDb();
  return db.getAllAsync<CollectionRow>(
    `SELECT c.id, c.name, c.created_at, c.updated_at
     FROM collections c
     JOIN note_collections nc ON nc.collection_id = c.id
     WHERE nc.note_id = ?
     ORDER BY c.name COLLATE NOCASE ASC`,
    noteId,
  );
}

export async function listNoteSections(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ section: string }>(
    `SELECT DISTINCT section
     FROM notes
     WHERE section IS NOT NULL AND deleted_at IS NULL
     ORDER BY section COLLATE NOCASE ASC`,
  );
  return rows.map((row) => row.section);
}

export async function setNoteSection(
  noteId: number,
  section: string | null,
): Promise<void> {
  const db = await getDb();
  const trimmed = section?.trim() || null;
  await db.runAsync(
    'UPDATE notes SET section = ?, updated_at = unixepoch() WHERE id = ?',
    trimmed,
    noteId,
  );
}
