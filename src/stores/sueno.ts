import { create } from 'zustand';
import * as suenoRepo from '@/db/queries/sueno';
import type { SuenoRow } from '@/db/queries/sueno';

// ponytail: horas y fecha son required (la UI fuerza esto); deep_sleep_percentage
// y quality pueden llegar null desde la UI pero el schema legacy exige NOT NULL
// — la query los coalesce a 0/'regular'. Techos simples sin tabla de topes.

const MAX_HOURS = 24;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeHours(raw: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error('Las horas deben ser un número válido.');
  }
  if (raw <= 0) throw new Error('Las horas deben ser mayores que 0.');
  if (raw > MAX_HOURS) {
    throw new Error(`Las horas no pueden superar ${MAX_HOURS}.`);
  }
  return raw;
}

function normalizeDate(raw: string): string {
  if (!DATE_RE.test(raw)) {
    throw new Error('La fecha debe tener formato YYYY-MM-DD.');
  }
  return raw;
}

function normalizeDeepPct(raw: number | null | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error('El % de sueño profundo debe ser un número válido.');
  }
  if (raw < 0 || raw > 100) {
    throw new Error('El % de sueño profundo debe estar entre 0 y 100.');
  }
  return raw;
}

interface SuenoState {
  items: SuenoRow[];
  loading: boolean;
  error: string | null;

  fetchItems: () => Promise<void>;
  createSueno: (
    date: string,
    hours: number,
    deep_sleep_percentage?: number | null,
    quality?: string | null,
  ) => Promise<void>;
  updateSueno: (
    id: number,
    date: string,
    hours: number,
    deep_sleep_percentage?: number | null,
    quality?: string | null,
  ) => Promise<void>;
  deleteSueno: (id: number) => Promise<void>;
}

function setError(error: string | null): { error: string | null } {
  console.error('[useSuenoStore]', error);
  return { error };
}

export const useSuenoStore = create<SuenoState>()((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await suenoRepo.getSueno();
      set({ items, loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : 'fetchItems failed'),
        loading: false,
      });
    }
  },

  createSueno: async (date, hours, deep_sleep_percentage, quality) => {
    try {
      const cleanDate = normalizeDate(date);
      const cleanHours = normalizeHours(hours);
      const cleanPct = normalizeDeepPct(deep_sleep_percentage);
      await suenoRepo.createSueno(cleanDate, cleanHours, cleanPct, quality);
      await get().fetchItems();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createSueno failed'));
      throw e;
    }
  },

  updateSueno: async (id, date, hours, deep_sleep_percentage, quality) => {
    try {
      const cleanDate = normalizeDate(date);
      const cleanHours = normalizeHours(hours);
      const cleanPct = normalizeDeepPct(deep_sleep_percentage);
      await suenoRepo.updateSueno(id, cleanDate, cleanHours, cleanPct, quality);
      await get().fetchItems();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'updateSueno failed'));
      throw e;
    }
  },

  deleteSueno: async (id) => {
    try {
      await suenoRepo.deleteSueno(id);
      await get().fetchItems();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'deleteSueno failed'));
      throw e;
    }
  },
}));