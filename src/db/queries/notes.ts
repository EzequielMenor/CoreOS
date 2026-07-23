import { getDb } from '../index';
import { setTagsForNote } from './tags';

// ponytail: timestamps en segundos (unixepoch()) para alinear con la query
// de getSections (usa strftime('%s','now',...)). Las notas legacy insertadas
// desde dispatchRoutedResult están en ms — desajuste conocido que se
// resolverá en una limpieza posterior; este repo solo escribe en segundos.

export type NoteStatus = 'inbox' | 'active' | 'archived';

export interface Note {
  id: number;
  title: string;
  body_md: string;
  status: NoteStatus;
  pinned: number;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  tags: string[];
}

export interface CreateNoteInput {
  title?: string;
  body_md?: string;
  status?: NoteStatus;
  pinned?: boolean;
  tagNames?: string[];
}

export interface UpdateNoteInput {
  title?: string;
  body_md?: string;
  status?: NoteStatus;
  pinned?: boolean;
  tagNames?: string[];
}

export type Sections = {
  pinned: Note[];
  today: Note[];
  yesterday: Note[];
  thisWeek: Note[];
  earlier: Note[];
};

interface SectionRow extends NoteLikeRow {
  section: 'PINNED' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'EARLIER';
}

const TAG_SEPARATOR = ' ';

// ponytail: el helper se queda como split-only porque las queries ya hacen
// GROUP_CONCAT inline. Si en el futuro una query devuelve filas sin tags,
// añadir aquí un fallback de batch-fetch vía WHERE note_id IN (?).
type NoteLikeRow = Omit<Note, 'tags'> & { tag_names: string | null };

function attachTags<R extends NoteLikeRow>(rows: R[]): Note[] {
  return rows.map((row) => {
    const tags = row.tag_names
      ? row.tag_names.split(TAG_SEPARATOR).filter(Boolean)
      : [];
    return {
      id: row.id,
      title: row.title,
      body_md: row.body_md,
      status: row.status,
      pinned: row.pinned,
      parent_id: row.parent_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      tags,
    };
  });
}

function sectionBucket(rows: SectionRow[]): Sections {
  const buckets: Sections = {
    pinned: [],
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };
  const notes = attachTags(rows);
  for (const note of notes) {
    const row = rows.find((r) => r.id === note.id);
    const section = row?.section ?? 'EARLIER';
    if (section === 'PINNED') buckets.pinned.push(note);
    else if (section === 'TODAY') buckets.today.push(note);
    else if (section === 'YESTERDAY') buckets.yesterday.push(note);
    else if (section === 'THIS_WEEK') buckets.thisWeek.push(note);
    else buckets.earlier.push(note);
  }
  return buckets;
}

export async function getSections(
  selectedTagIds: number[] | null,
): Promise<Sections> {
  const db = await getDb();
  const tagParam = selectedTagIds ? JSON.stringify(selectedTagIds) : null;
  const args = Array(7).fill(tagParam);

  const rows = await db.getAllAsync<SectionRow>(
    `
    WITH
      now_d AS (SELECT strftime('%s','now','start of day') AS v),
      yesterday AS (SELECT v - 86400 AS v FROM now_d),
      week_start AS (SELECT strftime('%s','now','weekday 0','-7 days') AS v FROM now_d),
      filter_clause AS (
        SELECT note_id FROM note_tags
          WHERE tag_id IN (SELECT value FROM json_each(?))
          GROUP BY note_id
          HAVING COUNT(DISTINCT tag_id) = (
            SELECT COUNT(DISTINCT value) FROM json_each(?)
          )
      )
    SELECT * FROM (
      SELECT 'PINNED' AS section, n.id, n.title, n.body_md, n.status,
             n.pinned, n.parent_id, n.created_at, n.updated_at, n.deleted_at,
           (
             SELECT GROUP_CONCAT(t.name, ' ')
             FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
             WHERE nt.note_id = n.id
           ) AS tag_names
    FROM notes n, now_d, yesterday, week_start
    WHERE n.deleted_at IS NULL AND n.pinned = 1
      AND (? IS NULL OR n.id IN (SELECT note_id FROM filter_clause))
    UNION ALL
    SELECT 'TODAY', n.id, n.title, n.body_md, n.status,
           n.pinned, n.parent_id, n.created_at, n.updated_at, n.deleted_at,
           (
             SELECT GROUP_CONCAT(t.name, ' ')
             FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
             WHERE nt.note_id = n.id
           ) AS tag_names
    FROM notes n, now_d
    WHERE n.deleted_at IS NULL AND n.pinned = 0
      AND n.created_at >= (SELECT v FROM now_d)
      AND n.created_at <  (SELECT v FROM yesterday)
      AND (? IS NULL OR n.id IN (SELECT note_id FROM filter_clause))
    UNION ALL
    SELECT 'YESTERDAY', n.id, n.title, n.body_md, n.status,
           n.pinned, n.parent_id, n.created_at, n.updated_at, n.deleted_at,
           (
             SELECT GROUP_CONCAT(t.name, ' ')
             FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
             WHERE nt.note_id = n.id
           ) AS tag_names
    FROM notes n, now_d, yesterday
    WHERE n.deleted_at IS NULL AND n.pinned = 0
      AND n.created_at >= (SELECT v FROM yesterday)
      AND n.created_at <  (SELECT v FROM now_d)
      AND (? IS NULL OR n.id IN (SELECT note_id FROM filter_clause))
    UNION ALL
    SELECT 'THIS_WEEK', n.id, n.title, n.body_md, n.status,
           n.pinned, n.parent_id, n.created_at, n.updated_at, n.deleted_at,
           (
             SELECT GROUP_CONCAT(t.name, ' ')
             FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
             WHERE nt.note_id = n.id
           ) AS tag_names
    FROM notes n, yesterday, week_start
    WHERE n.deleted_at IS NULL AND n.pinned = 0
      AND n.created_at >= (SELECT v FROM week_start)
      AND n.created_at <  (SELECT v FROM yesterday)
      AND (? IS NULL OR n.id IN (SELECT note_id FROM filter_clause))
    UNION ALL
    SELECT 'EARLIER', n.id, n.title, n.body_md, n.status,
           n.pinned, n.parent_id, n.created_at, n.updated_at, n.deleted_at,
           (
             SELECT GROUP_CONCAT(t.name, ' ')
             FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
             WHERE nt.note_id = n.id
           ) AS tag_names
    FROM notes n, week_start
    WHERE n.deleted_at IS NULL AND n.pinned = 0
      AND n.created_at <  (SELECT v FROM week_start)
      AND (? IS NULL OR n.id IN (SELECT note_id FROM filter_clause))
    )
    ORDER BY
      CASE section WHEN 'PINNED' THEN 0 WHEN 'TODAY' THEN 1
                   WHEN 'YESTERDAY' THEN 2 WHEN 'THIS_WEEK' THEN 3
                   ELSE 4 END,
      pinned DESC, created_at DESC;
    `,
    ...args,
  );

  return sectionBucket(rows);
}

interface NoteRowWithTags extends NoteLikeRow {}

export async function getById(id: number): Promise<Note | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<NoteRowWithTags>(
    `SELECT n.id, n.title, n.body_md, n.status, n.pinned, n.parent_id,
            n.created_at, n.updated_at, n.deleted_at,
            (
              SELECT GROUP_CONCAT(t.name, ' ')
              FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
              WHERE nt.note_id = n.id
            ) AS tag_names
     FROM notes n
     WHERE n.id = ?`,
    id,
  );
  if (!row) return null;
  const [note] = attachTags([row]);
  return note ?? null;
}

export async function searchNotes(query: string): Promise<Note[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // ponytail: wrap en comillas dobles = phrase-search FTS5, sin booleanos.
  // Los caracteres " internos se duplican. Usuario pierde AND/OR/wildcards
  // a cambio de no recibir syntax errors con caracteres raros.
  const ftsQuery = `"${trimmed.replace(/"/g, '""')}"`;
  const db = await getDb();
  const rows = await db.getAllAsync<NoteRowWithTags>(
    `SELECT n.id, n.title, n.body_md, n.status, n.pinned, n.parent_id,
            n.created_at, n.updated_at, n.deleted_at,
            (
              SELECT GROUP_CONCAT(t.name, ' ')
              FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
              WHERE nt.note_id = n.id
            ) AS tag_names
     FROM notes_fts fts
     JOIN notes n ON n.id = fts.rowid
     WHERE notes_fts MATCH ?
       AND n.deleted_at IS NULL
     ORDER BY bm25(notes_fts)`,
    ftsQuery,
  );
  return attachTags(rows);
}

export async function createNote(input: CreateNoteInput): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO notes (title, body_md, status, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
    input.title ?? '',
    input.body_md ?? '',
    input.status ?? 'active',
    input.pinned ? 1 : 0,
  );
  const id = result.lastInsertRowId;
  if (input.tagNames && input.tagNames.length > 0) {
    await setTagsForNote(id, input.tagNames);
  }
  return id;
}

export async function updateNote(
  id: number,
  patch: UpdateNoteInput,
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const args: (string | number)[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    args.push(patch.title);
  }
  if (patch.body_md !== undefined) {
    fields.push('body_md = ?');
    args.push(patch.body_md);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    args.push(patch.status);
  }
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?');
    args.push(patch.pinned ? 1 : 0);
  }
  if (fields.length > 0) {
    fields.push('updated_at = unixepoch()');
    await db.runAsync(
      `UPDATE notes SET ${fields.join(', ')} WHERE id = ?`,
      ...args,
      id,
    );
  }
  if (patch.tagNames !== undefined) {
    await setTagsForNote(id, patch.tagNames);
  }
}

export async function deleteNote(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE notes SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ?',
    id,
  );
}

export async function restoreNote(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE notes SET deleted_at = NULL, updated_at = unixepoch() WHERE id = ?',
    id,
  );
}

export async function pinNote(id: number, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE notes SET pinned = ?, updated_at = unixepoch() WHERE id = ?',
    pinned ? 1 : 0,
    id,
  );
}
