import { getDb } from '../../index';
import {
  addNoteToCollection,
  createCollection,
  getCollection,
  listCollectionNotes,
  listCollections,
  listNotesNotInCollection,
  removeNoteFromCollection,
  setCollectionOrder,
  updateCollection,
} from '../collections';

jest.mock('../../index', () => ({
  getDb: jest.fn(),
}));

type MockDb = Awaited<ReturnType<typeof getDb>>;

const mockGetDb = jest.mocked(getDb);
const mockRunAsync = jest.fn();
const mockGetFirstAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockWithTransactionAsync = jest.fn();
const mockDb = {
  runAsync: mockRunAsync,
  getFirstAsync: mockGetFirstAsync,
  getAllAsync: mockGetAllAsync,
  withTransactionAsync: mockWithTransactionAsync,
} as unknown as MockDb;

describe('collections queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDb.mockResolvedValue(mockDb);
    mockWithTransactionAsync.mockImplementation(
      async (callback: () => Promise<void>) => callback(),
    );
  });

  it('rejects empty collection names', async () => {
    await expect(createCollection('  ')).rejects.toThrow(
      'Collection name is required',
    );
  });

  it('creates collections with a trimmed description or null by default', async () => {
    mockRunAsync.mockResolvedValue({ lastInsertRowId: 42 });

    await createCollection('  Alpha ', '  Description  ');
    expect(mockRunAsync).toHaveBeenCalledWith(
      'INSERT INTO collections (name, description, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())',
      'Alpha',
      'Description',
    );

    mockRunAsync.mockClear();
    await createCollection('Beta');
    expect(mockRunAsync).toHaveBeenCalledWith(
      'INSERT INTO collections (name, description, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())',
      'Beta',
      null,
    );
  });

  it('lists collections ordered by name with counts', async () => {
    const rows = [
      {
        id: 2,
        name: 'Alpha',
        description: null,
        created_at: 2,
        updated_at: 3,
        note_count: 1,
      },
      {
        id: 1,
        name: 'beta',
        description: 'Description',
        created_at: 1,
        updated_at: 2,
        note_count: 0,
      },
    ];
    mockGetAllAsync.mockResolvedValueOnce(rows);

    await expect(listCollections()).resolves.toEqual(rows);
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY c.name COLLATE NOCASE ASC'),
    );
  });

  it('updates a collection name and description with the updated timestamp', async () => {
    await updateCollection(9, { name: '  Alpha ', description: '  Description  ' });

    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE collections SET name = ?, description = ?, updated_at = unixepoch() WHERE id = ?',
      'Alpha',
      'Description',
      9,
    );
  });

  it('gets a collection or returns null', async () => {
    const row = {
      id: 9,
      name: 'Alpha',
      description: 'Description',
      created_at: 1,
      updated_at: 2,
    };
    mockGetFirstAsync.mockResolvedValueOnce(row);

    await expect(getCollection(9)).resolves.toEqual(row);
    expect(mockGetFirstAsync).toHaveBeenCalledWith(
      'SELECT id, name, description, created_at, updated_at FROM collections WHERE id = ?',
      9,
    );

    mockGetFirstAsync.mockResolvedValueOnce(null);
    await expect(getCollection(10)).resolves.toBeNull();
  });

  it('adds a note with an insert-or-ignore membership', async () => {
    await addNoteToCollection(4, 9, 2);

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO note_collections'),
      4,
      9,
      2,
    );
  });

  it('sets collection positions in input order', async () => {
    await setCollectionOrder(9, [4, 7]);

    expect(mockRunAsync.mock.calls).toEqual([
      [
        'UPDATE note_collections SET position = ? WHERE collection_id = ? AND note_id = ?',
        0,
        9,
        4,
      ],
      [
        'UPDATE note_collections SET position = ? WHERE collection_id = ? AND note_id = ?',
        1,
        9,
        7,
      ],
    ]);
  });

  it('removes a note membership', async () => {
    await removeNoteFromCollection(4, 9);

    expect(mockRunAsync).toHaveBeenCalledWith(
      'DELETE FROM note_collections WHERE note_id = ? AND collection_id = ?',
      4,
      9,
    );
  });

  it('lists notes not in a collection with a title search and limit', async () => {
    const rows = [{ id: 4, title: 'Alpha note' }];
    mockGetAllAsync.mockResolvedValueOnce(rows);

    await expect(listNotesNotInCollection(9, '  Alpha  ')).resolves.toEqual(rows);
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('n.id NOT IN'),
      9,
      'Alpha',
    );
    expect(mockGetAllAsync.mock.calls[0][0]).toEqual(
      expect.stringContaining("LIKE '%' || ? || '%'")
    );
    expect(mockGetAllAsync.mock.calls[0][0]).toEqual(
      expect.stringContaining('LIMIT 25')
    );
  });

  it('lists collection notes with titles and the existing order', async () => {
    const rows = [
      { note_id: 4, position: 0, created_at: 10, title: 'Alpha note' },
    ];
    mockGetAllAsync.mockResolvedValueOnce(rows);

    await expect(listCollectionNotes(9)).resolves.toEqual(rows);
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('SELECT nc.note_id, nc.position, n.created_at, n.title'),
      9,
    );
    expect(mockGetAllAsync.mock.calls[0][0]).toEqual(
      expect.stringContaining(
        'ORDER BY nc.position IS NULL ASC, nc.position ASC, n.created_at DESC',
      )
    );
  });
});
