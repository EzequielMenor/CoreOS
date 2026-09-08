import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import {
  getSharedPayloads,
  clearSharedPayloads,
  type SharePayload,
} from 'expo-sharing';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { notifyCapturePersisted, trackCaptureOutcome } from '@/lib/capture-feedback';
import { captureInbox } from '@/services/capture';
import type { BatchResult } from '@/services/inbox';

// Extracción texto/URL del payload raw. El payload raw llega como
// { value: string, mimeType: string } (string compartido). Las websites llegan
// como 'text' con la URL en value — sin resolver (offline).
function extractText(p: SharePayload): string | null {
  if (typeof p.value === 'string' && p.value.trim()) return p.value;
  return null;
}

export default function CaptureShareScreen() {
  const router = useRouter();
  const theme = useTheme();
  const started = useRef(false); // dedupe re-entry (react-compiler safe)

  useEffect(() => {
    if (started.current) return; // AC-5: re-entry limpio
    started.current = true;
    (async () => {
      const captured: { inboxId: number; processing: Promise<BatchResult> }[] = [];
      const seen = new Set<string>(); // dedupe intra-batch
      try {
        const payloads = await getSharedPayloads(); // offline-safe
        for (const p of payloads) {
          const text = extractText(p);
          if (!text || seen.has(text)) continue;
          seen.add(text);
          // Persiste antes de iniciar la clasificación.
          const { inboxId, processing } = await captureInbox(text);
          captured.push({ inboxId, processing });
        }
        await clearSharedPayloads(); // evita re-disparo al relanzar app
      } catch {
        // I1–I4: nunca propagamos error al usuario; fallback graceful.
      }
      if (captured.length > 0) {
        // Solo persistencia: NADA de «Clasificando…» antes de conocer el
        // resultado. Cada captura confirma su destino por inboxId cuando el
        // batch termina (los toasts viven en el root → sobreviven al replace).
        notifyCapturePersisted(captured.length);
        // ponytail: batch compartido = outcomes casi simultáneos; el toast
        // más reciente gana. Un payload por share es el caso normal.
        for (const { inboxId, processing } of captured) {
          trackCaptureOutcome(processing, inboxId);
        }
      } else {
        Toast.show({
          type: 'info',
          text1: 'Nada que capturar',
          visibilityTime: 2000,
        });
      }
      // espera breve al toast antes de replace (evita unmount de toast)
      setTimeout(() => router.replace('/'), 350);
    })();
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: theme.notes.bg.base }]}>
      <ActivityIndicator size="large" />
      <ThemedText style={styles.text}>Guardando captura…</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { marginTop: 16 },
});
