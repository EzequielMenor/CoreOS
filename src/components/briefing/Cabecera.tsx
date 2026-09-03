import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface CabeceraProps {
  greeting: string;
  dateLabel: string;
}

// ponytail: Cabecera es presentational-only. Sin estado, sin side-effects.
// El saludo es el elemento principal (Typography.display); debajo va la
// fecha en mono. Tokens: NoteSpacing, Typography, theme.notes.text.*.
export function Cabecera({ greeting, dateLabel }: CabeceraProps): React.ReactElement {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.greeting, { color: theme.notes.text.primary }]}>
        {greeting}
      </Text>
      <Text style={[styles.date, { color: theme.notes.text.muted }]}>
        {dateLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
  },
  greeting: {
    ...Typography.display,
  },
  date: {
    ...Typography.caption,
    fontFamily: Fonts?.mono ?? 'ui-monospace',
    textTransform: 'lowercase',
  },
});
