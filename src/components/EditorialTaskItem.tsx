import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface EditorialTaskItemProps {
  title: string;
  status: 'pending' | 'completed';
  dueDate?: string | null;
  priority?: string | null;
  onToggle: () => void;
  onPress?: () => void;
}

export function EditorialTaskItem({
  title,
  status,
  dueDate,
  priority,
  onToggle,
  onPress,
}: EditorialTaskItemProps) {
  const theme = useTheme();
  const isDone = status === 'completed';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        // Fila hecha se atenúa entera, no solo el título
        isDone && { opacity: 0.5 },
      ]}
      onPress={onPress ?? onToggle}
    >
      <Pressable
        hitSlop={8}
        onPress={onToggle}
        style={[
          styles.checkbox,
          {
            borderColor: isDone ? theme.notes.text.primary : theme.notes.border.strong,
            backgroundColor: isDone ? theme.notes.text.primary : 'transparent',
          },
        ]}
      >
        {isDone ? (
          <SymbolView
            name="checkmark"
            size={10}
            tintColor={theme.notes.bg.base}
          />
        ) : null}
      </Pressable>

      <View style={styles.textWrap}>
        <Text
          numberOfLines={2}
          style={[
            styles.title,
            { color: isDone ? theme.notes.text.muted : theme.notes.text.primary },
            isDone && styles.titleDone,
          ]}
        >
          {title}
        </Text>

        {(dueDate || priority) ? (
          <View style={styles.metaRow}>
            {priority ? (
              <Text style={[styles.metaText, { color: priority === 'alta' ? theme.notes.accent.primary : theme.notes.text.muted }]}>
                {priority.toUpperCase()}
              </Text>
            ) : null}
            {dueDate ? (
              <Text style={[styles.metaText, { color: theme.notes.text.muted }]}>
                {dueDate}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: NoteSpacing.sm + 4,
    paddingVertical: NoteSpacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  rowPressed: {
    opacity: 0.7,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...Typography.body,
    fontSize: 15,
    lineHeight: 20,
  },
  titleDone: {
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NoteSpacing.sm,
    marginTop: 2,
  },
  metaText: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
