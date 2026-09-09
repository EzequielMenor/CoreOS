import { getDb } from '../../index';
import {
  addNoteToCollection,
  createCollection,
  listCollections,
  removeNoteFromCollection,
  setCollectionOrder,
} from '../collections';

jest.mock('../../index', () => ({
  getDb: jest.fn(),
}));

type MockDb = Awaited<ReturnType<typeof getDb>>;

const mockGetDb = jest.mocked(getDb);
const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockWithTransactionAsync = jest.fn();
const mockDb = {
  runAsync: mockRunAsync,
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

  it('lists collections ordered by name with counts', async () => {
    const rows = [
      { id: 2, name: 'Alpha', created_at: 2, updated_at: 3, note_count: 1 },
      { id: 1, name: 'beta', created_at: 1, updated_at: 2, note_count: 0 },
    ];
    mockGetAllAsync.mockResolvedValueOnce(rows);

    await expect(listCollections()).resolves.toEqual(rows);
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY c.name COLLATE NOCASE ASC'),
    );
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
});
