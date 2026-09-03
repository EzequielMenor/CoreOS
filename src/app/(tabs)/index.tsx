import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import Toast from 'react-native-toast-message';

import { BottomTabInset, IconSize, MaxContentWidth, NoteSpacing, Radii } from '@/constants/theme';
import { countPendingInbox } from '@/db';
import { getTareasHoy } from '@/db/queries/tareas';
import type { TareaRow } from '@/db/queries/tareas';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { processPendingInbox } from '@/services/inbox';
import { useTareasStore } from '@/stores/tareas';

import { Cabecera } from '@/components/briefing/Cabecera';
import { TareasPrioritarias } from '@/components/briefing/TareasPrioritarias';

function getGreeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

function todayISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [now, setNow] = useState<number>(() => Date.now());
  const [tareasHoy, setTareasHoy] = useState<TareaRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [processing, setProcessing] = useState(false);

  const greeting = useMemo(() => getGreeting(new Date(now)), [now]);
  const dateLabel = useMemo(() => formatLongDate(new Date(now)), [now]);
  const todayKey = useMemo(() => todayISO(new Date(now)), [now]);

  const reload = useCallback(async () => {
    // ponytail: allSettled — un fallo de una query no oculta la otra.
    const [tareas, pending] = await Promise.allSettled([
      getTareasHoy(todayISO(new Date())),
      countPendingInbox(),
    ]);
    if (tareas.status === 'fulfilled') setTareasHoy(tareas.value);
    if (pending.status === 'fulfilled') setPendingCount(pending.value);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      // ponytail: setNow en focus cubre la transición de medianoche.
      setNow(Date.now());
    }, [reload]),
  );

  const handleToggle = useCallback(
    async (id: number) => {
      try {
        await useTareasStore.getState().toggleStatus(id);
      } catch {
        // toggleStatus ya loguea el error en el store.
      }
      await reload();
    },
    [reload],
  );

  // Chip accionable: reintenta el pipeline LLM y reporta el resultado.
  // I4: processPendingInbox nunca lanza.
  const handleProcessPending = useCallback(async () => {
    if (processing) return;
    setProcessing(true);
    void haptic.tap.light();
    const result = await processPendingInbox();
    await reload();
    setProcessing(false);
    if (result.processed > 0) {
      Toast.show({
        type: 'success',
        text1:
          result.processed === 1
            ? '1 captura clasificada'
            : `${result.processed} capturas clasificadas`,
      });
    } else if (result.failed > 0) {
      Toast.show({
        type: 'error',
        text1: 'No se pudieron procesar',
        text2: result.errors[0]?.error,
      });
    }
  }, [processing, reload]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['top']}
    >
      <Stack.Screen options={{ title: 'Hoy', headerShown: false }} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: BottomTabInset + NoteSpacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCabecera}>
            <Cabecera greeting={greeting} dateLabel={dateLabel} />
          </View>
          <Pressable
            accessibilityLabel="Ajustes"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void haptic.tap.light();
              router.push('/ajustes');
            }}
            style={({ pressed }) => [styles.gearBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            {Platform.OS === 'ios' ? (
              <SymbolView
                name="gearshape"
                size={IconSize.md}
                tintColor={theme.notes.text.primary}
              />
            ) : (
              <Text style={{ color: theme.notes.text.primary, fontSize: 16 }}>⚙️</Text>
            )}
          </Pressable>
        </View>

        {pendingCount > 0 ? (
          <Pressable
            accessibilityHint="Reintenta clasificar las capturas pendientes"
            accessibilityLabel={`${pendingCount} capturas por procesar`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void handleProcessPending();
            }}
            style={({ pressed }) => [
              styles.pendingChip,
              {
                backgroundColor: theme.notes.accent.primaryDim,
                opacity: pressed || processing ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[styles.pendingText, { color: theme.notes.text.primary }]}>
              {processing
                ? 'Procesando…'
                : pendingCount === 1
                  ? '1 captura por procesar'
                  : `${pendingCount} capturas por procesar`}
            </Text>
          </Pressable>
        ) : null}

        <TareasPrioritarias
          tareas={tareasHoy}
          todayKey={todayKey}
          onPressItem={() => router.push('/tareas')}
          onToggleItem={(id) => void handleToggle(id)}
        />

        <Pressable
          accessibilityLabel="Ver todas las tareas"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            router.push('/tareas');
          }}
          style={({ pressed }) => [
            styles.verTodas,
            {
              borderColor: theme.notes.border.subtle,
              backgroundColor: theme.notes.bg.surface,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.verTodasText, { color: theme.notes.accent.primary }]}>
            Ver todas
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.lg,
    gap: NoteSpacing.lg,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.md,
  },
  headerCabecera: {
    flex: 1,
  },
  gearBtn: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pendingChip: {
    alignSelf: 'flex-start',
    borderRadius: Radii.full,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.xs,
  },
  pendingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  verTodas: {
    alignItems: 'center',
    borderRadius: Radii.lg,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  verTodasText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
