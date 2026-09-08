import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { persistAudioRecording } from '@/lib/audio-storage';
import {
  completeAudioCapture,
  discardAudioCapture,
  getRecoverableAudioCapture,
  insertAudioCapture,
  updateAudioCaptureStatus,
} from '@/db/queries/audio-captures';
import { getTranscriptionProvider } from '@/services/transcription';
import {
  useVoiceCapture,
  type UseVoiceCaptureResult,
} from '../use-voice-capture';

jest.mock('expo-audio', () => ({
  useAudioRecorder: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
  AudioQuality: { HIGH: 96 },
  IOSOutputFormat: { LINEARPCM: 'lpcm' },
}));

jest.mock('@/lib/audio-storage', () => ({
  persistAudioRecording: jest.fn(),
}));

jest.mock('@/db/queries/audio-captures', () => ({
  insertAudioCapture: jest.fn(),
  updateAudioCaptureStatus: jest.fn(),
  getRecoverableAudioCapture: jest.fn(),
  completeAudioCapture: jest.fn(),
  discardAudioCapture: jest.fn(),
}));

jest.mock('@/services/transcription', () => ({
  getTranscriptionProvider: jest.fn(),
}));

jest.mock('@/lib/animations', () => ({
  haptic: {
    tap: {
      light: jest.fn(),
      medium: jest.fn(),
      heavy: jest.fn(),
    },
    notify: {
      success: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    },
  },
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('useVoiceCapture hook', () => {
  const mockAudioRecorder = {
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
    uri: 'file:///temp/recording.wav',
  };

  const mockProvider = {
    id: 'test-provider',
    name: 'Test Provider',
    isAvailable: jest.fn().mockResolvedValue(true),
    transcribeFile: jest.fn(),
  };

  const mockOnSuccess = jest.fn();

  function renderVoiceCapture() {
    let result: UseVoiceCaptureResult | undefined;
    function Probe() {
      result = useVoiceCapture({ onTranscriptionSuccess: mockOnSuccess });
      return null;
    }
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(createElement(Probe));
    });
    return {
      get current(): UseVoiceCaptureResult {
        if (!result) throw new Error('Hook no montado');
        return result;
      },
      unmount() {
        act(() => {
          tree?.unmount();
        });
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    jest.mocked(useAudioRecorder).mockReturnValue(mockAudioRecorder as any);
    jest
      .mocked(requestRecordingPermissionsAsync)
      .mockResolvedValue({ granted: true } as any);
    jest.mocked(setAudioModeAsync).mockResolvedValue(undefined as any);
    jest
      .mocked(persistAudioRecording)
      .mockResolvedValue('file:///permanent/capture.wav');
    jest.mocked(insertAudioCapture).mockResolvedValue(101);
    jest.mocked(updateAudioCaptureStatus).mockResolvedValue(undefined as any);
    jest.mocked(getRecoverableAudioCapture).mockResolvedValue(null);
    jest.mocked(getTranscriptionProvider).mockReturnValue(mockProvider as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('inicia grabación con permisos y actualiza timer', async () => {
    const view = renderVoiceCapture();

    await act(async () => {
      await view.current.startRecording();
    });

    expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
    expect(mockAudioRecorder.prepareToRecordAsync).toHaveBeenCalled();
    expect(mockAudioRecorder.record).toHaveBeenCalled();
    expect(view.current.isRecording).toBe(true);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(view.current.durationSeconds).toBe(3);

    view.unmount();
  });

  it('detiene grabación, persiste audio en disco, registra en SQLite y transcribe', async () => {
    mockProvider.transcribeFile.mockResolvedValueOnce('Idea capturada por voz');
    const view = renderVoiceCapture();

    await act(async () => {
      await view.current.startRecording();
    });

    await act(async () => {
      await view.current.stopRecording();
    });

    // 1. Audio guardado en disco permanente antes de transcribir
    expect(persistAudioRecording).toHaveBeenCalledWith('file:///temp/recording.wav');

    // 2. Fila insertada en SQLite
    expect(insertAudioCapture).toHaveBeenCalledWith('file:///permanent/capture.wav');

    // 3. Status actualizado a transcribing y luego transcribed
    expect(updateAudioCaptureStatus).toHaveBeenCalledWith(101, 'transcribing');
    expect(mockProvider.transcribeFile).toHaveBeenCalledWith('file:///permanent/capture.wav');
    expect(updateAudioCaptureStatus).toHaveBeenCalledWith(101, 'transcribed', {
      transcription: 'Idea capturada por voz',
    });

    // 4. Callback llamado para alimentar el editor
    expect(mockOnSuccess).toHaveBeenCalledWith('Idea capturada por voz');
    expect(view.current.isRecording).toBe(false);
    expect(view.current.isTranscribing).toBe(false);

    // 5. Al completar guardado, purga el audio activo
    await act(async () => {
      await view.current.completeActiveCapture();
    });
    expect(completeAudioCapture).toHaveBeenCalledWith(101);

    view.unmount();
  });

  it('si la transcripción falla, no pierde la captura y permite reintentar', async () => {
    mockProvider.transcribeFile.mockRejectedValueOnce(
      new Error('Fallo de red en reconocimiento'),
    );
    const view = renderVoiceCapture();

    await act(async () => {
      await view.current.startRecording();
    });

    await act(async () => {
      await view.current.stopRecording();
    });

    expect(updateAudioCaptureStatus).toHaveBeenCalledWith(101, 'failed', {
      errorMessage: 'Fallo de red en reconocimiento',
    });
    expect(view.current.error).toBe('Fallo de red en reconocimiento');
    expect(view.current.canRetry).toBe(true);

    // Reintento exitoso
    mockProvider.transcribeFile.mockResolvedValueOnce('Texto tras reintentar');

    await act(async () => {
      await view.current.retryTranscription();
    });

    expect(mockProvider.transcribeFile).toHaveBeenCalledTimes(2);
    expect(mockOnSuccess).toHaveBeenCalledWith('Texto tras reintentar');
    expect(view.current.error).toBeNull();
    expect(view.current.canRetry).toBe(false);

    view.unmount();
  });

  it('recupera captura huérfana de SQLite al montar y permite reintentar o descartar', async () => {
    const orphanCapture = {
      id: 88,
      file_uri: 'file:///orphan.wav',
      created_at: 1000,
      status: 'failed' as const,
      transcription: null,
      error_message: 'interrupted',
    };
    jest.mocked(getRecoverableAudioCapture).mockResolvedValueOnce(orphanCapture);

    const view = renderVoiceCapture();
    // Dejar resolver el useEffect de recuperación
    await act(async () => {});

    expect(view.current.recoveredCapture).toEqual(orphanCapture);

    // Reintentar la captura recuperada
    mockProvider.transcribeFile.mockResolvedValueOnce('Texto recuperado');
    await act(async () => {
      await view.current.retryRecoveredCapture();
    });

    expect(mockProvider.transcribeFile).toHaveBeenCalledWith('file:///orphan.wav');
    expect(mockOnSuccess).toHaveBeenCalledWith('Texto recuperado');
    expect(view.current.recoveredCapture).toBeNull();

    view.unmount();
  });

  it('permite descartar la captura recuperada eliminándola', async () => {
    const orphanCapture = {
      id: 89,
      file_uri: 'file:///orphan2.wav',
      created_at: 2000,
      status: 'failed' as const,
      transcription: null,
      error_message: null,
    };
    jest.mocked(getRecoverableAudioCapture).mockResolvedValueOnce(orphanCapture);

    const view = renderVoiceCapture();
    await act(async () => {});

    await act(async () => {
      await view.current.dismissRecoveredCapture();
    });

    expect(discardAudioCapture).toHaveBeenCalledWith(89);
    expect(view.current.recoveredCapture).toBeNull();

    view.unmount();
  });

  it('cancelRecording detiene sin persistir ni transcribir', async () => {
    const view = renderVoiceCapture();

    await act(async () => {
      await view.current.startRecording();
    });

    await act(async () => {
      await view.current.cancelRecording();
    });

    expect(mockAudioRecorder.stop).toHaveBeenCalled();
    expect(persistAudioRecording).not.toHaveBeenCalled();
    expect(insertAudioCapture).not.toHaveBeenCalled();
    expect(mockProvider.transcribeFile).not.toHaveBeenCalled();
    expect(view.current.isRecording).toBe(false);

    view.unmount();
  });
});
