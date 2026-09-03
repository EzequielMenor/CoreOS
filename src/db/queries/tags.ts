import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../client';

export interface Tag {
  id: number;
  name: string;
}

export interface TagWithCount extends Tag {
  note_count: number;
}

export async function listTags(): Promise<TagWithCount[]> {
  const db = await getDb();
  return db.getAllAsync<TagWithCount>(
    `SELECT t.id, t.name,
      COUNT(n.id) AS note_count
     FROM tags t
     LEFT JOIN note_tags nt ON nt.tag_id = t.id
     LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
     GROUP BY t.id, t.name
     ORDER BY t.name COLLATE NOCASE ASC`,
  );
}

export async function createTag(name: string): Promise<number> {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tag name cannot be empty');
  await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', trimmed);
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM tags WHERE name = ?',
    trimmed,
  );
  if (!row) throw new Error('Failed to create or fetch tag');
  return row.id;
}

export async function setTagsForNote(
  noteId: number,
  tagNames: string[],
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await setTagsForNoteNoTx(db, noteId, tagNames);
  });
}

// Variante sin transacción para callers que ya gestionan su propia tx
// (p.ej. dispatchRoutedResult — invariante I1 en src/db/index.tsx).
export async function setTagsForNoteNoTx(
  db: SQLiteDatabase,
  noteId: number,
  tagNames: string[],
): Promise<void> {
  await db.runAsync('DELETE FROM note_tags WHERE note_id = ?', noteId);
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
    const row = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM tags WHERE name = ?',
      name,
    );
    if (!row) continue;
    await db.runAsync(
      'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
      noteId,
      row.id,
    );
  }
}
