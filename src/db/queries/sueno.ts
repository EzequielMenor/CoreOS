import { getDb } from '../client';

// ponytail: deep_sleep_percentage y quality son NOT NULL en el schema legacy,
// pero la UI los trata como opcionales. Aquí los coalescemos a defaults
// (0 y 'regular') para satisfacer la restricción NOT NULL sin necesidad de
// migración. Si en el futuro hace falta distinguir "ausente" de "0",
// añadir migración v3 que ALTER TABLE ... DROP NOT NULL.

export interface SuenoRow {
  id: number;
  date: string;
  hours: number;
  deep_sleep_percentage: number;
  quality: string;
  created_at: number;
}

export async function getSueno(): Promise<SuenoRow[]> {
  const db = await getDb();
  return db.getAllAsync<SuenoRow>(
    'SELECT * FROM sueno_log ORDER BY created_at DESC',
  );
}

export async function createSueno(
  date: string,
  hours: number,
  deep_sleep_percentage?: number | null,
  quality?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sueno_log (date, hours, deep_sleep_percentage, quality, created_at) VALUES (?, ?, ?, ?, ?)',
    date,
    hours,
    deep_sleep_percentage ?? 0,
    quality ?? 'regular',
    Date.now(),
  );
}

export async function updateSueno(
  id: number,
  date: string,
  hours: number,
  deep_sleep_percentage?: number | null,
  quality?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE sueno_log SET date = ?, hours = ?, deep_sleep_percentage = ?, quality = ? WHERE id = ?',
    date,
    hours,
    deep_sleep_percentage ?? 0,
    quality ?? 'regular',
    id,
  );
}

export async function deleteSueno(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sueno_log WHERE id = ?', id);
}