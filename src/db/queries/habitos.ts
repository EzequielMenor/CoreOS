import { getDb } from '../index';

// ponytail: created_at en ms (Date.now()) para alinear con lo que escribe
// dispatchRoutedResult en src/db/index.tsx. Sin UNIQUE en (habit_name, date) —
// el SELECT+DELETE/INSERT es seguro en single-user sin concurrencia local.
// ponytail: withTransactionAsync alrededor del toggle: defensivo, no en hot path.

export interface HabitosRow {
  id: number;
  habit_name: string;
  status: string; // 'done' | 'missed' (CHECK constraint en schema)
  date: string;
  created_at: number;
}

export async function getHabitos(): Promise<HabitosRow[]> {
  const db = await getDb();
  return db.getAllAsync<HabitosRow>(
    'SELECT * FROM habitos_log ORDER BY created_at DESC',
  );
}

export async function toggleHabitLog(
  habitName: string,
  date: string,
): Promise<{ inserted: boolean; deleted: boolean }> {
  const db = await getDb();
  let inserted = false;
  let deleted = false;
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM habitos_log WHERE habit_name = ? AND date = ?',
      habitName,
      date,
    );
    if (existing) {
      await db.runAsync('DELETE FROM habitos_log WHERE id = ?', existing.id);
      deleted = true;
      return;
    }
    await db.runAsync(
      'INSERT INTO habitos_log (habit_name, status, date, created_at) VALUES (?, ?, ?, ?)',
      habitName,
      'done',
      date,
      Date.now(),
    );
    inserted = true;
  });
  return { inserted, deleted };
}
