import { useCallback, useState } from 'react';
import {
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
import { useFocusEffect, useRouter } from 'expo-router';
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

interface CollectionModalProps {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string | null;
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<void>;
}

function CollectionModal({
  title,
  submitLabel,
  initialName = '',
  initialDescription = null,
  visible,
  onClose,
  onSubmit,
}: CollectionModalProps) {
  const theme = useTheme();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(name, description);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
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
          <Text style={[styles.modalTitle, { color: theme.notes.text.primary }]}>{title}</Text>
          <TextInput
            autoFocus
            onChangeText={setName}
            onSubmitEditing={() => void handleSubmit()}
            placeholder="Nombre de la colección"
            placeholderTextColor={theme.notes.text.muted}
            returnKeyType="done"
            selectionColor={theme.notes.accent.primary}
            style={[
              styles.modalInput,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
                color: theme.notes.text.primary,
              },
            ]}
            value={name}
          />
          <TextInput
            multiline
            onChangeText={setDescription}
            placeholder="Descripción (opcional)"
            placeholderTextColor={theme.notes.text.muted}
            selectionColor={theme.notes.accent.primary}
            style={[
              styles.descriptionInput,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
                color: theme.notes.text.primary,
              },
            ]}
            value={description}
          />
          <View style={styles.modalActions}>
            <Pressable
              accessibilityLabel="Cancelar"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
            >
              <Text style={[styles.modalAction, { color: theme.notes.text.muted }]}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={submitLabel}
              accessibilityRole="button"
              disabled={!name.trim() || saving}
              hitSlop={8}
              onPress={() => void handleSubmit()}
            >
              <Text
                style={[
                  styles.modalAction,
                  {
                    color: name.trim() && !saving
                      ? theme.notes.text.accent
                      : theme.notes.text.muted,
                  },
                ]}
              >
                {submitLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function CollectionsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const collections = useCollectionsStore((state) => state.collections);
  const loading = useCollectionsStore((state) => state.loading);
  const fetchCollections = useCollectionsStore((state) => state.fetchCollections);
  const createCollection = useCollectionsStore((state) => state.create);
  const updateCollection = useCollectionsStore((state) => state.update);
  const removeCollection = useCollectionsStore((state) => state.remove);
  const setOrder = useCollectionsStore((state) => state.setOrder);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editingCollection, setEditingCollection] = useState<CollectionWithCount | null>(null);
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

  const handleCreate = useCallback(
    async (collectionName: string, description: string) => {
      try {
        await createCollection(collectionName, description);
        setCreateModalVisible(false);
        void haptic.notify.success();
      } catch (error: unknown) {
        Alert.alert(
          'No se pudo crear',
          error instanceof Error ? error.message : 'Inténtalo de nuevo.',
        );
      }
    },
    [createCollection],
  );

  const handleUpdate = useCallback(
    async (collectionName: string, description: string) => {
      if (editingCollection == null) return;
      try {
        await updateCollection(editingCollection.id, collectionName, description);
        setEditingCollection(null);
        void haptic.notify.success();
      } catch (error: unknown) {
        Alert.alert(
          'No se pudo guardar',
          error instanceof Error ? error.message : 'Inténtalo de nuevo.',
        );
      }
    },
    [editingCollection, updateCollection],
  );

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
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityLabel="Nueva colección"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setCreateModalVisible(true)}
          style={[styles.createButton, { backgroundColor: theme.notes.accent.primary }]}
        >
          <Text style={styles.createButtonText}>+ Nueva colección</Text>
        </Pressable>

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
              <View style={styles.collectionRow}>
                <Pressable
                  accessibilityLabel={`Abrir colección ${collection.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  hitSlop={8}
                  onLongPress={() => confirmDelete(collection)}
                  onPress={() => router.push(`/colecciones/${collection.id}`)}
                  style={styles.collectionMain}
                >
                  <View style={styles.collectionCopy}>
                    <Text style={[styles.collectionName, { color: theme.notes.text.primary }]}>
                      {collection.name}
                    </Text>
                    <Text style={[styles.count, { color: theme.notes.text.muted }]}>
                      {collection.note_count} {collection.note_count === 1 ? 'nota' : 'notas'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={`${expanded ? 'Contraer' : 'Expandir'} colección ${collection.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  hitSlop={8}
                  onPress={() => toggleCollection(collection.id)}
                  style={styles.chevronButton}
                >
                  <Text style={[styles.chevron, { color: theme.notes.text.muted }]}>
                    {expanded ? '⌃' : '⌄'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Editar colección ${collection.name}`}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setEditingCollection(collection)}
                  style={styles.rowAction}
                >
                  {Platform.OS === 'ios' ? (
                    <SymbolView
                      name="pencil"
                      size={IconSize.sm}
                      tintColor={theme.notes.text.muted}
                    />
                  ) : (
                    <Text style={[styles.editFallback, { color: theme.notes.text.muted }]}>✎</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityLabel={`Eliminar colección ${collection.name}`}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => confirmDelete(collection)}
                  style={styles.rowAction}
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
              </View>
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
                          hitSlop={8}
                          onPress={() => void reorderNote(index, -1)}
                          style={styles.noteAction}
                        >
                          <Text style={[styles.noteActionText, { color: theme.notes.text.accent }]}>↑</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Bajar nota"
                          accessibilityRole="button"
                          disabled={index === expandedNotes.length - 1}
                          hitSlop={8}
                          onPress={() => void reorderNote(index, 1)}
                          style={styles.noteAction}
                        >
                          <Text style={[styles.noteActionText, { color: theme.notes.text.accent }]}>↓</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`Quitar ${note.title}`}
                          accessibilityRole="button"
                          hitSlop={8}
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
      {createModalVisible ? (
        <CollectionModal
          onClose={() => setCreateModalVisible(false)}
          onSubmit={handleCreate}
          submitLabel="Crear"
          title="Nueva colección"
          visible
        />
      ) : null}
      {editingCollection ? (
        <CollectionModal
          initialDescription={editingCollection.description}
          initialName={editingCollection.name}
          onClose={() => setEditingCollection(null)}
          onSubmit={handleUpdate}
          submitLabel="Guardar"
          title="Editar colección"
          visible
        />
      ) : null}
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
  createButton: {
    alignItems: 'center',
    borderRadius: Radii.md,
    justifyContent: 'center',
    marginBottom: NoteSpacing.lg,
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: Typography.body.size,
    fontWeight: '600',
  },
  collectionBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  collectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 68,
  },
  collectionMain: {
    flex: 1,
    minHeight: 68,
    justifyContent: 'center',
  },
  collectionCopy: {
    gap: NoteSpacing.xs,
  },
  collectionName: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
  },
  count: {
    fontSize: Typography.caption.size,
  },
  chevronButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 36,
  },
  chevron: {
    fontSize: 20,
  },
  rowAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 36,
  },
  editFallback: {
    fontSize: 20,
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
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 32,
  },
  noteActionText: {
    fontSize: 22,
  },
  empty: {
    fontSize: Typography.body.size,
    paddingVertical: NoteSpacing.xl,
    textAlign: 'center',
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
    maxWidth: 480,
    padding: NoteSpacing.lg,
    width: '100%',
  },
  modalTitle: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
  },
  modalInput: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    fontSize: Typography.body.size,
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  descriptionInput: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    fontSize: Typography.body.size,
    minHeight: 88,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
    textAlignVertical: 'top',
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
});
