import { generateAndPersistSuggestions } from '../note-relations';
import { getById } from '@/db/queries/notes';
import {
  findCandidateNotes,
  getRelatedNotes,
  upsertRelation,
} from '@/db/queries/note-relations';
import { getActiveLLMConfig } from '../llm-providers';

jest.mock('@/db/queries/notes', () => ({
  getById: jest.fn(),
}));

jest.mock('@/db/queries/note-relations', () => ({
  findCandidateNotes: jest.fn(),
  getRelatedNotes: jest.fn(),
  upsertRelation: jest.fn(),
}));

jest.mock('../llm-providers', () => ({
  getActiveLLMConfig: jest.fn(),
}));

const mockGetById = jest.mocked(getById);
const mockFindCandidateNotes = jest.mocked(findCandidateNotes);
const mockGetRelatedNotes = jest.mocked(getRelatedNotes);
const mockUpsertRelation = jest.mocked(upsertRelation);
const mockGetActiveLLMConfig = jest.mocked(getActiveLLMConfig);

describe('note-relations service', () => {
  const sampleNote = {
    id: 1,
    title: 'Nota A',
    body_md: 'Contenido sobre TypeScript',
    status: 'active' as const,
    pinned: 0,
    parent_id: null,
    section: null,
    content_type: 'markdown',
    created_at: 100,
    updated_at: 100,
    deleted_at: null,
    tags: ['ts'],
  };

  const sampleCandidate = {
    note: {
      id: 2,
      title: 'Nota B',
      body_md: 'Más contenido sobre TS y arquitectura',
      status: 'active' as const,
      pinned: 0,
      parent_id: null,
      section: null,
      content_type: 'markdown',
      created_at: 100,
      updated_at: 100,
      deleted_at: null,
      tags: ['ts'],
    },
    score: 0.7,
    reason: 'Etiquetas comunes: ts',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    mockGetById.mockResolvedValue(sampleNote);
    mockFindCandidateNotes.mockResolvedValue([sampleCandidate]);
    mockGetRelatedNotes.mockResolvedValue([
      {
        relationId: 1,
        noteId: 2,
        title: 'Nota B',
        body_md: '...',
        tags: ['ts'],
        origin: 'ai',
        status: 'suggested',
        similarity_score: 0.85,
        reason: 'Ambas notas tratan sobre arquitectura y TypeScript',
        updated_at: 100,
        isSource: true,
      },
    ]);
  });

  it('uses LLM when configured and persists refined suggestions', async () => {
    mockGetActiveLLMConfig.mockResolvedValue({
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      headers: { Authorization: 'Bearer test-key' },
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  noteId: 2,
                  confidence: 0.85,
                  reason: 'Ambas notas tratan sobre arquitectura y TypeScript',
                },
              ]),
            },
          },
        ],
      }),
    });

    const result = await generateAndPersistSuggestions(1);

    expect(mockUpsertRelation).toHaveBeenCalledWith({
      sourceNoteId: 1,
      targetNoteId: 2,
      origin: 'ai',
      status: 'suggested',
      similarityScore: 0.85,
      reason: 'Ambas notas tratan sobre arquitectura y TypeScript',
    });
    expect(result.length).toBe(1);
  });

  it('falls back to local heuristic candidates when LLM fails or is unavailable', async () => {
    mockGetActiveLLMConfig.mockResolvedValue({
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      headers: { Authorization: 'Bearer test-key' },
    });

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    await generateAndPersistSuggestions(1);

    expect(mockUpsertRelation).toHaveBeenCalledWith({
      sourceNoteId: 1,
      targetNoteId: 2,
      origin: 'semantic',
      status: 'suggested',
      similarityScore: 0.7,
      reason: 'Etiquetas comunes: ts',
    });
  });
});
