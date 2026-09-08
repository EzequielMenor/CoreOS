import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import {
  AndroidSpeechProvider,
  AppleSpeechProvider,
  getTranscriptionProvider,
  setTranscriptionProviderForTesting,
} from '../index';

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    supportsOnDeviceRecognition: jest.fn(),
    getSupportedLocales: jest.fn(),
    start: jest.fn(),
    abort: jest.fn(),
    addListener: jest.fn(),
  },
}));

describe('Transcription providers', () => {
  afterEach(() => {
    jest.clearAllMocks();
    setTranscriptionProviderForTesting(null);
  });

  describe('AndroidSpeechProvider', () => {
    it('documenta el gap: isAvailable retorna false', async () => {
      const provider = new AndroidSpeechProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    it('transcribeFile lanza error explicativo', async () => {
      const provider = new AndroidSpeechProvider();
      await expect(provider.transcribeFile('file:///audio.wav')).rejects.toThrow(
        'La transcripción de archivos en Android está pendiente de validación de compatibilidad',
      );
    });
  });

  describe('AppleSpeechProvider', () => {
    it('no está disponible fuera de iOS', async () => {
      const originalOS = Platform.OS;
      (Platform as any).OS = 'android';

      const provider = new AppleSpeechProvider();
      expect(await provider.isAvailable()).toBe(false);
      await expect(provider.transcribeFile('file:///audio.m4a')).rejects.toThrow(
        'Apple Speech solo está disponible en iOS/iPadOS.',
      );

      (Platform as any).OS = originalOS;
    });

    it('lanza error si no se conceden permisos en iOS', async () => {
      const originalOS = Platform.OS;
      (Platform as any).OS = 'ios';

      jest
        .mocked(ExpoSpeechRecognitionModule.isRecognitionAvailable)
        .mockReturnValue(true);
      jest
        .mocked(ExpoSpeechRecognitionModule.requestPermissionsAsync)
        .mockResolvedValueOnce({ granted: false } as any);

      const provider = new AppleSpeechProvider();
      await expect(provider.transcribeFile('file:///audio.wav')).rejects.toThrow(
        'Permiso de reconocimiento de voz o micrófono no concedido.',
      );

      (Platform as any).OS = originalOS;
    });

    it('transcribe exitosamente cuando se emite un resultado final', async () => {
      const originalOS = Platform.OS;
      (Platform as any).OS = 'ios';

      jest
        .mocked(ExpoSpeechRecognitionModule.isRecognitionAvailable)
        .mockReturnValue(true);
      jest
        .mocked(ExpoSpeechRecognitionModule.requestPermissionsAsync)
        .mockResolvedValueOnce({ granted: true } as any);
      jest
        .mocked(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition)
        .mockReturnValueOnce(true);
      jest
        .mocked(ExpoSpeechRecognitionModule.getSupportedLocales)
        .mockResolvedValueOnce({
          locales: ['es-ES'],
          installedLocales: ['es-ES'],
        });

      let resultListener: ((event: any) => void) | null = null;
      jest
        .mocked(ExpoSpeechRecognitionModule.addListener)
        .mockImplementation((event: string, listener: any) => {
          if (event === 'result') {
            resultListener = listener;
          }
          return { remove: jest.fn() } as any;
        });

      const provider = new AppleSpeechProvider();
      const promise = provider.transcribeFile('file:///audio.wav');

      // Esperar resolución de llamadas asíncronas previas (isAvailable, requestPermissions)
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // Simular que el reconocedor emite un resultado final
      expect(resultListener).not.toBeNull();
      resultListener!({
        isFinal: true,
        results: [{ transcript: 'Comprar manzanas mañana por la tarde' }],
      });

      const text = await promise;
      expect(text).toBe('Comprar manzanas mañana por la tarde');

      expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalledWith(
        expect.objectContaining({
          lang: 'es-ES',
          requiresOnDeviceRecognition: true,
          audioSource: { uri: 'file:///audio.wav' },
        }),
      );

      (Platform as any).OS = originalOS;
    });

    it('rechaza si el módulo emite un evento de error', async () => {
      const originalOS = Platform.OS;
      (Platform as any).OS = 'ios';

      jest
        .mocked(ExpoSpeechRecognitionModule.isRecognitionAvailable)
        .mockReturnValue(true);
      jest
        .mocked(ExpoSpeechRecognitionModule.requestPermissionsAsync)
        .mockResolvedValueOnce({ granted: true } as any);
      jest
        .mocked(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition)
        .mockReturnValueOnce(false);

      let errorListener: ((event: any) => void) | null = null;
      jest
        .mocked(ExpoSpeechRecognitionModule.addListener)
        .mockImplementation((event: string, listener: any) => {
          if (event === 'error') {
            errorListener = listener;
          }
          return { remove: jest.fn() } as any;
        });

      const provider = new AppleSpeechProvider();
      const promise = provider.transcribeFile('file:///audio.wav');

      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(errorListener).not.toBeNull();
      errorListener!({
        error: 'no-speech',
        message: 'No se detectó voz',
      });

      await expect(promise).rejects.toThrow('No se detectó voz');

      (Platform as any).OS = originalOS;
    });
  });

  describe('getTranscriptionProvider', () => {
    it('retorna instancia según plataforma y permite inyección en testing', () => {
      const mockCustomProvider = {
        id: 'custom-whisper',
        name: 'Custom Whisper',
        isAvailable: jest.fn().mockResolvedValue(true),
        transcribeFile: jest.fn().mockResolvedValue('texto mock'),
      };

      setTranscriptionProviderForTesting(mockCustomProvider);
      expect(getTranscriptionProvider().id).toBe('custom-whisper');
    });
  });
});
