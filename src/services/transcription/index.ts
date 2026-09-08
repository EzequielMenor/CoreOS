/**
 * index.ts — Módulo y factory de TranscriptionProvider (EZE-260).
 */

import { Platform } from 'react-native';
import { AppleSpeechProvider } from './apple-speech';
import { AndroidSpeechProvider } from './android-speech';
import type { TranscriptionProvider } from './types';

let activeProvider: TranscriptionProvider | null = null;

export function getTranscriptionProvider(): TranscriptionProvider {
  if (activeProvider) {
    return activeProvider;
  }

  if (Platform.OS === 'ios') {
    activeProvider = new AppleSpeechProvider();
  } else {
    activeProvider = new AndroidSpeechProvider();
  }

  return activeProvider;
}

/** Permite inyectar un proveedor en tests. */
export function setTranscriptionProviderForTesting(provider: TranscriptionProvider | null): void {
  activeProvider = provider;
}

export * from './types';
export * from './apple-speech';
export * from './android-speech';
