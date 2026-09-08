import { useState } from 'react';
import {
  ActivityIndicator,
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
import { SymbolView } from 'expo-symbols';

import { NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useCaptureDraft } from '@/hooks/use-capture-draft';
import { useVoiceCapture } from '@/hooks/use-voice-capture';
import { useTheme } from '@/hooks/use-theme';
import { notifyCapturePersisted, trackCaptureOutcome } from '@/lib/capture-feedback';
import { haptic } from '@/lib/animations';
import { captureInbox } from '@/services/capture';

const KEYBOARD_BAR_NATIVE_ID = 'capture-keyboard-bar';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function CapturarScreen() {
  const theme = useTheme();
  // Borrador persistente con autosave/debounce; ver use-capture-draft.ts.
  const { text, handleChangeText, discardDraft } = useCaptureDraft();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    isRecording,
    isTranscribing,
    durationSeconds,
    error: voiceError,
    canRetry,
    recoveredCapture,
    startRecording,
    stopRecording,
    cancelRecording,
    retryTranscription,
    retryRecoveredCapture,
    dismissRecoveredCapture,
    completeActiveCapture,
  } = useVoiceCapture({
    onTranscriptionSuccess: (transcription) => {
      // Concatenar o rellenar el texto en el borrador existente
      const trimmed = text.trim();
      const updatedText = trimmed ? `${trimmed}\n\n${transcription}` : transcription;
      handleChangeText(updatedText);
    },
  });

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
      // Purgar de forma segura el archivo de audio físico si vino de una nota de voz
      void completeActiveCapture();
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
            <View style={styles.headerRow}>
              <View style={styles.headerTitleArea}>
                <Text style={[styles.title, { color: theme.notes.text.primary }]}>
                  Capturar
                </Text>
                <Text style={[styles.hint, { color: theme.notes.text.secondary }]}>
                  Escribe o graba lo que quieras recordar. La IA lo clasificará en nota,
                  tarea, gasto, hábito o sueño.
                </Text>
              </View>

              {!isRecording && !isTranscribing && (
                <Pressable
                  accessibilityLabel="Grabar nota de voz"
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.micButton,
                    {
                      backgroundColor: theme.notes.accent.primaryDim,
                      borderColor: theme.notes.border.subtle,
                    },
                    pressed ? styles.micButtonPressed : null,
                  ]}
                  onPress={() => {
                    void startRecording();
                  }}
                >
                  <SymbolView
                    name="mic.fill"
                    size={22}
                    tintColor={theme.notes.accent.primary}
                    fallback={<Text style={styles.micFallback}>🎙️</Text>}
                  />
                </Pressable>
              )}
            </View>
          </View>

          {isRecording && (
            <View
              style={[
                styles.voiceBanner,
                {
                  backgroundColor: theme.notes.bg.surface,
                  borderColor: theme.notes.semantic.danger,
                },
              ]}
            >
              <View style={styles.voiceRecordingStatus}>
                <View
                  style={[
                    styles.pulseDot,
                    { backgroundColor: theme.notes.semantic.danger },
                  ]}
                />
                <Text
                  style={[styles.voiceStatusText, { color: theme.notes.text.primary }]}
                >
                  Grabando… {formatDuration(durationSeconds)}
                </Text>
              </View>

              <View style={styles.voiceActions}>
                <Pressable
                  accessibilityLabel="Cancelar grabación"
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.voiceCancelButton}
                  onPress={() => {
                    void cancelRecording();
                  }}
                >
                  <Text style={[styles.voiceCancelText, { color: theme.notes.text.secondary }]}>
                    Cancelar
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Detener grabación y transcribir"
                  accessibilityRole="button"
                  style={[
                    styles.voiceStopButton,
                    { backgroundColor: theme.notes.semantic.danger },
                  ]}
                  onPress={() => {
                    void stopRecording();
                  }}
                >
                  <SymbolView
                    name="stop.fill"
                    size={14}
                    tintColor="#FFFFFF"
                    fallback={<Text style={styles.stopIconFallback}>⏹</Text>}
                  />
                  <Text style={styles.voiceStopText}>Detener</Text>
                </Pressable>
              </View>
            </View>
          )}

          {isTranscribing && (
            <View
              style={[
                styles.voiceBanner,
                {
                  backgroundColor: theme.notes.bg.surface,
                  borderColor: theme.notes.border.subtle,
                },
              ]}
            >
              <ActivityIndicator size="small" color={theme.notes.accent.primary} />
              <Text
                style={[styles.voiceStatusText, { color: theme.notes.text.secondary }]}
              >
                Transcribiendo con Apple Speech…
              </Text>
            </View>
          )}

          {voiceError && (
            <View
              style={[
                styles.voiceBanner,
                {
                  backgroundColor: theme.notes.bg.surface,
                  borderColor: theme.notes.semantic.danger,
                },
              ]}
            >
              <Text
                style={[styles.voiceErrorText, { color: theme.notes.semantic.danger }]}
                numberOfLines={2}
              >
                {voiceError}
              </Text>
              {canRetry && (
                <Pressable
                  accessibilityLabel="Reintentar transcripción"
                  accessibilityRole="button"
                  style={[
                    styles.retryButton,
                    { backgroundColor: theme.notes.accent.primaryDim },
                  ]}
                  onPress={() => {
                    void retryTranscription();
                  }}
                >
                  <Text
                    style={[styles.retryText, { color: theme.notes.accent.primary }]}
                  >
                    Reintentar
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {recoveredCapture && !isRecording && !isTranscribing && (
            <View
              style={[
                styles.voiceBanner,
                {
                  backgroundColor: theme.notes.bg.surface,
                  borderColor: theme.notes.accent.primary,
                },
              ]}
            >
              <View style={styles.headerTitleArea}>
                <Text
                  style={[styles.voiceStatusText, { color: theme.notes.text.primary }]}
                >
                  Grabación pendiente de recuperar
                </Text>
                <Text
                  style={{ fontSize: 12, color: theme.notes.text.secondary }}
                >
                  Hay una nota de voz guardada antes de cerrar la app.
                </Text>
              </View>

              <View style={styles.voiceActions}>
                <Pressable
                  accessibilityLabel="Descartar grabación recuperada"
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.voiceCancelButton}
                  onPress={() => {
                    void dismissRecoveredCapture();
                  }}
                >
                  <Text style={[styles.voiceCancelText, { color: theme.notes.text.secondary }]}>
                    Descartar
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Transcribir grabación recuperada"
                  accessibilityRole="button"
                  style={[
                    styles.retryButton,
                    { backgroundColor: theme.notes.accent.primaryDim },
                  ]}
                  onPress={() => {
                    void retryRecoveredCapture();
                  }}
                >
                  <Text style={[styles.retryText, { color: theme.notes.accent.primary }]}>
                    Transcribir
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

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
            {!isRecording && !isTranscribing && (
              <Pressable
                accessibilityLabel="Grabar voz"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  Keyboard.dismiss();
                  void startRecording();
                }}
                style={({ pressed }) => [
                  styles.keyboardBarMic,
                  pressed ? styles.keyboardBarDonePressed : null,
                ]}>
                <SymbolView
                  name="mic.fill"
                  size={18}
                  tintColor={theme.notes.accent.primary}
                  fallback={<Text>🎙️</Text>}
                />
              </Pressable>
            )}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: NoteSpacing.md,
  },
  headerTitleArea: {
    flex: 1,
    gap: NoteSpacing.sm,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  micButtonPressed: {
    opacity: 0.6,
  },
  micFallback: {
    fontSize: 18,
  },
  voiceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    gap: NoteSpacing.sm,
  },
  voiceRecordingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NoteSpacing.sm,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  voiceStatusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  voiceActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NoteSpacing.sm,
  },
  voiceCancelButton: {
    paddingHorizontal: NoteSpacing.sm,
    paddingVertical: 6,
  },
  voiceCancelText: {
    fontSize: 13,
  },
  voiceStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
  },
  voiceStopText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  stopIconFallback: {
    fontSize: 12,
  },
  voiceErrorText: {
    flex: 1,
    fontSize: 13,
  },
  retryButton: {
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
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
  keyboardBarMic: {
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
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
