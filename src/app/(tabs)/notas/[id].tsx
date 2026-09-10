import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import {
  addNoteToCollection,
  getNoteCollections,
  listNoteSections,
  removeNoteFromCollection,
} from '@/db/queries/collections';
import type { CollectionRow } from '@/db/queries/collections';
import { getById } from '@/db/queries/notes';
import type { Note } from '@/db/queries/notes';
import { IconSize, NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useCollectionsStore } from '@/stores/collections';
import { useNotesStore } from '@/stores/notes';

import { EmptyState } from '@/components/EmptyState';
import { MarkdownView } from '@/components/MarkdownView';
import { OrganizationSuggestions } from '@/components/OrganizationSuggestions';
import { RelatedNotesSection } from '@/components/RelatedNotesSection';
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
  const setNoteSection = useCollectionsStore((state) => state.setNoteSection);
  const createCollection = useCollectionsStore((state) => state.create);
  const collections = useCollectionsStore((state) => state.collections);
  const fetchCollections = useCollectionsStore((state) => state.fetchCollections);
  const [note, setNote] = useState<Note | null>(null);
  const [noteCollections, setNoteCollections] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [sectionModalVisible, setSectionModalVisible] = useState(false);
  const [sectionDraft, setSectionDraft] = useState('');
  const [sectionOptions, setSectionOptions] = useState<string[]>([]);
  const [collectionModalVisible, setCollectionModalVisible] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [savingSection, setSavingSection] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!Number.isFinite(noteId) || noteId <= 0) {
        setLoading(false);
        setNotFound(true);
        return () => {
          active = false;
        };
      }
      setLoading(true);
      setNotFound(false);
      Promise.all([getById(noteId), getNoteCollections(noteId)])
        .then(([fetched, fetchedCollections]) => {
          if (!active) return;
          setNote(fetched);
              setNoteCollections(fetchedCollections);
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
    }, [noteId])
  );

  const goToEdit = useCallback(() => {
    if (note == null) return;
    void haptic.tap.light();
    router.push(`/notas/${note.id}/edit`);
  }, [note, router]);

  const openGraph = useCallback(() => {
    if (note == null) return;
    void haptic.tap.light();
    router.push({ pathname: '/grafo' as never, params: { noteId: String(note.id) } });
  }, [note, router]);

  const handleRestore = useCallback(() => {
    if (note == null) return;
    void restoreNote(note.id).catch((error: unknown) => {
      console.error('[NoteDetail] restoreNote failed', error);
    });
  }, [note, restoreNote]);

  const openSectionEditor = useCallback(() => {
    if (note == null) return;
    setSectionDraft(note.section ?? '');
    setSectionModalVisible(true);
    void listNoteSections()
      .then(setSectionOptions)
      .catch(() => setSectionOptions([]));
  }, [note]);

      const saveSection = useCallback(async () => {
        if (note == null || savingSection) return;
        setSavingSection(true);
        try {
          await setNoteSection(note.id, sectionDraft.trim() || null);
          const refreshed = await getById(note.id);
          setNote(refreshed);
          setSectionModalVisible(false);
        } catch (error: unknown) {
          Alert.alert(
            'No se pudo guardar',
            error instanceof Error ? error.message : 'Inténtalo de nuevo.',
          );
        } finally {
          setSavingSection(false);
        }
      }, [note, savingSection, sectionDraft, setNoteSection]);

  const removeSection = useCallback(() => {
    if (note == null) return;
    Alert.alert('Quitar sección', 'La nota quedará suelta, sin sección.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: () => {
          setSectionDraft('');
          void setNoteSection(noteId, null)
            .then(() => getById(noteId))
            .then(setNote)
            .catch(() => {
              Alert.alert('No se pudo quitar', 'Inténtalo de nuevo.');
            });
        },
      },
    ]);
  }, [note, noteId, setNoteSection]);

      const openCollectionEditor = useCallback(() => {
        setCollectionModalVisible(true);
        void fetchCollections();
      }, [fetchCollections]);

      const addCollection = useCallback(
        async (collectionId: number) => {
          if (note == null) return;
          if (noteCollections.some((collection) => collection.id === collectionId)) {
            setCollectionModalVisible(false);
            return;
          }
          try {
            await addNoteToCollection(note.id, collectionId);
            setNoteCollections(await getNoteCollections(note.id));
            setCollectionModalVisible(false);
          } catch {
            Alert.alert('No se pudo añadir', 'Inténtalo de nuevo.');
          }
        },
        [note, noteCollections],
      );

  const removeCollection = useCallback(
    (collectionId: number, collectionName: string) => {
      if (note == null) return;
      Alert.alert(
        `Quitar de ${collectionName}`,
        'La nota seguirá existiendo, solo sale de la colección.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Quitar',
            style: 'destructive',
            onPress: () => {
              void removeNoteFromCollection(note.id, collectionId)
                .then(() => {
                  setNoteCollections((current) =>
                    current.filter((collection) => collection.id !== collectionId),
                  );
                })
                .catch(() => {
                  Alert.alert('No se pudo quitar', 'Inténtalo de nuevo.');
                });
            },
          },
        ],
      );
    },
    [note],
  );

  const createCollectionAndAdd = useCallback(async () => {
    if (note == null || creatingCollection) return;
    const trimmed = newCollectionName.trim();
    if (!trimmed) {
      Alert.alert('Falta el nombre', 'Escribe un nombre para la colección.');
      return;
    }
    setCreatingCollection(true);
    try {
      const id = await createCollection(trimmed);
      await addNoteToCollection(note.id, id);
      setNoteCollections(await getNoteCollections(note.id));
      setNewCollectionName('');
      setCollectionModalVisible(false);
      void haptic.notify.success();
    } catch {
      Alert.alert('No se pudo crear', 'Inténtalo de nuevo.');
    } finally {
      setCreatingCollection(false);
    }
  }, [createCollection, creatingCollection, newCollectionName, note]);

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
            <View
                  style={[
                    styles.organization,
                    { borderTopColor: theme.notes.border.subtle },
                  ]}
                >
                  <View style={styles.organizationRow}>
                    <Text style={[styles.organizationLabel, { color: theme.notes.text.secondary }]}>Sección</Text>
                    {note.section ? (
                      <TagPill name={note.section} variant="display" />
                    ) : (
                      <Text style={[styles.organizationEmpty, { color: theme.notes.text.muted }]}>Sin sección</Text>
                    )}
                    <Pressable onPress={openSectionEditor}>
                      <Text style={[styles.organizationAction, { color: theme.notes.text.accent }]}>Editar</Text>
                    </Pressable>
                    {note.section ? (
                      <Pressable onPress={removeSection}>
                        <Text style={[styles.organizationAction, { color: theme.notes.text.muted }]}>Quitar</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={styles.organizationRow}>
                    <Text style={[styles.organizationLabel, { color: theme.notes.text.secondary }]}>Colecciones</Text>
                    <View style={styles.collectionChips}>
                      {noteCollections.map((collection) => (
                        <View key={collection.id} style={styles.collectionChip}>
                          <Pressable
                            accessibilityLabel={`Abrir colección ${collection.name}`}
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={() => router.push(`/colecciones/${collection.id}`)}
                          >
                            <TagPill name={collection.name} variant="display" />
                          </Pressable>
                          <Pressable
                            accessibilityLabel={`Quitar de ${collection.name}`}
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={() => removeCollection(collection.id, collection.name)}
                            style={styles.collectionRemove}
                          >
                            <Text style={[styles.collectionRemoveText, { color: theme.notes.text.muted }]}>×</Text>
                          </Pressable>
                        </View>
                      ))}
                      <TagPill
                        name="Añadir"
                        variant="filter"
                        onPress={openCollectionEditor}
                      />
                    </View>
                  </View>
                </View>
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

            <OrganizationSuggestions
              note={note}
              onCollectionsUpdated={setNoteCollections}
              onNoteUpdated={setNote}
            />
            <Pressable
              accessibilityLabel="Abrir grafo de esta nota"
              accessibilityRole="button"
              onPress={openGraph}
              style={({ pressed }) => [
                styles.graphButton,
                {
                  borderColor: theme.notes.border.subtle,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="point.3.connected.trianglepath.dotted"
                  size={IconSize.sm}
                  tintColor={theme.notes.text.accent}
                />
              ) : null}
              <Text style={[styles.graphButtonText, { color: theme.notes.text.accent }]}>Ver grafo de conexiones</Text>
            </Pressable>
            <RelatedNotesSection noteId={note.id} />
          </ScrollView>
        <Modal
                animationType="fade"
                onRequestClose={() => setSectionModalVisible(false)}
                transparent
                visible={sectionModalVisible}
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
                    <Text style={[styles.modalTitle, { color: theme.notes.text.primary }]}>Sección</Text>
                    {sectionOptions.length > 0 ? (
                      <View style={styles.optionChips}>
                        {sectionOptions.map((option) => (
                          <TagPill
                            key={option}
                            name={option}
                            variant="filter"
                            selected={sectionDraft.trim() === option}
                            onPress={() => setSectionDraft(option)}
                          />
                        ))}
                      </View>
                    ) : null}
                    <TextInput
                      autoFocus
                      onChangeText={setSectionDraft}
                      onSubmitEditing={() => void saveSection()}
                      placeholder="Ej. Trabajo"
                      placeholderTextColor={theme.notes.text.muted}
                      selectionColor={theme.notes.accent.primary}
                      style={[
                        styles.input,
                        {
                          backgroundColor: theme.notes.bg.surface,
                          borderColor: theme.notes.border.subtle,
                          color: theme.notes.text.primary,
                        },
                      ]}
                      value={sectionDraft}
                    />
                    <View style={styles.modalActions}>
                      <Pressable onPress={() => setSectionModalVisible(false)}>
                        <Text style={[styles.modalAction, { color: theme.notes.text.muted }]}>Cancelar</Text>
                      </Pressable>
                      <Pressable disabled={savingSection} onPress={() => void saveSection()}>
                        <Text style={[styles.modalAction, { color: theme.notes.text.accent }]}>Guardar</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </Modal>
              <Modal
                animationType="fade"
                onRequestClose={() => setCollectionModalVisible(false)}
                transparent
                visible={collectionModalVisible}
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
                    <Text style={[styles.modalTitle, { color: theme.notes.text.primary }]}>Añadir a colección</Text>
                    {collections.length > 0 ? (
                      collections.map((collection) => {
                        const alreadyAdded = noteCollections.some((item) => item.id === collection.id);
                        return (
                          <Pressable
                            key={collection.id}
                            disabled={alreadyAdded}
                            onPress={() => void addCollection(collection.id)}
                            style={styles.collectionOption}
                          >
                            <Text
                              style={[
                                styles.collectionOptionText,
                                {
                                  color: alreadyAdded
                                    ? theme.notes.text.muted
                                    : theme.notes.text.primary,
                                },
                              ]}
                            >
                              {collection.name}{alreadyAdded ? ' · añadida' : ''}
                            </Text>
                          </Pressable>
                        );
                      })
                    ) : (
                      <Text style={[styles.organizationEmpty, { color: theme.notes.text.muted }]}>No hay colecciones todavía.</Text>
                    )}
                        <TextInput
                          onChangeText={setNewCollectionName}
                          onSubmitEditing={() => void createCollectionAndAdd()}
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
                          value={newCollectionName}
                        />
                        <View style={styles.modalActions}>
                          <Pressable
                            accessibilityLabel="Crear colección y añadir nota"
                            accessibilityRole="button"
                            disabled={creatingCollection || !newCollectionName.trim()}
                            hitSlop={8}
                            onPress={() => void createCollectionAndAdd()}
                          >
                            <Text
                              style={[
                                styles.modalAction,
                                {
                                  color:
                                    creatingCollection || !newCollectionName.trim()
                                      ? theme.notes.text.muted
                                      : theme.notes.text.accent,
                                },
                              ]}
                            >
                              Crear y añadir
                            </Text>
                          </Pressable>
                          <Pressable onPress={() => setCollectionModalVisible(false)}>
                            <Text style={[styles.modalAction, { color: theme.notes.text.muted }]}>Cerrar</Text>
                          </Pressable>
                        </View>
                  </View>
                </View>
              </Modal>
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
  organization: {
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: NoteSpacing.sm,
      marginTop: NoteSpacing.lg,
      paddingTop: NoteSpacing.md,
    },
    organizationRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: NoteSpacing.sm,
    },
    organizationLabel: {
      fontSize: Typography.caption.size,
      fontWeight: '600',
      minWidth: 88,
    },
    organizationEmpty: {
      fontSize: Typography.caption.size,
    },
    organizationAction: {
      fontSize: Typography.caption.size,
      fontWeight: '600',
    },
    collectionChip: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    collectionRemove: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 28,
      minWidth: 24,
    },
    collectionRemoveText: {
      fontSize: 18,
    },
    optionChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: NoteSpacing.xs,
    },
    collectionChips: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: NoteSpacing.xs,
    },
    modalOverlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
      flex: 1,
      justifyContent: 'center',
      padding: NoteSpacing.lg,
    },
    modalPanel: {
      borderRadius: 12,
      borderWidth: 1,
      gap: NoteSpacing.md,
      maxWidth: 480,
      padding: NoteSpacing.lg,
      width: '100%',
    },
    modalTitle: {
      fontSize: Typography.subtitle.size,
      fontWeight: Typography.subtitle.weight,
    },
    input: {
      borderRadius: 8,
      borderWidth: 1,
      fontSize: Typography.body.size,
      minHeight: 44,
      paddingHorizontal: NoteSpacing.md,
      paddingVertical: NoteSpacing.sm,
    },
    modalActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: NoteSpacing.lg,
      justifyContent: 'flex-end',
    },
    modalAction: {
      fontSize: Typography.body.size,
      fontWeight: '600',
    },
    collectionOption: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingVertical: NoteSpacing.sm,
    },
    collectionOptionText: {
      fontSize: Typography.body.size,
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
  graphButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    justifyContent: 'center',
    marginTop: NoteSpacing.lg,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  graphButtonText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  headerAction: {
    fontSize: Typography.body.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.body.lineHeight,
    paddingHorizontal: NoteSpacing.xs,
  },
});