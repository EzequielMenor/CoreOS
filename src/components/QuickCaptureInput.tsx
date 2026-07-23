import { useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';

import { IconSize, NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';

export interface QuickCaptureInputProps {
  onSubmit: (text: string) => Promise<void> | void;
  placeholder?: string;
}

export function QuickCaptureInput({
  onSubmit,
  placeholder = 'Escribe una nota…',
}: QuickCaptureInputProps) {
  const theme = useTheme();
  const [text, setText] = useState('');

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    try {
      await onSubmit(trimmed);
      setText('');
      void haptic.tap.light();
    } catch {
      void haptic.notify.error();
    }
    Keyboard.dismiss();
  };

  const canSubmit = text.trim().length > 0;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.notes.bg.surface,
          borderColor: theme.notes.border.subtle,
        },
      ]}
    >
      <Text accessibilityElementsHidden style={styles.bolt}>
        ⚡
      </Text>
      <TextInput
        onChangeText={setText}
        onSubmitEditing={() => {
          void submit();
        }}
        placeholder={placeholder}
        placeholderTextColor={theme.notes.text.muted}
        returnKeyType="send"
        selectionColor={theme.notes.accent.primary}
        style={[styles.input, { color: theme.notes.text.primary }]}
        value={text}
      />
      {canSubmit ? (
        <Pressable
          accessibilityLabel="Enviar nota rápida"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            void submit();
          }}
          style={styles.submit}
        >
          {Platform.OS === 'ios' ? (
            <SymbolView
              name="arrow.up.circle.fill"
              size={IconSize.lg}
              tintColor={theme.notes.accent.primary}
            />
          ) : (
            <Text style={[styles.submitFallback, { color: theme.notes.accent.primary }]}>↑</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  bolt: {
    fontSize: IconSize.md,
    marginRight: NoteSpacing.sm,
  },
  input: {
    flex: 1,
    fontSize: Typography.body.size,
    fontWeight: Typography.body.weight,
    lineHeight: Typography.body.lineHeight,
    paddingVertical: NoteSpacing.sm,
  },
  submit: {
    marginLeft: NoteSpacing.sm,
  },
  submitFallback: {
    fontSize: IconSize.lg,
    fontWeight: '700',
  },
});