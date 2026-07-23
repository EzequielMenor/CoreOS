import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoteSpacing, Radii, Shadows, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';

import { insertInbox } from '../db';

interface CaptureModalProps {
  visible: boolean;
  onClose: () => void;
  onCaptured?: () => void;
}

export default function CaptureModal({ visible, onClose, onCaptured }: CaptureModalProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Resetear estado y notificar al padre al cerrar (cancelar o backdrop).
  const handleClose = () => {
    setText('');
    setError(null);
    onClose();
  };

  const handleProcess = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await insertInbox(trimmed);
      void haptic.notify.success();
      setText('');
      Toast.show({
        type: 'info',
        text1: 'Captura enviada al Inbox',
        text2: 'Clasificando con IA…',
        visibilityTime: 3000,
      });
      onCaptured?.();
      onClose();
    } catch (err) {
      void haptic.notify.error();
      setError(err instanceof Error ? err.message : 'No se pudo enviar la captura');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 40 }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoid}
        >
          <View
            style={[
              styles.panel,
              { backgroundColor: theme.notes.bg.elevated },
            ]}
          >
            <Text style={[styles.title, { color: theme.notes.text.primary }]}>Captura rápida</Text>

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
              autoFocus={visible}
              placeholder="¿Qué tienes en mente?"
              placeholderTextColor={theme.notes.text.muted}
              selectionColor={theme.notes.accent.primary}
              value={text}
              onChangeText={setText}
              textAlignVertical="top"
            />

            {error && (
              <Text style={[styles.errorText, { color: theme.notes.semantic.danger }]}>{error}</Text>
            )}

            <View style={styles.buttonRow}>
              <Pressable
                style={[
                  styles.button,
                  styles.cancelButton,
                  { backgroundColor: theme.notes.bg.hover },
                ]}
                onPress={() => {
                  void haptic.tap.light();
                  handleClose();
                }}
              >
                <Text style={[styles.cancelText, { color: theme.notes.text.secondary }]}>Cancelar</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.button,
                  styles.saveButton,
                  { backgroundColor: theme.notes.accent.primary },
                ]}
                onPress={handleProcess}
                disabled={!text.trim()}
              >
                <Text style={[styles.saveText, { color: theme.notes.text.primary }]}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  panel: {
    borderRadius: 16,
    paddingHorizontal: NoteSpacing.lg,
    paddingBottom: NoteSpacing.md,
    paddingTop: NoteSpacing.lg,
    width: '92%',
    maxWidth: 720,
    ...Shadows.md,
  },
  title: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.subtitle.lineHeight,
    marginBottom: NoteSpacing.md,
  },
  keyboardAvoid: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Radii.lg,
    padding: NoteSpacing.md,
    fontSize: 17,
    lineHeight: 24,
    minHeight: 160,
    maxHeight: 260,
  },
  errorText: {
    fontSize: 14,
    marginTop: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: NoteSpacing.md,
  },
  button: {
    flex: 1,
    borderRadius: Radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  cancelButton: {},
  cancelText: {
    fontSize: 17,
    fontWeight: '500',
  },
  saveButton: {},
  // ponytail: contraste justo en dark; añadir theme.notes.text.inverse si diseño rehace el accent.
  saveText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
