/**
 * apple-speech.ts — Proveedor de transcripción basado en Apple Speech (EZE-260).
 *
 * Utiliza SFSpeechRecognizer de iOS a través de expo-speech-recognition para transcribir
 * un archivo de audio previamente persistido en disco.
 *
 * Invariantes:
 * - Preferir on-device cuando esté disponible en el dispositivo.
 * - No hacer fallback silencioso a ninguna API de pago.
 */

import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { TranscriptionOptions, TranscriptionProvider } from './types';

const DEFAULT_LOCALE = 'es-ES';
const RECOGNITION_TIMEOUT_MS = 60_000;

export class AppleSpeechProvider implements TranscriptionProvider {
  readonly id = 'apple-speech';
  readonly name = 'Apple Speech';

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }
    try {
      return await ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  }

  async transcribeFile(
    fileUri: string,
    options?: TranscriptionOptions,
  ): Promise<string> {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Speech solo está disponible en iOS/iPadOS.');
    }

    const available = await this.isAvailable();
    if (!available) {
      throw new Error('El servicio de reconocimiento de Apple Speech no está disponible en este dispositivo.');
    }

    const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permissions.granted) {
      throw new Error('Permiso de reconocimiento de voz o micrófono no concedido.');
    }

    const targetLocale = options?.locale ?? DEFAULT_LOCALE;

    // Verificar si el dispositivo soporta reconocimiento on-device para este idioma
    let requiresOnDevice = options?.onDeviceOnly ?? false;
    if (!requiresOnDevice) {
      try {
        if (ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
          const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
          const langPrefix = targetLocale.split('-')[0].toLowerCase();
          if (
            installedLocales.some(
              (l) => l.toLowerCase() === targetLocale.toLowerCase() || l.toLowerCase().startsWith(langPrefix),
            )
          ) {
            requiresOnDevice = true;
          }
        }
      } catch {
        // Si la verificación falla, intentamos sin forzar onDevice
        requiresOnDevice = false;
      }
    }

    return new Promise<string>((resolve, reject) => {
      let finalTranscript = '';
      let isResolved = false;

      const timer = setTimeout(() => {
        cleanup();
        if (!isResolved) {
          isResolved = true;
          try {
            ExpoSpeechRecognitionModule.abort();
          } catch {
            // Ignorar fallo de abort al timeout
          }
          if (finalTranscript.trim()) {
            resolve(finalTranscript.trim());
          } else {
            reject(new Error('Tiempo de espera agotado al transcribir el audio.'));
          }
        }
      }, RECOGNITION_TIMEOUT_MS);

      const subResult = ExpoSpeechRecognitionModule.addListener('result', (event) => {
        if (event.results && event.results.length > 0) {
          finalTranscript = event.results[0].transcript;
        }
        if (event.isFinal && !isResolved) {
          isResolved = true;
          cleanup();
          resolve(finalTranscript.trim());
        }
      });

      const subError = ExpoSpeechRecognitionModule.addListener('error', (event) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error(event.message || `Error de reconocimiento (${event.error})`));
        }
      });

      const subEnd = ExpoSpeechRecognitionModule.addListener('end', () => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          resolve(finalTranscript.trim());
        }
      });

      function cleanup() {
        clearTimeout(timer);
        subResult.remove();
        subError.remove();
        subEnd.remove();
      }

      try {
        ExpoSpeechRecognitionModule.start({
          lang: targetLocale,
          requiresOnDeviceRecognition: requiresOnDevice,
          addsPunctuation: true,
          audioSource: {
            uri: fileUri,
          },
        });
      } catch (err) {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }
}
