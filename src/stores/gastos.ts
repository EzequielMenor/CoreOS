import { create } from 'zustand';
import * as gastosRepo from '@/db/queries/gastos';
import type {
  CreateGastoInput,
  GastoRow,
  MonthTotal,
  UpdateGastoInput,
} from '@/db/queries/gastos';

// ponytail: techo 1_000_000 anti-typos, sin tabla de topes editables. Description
// trunc 280 = tweet largo. date YYYY-MM-DD regex simple, sin i18n parser — el
// input viene de UI propia, no de paste libre.

const MAX_AMOUNT = 1_000_000;
const MAX_DESCRIPTION = 280;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeAmount(raw: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error('El importe debe ser un número válido.');
  }
  if (raw < 0) throw new Error('El importe no puede ser negativo.');
  if (raw > MAX_AMOUNT) {
    throw new Error(`El importe no puede superar ${MAX_AMOUNT} €.`);
  }
  return raw;
}

function normalizeDate(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  if (!DATE_RE.test(raw)) {
    throw new Error('La fecha debe tener formato YYYY-MM-DD.');
  }
  return raw;
}

function normalizeDescription(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  return raw.slice(0, MAX_DESCRIPTION);
}

interface GastosState {
  items: GastoRow[];
  monthTotal: MonthTotal | null;
  selectedMonth: { year: number; month: number };
  loading: boolean;
  error: string | null;

  fetchItems: () => Promise<void>;
  setSelectedMonth: (m: { year: number; month: number }) => Promise<void>;
  createGasto: (input: CreateGastoInput) => Promise<number>;
  updateGasto: (id: number, patch: UpdateGastoInput) => Promise<void>;
  deleteGasto: (id: number) => Promise<void>;
}

function setError(error: string | null): { error: string | null } {
  console.error('[useGastosStore]', error);
  return { error };
}

function currentMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

export const useGastosStore = create<GastosState>()((set, get) => ({
  items: [],
  monthTotal: null,
  selectedMonth: currentMonth(),
  loading: false,
  error: null,

  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const { year, month } = get().selectedMonth;
      const [items, monthTotal] = await Promise.all([
        gastosRepo.listGastos({ year, month }),
        gastosRepo.getMonthTotal(year, month),
      ]);
      set({ items, monthTotal, loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : 'fetchItems failed'),
        loading: false,
      });
    }
  },

  setSelectedMonth: async (m) => {
    set({ selectedMonth: m });
    await get().fetchItems();
  },

  createGasto: async (input) => {
    try {
      const amount = normalizeAmount(input.amount);
      const date = normalizeDate(input.date ?? null);
      const description = normalizeDescription(input.description ?? null);
      const id = await gastosRepo.createGasto({
        amount,
        description,
        category: input.category ?? null,
        date,
      });
      await get().fetchItems();
      return id;
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createGasto failed'));
      throw e;
    }
  },

  updateGasto: async (id, patch) => {
    try {
      const cleaned: UpdateGastoInput = {};
      if (patch.amount !== undefined) cleaned.amount = normalizeAmount(patch.amount);
      if (patch.date !== undefined) cleaned.date = normalizeDate(patch.date);
      if (patch.description !== undefined) {
        cleaned.description = normalizeDescription(patch.description);
      }
      if (patch.category !== undefined) cleaned.category = patch.category;
      await gastosRepo.updateGasto(id, cleaned);
      await get().fetchItems();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'updateGasto failed'));
      throw e;
    }
  },

  deleteGasto: async (id) => {
    try {
      await gastosRepo.deleteGasto(id);
      await get().fetchItems();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'deleteGasto failed'));
      throw e;
    }
  },
}));
