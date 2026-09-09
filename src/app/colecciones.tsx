import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { listCollectionNotes, removeNoteFromCollection } from '@/db/queries/collections';
import type { CollectionWithCount } from '@/db/queries/collections';
import { getById } from '@/db/queries/notes';
import { IconSize, NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useCollectionsStore } from '@/stores/collections';

interface CollectionNote {
  id: number;
  title: string;
}

export default function CollectionsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const collections = useCollectionsStore((state) => state.collections);
  const loading = useCollectionsStore((state) => state.loading);
  const fetchCollections = useCollectionsStore((state) => state.fetchCollections);
  const createCollection = useCollectionsStore((state) => state.create);
  const removeCollection = useCollectionsStore((state) => state.remove);
  const setOrder = useCollectionsStore((state) => state.setOrder);

  const [name, setName] = useState('');
  const [expandedCollectionId, setExpandedCollectionId] = useState<number | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<CollectionNote[]>([]);

  useFocusEffect(
    useCallback(() => {
      void fetchCollections();
    }, [fetchCollections]),
  );

  const loadNotes = useCallback(async (collectionId: number) => {
    const rows = await listCollectionNotes(collectionId);
    const resolved = await Promise.all(
      rows.map(async (row) => {
        const note = await getById(row.note_id);
        return note ? { id: note.id, title: note.title.trim() || 'Sin título' } : null;
      }),
    );
    setExpandedNotes(resolved.filter((note): note is CollectionNote => note !== null));
  }, []);

  const toggleCollection = useCallback(
    (collectionId: number) => {
      if (expandedCollectionId === collectionId) {
        setExpandedCollectionId(null);
        setExpandedNotes([]);
        return;
      }
      setExpandedCollectionId(collectionId);
      void loadNotes(collectionId).catch(() => {
        setExpandedNotes([]);
        Alert.alert('No se pudo cargar', 'No se pudieron cargar las notas de la colección.');
      });
    },
    [expandedCollectionId, loadNotes],
  );

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createCollection(trimmed);
      setName('');
      void haptic.notify.success();
    } catch (error: unknown) {
      Alert.alert(
        'No se pudo crear',
        error instanceof Error ? error.message : 'Inténtalo de nuevo.',
      );
    }
  }, [createCollection, name]);

  const confirmDelete = useCallback(
    (collection: CollectionWithCount) => {
      Alert.alert(
        'Eliminar colección',
        `¿Eliminar «${collection.name}»? Las notas no se eliminarán.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: () => {
              void removeCollection(collection.id)
                .then(() => {
                  if (expandedCollectionId === collection.id) {
                    setExpandedCollectionId(null);
                    setExpandedNotes([]);
                  }
                })
                .catch(() => {
                  Alert.alert('No se pudo eliminar', 'Inténtalo de nuevo.');
                });
            },
          },
        ],
      );
    },
    [expandedCollectionId, removeCollection],
  );

  const reorderNote = useCallback(
    async (index: number, direction: -1 | 1) => {
      if (expandedCollectionId == null) return;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= expandedNotes.length) return;
      const next = [...expandedNotes];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      try {
        await setOrder(
          expandedCollectionId,
          next.map((note) => note.id),
        );
        setExpandedNotes(next);
      } catch {
        Alert.alert('No se pudo ordenar', 'Inténtalo de nuevo.');
      }
    },
    [expandedCollectionId, expandedNotes, setOrder],
  );

  const removeNote = useCallback(
    async (noteId: number) => {
      if (expandedCollectionId == null) return;
      try {
        await removeNoteFromCollection(noteId, expandedCollectionId);
        await loadNotes(expandedCollectionId);
        await fetchCollections();
      } catch {
        Alert.alert('No se pudo quitar', 'Inténtalo de nuevo.');
      }
    },
    [expandedCollectionId, fetchCollections, loadNotes],
  );

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
    >
      <Stack.Screen
        options={{
          title: 'Colecciones',
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Volver"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.back()}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="chevron.left"
                  size={IconSize.md}
                  tintColor={theme.notes.text.primary}
                />
              ) : (
                <Text style={[styles.backFallback, { color: theme.notes.text.primary }]}>‹</Text>
              )}
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.createRow}>
          <TextInput
            onChangeText={setName}
            onSubmitEditing={() => void handleCreate()}
            placeholder="Nueva colección…"
            placeholderTextColor={theme.notes.text.muted}
            returnKeyType="done"
            selectionColor={theme.notes.accent.primary}
            style={[
              styles.input,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
                color: theme.notes.text.primary,
              },
            ]}
            value={name}
          />
          <Pressable
            accessibilityLabel="Crear colección"
            accessibilityRole="button"
            disabled={!name.trim()}
            onPress={() => void handleCreate()}
            style={[
              styles.confirmButton,
              {
                backgroundColor: name.trim()
                  ? theme.notes.accent.primary
                  : theme.notes.bg.elevated,
              },
            ]}
          >
            <Text style={[styles.confirmText, { color: name.trim() ? '#FFFFFF' : theme.notes.text.muted }]}>Añadir</Text>
          </Pressable>
        </View>

        {collections.length === 0 && !loading ? (
          <Text style={[styles.empty, { color: theme.notes.text.muted }]}>No hay colecciones todavía.</Text>
        ) : null}

        {collections.map((collection) => {
          const expanded = expandedCollectionId === collection.id;
          return (
            <View
              key={collection.id}
              style={[styles.collectionBlock, { borderBottomColor: theme.notes.border.subtle }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onLongPress={() => confirmDelete(collection)}
                onPress={() => toggleCollection(collection.id)}
                style={styles.collectionRow}
              >
                <View style={styles.collectionCopy}>
                  <Text style={[styles.collectionName, { color: theme.notes.text.primary }]}>
                    {collection.name}
                  </Text>
                  <Text style={[styles.count, { color: theme.notes.text.muted }]}>
                    {collection.note_count} {collection.note_count === 1 ? 'nota' : 'notas'}
                  </Text>
                </View>
                <Text style={[styles.chevron, { color: theme.notes.text.muted }]}>
                  {expanded ? '⌃' : '⌄'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Eliminar colección ${collection.name}`}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => confirmDelete(collection)}
                style={styles.deleteButton}
              >
                {Platform.OS === 'ios' ? (
                  <SymbolView
                    name="trash"
                    size={IconSize.sm}
                    tintColor={theme.notes.text.muted}
                  />
                ) : (
                  <Text style={[styles.deleteFallback, { color: theme.notes.text.muted }]}>🗑️</Text>
                )}
              </Pressable>
              {expanded ? (
                <View style={styles.notesList}>
                  {expandedNotes.length === 0 ? (
                    <Text style={[styles.emptyNotes, { color: theme.notes.text.muted }]}>Sin notas.</Text>
                  ) : (
                    expandedNotes.map((note, index) => (
                      <View
                        key={note.id}
                        style={[styles.noteRow, { borderTopColor: theme.notes.border.subtle }]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[styles.noteTitle, { color: theme.notes.text.primary }]}
                        >
                          {note.title}
                        </Text>
                        <Pressable
                          accessibilityLabel="Subir nota"
                          accessibilityRole="button"
                          disabled={index === 0}
                          onPress={() => void reorderNote(index, -1)}
                          style={styles.noteAction}
                        >
                          <Text style={[styles.noteActionText, { color: theme.notes.text.accent }]}>↑</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Bajar nota"
                          accessibilityRole="button"
                          disabled={index === expandedNotes.length - 1}
                          onPress={() => void reorderNote(index, 1)}
                          style={styles.noteAction}
                        >
                          <Text style={[styles.noteActionText, { color: theme.notes.text.accent }]}>↓</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`Quitar ${note.title}`}
                          accessibilityRole="button"
                          onPress={() => void removeNote(note.id)}
                          style={styles.noteAction}
                        >
                          <Text style={[styles.noteActionText, { color: theme.notes.text.muted }]}>×</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: NoteSpacing.lg,
    paddingBottom: NoteSpacing['2xl'],
  },
  createRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    marginBottom: NoteSpacing.lg,
  },
  input: {
    borderRadius: Radii.md,
    borderWidth: 1,
    flex: 1,
    fontSize: Typography.body.size,
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  confirmButton: {
    alignItems: 'center',
    borderRadius: Radii.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
  },
  confirmText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  collectionBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  collectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 68,
    paddingRight: NoteSpacing.xl,
  },
  collectionCopy: {
    flex: 1,
    gap: NoteSpacing.xs,
  },
  collectionName: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
  },
  count: {
    fontSize: Typography.caption.size,
  },
  chevron: {
    fontSize: 20,
    paddingHorizontal: NoteSpacing.sm,
  },
  deleteButton: {
    alignItems: 'center',
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 12,
  },
  deleteFallback: {
    fontSize: IconSize.sm,
  },
  notesList: {
    paddingBottom: NoteSpacing.sm,
    paddingLeft: NoteSpacing.md,
  },
  emptyNotes: {
    fontSize: Typography.caption.size,
    paddingBottom: NoteSpacing.md,
  },
  noteRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: NoteSpacing.xs,
    minHeight: 48,
    paddingVertical: NoteSpacing.xs,
  },
  noteTitle: {
    flex: 1,
    fontSize: Typography.body.size,
  },
  noteAction: {
    alignItems: 'center',
    minHeight: 36,
    minWidth: 32,
    justifyContent: 'center',
  },
  noteActionText: {
    fontSize: 22,
  },
  empty: {
    fontSize: Typography.body.size,
    paddingVertical: NoteSpacing.xl,
    textAlign: 'center',
  },
  backFallback: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 28,
  },
});
