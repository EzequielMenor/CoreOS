import { create } from 'zustand';
import {
  confirmRelation,
  deleteRelation,
  getRelatedNotes,
  rejectRelation,
  upsertRelation,
} from '@/db/queries/note-relations';
import type { RelatedNoteItem } from '@/db/queries/note-relations';
import { generateAndPersistSuggestions } from '@/services/note-relations';

interface NoteRelationsState {
  relationsByNoteId: Record<number, RelatedNoteItem[]>;
  loadingByNoteId: Record<number, boolean>;
  suggestingByNoteId: Record<number, boolean>;
  errorByNoteId: Record<number, string | null>;

  fetchRelations: (noteId: number) => Promise<void>;
  generateSuggestions: (noteId: number) => Promise<void>;
  confirm: (noteId: number, relationId: number) => Promise<void>;
  reject: (noteId: number, relationId: number) => Promise<void>;
  remove: (noteId: number, relationId: number) => Promise<void>;
  addManual: (sourceNoteId: number, targetNoteId: number) => Promise<void>;
}

export const useNoteRelationsStore = create<NoteRelationsState>()((set, get) => ({
  relationsByNoteId: {},
  loadingByNoteId: {},
  suggestingByNoteId: {},
  errorByNoteId: {},

  fetchRelations: async (noteId: number) => {
    set((state) => ({
      loadingByNoteId: { ...state.loadingByNoteId, [noteId]: true },
      errorByNoteId: { ...state.errorByNoteId, [noteId]: null },
    }));
    try {
      const items = await getRelatedNotes(noteId);
      set((state) => ({
        relationsByNoteId: { ...state.relationsByNoteId, [noteId]: items },
        loadingByNoteId: { ...state.loadingByNoteId, [noteId]: false },
      }));
    } catch (err) {
      set((state) => ({
        loadingByNoteId: { ...state.loadingByNoteId, [noteId]: false },
        errorByNoteId: {
          ...state.errorByNoteId,
          [noteId]: err instanceof Error ? err.message : 'Error al cargar notas relacionadas',
        },
      }));
    }
  },

  generateSuggestions: async (noteId: number) => {
    set((state) => ({
      suggestingByNoteId: { ...state.suggestingByNoteId, [noteId]: true },
    }));
    try {
      const items = await generateAndPersistSuggestions(noteId);
      set((state) => ({
        relationsByNoteId: { ...state.relationsByNoteId, [noteId]: items },
        suggestingByNoteId: { ...state.suggestingByNoteId, [noteId]: false },
      }));
    } catch (err) {
      console.error('[useNoteRelationsStore] generateSuggestions failed', err);
      set((state) => ({
        suggestingByNoteId: { ...state.suggestingByNoteId, [noteId]: false },
      }));
    }
  },

  confirm: async (noteId: number, relationId: number) => {
    try {
      await confirmRelation(relationId);
      await get().fetchRelations(noteId);
    } catch (err) {
      console.error('[useNoteRelationsStore] confirm failed', err);
      throw err;
    }
  },

  reject: async (noteId: number, relationId: number) => {
    try {
      await rejectRelation(relationId);
      await get().fetchRelations(noteId);
    } catch (err) {
      console.error('[useNoteRelationsStore] reject failed', err);
      throw err;
    }
  },

  remove: async (noteId: number, relationId: number) => {
    try {
      await deleteRelation(relationId);
      await get().fetchRelations(noteId);
    } catch (err) {
      console.error('[useNoteRelationsStore] remove failed', err);
      throw err;
    }
  },

  addManual: async (sourceNoteId: number, targetNoteId: number) => {
    try {
      await upsertRelation({
        sourceNoteId,
        targetNoteId,
        origin: 'manual',
        status: 'confirmed',
      });
      await get().fetchRelations(sourceNoteId);
    } catch (err) {
      console.error('[useNoteRelationsStore] addManual failed', err);
      throw err;
    }
  },
}));
