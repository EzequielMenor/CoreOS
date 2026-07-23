import { create } from 'zustand';
import * as ideasRepo from '@/db/queries/ideas';
import type { Idea } from '@/db/queries/ideas';
import { useNotesStore } from './notes';

interface IdeasState {
  inbox: Idea[];
  processed: Idea[];
  discarded: Idea[];
  loading: boolean;
  error: string | null;

  fetchIdeas: () => Promise<void>;
  createIdea: (text: string) => Promise<void>;
  convertToNote: (ideaId: number) => Promise<number>;
  discardIdea: (ideaId: number) => Promise<void>;
}

function setError(error: string | null): { error: string | null } {
  console.error('[useIdeasStore]', error);
  return { error };
}

function groupByStatus(ideas: Idea[]): Pick<
  IdeasState,
  'inbox' | 'processed' | 'discarded'
> {
  const groups = { inbox: [], processed: [], discarded: [] } as Pick<
    IdeasState,
    'inbox' | 'processed' | 'discarded'
  >;
  for (const idea of ideas) {
    if (idea.status === 'inbox') groups.inbox.push(idea);
    else if (idea.status === 'processed') groups.processed.push(idea);
    else groups.discarded.push(idea);
  }
  return groups;
}

export const useIdeasStore = create<IdeasState>()((set, get) => ({
  inbox: [],
  processed: [],
  discarded: [],
  loading: false,
  error: null,

  fetchIdeas: async () => {
    set({ loading: true, error: null });
    try {
      const all = await ideasRepo.listIdeas(null);
      set({ ...groupByStatus(all), loading: false });
    } catch (e) {
      set({
        ...setError(e instanceof Error ? e.message : 'fetchIdeas failed'),
        loading: false,
      });
    }
  },

  createIdea: async (text) => {
    try {
      await ideasRepo.createIdea(text);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'createIdea failed'));
      throw e;
    }
    await get().fetchIdeas();
  },

  convertToNote: async (ideaId) => {
    let noteId = 0;
    try {
      noteId = await ideasRepo.convertIdeaToNote(ideaId);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'convertToNote failed'));
      throw e;
    }
    await get().fetchIdeas();
    await useNotesStore.getState().fetchSections();
    return noteId;
  },

  discardIdea: async (ideaId) => {
    try {
      await ideasRepo.discardIdea(ideaId);
    } catch (e) {
      set(setError(e instanceof Error ? e.message : 'discardIdea failed'));
      throw e;
    }
    await get().fetchIdeas();
  },
}));
