import { getDb } from '../../index';
import {
  completeAudioCapture,
  discardAudioCapture,
  getAudioCapture,
  getRecentAudioCaptures,
  getRecoverableAudioCapture,
  insertAudioCapture,
  updateAudioCaptureStatus,
} from '../audio-captures';
import { deleteAudioRecording } from '@/lib/audio-storage';

jest.mock('../../index', () => ({
  getDb: jest.fn(),
}));

jest.mock('@/lib/audio-storage', () => ({
  deleteAudioRecording: jest.fn(),
}));

const mockGetDb = jest.mocked(getDb);
const mockDeleteAudioRecording = jest.mocked(deleteAudioRecording);

describe('audio-captures queries', () => {
  const mockRunAsync = jest.fn();
  const mockGetFirstAsync = jest.fn();
  const mockGetAllAsync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDb.mockResolvedValue({
      runAsync: mockRunAsync,
      getFirstAsync: mockGetFirstAsync,
      getAllAsync: mockGetAllAsync,
    } as any);
  });

  it('insertAudioCapture inserta con status recorded y retorna el rowId', async () => {
    mockRunAsync.mockResolvedValueOnce({ lastInsertRowId: 42 });

    const id = await insertAudioCapture('file:///test/audio.wav');

    expect(id).toBe(42);
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, 'recorded')"),
      'file:///test/audio.wav',
      expect.any(Number),
    );
  });

  it('updateAudioCaptureStatus actualiza status sin opciones adicionales', async () => {
    mockRunAsync.mockResolvedValueOnce({});

    await updateAudioCaptureStatus(1, 'transcribing');

    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE audio_captures SET status = ? WHERE id = ?',
      'transcribing',
      1,
    );
  });

  it('updateAudioCaptureStatus actualiza con transcripción o error', async () => {
    mockRunAsync.mockResolvedValueOnce({});

    await updateAudioCaptureStatus(1, 'transcribed', {
      transcription: 'Texto reconocido',
    });

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE audio_captures'),
      'transcribed',
      'Texto reconocido',
      null,
      1,
    );
  });

  it('getAudioCapture retorna la fila encontrada o null', async () => {
    const mockRow = {
      id: 1,
      file_uri: 'file:///test.wav',
      created_at: 123456,
      status: 'recorded' as const,
      transcription: null,
      error_message: null,
    };
    mockGetFirstAsync.mockResolvedValueOnce(mockRow);

    const result = await getAudioCapture(1);
    expect(result).toEqual(mockRow);

    mockGetFirstAsync.mockResolvedValueOnce(null);
    const nullResult = await getAudioCapture(2);
    expect(nullResult).toBeNull();
  });

  it('getRecentAudioCaptures retorna una lista ordenada', async () => {
    const mockRows = [
      { id: 2, file_uri: 'file:///2.wav', created_at: 200, status: 'transcribed' },
      { id: 1, file_uri: 'file:///1.wav', created_at: 100, status: 'recorded' },
    ];
    mockGetAllAsync.mockResolvedValueOnce(mockRows);

    const results = await getRecentAudioCaptures(5);
    expect(results).toEqual(mockRows);
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at DESC LIMIT ?'),
      5,
    );
  });

  it('getRecoverableAudioCapture busca capturas en recorded, transcribing o failed', async () => {
    const mockRow = {
      id: 99,
      file_uri: 'file:///recover.wav',
      created_at: 500,
      status: 'failed' as const,
      transcription: null,
      error_message: 'timeout',
    };
    mockGetFirstAsync.mockResolvedValueOnce(mockRow);

    const result = await getRecoverableAudioCapture();
    expect(result).toEqual(mockRow);
    expect(mockGetFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE status IN ('recorded', 'transcribing', 'failed')"),
    );
  });

  it('completeAudioCapture elimina el archivo y marca status completed', async () => {
    const mockRow = {
      id: 10,
      file_uri: 'file:///done.wav',
      created_at: 100,
      status: 'transcribed' as const,
      transcription: 'hola',
      error_message: null,
    };
    mockGetFirstAsync.mockResolvedValueOnce(mockRow);
    mockRunAsync.mockResolvedValueOnce({});

    await completeAudioCapture(10);

    expect(mockDeleteAudioRecording).toHaveBeenCalledWith('file:///done.wav');
    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE audio_captures SET status = ? WHERE id = ?',
      'completed',
      10,
    );
  });

  it('discardAudioCapture elimina el archivo y marca status discarded', async () => {
    const mockRow = {
      id: 11,
      file_uri: 'file:///discard.wav',
      created_at: 100,
      status: 'failed' as const,
      transcription: null,
      error_message: null,
    };
    mockGetFirstAsync.mockResolvedValueOnce(mockRow);
    mockRunAsync.mockResolvedValueOnce({});

    await discardAudioCapture(11);

    expect(mockDeleteAudioRecording).toHaveBeenCalledWith('file:///discard.wav');
    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE audio_captures SET status = ? WHERE id = ?',
      'discarded',
      11,
    );
  });
});
