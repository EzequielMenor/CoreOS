import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  addNoteToCollection,
  getCollection,
  listCollectionNotes,
  listNotesNotInCollection,
  removeNoteFromCollection,
} from '@/db/queries/collections';
import type { CollectionRow } from '@/db/queries/collections';
import { IconSize, NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useCollectionsStore } from '@/stores/collections';

interface CollectionNote {
  note_id: number;
  position: number | null;
  created_at: number;
  title: string;
}

interface SearchNote {
  id: number;
  title: string;
}

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const collectionId = Number(id);
  const setOrder = useCollectionsStore((state) => state.setOrder);
  const [collection, setCollection] = useState<CollectionRow | null>(null);
  const [notes, setNotes] = useState<CollectionNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchNote[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const fetchData = useCallback(async () => {
    const [nextCollection, nextNotes] = await Promise.all([
      getCollection(collectionId),
      listCollectionNotes(collectionId),
    ]);
    return { collection: nextCollection, notes: nextNotes };
  }, [collectionId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!Number.isInteger(collectionId) || collectionId <= 0) {
        setLoading(false);
        setNotFound(true);
        return () => {
          active = false;
        };
      }
      setLoading(true);
      setNotFound(false);
      void fetchData()
        .then((result) => {
          if (!active) return;
          setCollection(result.collection);
          setNotes(result.notes);
          setNotFound(result.collection == null);
        })
        .catch((error: unknown) => {
          console.error('[CollectionDetail] load failed', error);
          if (!active) return;
          setNotFound(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [collectionId, fetchData]),
  );

  const refreshSearch = useCallback(
    async (query: string) => {
      if (!Number.isInteger(collectionId) || collectionId <= 0) return;
      setSearchLoading(true);
      try {
        setSearchResults(await listNotesNotInCollection(collectionId, query));
      } catch (error: unknown) {
        console.error('[CollectionDetail] search failed', error);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [collectionId],
  );

  const openSearch = useCallback(() => {
    setSearchText('');
    setSearchModalVisible(true);
    void refreshSearch('');
  }, [refreshSearch]);

  const addNote = useCallback(
    async (noteId: number) => {
      try {
        await addNoteToCollection(noteId, collectionId);
        const result = await fetchData();
        setCollection(result.collection);
        setNotes(result.notes);
        await refreshSearch(searchText);
        void haptic.notify.success();
      } catch {
        Alert.alert('No se pudo añadir', 'Inténtalo de nuevo.');
      }
    },
    [collectionId, fetchData, refreshSearch, searchText],
  );

  const reorderNote = useCallback(
    async (index: number, direction: -1 | 1) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= notes.length) return;
      const next = [...notes];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      try {
        await setOrder(
          collectionId,
          next.map((note) => note.note_id),
        );
        setNotes(next);
      } catch {
        Alert.alert('No se pudo ordenar', 'Inténtalo de nuevo.');
      }
    },
    [collectionId, notes, setOrder],
  );

  const removeNote = useCallback(
    async (noteId: number) => {
      try {
        void haptic.tap.light();
        await removeNoteFromCollection(noteId, collectionId);
        const result = await fetchData();
        setCollection(result.collection);
        setNotes(result.notes);
      } catch {
        Alert.alert('No se pudo quitar', 'Inténtalo de nuevo.');
      }
    },
    [collectionId, fetchData],
  );

  const screenOptions = {
    title: collection?.name ?? 'Colección',
    headerBackTitle: 'Colecciones',
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.notes.bg.base }]}>
        <Stack.Screen options={screenOptions} />
        <ActivityIndicator color={theme.notes.text.accent} />
      </SafeAreaView>
    );
  }

  if (notFound || collection == null) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.notes.bg.base }]}>
        <Stack.Screen options={screenOptions} />
        <Text style={[styles.emptyTitle, { color: theme.notes.text.primary }]}>Colección no encontrada</Text>
        <Pressable
          accessibilityLabel="Volver a colecciones"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: theme.notes.accent.primary }]}
        >
          <Text style={styles.backButtonText}>Volver</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.flex, { backgroundColor: theme.notes.bg.base }]}
    >
      <Stack.Screen options={screenOptions} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: theme.notes.text.primary }]}>{collection.name}</Text>
        {collection.description !== null ? (
          <Text style={[styles.description, { color: theme.notes.text.secondary }]}>
            {collection.description}
          </Text>
        ) : null}
        <Text style={[styles.count, { color: theme.notes.text.muted }]}>
          {notes.length} {notes.length === 1 ? 'nota' : 'notas'}
        </Text>
        <View style={styles.topActions}>
          <Pressable
            accessibilityLabel="Crear nueva nota en esta colección"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() =>
              router.push({ pathname: '/notas/new', params: { collectionId: String(collectionId) } })
            }
            style={[styles.primaryAction, { backgroundColor: theme.notes.accent.primary }]}
          >
            <Text style={styles.primaryActionText}>Nueva nota</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Añadir nota a la colección"
            accessibilityRole="button"
            hitSlop={8}
            onPress={openSearch}
            style={[styles.secondaryAction, { borderColor: theme.notes.border.subtle }]}
          >
            <Text style={[styles.secondaryActionText, { color: theme.notes.text.accent }]}>Añadir nota</Text>
          </Pressable>
        </View>

        <View style={styles.notesList}>
          {notes.length === 0 ? (
            <Text style={[styles.emptyNotes, { color: theme.notes.text.muted }]}>Sin notas todavía.</Text>
          ) : (
            notes.map((note, index) => (
              <View
                key={note.note_id}
                style={[styles.noteRow, { borderTopColor: theme.notes.border.subtle }]}
              >
                <Text style={[styles.position, { color: theme.notes.text.muted }]}>{index + 1}</Text>
                <Pressable
                  accessibilityLabel={`Abrir ${note.title.trim() || 'Sin título'}`}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => router.push(`/notas/${note.note_id}`)}
                  style={styles.noteLink}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.noteTitle, { color: theme.notes.text.primary }]}
                  >
                    {note.title.trim() || 'Sin título'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Subir ${note.title.trim() || 'Sin título'}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: index === 0 }}
                  disabled={index === 0}
                  hitSlop={8}
                  onPress={() => void reorderNote(index, -1)}
                  style={[styles.noteAction, { opacity: index === 0 ? 0.35 : 1 }]}
                >
                  <Text style={[styles.noteActionText, { color: theme.notes.text.accent }]}>↑</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Bajar ${note.title.trim() || 'Sin título'}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: index === notes.length - 1 }}
                  disabled={index === notes.length - 1}
                  hitSlop={8}
                  onPress={() => void reorderNote(index, 1)}
                  style={[styles.noteAction, { opacity: index === notes.length - 1 ? 0.35 : 1 }]}
                >
                  <Text style={[styles.noteActionText, { color: theme.notes.text.accent }]}>↓</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Quitar ${note.title.trim() || 'Sin título'} de la colección`}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => void removeNote(note.note_id)}
                  style={styles.noteAction}
                >
                  <Text style={[styles.noteActionText, { color: theme.notes.text.muted }]}>×</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setSearchModalVisible(false)}
        transparent
        visible={searchModalVisible}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalPanel,
              {
                backgroundColor: theme.notes.bg.elevated,
                borderColor: theme.notes.border.subtle,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.notes.text.primary }]}>Añadir nota</Text>
            <TextInput
              autoFocus
              onChangeText={(text) => {
                setSearchText(text);
                void refreshSearch(text);
              }}
              placeholder="Buscar notas por título…"
              placeholderTextColor={theme.notes.text.muted}
              selectionColor={theme.notes.accent.primary}
              style={[
                styles.searchInput,
                {
                  backgroundColor: theme.notes.bg.surface,
                  borderColor: theme.notes.border.subtle,
                  color: theme.notes.text.primary,
                },
              ]}
              value={searchText}
            />
            {searchLoading ? (
              <ActivityIndicator color={theme.notes.text.accent} />
            ) : searchResults.length > 0 ? (
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.searchResults}>
                {searchResults.map((note) => (
                  <View key={note.id} style={styles.searchResult}>
                    <Text
                      numberOfLines={2}
                      style={[styles.searchResultTitle, { color: theme.notes.text.primary }]}
                    >
                      {note.title.trim() || 'Sin título'}
                    </Text>
                    <Pressable
                      accessibilityLabel={`Añadir ${note.title.trim() || 'Sin título'}`}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => void addNote(note.id)}
                      style={styles.addButton}
                    >
                      <Text style={[styles.addButtonText, { color: theme.notes.text.accent }]}>＋</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={[styles.emptySearch, { color: theme.notes.text.muted }]}>No hay notas para añadir.</Text>
            )}
            <Pressable
              accessibilityLabel="Cerrar búsqueda"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setSearchModalVisible(false)}
              style={styles.closeButton}
            >
              <Text style={[styles.modalAction, { color: theme.notes.text.muted }]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    padding: NoteSpacing.lg,
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
  description: {
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    marginTop: NoteSpacing.sm,
  },
  count: {
    fontSize: Typography.caption.size,
    marginTop: NoteSpacing.sm,
  },
  topActions: {
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    marginTop: NoteSpacing.lg,
  },
  primaryAction: {
    alignItems: 'center',
    borderRadius: Radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  secondaryAction: {
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
  },
  secondaryActionText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  notesList: {
    marginTop: NoteSpacing.lg,
  },
  emptyNotes: {
    fontSize: Typography.body.size,
    paddingVertical: NoteSpacing.xl,
    textAlign: 'center',
  },
  noteRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: NoteSpacing.xs,
    minHeight: 52,
  },
  position: {
    fontSize: Typography.caption.size,
    minWidth: 24,
    textAlign: 'center',
  },
  noteLink: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  noteTitle: {
    fontSize: Typography.body.size,
  },
  noteAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 32,
  },
  noteActionText: {
    fontSize: 22,
  },
  emptyTitle: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
    marginBottom: NoteSpacing.md,
    textAlign: 'center',
  },
  backButton: {
    alignItems: 'center',
    borderRadius: Radii.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: NoteSpacing.lg,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: Typography.body.size,
    fontWeight: '600',
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: NoteSpacing.lg,
  },
  modalPanel: {
    borderRadius: Radii.md,
    borderWidth: 1,
    gap: NoteSpacing.md,
    maxHeight: '80%',
    maxWidth: 480,
    padding: NoteSpacing.lg,
    width: '100%',
  },
  modalTitle: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
  },
  searchInput: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    fontSize: Typography.body.size,
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  searchResults: {
    flexGrow: 0,
  },
  searchResult: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 48,
  },
  searchResultTitle: {
    flex: 1,
    fontSize: Typography.body.size,
    paddingVertical: NoteSpacing.sm,
  },
  addButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 40,
  },
  addButtonText: {
    fontSize: IconSize.md,
    fontWeight: '600',
  },
  emptySearch: {
    fontSize: Typography.caption.size,
    paddingVertical: NoteSpacing.md,
    textAlign: 'center',
  },
  closeButton: {
    alignSelf: 'flex-end',
    minHeight: 36,
    justifyContent: 'center',
  },
  modalAction: {
    fontSize: Typography.body.size,
    fontWeight: '600',
  },
});
