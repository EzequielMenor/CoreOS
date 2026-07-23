import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  done: boolean;
  isToday?: boolean;
}

export interface HabitHeatmapProps {
  days: HeatmapDay[];
  title?: string;
  subtitle?: string;
  // ponytail: el heatmap se trata como "un único hábito" en single-habit view.
  // Sin habitName, la celda de hoy sigue siendo View (sin tap).
  habitName?: string;
  // ponytail: solo se invoca si el caller pasa también habitName (gating ternario).
  onCellPress?: (date: string) => void;
}

export function HabitHeatmap({ days, title, subtitle, habitName, onCellPress }: HabitHeatmapProps) {
  const theme = useTheme();

  if (days.length === 0) return null;

  const today = new Date().toISOString().split('T')[0];
  const canPressToday = Boolean(onCellPress && habitName);

  // Render a GitHub / jerad-ops style contribution row/strip or mini grid
  return (
    <View style={[styles.container, { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle }]}>
      {(title || subtitle) && (
        <View style={styles.header}>
          {title ? (
            <Text style={[styles.title, { color: theme.notes.text.primary }]}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.notes.text.muted }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      )}
      <View style={styles.grid}>
        {days.map((cell, idx) => {
          const isDone = cell.done;
          const isToday = cell.isToday;
          const cellStyle = [
            styles.cell,
            {
              backgroundColor: isDone
                ? theme.notes.text.primary
                : 'transparent',
              borderColor: isDone
                ? theme.notes.text.primary
                : theme.notes.border.strong,
            },
            isToday && {
              borderWidth: 1.5,
              borderColor: theme.notes.accent.primary,
            },
          ];
          if (isToday && cell.date === today && canPressToday) {
            return (
              <Pressable
                key={cell.date || idx}
                hitSlop={6}
                onPress={() => onCellPress!(cell.date)}
                style={({ pressed }) => [
                  ...cellStyle,
                  pressed && { opacity: 0.7 },
                ]}
              />
            );
          }
          return <View key={cell.date || idx} style={cellStyle} />;
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.md,
    gap: NoteSpacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  title: {
    ...Typography.body,
    fontWeight: '600',
  },
  subtitle: {
    ...Typography.caption,
    fontFamily: 'ui-monospace',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  cell: {
    width: 14,
    height: 14,
    borderRadius: 2,
    borderWidth: 1,
  },
});
