import { create } from 'zustand';

type SectionFilter = 'all' | 'pinned' | 'inbox';
type EditorMode = 'create' | 'edit';
type EditorDomain = 'note' | 'tarea' | 'gasto' | 'sueno';

interface UiState {
  isEditorOpen: boolean;
  editorMode: EditorMode;
  editorNoteId: number | null;
  editorDomain: EditorDomain;
  activeSectionFilter: SectionFilter;

  openEditor: (mode: EditorMode, noteId?: number) => void;
  closeEditor: () => void;
  setEditorDomain: (domain: EditorDomain) => void;
  setSectionFilter: (filter: SectionFilter) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  isEditorOpen: false,
  editorMode: 'create',
  editorNoteId: null,
  editorDomain: 'note',
  activeSectionFilter: 'all',

  openEditor: (mode, noteId) =>
    set({
      isEditorOpen: true,
      editorMode: mode,
      editorNoteId: noteId ?? null,
    }),

  closeEditor: () =>
    set({ isEditorOpen: false, editorNoteId: null }),

  setEditorDomain: (domain) => set({ editorDomain: domain }),
  setSectionFilter: (filter) => set({ activeSectionFilter: filter }),
}));
