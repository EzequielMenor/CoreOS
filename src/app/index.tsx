import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as SecureStore from 'expo-secure-store';

import { BottomTabInset, NoteSpacing, Radii, Typography } from '@/constants/theme';
import CaptureModal from '../components/CaptureModal';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { ButtonBrand } from '@/components/ButtonBrand';
import { HabitHeatmap, type HeatmapDay } from '@/components/HabitHeatmap';
import { EditorialTaskItem } from '@/components/EditorialTaskItem';
import { useTareasStore } from '@/stores/tareas';
import { useGastosStore } from '@/stores/gastos';

const HAS_ONBOARDED_KEY = 'hasOnboarded';
const MOCK_MODE = false;

// Mock data editorial
const now = new Date();
const MOCK_DAYS: HeatmapDay[] = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(now.getTime() - (13 - i) * 86_400_000);
  const dateStr = d.toISOString().split('T')[0];
  return {
    date: dateStr,
    done: i !== 3 && i !== 8, // la mayoría hechos
    isToday: i === 13,
  };
});

const MOCK_TOP_TASKS = [
  { id: 1, title: 'Revisar PR del knowledge graph y validar FTS5', due_date: 'Hoy', priority: 'alta', status: 'pending' as const },
  { id: 2, title: 'Preparar presentación del rediseño de CoreOS', due_date: 'Mañana', priority: 'media', status: 'pending' as const },
  { id: 3, title: 'Actualizar dependencias de Expo SDK 57', due_date: '24 jul', priority: null, status: 'completed' as const },
];

const MOCK_RECENT_NOTES = [
  { id: 101, title: 'Principios de arquitectura limpia', meta: 'Hace 2h · #arquitectura' },
  { id: 102, title: 'Ideas para CoreOS v2 — Lino y Tinta', meta: 'Hace 5h · #diseño' },
  { id: 103, title: 'Notas de reunión: sincronización local-first', meta: 'Ayer · #tech' },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [today] = useState(() => new Date());

  const tasksItems = useTareasStore((s) => s.items);
  const toggleStatus = useTareasStore((s) => s.toggleStatus);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const v = await SecureStore.getItemAsync(HAS_ONBOARDED_KEY);
          if (!cancelled) setHasApiKey(v === 'true');
        } catch {
          if (!cancelled) setHasApiKey(true);
        }
      })();
      void useTareasStore.getState().fetchItems();
      void useGastosStore.getState().fetchItems();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const displayTasks = useMemo(() => {
    if (MOCK_MODE) return MOCK_TOP_TASKS;
    return tasksItems.slice(0, 4);
  }, [tasksItems]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['top']}
    >
      <Stack.Screen options={{ title: 'Hub', headerShown: false }} />
      
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: BottomTabInset + NoteSpacing['2xl'] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Cabecera limpia */}
        <View style={styles.headerSection}>
          <Text style={[styles.greeting, { color: theme.notes.text.primary }]}>
            {greeting()}
          </Text>
          <Text style={[styles.date, { color: theme.notes.text.muted }]}>
            {formatLongDate(today)}
          </Text>
        </View>

        {/* Banner API Key si falta */}
        {hasApiKey === false ? (
          <View
            style={[
              styles.apiBanner,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.strong,
              },
            ]}
          >
            <Text style={[styles.apiBannerText, { color: theme.notes.text.primary }]}>
              Configura tu API Key en Ajustes para activar el clasificador IA
            </Text>
            <ButtonBrand
              title="Ajustes"
              size="sm"
              variant="secondary"
              onPress={() => router.push('/ajustes' as never)}
            />
          </View>
        ) : null}

        {/* Barra de captura rápida tipo Raycast / Apple Notes */}
        <View style={styles.section}>
          <Pressable
            style={[
              styles.quickCaptureBar,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.strong,
              },
            ]}
            onPress={() => {
              void haptic.tap.light();
              setModalVisible(true);
            }}
          >
            {Platform.OS === 'ios' ? (
              <SymbolView name="plus.circle" size={18} tintColor={theme.notes.text.muted} />
            ) : (
              <Text style={{ color: theme.notes.text.muted }}>+</Text>
            )}
            <Text style={[styles.quickCaptureText, { color: theme.notes.text.muted }]}>
              Escribe o captura un pensamiento rápido…
            </Text>
          </Pressable>
        </View>

        {/* Heatmap Hábitos estilo GitHub / jerad-ops */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
              HÁBITOS · ÚLTIMOS 14 DÍAS
            </Text>
            <Pressable onPress={() => router.push('/habitos' as never)}>
              <Text style={[styles.sectionLink, { color: theme.notes.text.muted }]}>Ver todos →</Text>
            </Pressable>
          </View>
          <HabitHeatmap
            days={MOCK_DAYS}
            title="Racha activa"
            subtitle="12 de 14 días"
          />
        </View>

        {/* Tareas prioritarias estilo editorial */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
              TAREAS DE HOY
            </Text>
            <Pressable onPress={() => router.push('/tareas' as never)}>
              <Text style={[styles.sectionLink, { color: theme.notes.text.muted }]}>Ver todas →</Text>
            </Pressable>
          </View>
          <View style={[styles.listCard, { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle }]}>
            {displayTasks.map((t, idx) => (
              <EditorialTaskItem
                key={t.id}
                title={t.title}
                status={t.status}
                dueDate={t.due_date}
                priority={t.priority}
                onToggle={() => {
                  if (!MOCK_MODE) void toggleStatus(t.id);
                }}
                onPress={() => router.push('/tareas' as never)}
              />
            ))}
          </View>
        </View>

        {/* Notas recientes */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
              NOTAS RECIENTES
            </Text>
            <Pressable onPress={() => router.push('/notas' as never)}>
              <Text style={[styles.sectionLink, { color: theme.notes.text.muted }]}>Abrir →</Text>
            </Pressable>
          </View>
          <View style={[styles.listCard, { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle }]}>
            {MOCK_RECENT_NOTES.map((note, idx) => (
              <Pressable
                key={note.id}
                style={({ pressed }) => [
                  styles.noteRow,
                  idx < MOCK_RECENT_NOTES.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.15)' },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => router.push('/notas' as never)}
              >
                <Text style={[styles.noteTitle, { color: theme.notes.text.primary }]}>
                  {note.title}
                </Text>
                <Text style={[styles.noteMeta, { color: theme.notes.text.muted }]}>
                  {note.meta}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Enlaces de navegación rápida */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary, marginBottom: 8 }]}>
            MÓDULOS
          </Text>
          <View style={styles.navRow}>
            {[
              { label: 'Gastos', route: '/gastos', stat: '342 €' },
              { label: 'Ideas', route: '/ideas', stat: '5 pend.' },
              { label: 'Sueño', route: '/sueno', stat: '7.2h' },
            ].map((m) => (
              <Pressable
                key={m.label}
                style={({ pressed }) => [
                  styles.navPill,
                  { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => router.push(m.route as never)}
              >
                <Text style={[styles.navPillText, { color: theme.notes.text.primary }]}>
                  {m.label}
                </Text>
                <Text style={[styles.navPillStat, { color: theme.notes.text.muted }]}>
                  {m.stat}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      <CaptureModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
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
  },
  headerSection: {
    marginBottom: NoteSpacing.lg,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  date: {
    fontSize: 13,
    marginTop: 2,
    fontFamily: 'ui-monospace',
    textTransform: 'lowercase',
  },
  apiBanner: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: NoteSpacing.lg,
    gap: 12,
  },
  apiBannerText: {
    ...Typography.body,
    flex: 1,
    fontSize: 14,
  },
  section: {
    marginBottom: NoteSpacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: NoteSpacing.sm,
  },
  sectionTitle: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '500',
  },
  quickCaptureBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NoteSpacing.sm,
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: 14,
  },
  quickCaptureText: {
    fontSize: 15,
  },
  listCard: {
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: NoteSpacing.md,
  },
  noteRow: {
    paddingVertical: NoteSpacing.md,
    gap: 4,
  },
  noteTitle: {
    ...Typography.body,
    fontWeight: '500',
  },
  noteMeta: {
    ...Typography.caption,
    fontFamily: 'ui-monospace',
    fontSize: 12,
  },
  navRow: {
    flexDirection: 'row',
    gap: NoteSpacing.sm,
  },
  navPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  navPillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  navPillStat: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
  },
});
