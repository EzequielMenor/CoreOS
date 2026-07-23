import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Toast from 'react-native-toast-message';

import { NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getHabitos, HabitosRow, toggleHabitLog } from '@/db/queries/habitos';
import { haptic } from '@/lib/animations';
import { HabitHeatmap, type HeatmapDay } from '@/components/HabitHeatmap';

const MOCK_MODE = false;

const MOCK_HABITOS: HabitosRow[] = [
  { id: 1, habit_name: 'Ejercicio', status: 'done', date: '2026-07-22', created_at: Date.now() },
  { id: 2, habit_name: 'Lectura', status: 'done', date: '2026-07-22', created_at: Date.now() },
  { id: 3, habit_name: 'Meditación', status: 'missed', date: '2026-07-21', created_at: Date.now() },
  { id: 4, habit_name: 'Programar side project', status: 'done', date: '2026-07-21', created_at: Date.now() },
  { id: 5, habit_name: 'Ejercicio', status: 'done', date: '2026-07-20', created_at: Date.now() },
  { id: 6, habit_name: 'Lectura', status: 'missed', date: '2026-07-20', created_at: Date.now() },
  { id: 7, habit_name: 'Meditación', status: 'done', date: '2026-07-19', created_at: Date.now() },
  { id: 8, habit_name: 'Programar side project', status: 'done', date: '2026-07-18', created_at: Date.now() },
  { id: 9, habit_name: 'Ejercicio', status: 'missed', date: '2026-07-17', created_at: Date.now() },
  { id: 10, habit_name: 'Lectura', status: 'done', date: '2026-07-16', created_at: Date.now() },
];

export default function HabitosScreen() {
  const theme = useTheme();
  const [habitos, setHabitos] = useState<HabitosRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (MOCK_MODE) {
        setHabitos(MOCK_HABITOS);
        setLoading(false);
        return;
      }
      let active = true;
      setLoading(true);
      getHabitos()
        .then((rows) => {
          if (active) setHabitos(rows);
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

  const toggleRow = useCallback(async (item: HabitosRow) => {
    // ponytail: haptic vive en el screen, no en la query — I3 invariant
    void haptic.tap.medium();
    if (MOCK_MODE) {
      // ponytail: optimistic toggle para feedback instantáneo sin tocar DB
      setHabitos((prev) =>
        prev.map((h) =>
          h.id === item.id
            ? { ...h, status: h.status === 'done' ? 'missed' : 'done' }
            : h,
        ),
      );
      return;
    }
    try {
      await toggleHabitLog(item.habit_name, item.date);
      const rows = await getHabitos();
      setHabitos(rows);
    } catch {
      void haptic.notify.error();
      Toast.show({ type: 'error', text1: 'No se pudo actualizar el hábito' });
    }
  }, []);

  const heatmapDays = useMemo<HeatmapDay[]>(() => {
    const now = new Date();
    return Array.from({ length: 28 }, (_, i) => {
      const d = new Date(now.getTime() - (27 - i) * 86_400_000);
      const dateStr = d.toISOString().split('T')[0];
      return {
        date: dateStr,
        done: i !== 4 && i !== 12 && i !== 19,
        isToday: i === 27,
      };
    });
  }, []);

  const firstHabitName = useMemo(() => habitos[0]?.habit_name, [habitos]);

  // ponytail: sintetiza fila para toggleRow; firstHabitName=undefined → no-op
  const handleHeatmapTap = useCallback(
    async (date: string) => {
      if (!firstHabitName) return;
      await toggleRow({ id: -1, habit_name: firstHabitName, date, status: 'done', created_at: 0 });
    },
    [firstHabitName, toggleRow],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['top']}
    >
      <FlatList
        data={habitos}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <HabitHeatmap
              days={heatmapDays}
              title="Consistencia global"
              subtitle="Últimas 4 semanas"
              habitName={firstHabitName}
              onCellPress={handleHeatmapTap}
            />
            <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
              REGISTRO DE HÁBITOS
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: theme.notes.text.muted }]}>
            {loading ? '' : 'Aún no hay hábitos registrados'}
          </Text>
        }
        renderItem={({ item }) => {
          const isDone = item.status === 'done';
          return (
            <Pressable
              onPress={() => void toggleRow(item)}
              style={[
                styles.itemRow,
                {
                  borderBottomColor: 'rgba(128,128,128,0.15)',
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isDone ? theme.notes.text.primary : 'transparent',
                    borderColor: isDone ? theme.notes.text.primary : theme.notes.border.strong,
                  },
                ]}
              />
              <View style={styles.textWrap}>
                <Text style={[styles.habitName, { color: theme.notes.text.primary }]}>
                  {item.habit_name}
                </Text>
              </View>
              <Text style={[styles.dateText, { color: theme.notes.text.muted }]}>
                {item.date ?? ''}
              </Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: NoteSpacing.lg, gap: NoteSpacing.sm, flexGrow: 1 },
  headerWrap: {
    gap: NoteSpacing.lg,
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
    gap: NoteSpacing.sm + 4,
    paddingVertical: NoteSpacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1.2,
  },
  textWrap: {
    flex: 1,
  },
  habitName: {
    ...Typography.body,
    fontWeight: '500',
  },
  dateText: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
  },
  emptyText: { textAlign: 'center', marginTop: NoteSpacing.xl, fontSize: 15 },
});