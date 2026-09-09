import { getDb } from '../index';

export interface CollectionRow {
  id: number;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export type CollectionWithCount = CollectionRow & {
  note_count: number;
};

export async function listCollections(): Promise<CollectionWithCount[]> {
  const db = await getDb();
  return db.getAllAsync<CollectionWithCount>(
    `SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
            COUNT(n.id) AS note_count
     FROM collections c
     LEFT JOIN note_collections nc ON nc.collection_id = c.id
     LEFT JOIN notes n ON n.id = nc.note_id AND n.deleted_at IS NULL
     GROUP BY c.id, c.name, c.description, c.created_at, c.updated_at
     ORDER BY c.name COLLATE NOCASE ASC`,
  );
}

function requiredName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Collection name is required');
  return trimmed;
}

function optionalDescription(description: string | null | undefined): string | null {
  return description?.trim() || null;
}

export function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export async function createCollection(
  name: string,
  description?: string,
): Promise<number> {
  const db = await getDb();
  const trimmedName = requiredName(name);
  const existing = (await db.getAllAsync<{ id: number; name: string }>(
    'SELECT id, name FROM collections ORDER BY id ASC',
  ) ?? []).find((row) => normalizedName(row.name) === normalizedName(trimmedName));
  if (existing) return existing.id;

  const trimmedDescription = optionalDescription(description);
  const result = await db.runAsync(
    'INSERT INTO collections (name, description, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())',
    trimmedName,
    trimmedDescription,
  );
  return result.lastInsertRowId;
}

export async function updateCollection(
  id: number,
  input: { name: string; description: string | null },
): Promise<void> {
  const db = await getDb();
  const name = requiredName(input.name);
  const conflicting = (await db.getAllAsync<{ id: number; name: string }>(
    'SELECT id, name FROM collections WHERE id <> ? ORDER BY id ASC',
    id,
  ) ?? []).find((row) => normalizedName(row.name) === normalizedName(name));
  if (conflicting) throw new Error('Ya existe una colección con ese nombre');

  const description = optionalDescription(input.description);
  await db.runAsync(
    'UPDATE collections SET name = ?, description = ?, updated_at = unixepoch() WHERE id = ?',
    name,
    description,
    id,
  );
}

export async function getCollection(id: number): Promise<CollectionRow | null> {
  const db = await getDb();
  return db.getFirstAsync<CollectionRow>(
    'SELECT id, name, description, created_at, updated_at FROM collections WHERE id = ?',
    id,
  );
}

export async function deleteCollection(id: number): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    // ON DELETE CASCADE es inerte porque PRAGMA foreign_keys está desactivado en la app.
    await db.runAsync('DELETE FROM note_collections WHERE collection_id = ?', id);
    await db.runAsync('DELETE FROM collections WHERE id = ?', id);
  });
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
): Promise<{
  note_id: number;
  position: number | null;
  created_at: number;
  title: string;
}[]> {
  const db = await getDb();
  return db.getAllAsync<{
    note_id: number;
    position: number | null;
    created_at: number;
    title: string;
  }>(
    `SELECT nc.note_id, nc.position, n.created_at, n.title
     FROM note_collections nc
     JOIN notes n ON n.id = nc.note_id
     WHERE nc.collection_id = ? AND n.deleted_at IS NULL
     ORDER BY nc.position IS NULL ASC, nc.position ASC, n.created_at DESC`,
    collectionId,
  );
}

export async function listNotesNotInCollection(
  collectionId: number,
  search: string,
): Promise<{ id: number; title: string }[]> {
  const db = await getDb();
  const trimmedSearch = search.trim();
  return db.getAllAsync<{ id: number; title: string }>(
    `SELECT n.id, n.title
     FROM notes n
     WHERE n.deleted_at IS NULL
       AND n.id NOT IN (
         SELECT nc.note_id
         FROM note_collections nc
         WHERE nc.collection_id = ?
       )
       AND n.title LIKE '%' || ? || '%'
     ORDER BY n.updated_at DESC
     LIMIT 25`,
    collectionId,
    trimmedSearch,
  );
}

export async function getNoteCollections(noteId: number): Promise<CollectionRow[]> {
  const db = await getDb();
  return db.getAllAsync<CollectionRow>(
    `SELECT c.id, c.name, c.description, c.created_at, c.updated_at
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
