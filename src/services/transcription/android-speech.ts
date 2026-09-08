/**
 * android-speech.ts — Proveedor de transcripción para Android (EZE-260).
 *
 * NOTA DE DISEÑO (Estado en Android):
 * expo-speech-recognition soporta transcripción de archivos vía audioSource.uri en Android 13+
 * cuando el dispositivo cuenta con paquetes compatibles de reconocimiento instalados
 * (por ejemplo com.google.android.as con modelos offline).
 *
 * No es una imposibilidad arquitectónica; queda documentado como "pendiente de validación de
 * compatibilidad" en dispositivos Android reales y fuera del alcance de cierre de EZE-260.
 */

import type { TranscriptionOptions, TranscriptionProvider } from './types';

export class AndroidSpeechProvider implements TranscriptionProvider {
  readonly id = 'android-speech';
  readonly name = 'Android Speech';

  async isAvailable(): Promise<boolean> {
    // Pendiente de validación de compatibilidad en hardware Android real con modelos offline.
    return false;
  }

  async transcribeFile(
    _fileUri: string,
    _options?: TranscriptionOptions,
  ): Promise<string> {
    throw new Error(
      'La transcripción de archivos en Android está pendiente de validación de compatibilidad (Android 13+).',
    );
  }
}
