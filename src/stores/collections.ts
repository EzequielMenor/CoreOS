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
  create: (name: string) => Promise<number>;
  rename: (id: number, name: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setNoteCollections: (noteId: number, collectionIds: number[]) => Promise<void>;
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
        ...setError(e instanceof Error ? e.message : 'fetchCollections failed'),
        loading: false,
      });
    }
  },

  create: async (name) => {
    try {
      const id = await collectionsRepo.createCollection(name);
      await get().fetchCollections();
      return id;
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createCollection failed'));
      throw e;
    }
  },

  rename: async (id, name) => {
    try {
      await collectionsRepo.renameCollection(id, name);
      await get().fetchCollections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'renameCollection failed'));
      throw e;
    }
  },

  remove: async (id) => {
    try {
      await collectionsRepo.deleteCollection(id);
      await get().fetchCollections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'deleteCollection failed'));
      throw e;
    }
  },

  setNoteCollections: async (noteId, collectionIds) => {
    try {
      const current = await collectionsRepo.getNoteCollections(noteId);
      const desiredIds = new Set(collectionIds);
      const currentIds = new Set(current.map((collection) => collection.id));

      for (const collectionId of collectionIds) {
        if (!currentIds.has(collectionId)) {
          await collectionsRepo.addNoteToCollection(noteId, collectionId);
        }
      }
      for (const collectionId of currentIds) {
        if (!desiredIds.has(collectionId)) {
          await collectionsRepo.removeNoteFromCollection(noteId, collectionId);
        }
      }
      await get().fetchCollections();
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'setNoteCollections failed'));
      throw e;
    }
  },

  setOrder: async (collectionId, orderedNoteIds) => {
    try {
      await collectionsRepo.setCollectionOrder(collectionId, orderedNoteIds);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'setCollectionOrder failed'));
      throw e;
    }
  },

  setNoteSection: async (noteId, section) => {
    try {
      await collectionsRepo.setNoteSection(noteId, section);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'setNoteSection failed'));
      throw e;
    }
  },
}));
