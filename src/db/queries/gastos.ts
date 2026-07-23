import { getDb } from '../index';

// ponytail: created_at en ms (Date.now()) para alinear con lo que escribe
// dispatchRoutedResult. date filtra prefijos 'YYYY-MM%'; gastos con date NULL
// quedan excluidos del total mensual (decisión documentada en design.md).
// Sin índice sobre date porque el listado es pequeño (single-user);
// añadir idx_gastos_date cuando >5k filas.

export interface GastoRow {
  id: number;
  amount: number;
  description: string | null;
  category: string | null;
  date: string | null;
  created_at: number;
}

export interface CreateGastoInput {
  amount: number;
  description?: string | null;
  category?: string | null;
  date?: string | null;
}

export interface UpdateGastoInput {
  amount?: number;
  description?: string | null;
  category?: string | null;
  date?: string | null;
}

export interface MonthTotal {
  year: number;
  month: number;
  total: number;
  count: number;
}

function monthPrefix(year: number, month: number): string {
  const m = String(month + 1).padStart(2, '0');
  return `${year}-${m}`;
}

export async function listGastos(
  month?: { year: number; month: number },
): Promise<GastoRow[]> {
  const db = await getDb();
  if (month) {
    return db.getAllAsync<GastoRow>(
      'SELECT * FROM gastos WHERE date LIKE ? ORDER BY created_at DESC',
      `${monthPrefix(month.year, month.month)}%`,
    );
  }
  return db.getAllAsync<GastoRow>(
    'SELECT * FROM gastos ORDER BY created_at DESC',
  );
}

export async function createGasto(input: CreateGastoInput): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO gastos (amount, description, category, date, created_at) VALUES (?, ?, ?, ?, ?)',
    input.amount,
    input.description ?? null,
    input.category ?? null,
    input.date ?? null,
    Date.now(),
  );
  return result.lastInsertRowId;
}

export async function updateGasto(
  id: number,
  patch: UpdateGastoInput,
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.amount !== undefined) {
    fields.push('amount = ?');
    args.push(patch.amount);
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    args.push(patch.description);
  }
  if (patch.category !== undefined) {
    fields.push('category = ?');
    args.push(patch.category);
  }
  if (patch.date !== undefined) {
    fields.push('date = ?');
    args.push(patch.date);
  }
  if (fields.length === 0) return;
  await db.runAsync(
    `UPDATE gastos SET ${fields.join(', ')} WHERE id = ?`,
    ...args,
    id,
  );
}

export async function deleteGasto(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM gastos WHERE id = ?', id);
}

export async function getMonthTotal(
  year: number,
  month: number,
): Promise<MonthTotal> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    total: number | null;
    count: number;
  }>(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM gastos
     WHERE date IS NOT NULL AND date LIKE ?`,
    `${monthPrefix(year, month)}%`,
  );
  return {
    year,
    month,
    total: row?.total ?? 0,
    count: row?.count ?? 0,
  };
}
