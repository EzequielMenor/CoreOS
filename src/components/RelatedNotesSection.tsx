import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { NoteSpacing, Radii, Typography } from '@/constants/theme';
import { listRecentNotes, searchNotesWithScore } from '@/db/queries/notes';
import type { Note } from '@/db/queries/notes';
import type { RelatedNoteItem } from '@/db/queries/note-relations';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useNoteRelationsStore } from '@/stores/note-relations';
import { TagPill } from '@/components/TagPill';

export interface RelatedNotesSectionProps {
  noteId: number;
}

export function RelatedNotesSection({ noteId }: RelatedNotesSectionProps) {
  const router = useRouter();
  const theme = useTheme();

  const relations = useNoteRelationsStore((state) => state.relationsByNoteId[noteId] ?? []);
  const loading = useNoteRelationsStore((state) => state.loadingByNoteId[noteId] ?? false);
  const suggesting = useNoteRelationsStore((state) => state.suggestingByNoteId[noteId] ?? false);

  const fetchRelations = useNoteRelationsStore((state) => state.fetchRelations);
  const generateSuggestions = useNoteRelationsStore((state) => state.generateSuggestions);
  const confirmRelation = useNoteRelationsStore((state) => state.confirm);
  const rejectRelation = useNoteRelationsStore((state) => state.reject);
  const removeRelation = useNoteRelationsStore((state) => state.remove);
  const addManual = useNoteRelationsStore((state) => state.addManual);

  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [candidatesList, setCandidatesList] = useState<Note[]>([]);
  const [searchingCandidates, setSearchingCandidates] = useState(false);

  useEffect(() => {
    void fetchRelations(noteId);
  }, [noteId, fetchRelations]);

  const confirmedRelations = useMemo(
    () => relations.filter((r) => r.status === 'confirmed'),
    [relations],
  );

  const suggestedRelations = useMemo(
    () => relations.filter((r) => r.status === 'suggested'),
    [relations],
  );

  const handleOpenNote = useCallback(
    (targetId: number) => {
      void haptic.tap.light();
      router.push(`/notas/${targetId}`);
    },
    [router],
  );

  const handleSuggest = useCallback(async () => {
    void haptic.tap.light();
    await generateSuggestions(noteId);
  }, [generateSuggestions, noteId]);

  const handleConfirm = useCallback(
    async (relation: RelatedNoteItem) => {
      void haptic.notify.success();
      try {
        await confirmRelation(noteId, relation.relationId);
      } catch {
        Alert.alert('Error', 'No se pudo aceptar la relación');
      }
    },
    [confirmRelation, noteId],
  );

  const handleReject = useCallback(
    async (relation: RelatedNoteItem) => {
      void haptic.tap.light();
      try {
        await rejectRelation(noteId, relation.relationId);
      } catch {
        Alert.alert('Error', 'No se pudo rechazar la sugerencia');
      }
    },
    [noteId, rejectRelation],
  );

  const handleRemove = useCallback(
    (relation: RelatedNoteItem) => {
      void haptic.tap.light();
      Alert.alert(
        'Eliminar relación',
        `¿Deseas desvincular la nota "${relation.title || 'Sin título'}"?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: () => {
              void removeRelation(noteId, relation.relationId);
            },
          },
        ],
      );
    },
    [noteId, removeRelation],
  );

  // Carga de notas para el modal manual
  const openManualModal = useCallback(async () => {
    setSearchQuery('');
    setSearchingCandidates(true);
    setModalVisible(true);
    try {
      const recent = await listRecentNotes(25, noteId);
      const linkedIds = new Set(relations.map((r) => r.noteId));
      setCandidatesList(recent.filter((n) => !linkedIds.has(n.id)));
    } catch {
      setCandidatesList([]);
    } finally {
      setSearchingCandidates(false);
    }
  }, [noteId, relations]);

  const handleSearchChange = useCallback(
    async (text: string) => {
      setSearchQuery(text);
      const trimmed = text.trim();
      setSearchingCandidates(true);
      try {
        const linkedIds = new Set(relations.map((r) => r.noteId));
        if (!trimmed) {
          const recent = await listRecentNotes(25, noteId);
          setCandidatesList(recent.filter((n) => !linkedIds.has(n.id)));
        } else {
          const hits = await searchNotesWithScore(trimmed);
          setCandidatesList(
            hits.map((h) => h.note).filter((n) => n.id !== noteId && !linkedIds.has(n.id)),
          );
        }
      } catch {
        setCandidatesList([]);
      } finally {
        setSearchingCandidates(false);
      }
    },
    [noteId, relations],
  );

  const handleSelectManualNote = useCallback(
    async (targetNote: Note) => {
      void haptic.tap.medium();
      try {
        await addManual(noteId, targetNote.id);
        setModalVisible(false);
      } catch {
        Alert.alert('Error', 'No se pudo añadir la relación');
      }
    },
    [addManual, noteId],
  );

  return (
    <View style={[styles.container, { borderTopColor: theme.notes.border.subtle }]}>
      <View style={styles.header}>
        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: theme.notes.text.primary }]}>
            Relacionadas
          </Text>
          {confirmedRelations.length > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle },
              ]}
            >
              <Text style={[styles.badgeText, { color: theme.notes.text.secondary }]}>
                {confirmedRelations.length}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Buscar sugerencias automáticas"
            accessibilityRole="button"
            disabled={suggesting}
            hitSlop={8}
            onPress={() => void handleSuggest()}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          >
            {suggesting ? (
              <ActivityIndicator color={theme.notes.text.accent} size="small" />
            ) : (
              <>
                {Platform.OS === 'ios' ? (
                  <SymbolView
                    name="sparkles"
                    size={14}
                    tintColor={theme.notes.text.accent}
                  />
                ) : null}
                <Text style={[styles.actionButtonText, { color: theme.notes.text.accent }]}>
                  Sugerir
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            accessibilityLabel="Añadir relación manual"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => void openManualModal()}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          >
            {Platform.OS === 'ios' ? (
              <SymbolView
                name="link.badge.plus"
                size={14}
                tintColor={theme.notes.text.accent}
              />
            ) : null}
            <Text style={[styles.actionButtonText, { color: theme.notes.text.accent }]}>
              Añadir
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Sugerencias pendientes */}
      {suggestedRelations.length > 0 ? (
        <View style={styles.suggestedBlock}>
          <Text style={[styles.sectionSubtitle, { color: theme.notes.text.secondary }]}>
            Sugerencias detectadas
          </Text>
          {suggestedRelations.map((item) => (
            <View
              key={item.relationId}
              style={[
                styles.suggestionCard,
                {
                  backgroundColor: theme.notes.bg.surface,
                  borderColor: theme.notes.border.subtle,
                },
              ]}
            >
              <View style={styles.suggestionTop}>
                <Pressable
                  onPress={() => handleOpenNote(item.noteId)}
                  style={styles.suggestionTitleGroup}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.relationTitle, { color: theme.notes.text.primary }]}
                  >
                    {item.title.trim() || 'Sin título'}
                  </Text>
                  <Text
                    style={[
                      styles.originPill,
                      {
                        backgroundColor:
                          item.origin === 'ai'
                            ? theme.notes.accent.primary + '22'
                            : theme.notes.bg.elevated,
                        color:
                          item.origin === 'ai'
                            ? theme.notes.accent.primary
                            : theme.notes.text.muted,
                      },
                    ]}
                  >
                    {item.origin === 'ai' ? 'IA' : 'Semántica'}
                  </Text>
                </Pressable>
              </View>

              {item.reason ? (
                <Text
                  numberOfLines={2}
                  style={[styles.reasonText, { color: theme.notes.text.muted }]}
                >
                  {item.reason}
                </Text>
              ) : null}

              {item.tags.length > 0 ? (
                <View style={styles.tagsRow}>
                  {item.tags.map((t) => (
                    <TagPill key={t} name={t} variant="display" />
                  ))}
                </View>
              ) : null}

              <View style={styles.suggestionActions}>
                <Pressable
                  accessibilityLabel="Descartar sugerencia"
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => void handleReject(item)}
                  style={[styles.btnReject, { borderColor: theme.notes.border.subtle }]}
                >
                  <Text style={[styles.btnActionText, { color: theme.notes.text.muted }]}>
                    ✕ Descartar
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Aceptar sugerencia"
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => void handleConfirm(item)}
                  style={[styles.btnAccept, { backgroundColor: theme.notes.accent.primary }]}
                >
                  <Text style={[styles.btnActionText, { color: '#ffffff' }]}>
                    ✓ Conectar
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Relaciones confirmadas */}
      {confirmedRelations.length > 0 ? (
        <View style={styles.relationsList}>
          {confirmedRelations.map((item) => (
            <View
              key={item.relationId}
              style={[
                styles.confirmedCard,
                {
                  backgroundColor: theme.notes.bg.surface,
                  borderColor: theme.notes.border.subtle,
                },
              ]}
            >
              <Pressable
                onPress={() => handleOpenNote(item.noteId)}
                style={styles.confirmedContent}
              >
                <View style={styles.confirmedHeader}>
                  <Text
                    numberOfLines={1}
                    style={[styles.relationTitle, { color: theme.notes.text.primary }]}
                  >
                    {item.title.trim() || 'Sin título'}
                  </Text>
                  <Text
                    style={[
                      styles.originPill,
                      {
                        backgroundColor:
                          item.origin === 'manual'
                            ? theme.notes.bg.elevated
                            : theme.notes.accent.primary + '22',
                        color:
                          item.origin === 'manual'
                            ? theme.notes.text.muted
                            : theme.notes.accent.primary,
                      },
                    ]}
                  >
                    {item.origin === 'manual' ? 'Manual' : item.origin === 'ai' ? 'IA' : 'Semántica'}
                  </Text>
                </View>

                {item.reason ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.reasonText, { color: theme.notes.text.muted }]}
                  >
                    {item.reason}
                  </Text>
                ) : null}

                {item.tags.length > 0 ? (
                  <View style={styles.tagsRow}>
                    {item.tags.map((t) => (
                      <TagPill key={t} name={t} variant="display" />
                    ))}
                  </View>
                ) : null}
              </Pressable>

              <Pressable
                accessibilityLabel="Eliminar relación"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => handleRemove(item)}
                style={styles.removeBtn}
              >
                <Text style={[styles.removeIcon, { color: theme.notes.text.muted }]}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Estado vacío discreto */}
      {confirmedRelations.length === 0 && suggestedRelations.length === 0 ? (
        <View style={styles.emptyContainer}>
          {loading ? (
            <ActivityIndicator color={theme.notes.text.muted} size="small" />
          ) : (
            <Text style={[styles.emptyText, { color: theme.notes.text.muted }]}>
              Sin conexiones. Pulsa Añadir para enlazar o Sugerir para detectar relaciones.
            </Text>
          )}
        </View>
      ) : null}

      {/* Modal para vincular nota manualmente */}
      <Modal
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
        transparent
        visible={modalVisible}
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
            <Text style={[styles.modalTitle, { color: theme.notes.text.primary }]}>
              Vincular nota relacionada
            </Text>

            <TextInput
              autoFocus
              onChangeText={(t) => void handleSearchChange(t)}
              placeholder="Buscar por título o contenido..."
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
              value={searchQuery}
            />

            {searchingCandidates ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator color={theme.notes.text.accent} />
              </View>
            ) : (
              <View style={styles.candidatesList}>
                {candidatesList.length > 0 ? (
                  candidatesList.slice(0, 8).map((candidate) => (
                    <Pressable
                      key={candidate.id}
                      onPress={() => void handleSelectManualNote(candidate)}
                      style={({ pressed }) => [
                        styles.candidateRow,
                        { borderBottomColor: theme.notes.border.subtle },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.candidateTextGroup}>
                        <Text
                          numberOfLines={1}
                          style={[styles.candidateTitle, { color: theme.notes.text.primary }]}
                        >
                          {candidate.title.trim() || 'Sin título'}
                        </Text>
                        {candidate.tags.length > 0 ? (
                          <Text
                            numberOfLines={1}
                            style={[styles.candidateTags, { color: theme.notes.text.muted }]}
                          >
                            {candidate.tags.map((t) => `#${t}`).join(' ')}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.candidateAddText, { color: theme.notes.text.accent }]}>
                        + Vincular
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={[styles.emptyModalText, { color: theme.notes.text.muted }]}>
                    No hay otras notas disponibles.
                  </Text>
                )}
              </View>
            )}

            <View style={styles.modalActions}>
              <Pressable onPress={() => setModalVisible(false)}>
                <Text style={[styles.modalCloseText, { color: theme.notes.text.muted }]}>
                  Cerrar
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: NoteSpacing.sm,
    marginTop: NoteSpacing.lg,
    paddingTop: NoteSpacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.xs,
  },
  headerTitle: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
  },
  badge: {
    borderRadius: Radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: Typography.caption.size - 2,
    fontWeight: '600',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
  },
  actionButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: NoteSpacing.xs,
    paddingVertical: NoteSpacing.xs,
  },
  actionButtonText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
  suggestedBlock: {
    gap: NoteSpacing.xs,
    marginTop: NoteSpacing.xs,
  },
  sectionSubtitle: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  suggestionCard: {
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: NoteSpacing.xs,
    padding: NoteSpacing.sm,
  },
  suggestionTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  suggestionTitleGroup: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: NoteSpacing.xs,
  },
  relationTitle: {
    flexShrink: 1,
    fontSize: Typography.body.size,
    fontWeight: '600',
  },
  originPill: {
    borderRadius: Radii.full,
    fontSize: Typography.caption.size - 2,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    textTransform: 'uppercase',
  },
  reasonText: {
    fontSize: Typography.caption.size,
    fontStyle: 'italic',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  suggestionActions: {
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    justifyContent: 'flex-end',
    marginTop: NoteSpacing.xs,
  },
  btnReject: {
    borderRadius: Radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: NoteSpacing.sm,
    paddingVertical: 5,
  },
  btnAccept: {
    borderRadius: Radii.sm,
    paddingHorizontal: NoteSpacing.sm,
    paddingVertical: 5,
  },
  btnActionText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  relationsList: {
    gap: NoteSpacing.xs,
  },
  confirmedCard: {
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: NoteSpacing.sm,
  },
  confirmedContent: {
    flex: 1,
    gap: 2,
  },
  confirmedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.xs,
  },
  removeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: NoteSpacing.xs,
    paddingVertical: NoteSpacing.xs,
  },
  removeIcon: {
    fontSize: 20,
    fontWeight: '300',
    lineHeight: 20,
  },
  emptyContainer: {
    paddingVertical: NoteSpacing.xs,
  },
  emptyText: {
    fontSize: Typography.caption.size,
    fontStyle: 'italic',
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: NoteSpacing.lg,
  },
  modalPanel: {
    borderRadius: Radii.lg,
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
  modalLoading: {
    alignItems: 'center',
    paddingVertical: NoteSpacing.lg,
  },
  candidatesList: {
    maxHeight: 280,
  },
  candidateRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: NoteSpacing.sm,
  },
  candidateTextGroup: {
    flex: 1,
    gap: 2,
    marginRight: NoteSpacing.sm,
  },
  candidateTitle: {
    fontSize: Typography.body.size,
    fontWeight: '500',
  },
  candidateTags: {
    fontSize: Typography.caption.size,
  },
  candidateAddText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  emptyModalText: {
    fontSize: Typography.body.size,
    fontStyle: 'italic',
    paddingVertical: NoteSpacing.md,
    textAlign: 'center',
  },
  modalActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalCloseText: {
    fontSize: Typography.body.size,
    fontWeight: '600',
  },
});
