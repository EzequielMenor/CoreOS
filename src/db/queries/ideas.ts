import { getDb } from '../index';

export type IdeaStatus = 'inbox' | 'processed' | 'discarded';

export interface Idea {
  id: number;
  text: string;
  status: IdeaStatus;
  created_at: number;
  converted_note_id: number | null;
}

export async function listIdeas(status: IdeaStatus | null): Promise<Idea[]> {
  const db = await getDb();
  if (status === null) {
    return db.getAllAsync<Idea>(
      'SELECT * FROM ideas ORDER BY created_at DESC',
    );
  }
  return db.getAllAsync<Idea>(
    'SELECT * FROM ideas WHERE status = ? ORDER BY created_at DESC',
    status,
  );
}

export async function createIdea(text: string): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    "INSERT INTO ideas (text, status, created_at) VALUES (?, 'inbox', unixepoch())",
    text,
  );
  return result.lastInsertRowId;
}

export async function convertIdeaToNote(ideaId: number): Promise<number> {
  const db = await getDb();
  let noteId = 0;
  await db.withTransactionAsync(async () => {
    const idea = await db.getFirstAsync<Idea>(
      'SELECT id, text, status, created_at, converted_note_id FROM ideas WHERE id = ?',
      ideaId,
    );
    if (!idea) throw new Error(`Idea ${ideaId} not found`);
    const noteRes = await db.runAsync(
      `INSERT INTO notes (title, body_md, status, created_at, updated_at)
       VALUES ('', ?, 'active', unixepoch(), unixepoch())`,
      idea.text,
    );
    noteId = noteRes.lastInsertRowId;
    await db.runAsync(
      "UPDATE ideas SET status = 'processed', converted_note_id = ? WHERE id = ?",
      noteId,
      ideaId,
    );
  });
  return noteId;
}

export async function discardIdea(ideaId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE ideas SET status = 'discarded' WHERE id = ?",
    ideaId,
  );
}
