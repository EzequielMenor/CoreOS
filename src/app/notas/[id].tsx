import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { getById } from '@/db/queries/notes';
import type { Note } from '@/db/queries/notes';
import { IconSize, NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useNotesStore } from '@/stores/notes';

import { EmptyState } from '@/components/EmptyState';
import { MarkdownView } from '@/components/MarkdownView';
import { TagPill } from '@/components/TagPill';

function formatTimestamp(seconds: number): string {
  const date = new Date(seconds > 10_000_000_000 ? seconds : seconds * 1000);
  const now = new Date();
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `hace ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `hace ${days} d`;
  }
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export default function NoteDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const noteId = Number(params.id);
  const restoreNote = useNotesStore((state) => state.restoreNote);
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    if (!Number.isFinite(noteId) || noteId <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setNotFound(true);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setNotFound(false);
    getById(noteId)
      .then((fetched) => {
        if (!active) return;
        setNote(fetched);
        setNotFound(fetched == null);
      })
      .catch((error: unknown) => {
        console.error('[NoteDetail] getById failed', error);
        if (!active) return;
        setNotFound(true);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [noteId]);

  const goToEdit = useCallback(() => {
    if (note == null) return;
    void haptic.tap.light();
    router.push(`/notas/${note.id}/edit`);
  }, [note, router]);

  const handleRestore = useCallback(() => {
    if (note == null) return;
    void restoreNote(note.id).catch((error: unknown) => {
      console.error('[NoteDetail] restoreNote failed', error);
    });
  }, [note, restoreNote]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.notes.bg.base }]}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Notas' }} />
        <ActivityIndicator color={theme.notes.text.accent} />
      </SafeAreaView>
    );
  }

  if (notFound || note == null) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.notes.bg.base }]}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Notas' }} />
        <EmptyState
          illustration="notes"
          title="Nota no encontrada"
          subtitle="Es posible que haya sido eliminada."
          cta={{ label: 'Volver', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  const isDeleted = note.deleted_at != null;
  const headerTitle = note.title.trim() || 'Sin título';

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.notes.bg.base }]}>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerBackTitle: 'Notas',
          headerRight: () => (
            <Pressable
              accessibilityLabel="Editar nota"
              accessibilityRole="button"
              hitSlop={8}
              onPress={goToEdit}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="pencil"
                  size={IconSize.md}
                  tintColor={theme.notes.text.accent}
                />
              ) : (
                <Text style={[styles.headerAction, { color: theme.notes.text.accent }]}>
                  Edit
                </Text>
              )}
            </Pressable>
          ),
        }}
      />
      {isDeleted ? (
        <EmptyState
          illustration="notes"
          title="Nota eliminada"
          subtitle="Puedes restaurarla si la has borrado por error."
          cta={{ label: 'Restaurar', onPress: handleRestore }}
        />
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={[styles.title, { color: theme.notes.text.primary }]}>{headerTitle}</Text>
            {note.tags.length > 0 ? (
              <View style={styles.tagsRow}>
                {note.tags.map((tagName) => (
                  <TagPill key={tagName} name={tagName} variant="display" />
                ))}
              </View>
            ) : null}
            <Text style={[styles.timestamp, { color: theme.notes.text.muted }]}>
              {formatTimestamp(note.created_at)}
            </Text>
            <View
              style={[
                styles.body,
                { borderTopColor: theme.notes.border.subtle },
              ]}
            >
              {note.body_md.trim().length > 0 ? (
                <MarkdownView body={note.body_md} />
              ) : (
                <Text style={[styles.empty, { color: theme.notes.text.muted }]}>
                  Esta nota no tiene contenido.
                </Text>
              )}
            </View>
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    paddingBottom: NoteSpacing['2xl'],
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.md,
  },
  title: {
    fontSize: Typography.display.size,
    fontWeight: Typography.display.weight,
    letterSpacing: Typography.display.letterSpacing,
    lineHeight: Typography.display.lineHeight,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: NoteSpacing.xs,
    marginTop: NoteSpacing.md,
  },
  timestamp: {
    fontSize: Typography.caption.size,
    fontWeight: Typography.caption.weight,
    lineHeight: Typography.caption.lineHeight,
    marginTop: NoteSpacing.sm,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: NoteSpacing.lg,
    paddingTop: NoteSpacing.md,
  },
  empty: {
    fontSize: Typography.body.size,
    fontStyle: 'italic',
    lineHeight: Typography.body.lineHeight,
  },
  headerAction: {
    fontSize: Typography.body.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.body.lineHeight,
    paddingHorizontal: NoteSpacing.xs,
  },
});