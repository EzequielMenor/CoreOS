import { Platform, StyleSheet, TextInput } from 'react-native';

import { Fonts, NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface MarkdownEditorProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputAccessoryViewID?: string;
}

export function MarkdownEditor({
  value,
  onChangeText,
  onSelectionChange,
  placeholder = 'Empieza a escribir…',
  autoFocus = false,
  inputAccessoryViewID,
}: MarkdownEditorProps) {
  const theme = useTheme();

  return (
    <TextInput
      autoFocus={autoFocus}
      inputAccessoryViewID={inputAccessoryViewID}
      multiline
      onChangeText={onChangeText}
      onSelectionChange={(event) => {
        const { start, end } = event.nativeEvent.selection;
        onSelectionChange?.({ start, end });
      }}
      placeholder={placeholder}
      placeholderTextColor={theme.notes.text.muted}
      scrollEnabled
      selectionColor={theme.notes.accent.primary}
      style={[
        styles.input,
        {
          backgroundColor: theme.notes.bg.surface,
          color: theme.notes.text.primary,
          fontFamily: Platform.OS === 'ios' ? Fonts?.mono : 'monospace',
        },
      ]}
      textAlignVertical="top"
      value={value}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    padding: NoteSpacing.md,
  },
});