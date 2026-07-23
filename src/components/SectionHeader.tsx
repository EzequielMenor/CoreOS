import { StyleSheet, Text, View } from 'react-native';

import { NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface SectionHeaderProps {
  title: string;
  count?: number;
}

export function SectionHeader({ title, count }: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { borderBottomColor: theme.notes.border.subtle }]}>
      <Text style={[styles.text, { color: theme.notes.text.muted }]}>{title.toUpperCase()}</Text>
      {count !== undefined ? (
        <Text style={[styles.text, { color: theme.notes.text.muted }]}>({count})</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: NoteSpacing.xs,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  text: {
    fontSize: Typography.caption.size,
    fontWeight: Typography.caption.weight,
    letterSpacing: Typography.caption.letterSpacing,
    lineHeight: Typography.caption.lineHeight,
  },
});
