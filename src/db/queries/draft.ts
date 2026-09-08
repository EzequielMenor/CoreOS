/**
 * Borrador de la tab Capturar — persistido en SQLite (invariante §1: todo
 * el estado local vive en coreos.db). Reutiliza `schema_meta` como KV;
 * key única `capture_draft` (un solo borrador de texto en v0.2).
 * No va a SecureStore: no es una credencial.
 */

import { getDb } from '../index';

const DRAFT_KEY = 'capture_draft';

export async function getCaptureDraft(): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM schema_meta WHERE key = ?',
    DRAFT_KEY,
  );
  return row?.value ?? '';
}

export async function saveCaptureDraft(text: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)',
    DRAFT_KEY,
    text,
  );
}

export async function clearCaptureDraft(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM schema_meta WHERE key = ?', DRAFT_KEY);
}
