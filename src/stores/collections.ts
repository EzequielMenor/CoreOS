import { create } from 'zustand';
import * as collectionsRepo from '@/db/queries/collections';
import type {
  CollectionWithCount,
} from '@/db/queries/collections';

interface CollectionsState {
  collections: CollectionWithCount[];
  loading: boolean;
  error: string | null;

  fetchCollections: () => Promise<void>;
  create: (name: string, description?: string) => Promise<number>;
  update: (id: number, name: string, description: string | null) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setOrder: (collectionId: number, orderedNoteIds: number[]) => Promise<void>;
  setNoteSection: (noteId: number, section: string | null) => Promise<void>;
}

function setError(error: string | null): { error: string | null } {
  console.error('[useCollectionsStore]', error);
  return { error };
}

export const useCollectionsStore = create<CollectionsState>()((set, get) => ({
  collections: [],
  loading: false,
  error: null,

  fetchCollections: async () => {
    set({ loading: true, error: null });
    try {
      const collections = await collectionsRepo.listCollections();
      set({ collections, loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : String(e)),
        loading: false,
      });
    }
  },

  create: async (name, description) => {
    try {
      const id = await collectionsRepo.createCollection(name, description);
      await get().fetchCollections();
      return id;
    } catch (e) {
      set(setError(e instanceof Error ? e.message : String(e)));
      throw e;
    }
  },

  update: async (id, name, description) => {
    try {
      await collectionsRepo.updateCollection(id, { name, description });
      await get().fetchCollections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : String(e)));
      throw e;
    }
  },

  remove: async (id) => {
    try {
      await collectionsRepo.deleteCollection(id);
      await get().fetchCollections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : String(e)));
      throw e;
    }
  },

  setOrder: async (collectionId, orderedNoteIds) => {
    try {
      await collectionsRepo.setCollectionOrder(collectionId, orderedNoteIds);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : String(e)));
      throw e;
    }
  },

  setNoteSection: async (noteId, section) => {
    try {
      await collectionsRepo.setNoteSection(noteId, section);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : String(e)));
      throw e;
    }
  },
}));
