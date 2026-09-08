/**
 * types.ts — Abstracción TranscriptionProvider (EZE-260).
 *
 * Permite cambiar o extender el motor de transcripción (Apple Speech, Android nativo,
 * Whisper local) manteniendo el resto de la app agnóstica al proveedor.
 */

export interface TranscriptionOptions {
  /** Locale BCP-47 para transcripción (por defecto 'es-ES'). */
  locale?: string;
  /** Forzar solo reconocimiento local on-device (evita llamadas de red del SO si es true). */
  onDeviceOnly?: boolean;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  transcribeFile(fileUri: string, options?: TranscriptionOptions): Promise<string>;
}
