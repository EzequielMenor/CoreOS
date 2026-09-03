import { getDb } from '../index';

// ponytail: created_at en ms (Date.now()) para alinear con lo que escribe
// dispatchRoutedResult en src/db/index.tsx. Sin índice sobre status porque el
// listado es pequeño (single-user); añadir idx_tareas_status cuando >5k filas.

export type TareaStatus = 'pending' | 'completed';

export interface TareaRow {
  id: number;
  title: string;
  due_date: string | null;
  priority: string | null;
  status: TareaStatus;
  created_at: number;
}

export interface CreateTareaInput {
  title: string;
  due_date?: string | null;
  priority?: string | null;
}

export interface UpdateTareaInput {
  title?: string;
  due_date?: string | null;
  priority?: string | null;
  status?: TareaStatus;
}

export interface TareaFilter {
  status: 'all' | TareaStatus;
}

export async function listTareas(filter?: TareaFilter): Promise<TareaRow[]> {
  const db = await getDb();
  if (filter && filter.status !== 'all') {
    return db.getAllAsync<TareaRow>(
      'SELECT * FROM tareas WHERE status = ? ORDER BY created_at DESC',
      filter.status,
    );
  }
  return db.getAllAsync<TareaRow>(
    'SELECT * FROM tareas ORDER BY created_at DESC',
  );
}

export async function createTarea(input: CreateTareaInput): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO tareas (title, due_date, priority, status, created_at) VALUES (?, ?, ?, ?, ?)',
    input.title,
    input.due_date ?? null,
    input.priority ?? null,
    'pending',
    Date.now(),
  );
  return result.lastInsertRowId;
}

export async function updateTarea(
  id: number,
  patch: UpdateTareaInput,
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    args.push(patch.title);
  }
  if (patch.due_date !== undefined) {
    fields.push('due_date = ?');
    args.push(patch.due_date);
  }
  if (patch.priority !== undefined) {
    fields.push('priority = ?');
    args.push(patch.priority);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    args.push(patch.status);
  }
  if (fields.length === 0) return;
  await db.runAsync(
    `UPDATE tareas SET ${fields.join(', ')} WHERE id = ?`,
    ...args,
    id,
  );
}

export async function deleteTarea(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM tareas WHERE id = ?', id);
}

export async function countPendingTareas(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM tareas WHERE status = 'pending'",
  );
  return row?.cnt ?? 0;
}

// V1 "Hoy": pending con fecha <= hoy (vencidas incluidas). Las tareas sin
// fecha y las futuras NO aparecen aquí (viven en la ruta secundaria /tareas).
// Orden: vencidas primero, luego prioridad (alta > media > baja), luego fecha.
export async function getTareasHoy(hoyISO: string): Promise<TareaRow[]> {
  const db = await getDb();
  return db.getAllAsync<TareaRow>(
    `SELECT * FROM tareas
     WHERE status = 'pending' AND due_date IS NOT NULL AND due_date <= ?
     ORDER BY (due_date < ?) DESC,
       CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 WHEN 'baja' THEN 2 ELSE 3 END,
       due_date ASC`,
    hoyISO,
    hoyISO,
  );
}
