jest.mock('@/db/queries/notes', () => ({
  getSections: jest.fn(async () => ({
    pinned: [],
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  })),
  getNotesBySection: jest.fn(async () => []),
  getNotesByCollection: jest.fn(async () => []),
  searchNotesWithScore: jest.fn(async () => []),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
  restoreNote: jest.fn(),
  pinNote: jest.fn(),
}));

type NotesStore = typeof import('../notes').useNotesStore;
type NotesRepoMock = {
  getSections: jest.Mock;
};

let useNotesStore: NotesStore;
let notesRepo: NotesRepoMock;

beforeEach(() => {
  jest.resetModules();
  useNotesStore = jest.requireActual<typeof import('../notes')>('../notes').useNotesStore;
  notesRepo = jest.requireMock('@/db/queries/notes') as NotesRepoMock;
  jest.clearAllMocks();
});

describe('notes filter actions', () => {
  it('clears all selected tags with one repository read', async () => {
    useNotesStore.setState({ selectedTagIds: [1, 2] });

    await useNotesStore.getState().clearTagFilter();

    expect(useNotesStore.getState().selectedTagIds).toEqual([]);
    expect(notesRepo.getSections).toHaveBeenCalledTimes(1);
  });

  it('clears every filter and search state with one unfiltered read', async () => {
    useNotesStore.setState({
      sectionFilter: 'Estudio',
      collectionFilter: 3,
      selectedTagIds: [1, 2],
      searchQuery: 'arquitectura',
      searchResults: [{ id: 1 } as never],
      filteredNotes: [{ id: 2 } as never],
    });

    await useNotesStore.getState().clearAllFilters();

    expect(useNotesStore.getState()).toEqual(
      expect.objectContaining({
        sectionFilter: null,
        collectionFilter: null,
        selectedTagIds: [],
        searchQuery: '',
        searchResults: [],
        filteredNotes: null,
      }),
    );
    expect(notesRepo.getSections).toHaveBeenCalledTimes(1);
    expect(notesRepo.getSections).toHaveBeenCalledWith(null);
  });

  it('passes selected tags through unchanged for the AND filter contract', async () => {
    useNotesStore.setState({ selectedTagIds: [9, 4] });

    await useNotesStore.getState().fetchSections();

    expect(notesRepo.getSections).toHaveBeenCalledWith([9, 4]);
  });

  it('keeps the baseline cost of one repository read per tag toggle', async () => {
    await useNotesStore.getState().toggleTagFilter(1);
    await useNotesStore.getState().toggleTagFilter(2);

    expect(notesRepo.getSections).toHaveBeenCalledTimes(2);
  });
});
