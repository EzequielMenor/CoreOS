/**
 * use-voice-capture.ts — Hook para grabación de voz, persistencia y transcripción (EZE-260).
 *
 * Flujo:
 * 1. Grabar audio con expo-audio usando PCM WAV 16kHz mono (formato óptimo probado por expo-speech-recognition).
 * 2. Persistir archivo en disco (persistAudioRecording) ANTES de depender de transcripción.
 * 3. Registrar fila en SQLite (audio_captures) con estado 'recorded'.
 * 4. Transcribir con TranscriptionProvider (Apple Speech en iOS).
 * 5. Entregar el texto al callback onTranscriptionSuccess para rellenar el campo de texto.
 * 6. Si falla o la app se reinicia, recuperar la captura huérfana para permitir reintento o descarte explícito.
 * 7. Al guardar en inbox, purgar de forma segura el archivo de audio físico.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
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
import type { AudioCaptureRow } from '@/db';
import { getTranscriptionProvider } from '@/services/transcription';
import { haptic } from '@/lib/animations';

/**
 * Preset de grabación PCM WAV 16 kHz 16-bit Mono.
 * Formato probado y verificado por la librería expo-speech-recognition en iOS
 * para transcripción directa de archivos sin conversiones intermedias.
 */
export const SPEECH_WAV_RECORDING_PRESET: RecordingOptions = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  android: {
    extension: '.wav',
    outputFormat: 'default',
    audioEncoder: 'default',
  },
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

export interface UseVoiceCaptureOptions {
  onTranscriptionSuccess: (transcription: string) => void;
}

export interface UseVoiceCaptureResult {
  isRecording: boolean;
  isTranscribing: boolean;
  durationSeconds: number;
  error: string | null;
  canRetry: boolean;
  recoveredCapture: AudioCaptureRow | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  retryTranscription: () => Promise<void>;
  retryRecoveredCapture: () => Promise<void>;
  dismissRecoveredCapture: () => Promise<void>;
  completeActiveCapture: () => Promise<void>;
  clearError: () => void;
}

export function useVoiceCapture({
  onTranscriptionSuccess,
}: UseVoiceCaptureOptions): UseVoiceCaptureResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [lastCapture, setLastCapture] = useState<{ id: number; uri: string } | null>(null);
  const [recoveredCapture, setRecoveredCapture] = useState<AudioCaptureRow | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const audioRecorder = useAudioRecorder(SPEECH_WAV_RECORDING_PRESET);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setDurationSeconds(0);
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  // Recuperación tras reinicio: si había una captura fallida/pendiente en SQLite, la exponemos
  useEffect(() => {
    let active = true;
    getRecoverableAudioCapture()
      .then((capture) => {
        if (active && capture) {
          setRecoveredCapture(capture);
        }
      })
      .catch((err) => {
        console.warn('[voice-capture] Error al verificar capturas huérfanas:', err);
      });

    return () => {
      active = false;
    };
  }, []);

  const runTranscription = useCallback(
    async (captureId: number, audioUri: string) => {
      setIsTranscribing(true);
      setError(null);
      try {
        await updateAudioCaptureStatus(captureId, 'transcribing');
        const provider = getTranscriptionProvider();
        const text = await provider.transcribeFile(audioUri);
        const trimmed = text.trim();

        if (!trimmed) {
          throw new Error('No se detectó voz audible en la grabación.');
        }

        await updateAudioCaptureStatus(captureId, 'transcribed', {
          transcription: trimmed,
        });
        void haptic.notify.success();
        onTranscriptionSuccess(trimmed);
        setLastCapture({ id: captureId, uri: audioUri });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al transcribir el audio.';
        await updateAudioCaptureStatus(captureId, 'failed', {
          errorMessage: message,
        });
        void haptic.notify.error();
        setError(message);
      } finally {
        setIsTranscribing(false);
      }
    },
    [onTranscriptionSuccess],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Permiso de micrófono denegado para capturar notas de voz.');
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();

      void haptic.tap.medium();
      setIsRecording(true);
      setDurationSeconds(0);

      timerRef.current = setInterval(() => {
        setDurationSeconds((sec) => sec + 1);
      }, 1000);
    } catch (err) {
      clearTimer();
      setIsRecording(false);
      const message = err instanceof Error ? err.message : 'No se pudo iniciar la grabación.';
      setError(message);
      void haptic.notify.error();
    }
  }, [audioRecorder, clearTimer]);

  const stopRecording = useCallback(async () => {
    if (!isRecording) return;

    clearTimer();
    setIsRecording(false);
    void haptic.tap.light();

    try {
      await audioRecorder.stop();
      const tempUri = audioRecorder.uri;
      if (!tempUri) {
        throw new Error('No se generó el archivo de audio de la grabación.');
      }

      // 1. Persistir permanentemente el archivo en disco
      const permanentUri = await persistAudioRecording(tempUri);

      // 2. Registrar en SQLite antes de depender de la red o motor STT
      const captureId = await insertAudioCapture(permanentUri);
      setLastCapture({ id: captureId, uri: permanentUri });

      // 3. Ejecutar la transcripción
      await runTranscription(captureId, permanentUri);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al procesar la grabación.';
      setError(message);
      void haptic.notify.error();
    }
  }, [audioRecorder, isRecording, clearTimer, runTranscription]);

  const cancelRecording = useCallback(async () => {
    clearTimer();
    setIsRecording(false);
    try {
      await audioRecorder.stop();
    } catch {
      // Ignorar fallo al cancelar
    }
    void haptic.tap.light();
  }, [audioRecorder, clearTimer]);

  const retryTranscription = useCallback(async () => {
    if (!lastCapture) return;
    const { id, uri } = lastCapture;
    await runTranscription(id, uri);
  }, [lastCapture, runTranscription]);

  const retryRecoveredCapture = useCallback(async () => {
    if (!recoveredCapture) return;
    const capture = recoveredCapture;
    setRecoveredCapture(null);
    setLastCapture({ id: capture.id, uri: capture.file_uri });
    await runTranscription(capture.id, capture.file_uri);
  }, [recoveredCapture, runTranscription]);

  const dismissRecoveredCapture = useCallback(async () => {
    if (!recoveredCapture) return;
    const capture = recoveredCapture;
    setRecoveredCapture(null);
    await discardAudioCapture(capture.id);
  }, [recoveredCapture]);

  const completeActiveCapture = useCallback(async () => {
    if (lastCapture) {
      const id = lastCapture.id;
      setLastCapture(null);
      await completeAudioCapture(id);
    }
  }, [lastCapture]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isRecording,
    isTranscribing,
    durationSeconds,
    error,
    canRetry: error !== null && lastCapture !== null && !isTranscribing,
    recoveredCapture,
    startRecording,
    stopRecording,
    cancelRecording,
    retryTranscription,
    retryRecoveredCapture,
    dismissRecoveredCapture,
    completeActiveCapture,
    clearError,
  };
}
