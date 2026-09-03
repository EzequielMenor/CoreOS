import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import Toast from 'react-native-toast-message';

import { NoteSpacing, Radii, Typography } from '@/constants/theme';
import { insertInbox } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { processPendingInbox } from '@/services/inbox';

export default function CapturarScreen() {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    try {
      // Persistir antes de pensar: la captura queda a salvo en inbox primero.
      await insertInbox(trimmed);
      void haptic.notify.success();
      setText('');
      Toast.show({
        type: 'success',
        text1: 'Captura guardada',
        text2: 'Clasificando con IA…',
        visibilityTime: 2500,
      });
      // Fire-and-forget: si falla, la fila queda pending y se reintenta
      // en el próximo trigger (I4: nunca lanza).
      void processPendingInbox();
    } catch (err) {
      void haptic.notify.error();
      setError(err instanceof Error ? err.message : 'No se pudo guardar la captura');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['bottom']}
    >
      <Stack.Screen
        options={{
          title: 'Capturar',
          headerTitleAlign: 'center',
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <Text style={[styles.hint, { color: theme.notes.text.secondary }]}>
            Escribe lo que quieras recordar. La IA lo clasificará en nota,
            tarea, gasto, hábito o sueño.
          </Text>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
                color: theme.notes.text.primary,
              },
            ]}
            multiline
            autoFocus
            placeholder="¿Qué tienes en mente?"
            placeholderTextColor={theme.notes.text.muted}
            selectionColor={theme.notes.accent.primary}
            value={text}
            onChangeText={setText}
            textAlignVertical="top"
          />

          {error ? (
            <Text style={[styles.errorText, { color: theme.notes.semantic.danger }]}>
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityLabel="Guardar captura"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.saveButton,
              {
                backgroundColor: theme.notes.accent.primary,
                opacity: !text.trim() || saving ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
            onPress={() => {
              void handleSave();
            }}
            disabled={!text.trim() || saving}
          >
            <Text style={[styles.saveText, { color: theme.notes.text.primary }]}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    gap: NoteSpacing.md,
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.lg,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radii.lg,
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    minHeight: 200,
    padding: NoteSpacing.md,
  },
  errorText: {
    fontSize: 14,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: Radii.lg,
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 14,
  },
  saveText: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
  },
});
