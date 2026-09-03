import { create } from 'zustand';
import * as tagsRepo from '@/db/queries/tags';
import type { TagWithCount } from '@/db/queries/tags';
import { useNotesStore } from './notes';

interface TagsState {
  tags: TagWithCount[];
  loading: boolean;
  error: string | null;

  fetchTags: () => Promise<void>;
  createTag: (name: string) => Promise<void>;
}

function setError(error: string | null): { error: string | null } {
  console.error('[useTagsStore]', error);
  return { error };
}

export const useTagsStore = create<TagsState>()((set) => ({
  tags: [],
  loading: false,
  error: null,

  fetchTags: async () => {
    set({ loading: true, error: null });
    try {
      const tags = await tagsRepo.listTags();
      set({ tags, loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : 'fetchTags failed'),
        loading: false,
      });
    }
  },

  createTag: async (name) => {
    try {
      await tagsRepo.createTag(name);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createTag failed'));
      throw e;
    }
    await useTagsStore.getState().fetchTags();
    await useNotesStore.getState().fetchSections();
  },
}));
