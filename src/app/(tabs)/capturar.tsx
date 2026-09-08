import { useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useCaptureDraft } from '@/hooks/use-capture-draft';
import { useTheme } from '@/hooks/use-theme';
import { notifyCapturePersisted, trackCaptureOutcome } from '@/lib/capture-feedback';
import { haptic } from '@/lib/animations';
import { captureInbox } from '@/services/capture';

const KEYBOARD_BAR_NATIVE_ID = 'capture-keyboard-bar';

export default function CapturarScreen() {
  const theme = useTheme();
  // Borrador persistente con autosave/debounce; ver use-capture-draft.ts.
  const { text, handleChangeText, discardDraft } = useCaptureDraft();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    try {
      // Persistir antes de pensar: la captura queda a salvo en inbox primero.
      const { inboxId, processing } = await captureInbox(trimmed);
      // insertInbox confirmó persistencia: único punto donde el borrador se
      // borra. Si el guardado falla (catch), texto y borrador se mantienen.
      discardDraft();
      void haptic.notify.success();
      // Solo persistencia confirmada — nada de «Clasificando…» antes de tiempo.
      notifyCapturePersisted();
      // Feedback ASOCIADO A ESTA CAPTURA (inboxId): el batch puede procesar
      // capturas de otros triggers; los totales no son atribuibles.
      // I4: processing nunca rechaza.
      trackCaptureOutcome(processing, inboxId);
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
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.notes.text.primary }]}>
              Capturar
            </Text>
            <Text style={[styles.hint, { color: theme.notes.text.secondary }]}>
              Escribe lo que quieras recordar. La IA lo clasificará en nota,
              tarea, gasto, hábito o sueño.
            </Text>
          </View>

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
            inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_BAR_NATIVE_ID : undefined}
            placeholder="¿Qué tienes en mente?"
            placeholderTextColor={theme.notes.text.muted}
            selectionColor={theme.notes.accent.primary}
            value={text}
            onChangeText={handleChangeText}
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

      {/* Barra sobre el teclado: única vía para cerrarlo y volver a la tab bar */}
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={KEYBOARD_BAR_NATIVE_ID}>
          <View
            style={[
              styles.keyboardBar,
              {
                backgroundColor: theme.notes.bg.elevated,
                borderTopColor: theme.notes.border.subtle,
              },
            ]}>
            <Pressable
              accessibilityLabel="Cerrar teclado"
              accessibilityRole="button"
              hitSlop={8}
              onPress={Keyboard.dismiss}
              style={({ pressed }) => [
                styles.keyboardBarDone,
                { backgroundColor: theme.notes.accent.primaryDim },
                pressed ? styles.keyboardBarDonePressed : null,
              ]}>
              <Text style={[styles.keyboardBarDoneText, { color: theme.notes.accent.primary }]}>
                Listo
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
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
    gap: NoteSpacing.lg,
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.xl,
  },
  header: {
    gap: NoteSpacing.sm,
  },
  title: {
    ...Typography.title,
  },
  hint: {
    ...Typography.body,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radii.lg,
    fontSize: 17,
    height: 140,
    lineHeight: 24,
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
  keyboardBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  keyboardBarDone: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    justifyContent: 'center',
    paddingHorizontal: NoteSpacing.lg,
    paddingVertical: 8,
  },
  keyboardBarDonePressed: {
    opacity: 0.6,
  },
  keyboardBarDoneText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
