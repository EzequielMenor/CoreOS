import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getSueno, SuenoRow } from '@/db';

const MOCK_MODE = false;

const MOCK_SUENO: SuenoRow[] = [
  { id: 1, hours: 7.8, deep_sleep_percentage: 24, quality: 'buena', date: '2026-07-22', created_at: Date.now() - 0 * 86400000 },
  { id: 2, hours: 8.2, deep_sleep_percentage: 30, quality: 'excelente', date: '2026-07-21', created_at: Date.now() - 1 * 86400000 },
  { id: 3, hours: 6.5, deep_sleep_percentage: 18, quality: 'regular', date: '2026-07-20', created_at: Date.now() - 2 * 86400000 },
  { id: 4, hours: 7.2, deep_sleep_percentage: 22, quality: 'buena', date: '2026-07-19', created_at: Date.now() - 3 * 86400000 },
  { id: 5, hours: 8.5, deep_sleep_percentage: 33, quality: 'excelente', date: '2026-07-18', created_at: Date.now() - 4 * 86400000 },
  { id: 6, hours: 6.8, deep_sleep_percentage: 16, quality: 'mala', date: '2026-07-17', created_at: Date.now() - 5 * 86400000 },
  { id: 7, hours: 7.5, deep_sleep_percentage: 25, quality: 'buena', date: '2026-07-16', created_at: Date.now() - 6 * 86400000 },
];

export default function SuenoScreen() {
  const theme = useTheme();
  const [suenos, setSuenos] = useState<SuenoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (MOCK_MODE) {
        setSuenos(MOCK_SUENO);
        setLoading(false);
        return;
      }
      let active = true;
      setLoading(true);
      getSueno()
        .then((rows) => {
          if (active) setSuenos(rows);
        })
        .catch(console.error)
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['top']}
    >
      <FlatList
        data={suenos}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
              REGISTRO DE SUEÑO Y CALIDAD
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: theme.notes.text.muted }]}>
            {loading ? '' : 'Aún no hay registros de sueño'}
          </Text>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.itemRow,
              {
                borderBottomColor: 'rgba(128,128,128,0.15)',
              },
            ]}
          >
            <View style={styles.hoursColumn}>
              <Text style={[styles.hours, { color: theme.notes.text.primary }]}>
                {item.hours.toFixed(1)}
                <Text style={[styles.hoursUnit, { color: theme.notes.text.muted }]}>h</Text>
              </Text>
            </View>

            <View style={styles.detailsColumn}>
              <Text style={[styles.qualityText, { color: theme.notes.text.primary }]}>
                {item.quality ? item.quality.toUpperCase() : 'REGULAR'} · {item.deep_sleep_percentage.toFixed(0)}% PROFUNDO
              </Text>
              <Text style={[styles.dateText, { color: theme.notes.text.muted }]}>
                {item.date ?? ''}
              </Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: NoteSpacing.lg, gap: NoteSpacing.xs, flexGrow: 1 },
  headerWrap: {
    marginBottom: NoteSpacing.md,
  },
  sectionTitle: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NoteSpacing.md,
    paddingVertical: NoteSpacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hoursColumn: {
    minWidth: 64,
  },
  hours: {
    fontFamily: 'ui-monospace',
    fontSize: 22,
    fontWeight: '700',
  },
  hoursUnit: {
    fontSize: 15,
    fontWeight: '400',
  },
  detailsColumn: {
    flex: 1,
    gap: 2,
  },
  qualityText: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  dateText: {
    ...Typography.caption,
    fontFamily: 'ui-monospace',
    fontSize: 12,
  },
  emptyText: { textAlign: 'center', marginTop: NoteSpacing.xl, fontSize: 15 },
});