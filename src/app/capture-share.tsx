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
import { insertInbox } from '@/db';
import { processPendingInbox } from '@/services/inbox';

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
      let inserted = 0;
      const seen = new Set<string>(); // dedupe intra-batch
      try {
        const payloads = await getSharedPayloads(); // offline-safe
        for (const p of payloads) {
          const text = extractText(p);
          if (!text || seen.has(text)) continue;
          seen.add(text);
          await insertInbox(text); // I4: nunca lanza dispatch; solo INSERT
          inserted++;
        }
        await clearSharedPayloads(); // evita re-disparo al relanzar app
        // Disparo fire-and-forget: la captura ya está a salvo en inbox.
        if (inserted > 0) void processPendingInbox();
      } catch {
        // I1–I4: nunca propagamos error al usuario; fallback graceful.
      }
      Toast.show({
        type: inserted > 0 ? 'success' : 'info',
        text1: inserted > 0 ? 'Captura enviada al Inbox' : 'Nada que capturar',
        text2: 'Clasificando con IA…',
        visibilityTime: 3000,
      });
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
