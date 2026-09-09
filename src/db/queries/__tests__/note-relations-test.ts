import { getDb } from '../../index';
import {
  confirmRelation,
  deleteRelation,
  extractSearchTerms,
  findCandidateNotes,
  getRelatedNotes,
  rejectRelation,
  upsertRelation,
} from '../note-relations';
import { getById } from '../notes';

jest.mock('../../index', () => ({
  getDb: jest.fn(),
}));

jest.mock('../notes', () => ({
  getById: jest.fn(),
}));

type MockDb = Awaited<ReturnType<typeof getDb>>;

const mockGetDb = jest.mocked(getDb);
const mockGetById = jest.mocked(getById);
const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockGetFirstAsync = jest.fn();
const mockWithTransactionAsync = jest.fn();

const mockDb = {
  runAsync: mockRunAsync,
  getAllAsync: mockGetAllAsync,
  getFirstAsync: mockGetFirstAsync,
  withTransactionAsync: mockWithTransactionAsync,
} as unknown as MockDb;

describe('note-relations queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDb.mockResolvedValue(mockDb);
  });

  describe('extractSearchTerms', () => {
    it('filters out stopwords, punctuation, and short words', () => {
      const terms = extractSearchTerms(
        'Arquitectura de software',
        'Este es un documento sobre patrones y diseño hexagonal.',
      );
      expect(terms).toContain('arquitectura');
      expect(terms).toContain('software');
      expect(terms).toContain('patrones');
      expect(terms).toContain('diseño');
      expect(terms).toContain('hexagonal');
      expect(terms).not.toContain('este');
      expect(terms).not.toContain('sobre');
      expect(terms).not.toContain('para');
    });
  });

  describe('upsertRelation', () => {
    it('throws when trying to relate a note to itself', async () => {
      await expect(
        upsertRelation({
          sourceNoteId: 5,
          targetNoteId: 5,
          origin: 'manual',
          status: 'confirmed',
        }),
      ).rejects.toThrow('No se puede relacionar una nota consigo misma');
    });

    it('inserts a new relation when none exists', async () => {
      mockGetFirstAsync.mockResolvedValueOnce(null);
      mockRunAsync.mockResolvedValueOnce({ lastInsertRowId: 42 });

      const id = await upsertRelation({
        sourceNoteId: 1,
        targetNoteId: 2,
        origin: 'manual',
        status: 'confirmed',
      });

      expect(id).toBe(42);
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO note_relations'),
        1,
        2,
        'manual',
        'confirmed',
        null,
        null,
      );
    });

    it('updates existing relation and preserves manual origin if new is ai', async () => {
      mockGetFirstAsync.mockResolvedValueOnce({
        id: 10,
        source_note_id: 1,
        target_note_id: 2,
        origin: 'manual',
        status: 'suggested',
      });
      mockRunAsync.mockResolvedValueOnce({ lastInsertRowId: 10 });

      const id = await upsertRelation({
        sourceNoteId: 1,
        targetNoteId: 2,
        origin: 'ai',
        status: 'confirmed',
        similarityScore: 0.9,
        reason: 'Conexión fuerte',
      });

      expect(id).toBe(10);
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE note_relations'),
        'manual',
        'confirmed',
        0.9,
        'Conexión fuerte',
        10,
      );
    });
  });

  describe('confirmRelation & rejectRelation & deleteRelation', () => {
    it('confirms a relation', async () => {
      await confirmRelation(7);
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'confirmed'"),
        7,
      );
    });

    it('rejects a relation', async () => {
      await rejectRelation(8);
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'rejected'"),
        8,
      );
    });

    it('deletes a relation', async () => {
      await deleteRelation(9);
      expect(mockRunAsync).toHaveBeenCalledWith(
        'DELETE FROM note_relations WHERE id = ?',
        9,
      );
    });
  });

  describe('getRelatedNotes', () => {
    it('returns formatted related note items', async () => {
      const rawRows = [
        {
          relation_id: 1,
          source_note_id: 3,
          target_note_id: 8,
          origin: 'manual',
          status: 'confirmed',
          similarity_score: null,
          reason: null,
          updated_at: 1000,
          note_id: 8,
          title: 'Target Note',
          body_md: 'Target Content',
          tag_names: 'tag1 tag2',
        },
      ];
      mockGetAllAsync.mockResolvedValueOnce(rawRows);

      const items = await getRelatedNotes(3);
      expect(items).toEqual([
        {
          relationId: 1,
          noteId: 8,
          title: 'Target Note',
          body_md: 'Target Content',
          tags: ['tag1', 'tag2'],
          origin: 'manual',
          status: 'confirmed',
          similarity_score: null,
          reason: null,
          updated_at: 1000,
          isSource: true,
        },
      ]);
    });
  });

  describe('findCandidateNotes', () => {
    it('finds candidates using tag overlap and content matching', async () => {
      mockGetById.mockImplementation(async (id: number) => {
        if (id === 1) {
          return {
            id: 1,
            title: 'Arquitectura limpia',
            body_md: 'Explicación de Clean Architecture y testing en TypeScript',
            status: 'active',
            pinned: 0,
            parent_id: null,
            section: null,
            content_type: 'markdown',
            created_at: 100,
            updated_at: 100,
            deleted_at: null,
            tags: ['arquitectura', 'typescript'],
          };
        }
        if (id === 2) {
          return {
            id: 2,
            title: 'Hexagonal en TypeScript',
            body_md: 'Puertos y adaptadores para apps móviles',
            status: 'active',
            pinned: 0,
            parent_id: null,
            section: null,
            content_type: 'markdown',
            created_at: 100,
            updated_at: 100,
            deleted_at: null,
            tags: ['typescript'],
          };
        }
        return null;
      });

      // No previous relations
      mockGetAllAsync.mockResolvedValueOnce([]); // existingRelations
      // Tag matches
      mockGetAllAsync.mockResolvedValueOnce([
        { note_id: 2, shared_tag_count: 1, matched_tags: 'typescript' },
      ]);
      // FTS matches
      mockGetAllAsync.mockResolvedValueOnce([
        { rowid: 2, bm25_score: -4.5 },
      ]);

      const candidates = await findCandidateNotes(1, 5);
      expect(candidates.length).toBe(1);
      expect(candidates[0].note.id).toBe(2);
      expect(candidates[0].score).toBeGreaterThan(0.3);
      expect(candidates[0].reason).toContain('typescript');
    });
  });
});
