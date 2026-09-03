import { create } from 'zustand';
import * as notesRepo from '@/db/queries/notes';
import type {
  CreateNoteInput,
  Note,
  Sections,
  UpdateNoteInput,
} from '@/db/queries/notes';

interface NotesState {
  sections: Sections;
  searchResults: Note[];
  searchQuery: string;
  selectedTagIds: number[];
  searchAbortController: AbortController | null;
  loading: boolean;
  error: string | null;

  fetchSections: () => Promise<void>;
  search: (query: string) => Promise<void>;
  searchWithAbort: (query: string) => Promise<void>;
  clearSearch: () => void;
  toggleTagFilter: (tagId: number) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<number>;
  updateNote: (id: number, patch: UpdateNoteInput) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  restoreNote: (id: number) => Promise<void>;
  pinNote: (id: number, pinned: boolean) => Promise<void>;
}

const EMPTY_SECTIONS: Sections = {
  pinned: [],
  today: [],
  yesterday: [],
  thisWeek: [],
  earlier: [],
};

function setError(error: string | null): { error: string | null } {
  console.error('[useNotesStore]', error);
  return { error };
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  sections: EMPTY_SECTIONS,
  searchResults: [],
  searchQuery: '',
  selectedTagIds: [],
  searchAbortController: null,
  loading: false,
  error: null,

  fetchSections: async () => {
    set({ loading: true, error: null });
    try {
      const ids = get().selectedTagIds;
      const tagFilter = ids.length > 0 ? ids : null;
      const sections = await notesRepo.getSections(tagFilter);
      set({ sections, loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : 'fetchSections failed'),
        loading: false,
      });
    }
  },

  search: (query) => get().searchWithAbort(query),

  searchWithAbort: async (query) => {
    get().searchAbortController?.abort();
    const controller = new AbortController();
    set({
      searchAbortController: controller,
      searchQuery: query,
      error: null,
    });

    const trimmed = query.trim();
    if (!trimmed) {
      set({
        searchResults: [],
        loading: false,
        searchAbortController: null,
      });
      return;
    }

    set({ loading: true });
    try {
      const hits = await notesRepo.searchNotesWithScore(
        trimmed,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      set({
        searchResults: hits.map(({ note }) => note),
        loading: false,
        searchAbortController: null,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      set({
        searchResults: [],
        loading: false,
        searchAbortController: null,
        ...setError(e instanceof Error ? e.message : 'search failed'),
      });
    }
  },

  clearSearch: () => {
    get().searchAbortController?.abort();
    set({
      searchResults: [],
      searchQuery: '',
      searchAbortController: null,
      loading: false,
    });
  },

  toggleTagFilter: async (tagId) => {
    const current = get().selectedTagIds;
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    set({ selectedTagIds: next });
    await get().fetchSections();
  },

  createNote: async (input) => {
    try {
      const id = await notesRepo.createNote(input);
      await get().fetchSections();
      return id;
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createNote failed'));
      throw e;
    }
  },

  updateNote: async (id, patch) => {
    try {
      await notesRepo.updateNote(id, patch);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'updateNote failed'));
      throw e;
    }
  },

  deleteNote: async (id) => {
    try {
      await notesRepo.deleteNote(id);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'deleteNote failed'));
      throw e;
    }
  },

  restoreNote: async (id) => {
    try {
      await notesRepo.restoreNote(id);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'restoreNote failed'));
      throw e;
    }
  },

  pinNote: async (id, pinned) => {
    try {
      await notesRepo.pinNote(id, pinned);
      await get().fetchSections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'pinNote failed'));
      throw e;
    }
  },
}));
