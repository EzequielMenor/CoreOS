import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  View,
  Platform,
  Keyboard,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import Toast from 'react-native-toast-message';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { IconSize, NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useIdeasStore } from '@/stores/ideas';
import { animations, haptic } from '@/lib/animations';
import { EmptyState } from '@/components/EmptyState';
import type { Idea } from '@/db/queries/ideas';

type Tab = 'inbox' | 'processed' | 'discarded';

const TAB_LABELS: Record<Tab, string> = {
  inbox: 'Inbox',
  processed: 'Procesadas',
  discarded: 'Descartadas',
};

// ponytail: helper inline de presentación. Si se necesita en otra pantalla,
// mover a src/lib/format.ts (cuando aparezca un tercer caller).
function formatRelative(seconds: number): string {
  const ms = seconds > 10_000_000_000 ? seconds : seconds * 1000;
  const date = new Date(ms);
  const now = new Date();
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export default function IdeasInboxScreen() {
  const router = useRouter();
  const theme = useTheme();

  const inbox = useIdeasStore((s) => s.inbox);
  const processed = useIdeasStore((s) => s.processed);
  const discarded = useIdeasStore((s) => s.discarded);
  const fetchIdeas = useIdeasStore((s) => s.fetchIdeas);
  const createIdea = useIdeasStore((s) => s.createIdea);
  const convertToNote = useIdeasStore((s) => s.convertToNote);
  const discardIdea = useIdeasStore((s) => s.discardIdea);

  const [activeTab, setActiveTab] = useState<Tab>('inbox');
  const [composing, setComposing] = useState(false);
  const [composingText, setComposingText] = useState('');
  const [saving, setSaving] = useState(false);

  // Crossfade tab content per spec D11
  const tabOpacity = useSharedValue(1);
  const tabAnimatedStyle = useAnimatedStyle(() => ({
    opacity: tabOpacity.value,
  }));

  useFocusEffect(
    useCallback(() => {
      void fetchIdeas();
    }, [fetchIdeas]),
  );

  const ideas = useMemo(() => {
    if (activeTab === 'inbox') return inbox;
    if (activeTab === 'processed') return processed;
    return discarded;
  }, [activeTab, inbox, processed, discarded]);

  const handleTabChange = useCallback(
    (next: Tab) => {
      if (next === activeTab) return;
      void haptic.tap.light();
      tabOpacity.set(0);
      setActiveTab(next);
    },
    [activeTab, tabOpacity],
  );

  // Animate tab content in after activeTab change
  useEffect(() => {
    tabOpacity.set(animations.tabswitch.fade.apply(tabOpacity));
  }, [activeTab, tabOpacity]);

  const handleConvert = useCallback(
    async (ideaId: number) => {
      try {
        const noteId = await convertToNote(ideaId);
        void haptic.notify.success();
        Toast.show({
          type: 'success',
          text1: 'Idea convertida a nota',
          text2: 'Puedes encontrarla en tus Notas',
          onPress: () => router.push(`/notas/${noteId}`),
        });
      } catch {
        void haptic.notify.error();
        Toast.show({
          type: 'error',
          text1: 'No se pudo convertir la idea',
        });
      }
    },
    [convertToNote, router],
  );

  const handleDiscard = useCallback(
    async (ideaId: number) => {
      try {
        await discardIdea(ideaId);
        void haptic.tap.medium();
      } catch {
        void haptic.notify.error();
        Toast.show({
          type: 'error',
          text1: 'No se pudo descartar la idea',
        });
      }
    },
    [discardIdea],
  );

  const handleOpenComposer = useCallback(() => {
    void haptic.tap.light();
    setComposing(true);
    setComposingText('');
  }, []);

  const handleCancelComposer = useCallback(() => {
    setComposing(false);
    setComposingText('');
    Keyboard.dismiss();
  }, []);

  const handleSubmitComposer = useCallback(async () => {
    const trimmed = composingText.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await createIdea(trimmed);
      void haptic.tap.light();
      setComposingText('');
      setComposing(false);
      Keyboard.dismiss();
    } catch {
      void haptic.notify.error();
      Toast.show({
        type: 'error',
        text1: 'No se pudo guardar la idea',
      });
    } finally {
      setSaving(false);
    }
  }, [composingText, saving, createIdea]);

  const renderRow = useCallback(
    ({ item }: { item: Idea }) => {
      if (activeTab === 'inbox') {
        return (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
              },
            ]}
          >
            <Text
              style={[styles.ideaText, { color: theme.notes.text.primary }]}
              numberOfLines={6}
            >
              {item.text}
            </Text>
            <Text
              style={[styles.timestamp, { color: theme.notes.text.muted }]}
            >
              {formatRelative(item.created_at)}
            </Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Convertir a nota"
                onPress={() => handleConvert(item.id)}
                style={[
                  styles.actionButton,
                  styles.primaryAction,
                  { backgroundColor: theme.notes.accent.primary },
                ]}
              >
                <Text
                  style={[
                    styles.primaryActionText,
                    { color: theme.notes.text.primary },
                  ]}
                >
                  → Convertir a nota
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Descartar idea"
                onPress={() => handleDiscard(item.id)}
                style={[
                  styles.actionButton,
                  styles.ghostAction,
                  { borderColor: theme.notes.border.subtle },
                ]}
              >
                <Text
                  style={[
                    styles.ghostActionText,
                    { color: theme.notes.text.muted },
                  ]}
                >
                  Descartar
                </Text>
              </Pressable>
            </View>
          </View>
        );
      }

      if (activeTab === 'processed') {
        return (
          <Pressable
            accessibilityRole={item.converted_note_id ? 'button' : 'text'}
            disabled={!item.converted_note_id}
            onPress={() => {
              if (item.converted_note_id) {
                router.push(`/notas/${item.converted_note_id}`);
              }
            }}
            style={[
              styles.card,
              styles.cardProcessed,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
              },
            ]}
          >
            <Text
              style={[styles.ideaText, { color: theme.notes.text.primary }]}
              numberOfLines={6}
            >
              {item.text}
            </Text>
            <View style={styles.processedFooter}>
              <Text
                style={[styles.timestamp, { color: theme.notes.text.muted }]}
              >
                {formatRelative(item.created_at)}
              </Text>
              {item.converted_note_id ? (
                <Text
                  style={[
                    styles.noteLink,
                    { color: theme.notes.text.accent },
                  ]}
                >
                  Ver nota #{item.converted_note_id} →
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      }

      // discarded
      return (
        <View
          style={[
            styles.card,
            styles.cardDiscarded,
            {
              backgroundColor: theme.notes.bg.surface,
              borderColor: theme.notes.border.subtle,
            },
          ]}
        >
          <Text
            style={[
              styles.ideaText,
              styles.discardedText,
              { color: theme.notes.text.muted },
            ]}
            numberOfLines={6}
          >
            {item.text}
          </Text>
          <Text
            style={[styles.timestamp, { color: theme.notes.text.muted }]}
          >
            {formatRelative(item.created_at)}
          </Text>
        </View>
      );
    },
    [
      activeTab,
      theme,
      handleConvert,
      handleDiscard,
      router,
    ],
  );

  const emptyState = useMemo(() => {
    if (activeTab === 'inbox') {
      return (
        <EmptyState
          illustration="ideas"
          title="No tienes ideas pendientes"
          subtitle="Las ideas que captures aquí se procesan después para crear notas estructuradas."
          cta={{ label: 'Crear idea', onPress: handleOpenComposer }}
        />
      );
    }
    if (activeTab === 'processed') {
      return (
        <EmptyState
          illustration="ideas"
          title="Aún no has procesado ideas"
          subtitle="Las ideas que conviertas a notas aparecerán en esta pestaña."
        />
      );
    }
    return (
      <EmptyState
        illustration="ideas"
        title="Sin ideas descartadas"
        subtitle="Las ideas que descartes se mueven aquí para que puedas revisarlas si cambias de opinión."
      />
    );
  }, [activeTab, handleOpenComposer]);

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
    >
      <Stack.Screen
        options={{
          title: 'Ideas',
          headerRight: () => (
            <Pressable
              accessibilityLabel="Crear idea"
              accessibilityRole="button"
              hitSlop={8}
              onPress={handleOpenComposer}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="plus"
                  size={IconSize.md}
                  tintColor={theme.notes.text.accent}
                />
              ) : (
                <Text
                  style={[
                    styles.headerAction,
                    { color: theme.notes.text.accent },
                  ]}
                >
                  +
                </Text>
              )}
            </Pressable>
          ),
        }}
      />

      {/* Composer inline (visible solo cuando el usuario pulsa +) */}
      {composing ? (
        <View
          style={[
            styles.composeWrap,
            {
              backgroundColor: theme.notes.bg.elevated,
              borderColor: theme.notes.border.subtle,
            },
          ]}
        >
          <TextInput
            autoFocus
            multiline
            onChangeText={setComposingText}
            onSubmitEditing={handleSubmitComposer}
            placeholder="Escribe una idea…"
            placeholderTextColor={theme.notes.text.muted}
            returnKeyType="send"
            selectionColor={theme.notes.accent.primary}
            style={[
              styles.composeInput,
              { color: theme.notes.text.primary },
            ]}
            value={composingText}
          />
          <View style={styles.composeActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleCancelComposer}
            >
              <Text
                style={[
                  styles.composeCancel,
                  { color: theme.notes.text.muted },
                ]}
              >
                Cancelar
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!composingText.trim() || saving}
              onPress={handleSubmitComposer}
              style={[
                styles.composeSaveButton,
                {
                  backgroundColor: theme.notes.accent.primary,
                  opacity: !composingText.trim() || saving ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.composeSaveText,
                  { color: theme.notes.text.primary },
                ]}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 3-tab segmented control custom */}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: theme.notes.bg.surface,
            borderColor: theme.notes.border.subtle,
          },
        ]}
      >
        {(['inbox', 'processed', 'discarded'] as const).map((tab) => {
          const isActive = tab === activeTab;
          return (
            <Pressable
              key={tab}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => handleTabChange(tab)}
              style={[
                styles.tab,
                isActive && {
                  backgroundColor: theme.notes.accent.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: isActive
                      ? theme.notes.text.primary
                      : theme.notes.text.muted,
                  },
                ]}
              >
                {TAB_LABELS[tab]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Lista con crossfade entre tabs */}
      <Animated.View style={[styles.listWrap, tabAnimatedStyle]}>
        <FlatList
          contentContainerStyle={styles.listContent}
          data={ideas}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => String(item.id)}
          ListEmptyComponent={emptyState}
          renderItem={renderRow}
        />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerAction: {
    fontSize: Typography.title.size,
    fontWeight: Typography.title.weight,
    lineHeight: Typography.title.lineHeight,
    paddingHorizontal: NoteSpacing.xs,
  },

  // Composer
  composeWrap: {
    borderBottomWidth: 1,
    marginHorizontal: NoteSpacing.md,
    marginTop: NoteSpacing.sm,
    padding: NoteSpacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  composeInput: {
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    minHeight: 80,
    paddingVertical: NoteSpacing.sm,
    textAlignVertical: 'top',
  },
  composeActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: NoteSpacing.sm,
    gap: NoteSpacing.md,
  },
  composeCancel: {
    fontSize: Typography.body.size,
    fontWeight: '500',
    paddingVertical: NoteSpacing.xs,
  },
  composeSaveButton: {
    borderRadius: Radii.pill,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  composeSaveText: {
    fontSize: Typography.body.size,
    fontWeight: '600',
  },

  // Tab bar
  tabBar: {
    borderRadius: Radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: NoteSpacing.md,
    marginTop: NoteSpacing.md,
    padding: 3,
  },
  tab: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    flex: 1,
    paddingVertical: NoteSpacing.sm,
  },
  tabLabel: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
    letterSpacing: 0.2,
    lineHeight: Typography.caption.lineHeight,
  },

  // List
  listWrap: {
    flex: 1,
    marginTop: NoteSpacing.md,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: NoteSpacing.md,
    paddingBottom: NoteSpacing['2xl'],
  },

  // Cards
  card: {
    borderRadius: Radii.md,
    borderWidth: 1,
    marginBottom: NoteSpacing.sm + 4,
    padding: NoteSpacing.md,
    gap: NoteSpacing.xs,
  },
  cardProcessed: {
    // Estado procesado: ligero visual tint
  },
  cardDiscarded: {
    opacity: 0.65,
  },
  ideaText: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 23,
  },
  discardedText: {
    textDecorationLine: 'line-through',
  },
  timestamp: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
    marginTop: NoteSpacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    marginTop: NoteSpacing.md,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    flex: 1,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  primaryAction: {
    borderWidth: 0,
  },
  primaryActionText: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    lineHeight: Typography.caption.lineHeight,
  },
  ghostAction: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  ghostActionText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
    lineHeight: Typography.caption.lineHeight,
  },
  processedFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: NoteSpacing.sm,
  },
  noteLink: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    lineHeight: Typography.caption.lineHeight,
  },
});