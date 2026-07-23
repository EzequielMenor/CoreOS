import { getDb } from '../index';
import type { Note } from './notes';

const TAG_SEPARATOR = ' ';

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

export async function deleteTag(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM tags WHERE id = ?', id);
}

interface NoteRowWithTags {
  id: number;
  title: string;
  body_md: string;
  status: Note['status'];
  pinned: number;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  tag_names: string | null;
}

function attachTagsToRows(rows: NoteRowWithTags[]): Note[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body_md: row.body_md,
    status: row.status,
    pinned: row.pinned,
    parent_id: row.parent_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    tags: row.tag_names
      ? row.tag_names.split(TAG_SEPARATOR).filter(Boolean)
      : [],
  }));
}

export async function getNotesForTag(tagId: number): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<NoteRowWithTags>(
    `SELECT n.id, n.title, n.body_md, n.status, n.pinned, n.parent_id,
            n.created_at, n.updated_at, n.deleted_at,
            (
              SELECT GROUP_CONCAT(t2.name, ' ')
              FROM note_tags nt2 JOIN tags t2 ON t2.id = nt2.tag_id
              WHERE nt2.note_id = n.id
            ) AS tag_names
     FROM note_tags nt
     JOIN tags t ON t.id = nt.tag_id
     JOIN notes n ON n.id = nt.note_id
     WHERE t.id = ? AND n.deleted_at IS NULL
     ORDER BY n.created_at DESC`,
    tagId,
  );
  return attachTagsToRows(rows);
}

export async function setTagsForNote(
  noteId: number,
  tagNames: string[],
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
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
  });
}
