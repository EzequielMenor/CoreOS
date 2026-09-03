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

// due_date es texto libre (UI free-input + LLM): ISO con hora, "hoy", d/m/y…
// Se normaliza a YYYY-MM-DD antes de comparar. null si no hay fecha válida.
export function normalizeDueDate(raw: string | null, hoy: string): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === 'hoy' || s === 'today') return hoy;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

// ponytail: rank de prioridad tolera el enum inglés legacy del LLM (low/medium/high).
function priorityRank(p: string | null): number {
  if (p === 'alta' || p === 'high') return 0;
  if (p === 'media' || p === 'medium') return 1;
  if (p === 'baja' || p === 'low') return 2;
  return 3;
}

export async function getTareasHoy(hoyISO: string): Promise<TareaRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TareaRow>(
    "SELECT * FROM tareas WHERE status = 'pending' AND due_date IS NOT NULL",
  );
  // ponytail: filtro/sort en JS — listado pequeño (single-user) y due_date
  // necesita normalización antes de comparar.
  return rows
    .map((t) => ({ ...t, due_date: normalizeDueDate(t.due_date, hoyISO) }))
    .filter((t) => t.due_date !== null && t.due_date <= hoyISO)
    .sort((a, b) => {
      const aOverdue = (a.due_date ?? '') < hoyISO ? 0 : 1;
      const bOverdue = (b.due_date ?? '') < hoyISO ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const pa = priorityRank(a.priority);
      const pb = priorityRank(b.priority);
      if (pa !== pb) return pa - pb;
      return (a.due_date ?? '').localeCompare(b.due_date ?? '');
    });
}
