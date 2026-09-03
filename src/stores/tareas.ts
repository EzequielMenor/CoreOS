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

export const useTareasStore = create<TareasState>()((set, get) => ({
  items: [],
  filter: { status: 'all' },
  loading: false,
  error: null,

  fetchItems: async () => {
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
