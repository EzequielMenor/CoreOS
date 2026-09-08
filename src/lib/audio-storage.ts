/**
 * audio-storage.ts — Gestión de almacenamiento seguro para grabaciones de voz (EZE-260).
 *
 * Copia el audio temporal generado en caché hacia el directorio permanente de documentos
 * para asegurar que el source of truth no se pierda ante purgas de caché del sistema o reinicios.
 */

import { Directory, File, Paths } from 'expo-file-system';

const AUDIO_CAPTURES_DIR_NAME = 'audio_captures';

export function getAudioCapturesDirectory(): Directory {
  const baseDir = new Directory(Paths.document);
  const audioDir = new Directory(Paths.document, AUDIO_CAPTURES_DIR_NAME);
  if (!audioDir.exists) {
    try {
      baseDir.createDirectory(AUDIO_CAPTURES_DIR_NAME);
    } catch {
      // Si ya existía o hubo carrera, verificamos si existe.
    }
  }
  return audioDir;
}

export async function persistAudioRecording(sourceUri: string): Promise<string> {
  const audioDir = getAudioCapturesDirectory();
  const filename = `capture_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.wav`;
  const src = new File(sourceUri);
  const dst = new File(audioDir, filename);

  await src.copy(dst);
  return dst.uri;
}

/**
 * Elimina físicamente un archivo de audio en disco de forma segura.
 * Nunca lanza error para no interrumpir el flujo principal.
 */
export async function deleteAudioRecording(fileUri: string): Promise<void> {
  try {
    const file = new File(fileUri);
    if (file.exists) {
      await file.delete();
    }
  } catch (err) {
    console.warn('[audio-storage] No se pudo eliminar el archivo de audio:', fileUri, err);
  }
}

