import { create } from 'zustand';
import * as tareasRepo from '@/db/queries/tareas';
import type {
  CreateTareaInput,
  TareaFilter,
  TareaRow,
  TareaStatus,
  UpdateTareaInput,
} from '@/db/queries/tareas';

// ponytail: priority enum hardcoded, add tabla de prioridades si necesita
// customizar. Truncación 500 chars = ~3 párrafos cortos, suficiente para
// título legible sin overflow.

const PRIORITY_VALUES = new Set(['alta', 'media', 'baja']);

function normalizeTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('El título no puede estar vacío.');
  }
  return trimmed.slice(0, 500);
}

function normalizePriority(value: string | null | undefined): string | null {
  if (value == null) return null;
  const lower = value.toLowerCase();
  return PRIORITY_VALUES.has(lower) ? lower : null;
}

interface TareasState {
  items: TareaRow[];
  filter: TareaFilter;
  loading: boolean;
  error: string | null;

  fetchItems: () => Promise<void>;
  setFilter: (f: TareaFilter) => Promise<void>;
  createTarea: (input: CreateTareaInput) => Promise<number>;
  updateTarea: (id: number, patch: UpdateTareaInput) => Promise<void>;
  deleteTarea: (id: number) => Promise<void>;
  toggleStatus: (id: number) => Promise<void>;
}

function setError(error: string | null): { error: string | null } {
  console.error('[useTareasStore]', error);
  return { error };
}

// ── Mock mode para preview visual ──────────────────────────────────────────
// ponytail: borrar este bloque cuando haya datos reales suficientes.
const MOCK_MODE = false;
const now = Date.now();
const DAY = 86_400_000;
const MOCK_TAREAS: TareaRow[] = [
  { id: 1, title: 'Revisar PR del knowledge graph', due_date: '2026-07-22', priority: 'alta', status: 'pending', created_at: now - DAY * 1 },
  { id: 2, title: 'Preparar presentación del proyecto', due_date: '2026-07-23', priority: 'alta', status: 'pending', created_at: now - DAY * 2 },
  { id: 3, title: 'Actualizar dependencias de Expo SDK 57', due_date: '2026-07-24', priority: 'media', status: 'pending', created_at: now - DAY * 3 },
  { id: 4, title: 'Escribir tests para el pipeline de inbox', due_date: '2026-07-25', priority: 'media', status: 'pending', created_at: now - DAY * 4 },
  { id: 5, title: 'Diseñar mockups del heatmap de hábitos', due_date: null, priority: 'baja', status: 'pending', created_at: now - DAY * 5 },
  { id: 6, title: 'Leer capítulo 5 de Clean Architecture', due_date: '2026-07-20', priority: 'baja', status: 'pending', created_at: now - DAY * 6 },
  { id: 7, title: 'Configurar ESLint strict rules', due_date: null, priority: null, status: 'pending', created_at: now - DAY * 7 },
  { id: 8, title: 'Migrar CaptureModal a useTheme()', due_date: '2026-07-19', priority: 'media', status: 'completed', created_at: now - DAY * 3 },
  { id: 9, title: 'Añadir FTS5 a la tabla de notas', due_date: '2026-07-18', priority: 'alta', status: 'completed', created_at: now - DAY * 5 },
  { id: 10, title: 'Refactor del store de ideas', due_date: '2026-07-17', priority: null, status: 'completed', created_at: now - DAY * 8 },
];

export const useTareasStore = create<TareasState>()((set, get) => ({
  items: MOCK_MODE ? MOCK_TAREAS : [],
  filter: { status: 'all' },
  loading: false,
  error: null,

  fetchItems: async () => {
    if (MOCK_MODE) {
      const f = get().filter;
      const filtered = f.status === 'all'
        ? MOCK_TAREAS
        : MOCK_TAREAS.filter((t) => t.status === f.status);
      set({ items: filtered, loading: false });
      return;
    }
    set({ loading: true, error: null });
    try {
      const items = await tareasRepo.listTareas(get().filter);
      set({ items, loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : 'fetchItems failed'),
        loading: false,
      });
    }
  },

  setFilter: async (f) => {
    set({ filter: f });
    await get().fetchItems();
  },

  createTarea: async (input) => {
    try {
      const title = normalizeTitle(input.title);
      const priority = normalizePriority(input.priority ?? null);
      const id = await tareasRepo.createTarea({
        title,
        due_date: input.due_date ?? null,
        priority,
      });
      await get().fetchItems();
      return id;
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createTarea failed'));
      throw e;
    }
  },

  updateTarea: async (id, patch) => {
    try {
      const cleaned: UpdateTareaInput = {};
      if (patch.title !== undefined) cleaned.title = normalizeTitle(patch.title);
      if (patch.due_date !== undefined) cleaned.due_date = patch.due_date;
      if (patch.priority !== undefined) {
        cleaned.priority = normalizePriority(patch.priority);
      }
      if (patch.status !== undefined) cleaned.status = patch.status;
      await tareasRepo.updateTarea(id, cleaned);
      await get().fetchItems();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'updateTarea failed'));
      throw e;
    }
  },

  deleteTarea: async (id) => {
    try {
      await tareasRepo.deleteTarea(id);
      await get().fetchItems();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'deleteTarea failed'));
      throw e;
    }
  },

  toggleStatus: async (id) => {
    const current = get().items.find((t) => t.id === id);
    if (!current) return;
    const nextStatus: TareaStatus =
      current.status === 'pending' ? 'completed' : 'pending';
    await get().updateTarea(id, { status: nextStatus });
  },
}));
