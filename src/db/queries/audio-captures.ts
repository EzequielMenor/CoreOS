/**
 * audio-captures.ts — Consultas para persistencia y ciclo de vida de capturas de audio (EZE-260).
 *
 * Invariante: El audio grabado se persiste en disco y se registra en SQLite con estado 'recorded'
 * ANTES de depender de cualquier motor de transcripción.
 */

import { getDb, type AudioCaptureRow } from '../index';
import { deleteAudioRecording } from '@/lib/audio-storage';

export async function insertAudioCapture(fileUri: string): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.runAsync(
    `INSERT INTO audio_captures (file_uri, created_at, status)
     VALUES (?, ?, 'recorded')`,
    fileUri,
    now,
  );
  return result.lastInsertRowId;
}

export async function updateAudioCaptureStatus(
  id: number,
  status: AudioCaptureRow['status'],
  options?: {
    transcription?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const db = await getDb();
  if (options && ('transcription' in options || 'errorMessage' in options)) {
    await db.runAsync(
      `UPDATE audio_captures
       SET status = ?,
           transcription = COALESCE(?, transcription),
           error_message = ?
       WHERE id = ?`,
      status,
      options.transcription ?? null,
      options.errorMessage ?? null,
      id,
    );
  } else {
    await db.runAsync(
      `UPDATE audio_captures SET status = ? WHERE id = ?`,
      status,
      id,
    );
  }
}

export async function getAudioCapture(id: number): Promise<AudioCaptureRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AudioCaptureRow>(
    `SELECT * FROM audio_captures WHERE id = ?`,
    id,
  );
  return row ?? null;
}

export async function getRecentAudioCaptures(limit = 10): Promise<AudioCaptureRow[]> {
  const db = await getDb();
  return db.getAllAsync<AudioCaptureRow>(
    `SELECT * FROM audio_captures ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
}

/**
 * Busca la captura de audio más reciente que quedó pendiente o fallida
 * (por ejemplo, tras cerrar la app durante la grabación o tras un error de STT).
 */
export async function getRecoverableAudioCapture(): Promise<AudioCaptureRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AudioCaptureRow>(
    `SELECT * FROM audio_captures
     WHERE status IN ('recorded', 'transcribing', 'failed')
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  return row ?? null;
}

/**
 * Marca la captura como completada (el texto ya fue guardado en el inbox)
 * y elimina de forma segura el archivo de audio físico en disco.
 */
export async function completeAudioCapture(id: number): Promise<void> {
  const capture = await getAudioCapture(id);
  if (capture) {
    await deleteAudioRecording(capture.file_uri);
    await updateAudioCaptureStatus(id, 'completed');
  }
}

/**
 * Descarta explícitamente una captura de audio y elimina el archivo físico en disco.
 */
export async function discardAudioCapture(id: number): Promise<void> {
  const capture = await getAudioCapture(id);
  if (capture) {
    await deleteAudioRecording(capture.file_uri);
    await updateAudioCaptureStatus(id, 'discarded');
  }
}
