import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import Toast from 'react-native-toast-message';

import { IconSize, NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useTareasStore } from '@/stores/tareas';
import { useUiStore } from '@/stores/ui';

import { ButtonBrand } from '@/components/ButtonBrand';
import { EmptyState } from '@/components/EmptyState';
import { EditorialTaskItem } from '@/components/EditorialTaskItem';

import type {
  CreateTareaInput,
  TareaFilter,
  TareaRow,
} from '@/db/queries/tareas';

type FilterTab = TareaFilter['status'];

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'completed', label: 'Completadas' },
];

const PRIORITY_OPTIONS: { key: string | null; label: string }[] = [
  { key: null, label: 'Ninguna' },
  { key: 'alta', label: 'Alta' },
  { key: 'media', label: 'Media' },
  { key: 'baja', label: 'Baja' },
];

// ponytail: helper inline de presentación. Mover a src/lib/format.ts cuando
// aparezca un tercer caller (gastos.tsx probablemente lo necesitará).
function formatDueDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}


export default function TareasScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const items = useTareasStore((s) => s.items);
  const filter = useTareasStore((s) => s.filter);
  const loading = useTareasStore((s) => s.loading);
  const error = useTareasStore((s) => s.error);
  const fetchItems = useTareasStore((s) => s.fetchItems);
  const setFilter = useTareasStore((s) => s.setFilter);
  const createTarea = useTareasStore((s) => s.createTarea);
  const updateTarea = useTareasStore((s) => s.updateTarea);
  const deleteTarea = useTareasStore((s) => s.deleteTarea);
  const toggleStatus = useTareasStore((s) => s.toggleStatus);

  const isEditorOpen = useUiStore((s) => s.isEditorOpen);
  const editorMode = useUiStore((s) => s.editorMode);
  const editorNoteId = useUiStore((s) => s.editorNoteId);
  const editorDomain = useUiStore((s) => s.editorDomain);
  const openEditor = useUiStore((s) => s.openEditor);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const setEditorDomain = useUiStore((s) => s.setEditorDomain);

  const [formTitle, setFormTitle] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formPriority, setFormPriority] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchItems();
    }, [fetchItems]),
  );

  const handleTabChange = useCallback(
    (next: FilterTab) => {
      if (next === filter.status) return;
      void haptic.tap.light();
      void setFilter({ status: next });
    },
    [filter.status, setFilter],
  );

  const handleOpenCreate = useCallback(() => {
    setFormTitle('');
    setFormDueDate('');
    setFormPriority(null);
    void haptic.tap.medium();
    setEditorDomain('tarea');
    openEditor('create');
  }, [openEditor, setEditorDomain]);

  const handleOpenEdit = useCallback(
    (id: number) => {
      const t = items.find((i) => i.id === id);
      if (t) {
        setFormTitle(t.title);
        setFormDueDate(t.due_date ?? '');
        setFormPriority(t.priority);
      } else {
        setFormTitle('');
        setFormDueDate('');
        setFormPriority(null);
      }
      void haptic.tap.light();
      setEditorDomain('tarea');
      openEditor('edit', id);
    },
    [items, openEditor, setEditorDomain],
  );

  const handleToggle = useCallback(
    (id: number) => {
      void haptic.tap.light();
      void toggleStatus(id).catch(() => {
        void haptic.notify.error();
        Toast.show({ type: 'error', text1: 'No se pudo actualizar la tarea' });
      });
    },
    [toggleStatus],
  );

  const handleDelete = useCallback(
    (id: number) => {
      void haptic.notify.warning();
      void deleteTarea(id)
        .then(() => {
          Toast.show({ type: 'info', text1: 'Tarea eliminada' });
        })
        .catch(() => {
          void haptic.notify.error();
          Toast.show({ type: 'error', text1: 'No se pudo eliminar la tarea' });
        });
    },
    [deleteTarea],
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = formTitle.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const dueDate = formDueDate.trim() || null;
      if (editorMode === 'edit' && editorNoteId != null) {
        await updateTarea(editorNoteId, {
          title: trimmed,
          due_date: dueDate,
          priority: formPriority,
        });
      } else {
        const input: CreateTareaInput = {
          title: trimmed,
          due_date: dueDate,
          priority: formPriority,
        };
        await createTarea(input);
      }
      void haptic.notify.success();
      closeEditor();
    } catch (e) {
      void haptic.notify.error();
      Toast.show({
        type: 'error',
        text1: 'No se pudo guardar la tarea',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }, [
    formTitle,
    formDueDate,
    formPriority,
    saving,
    editorMode,
    editorNoteId,
    createTarea,
    updateTarea,
    closeEditor,
  ]);

  const handleCancel = useCallback(() => {
    closeEditor();
  }, [closeEditor]);

  const handleDeleteFromModal = useCallback(async () => {
    if (editorMode !== 'edit' || editorNoteId == null) return;
    try {
      await deleteTarea(editorNoteId);
      void haptic.notify.warning();
      closeEditor();
      Toast.show({ type: 'info', text1: 'Tarea eliminada' });
    } catch {
      void haptic.notify.error();
      Toast.show({ type: 'error', text1: 'No se pudo eliminar la tarea' });
    }
  }, [editorMode, editorNoteId, deleteTarea, closeEditor]);

  const modalVisible = isEditorOpen && editorDomain === 'tarea';
  const editingId = editorMode === 'edit' ? editorNoteId : null;
  const editingItem = editingId != null ? items.find((t) => t.id === editingId) : null;
  const canSubmit = formTitle.trim().length > 0 && !saving;

  const emptyState = (() => {
    if (filter.status === 'pending') {
      return (
        <EmptyState
          illustration="sf.checkmark.circle"
          title="No hay tareas pendientes"
          subtitle="Las tareas que marques como hechas aparecerán aquí."
        />
      );
    }
    if (filter.status === 'completed') {
      return (
        <EmptyState
          illustration="sf.checkmark.circle.fill"
          title="Aún no has completado tareas"
          subtitle="Marca una tarea como hecha para verla aquí."
        />
      );
    }
    return (
      <EmptyState
        illustration="sf.checkmark.circle"
        title="Sin tareas"
        subtitle="Toca + para añadir una."
      />
    );
  })();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['top']}
    >
      <Stack.Screen options={{ title: 'Tareas' }} />

      {/* Filter segmented control */}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: theme.notes.bg.surface,
            borderColor: theme.notes.border.subtle,
          },
        ]}
      >
        {FILTER_TABS.map((tab) => {
          const isActive = tab.key === filter.status;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => handleTabChange(tab.key)}
              style={[
                styles.tab,
                isActive && { backgroundColor: theme.notes.accent.primary },
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
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Error banner (fetch) */}
      {error ? (
        <View
          style={[
            styles.errorBanner,
            {
              backgroundColor: theme.notes.bg.surface,
              borderColor: theme.notes.semantic.danger,
            },
          ]}
        >
          <Text style={[styles.errorText, { color: theme.notes.semantic.danger }]}>
            {error}
          </Text>
          <ButtonBrand
            title="Reintentar"
            variant="secondary"
            size="sm"
            onPress={() => void fetchItems()}
          />
        </View>
      ) : null}

      {/* Lista */}
      <View style={styles.listWrap}>
        {loading && items.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.notes.accent.primary} />
          </View>
        ) : (
          <FlatListTareas
            items={items}
            onToggle={handleToggle}
            onPressRow={handleOpenEdit}
            onDelete={handleDelete}
            emptyState={emptyState}
          />
        )}
      </View>

      {/* FAB */}
      <Pressable
        accessibilityLabel="Crear tarea"
        accessibilityRole="button"
        hitSlop={8}
        onPress={handleOpenCreate}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: theme.notes.accent.primary,
            bottom: insets.bottom + NoteSpacing.lg,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {Platform.OS === 'ios' ? (
          <SymbolView
            name="plus"
            size={IconSize.lg}
            tintColor={theme.notes.text.primary}
          />
        ) : (
          <Text style={[styles.fabPlus, { color: theme.notes.text.primary }]}>+</Text>
        )}
      </Pressable>

      {/* Modal editor tarea (gated por useUiStore) */}
      <Modal
        animationType="fade"
        onRequestClose={handleCancel}
        transparent
        visible={modalVisible}
      >
        <View style={[styles.modalOverlay, { paddingTop: insets.top + 40 }]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKeyboardAvoid}
          >
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
                {editingItem ? 'Editar tarea' : 'Nueva tarea'}
              </Text>

              <Text style={[styles.fieldLabel, { color: theme.notes.text.secondary }]}>
                Título
              </Text>
              <TextInput
                autoFocus={!editingItem}
                onChangeText={setFormTitle}
                placeholder="Ej. Comprar leche"
                placeholderTextColor={theme.notes.text.muted}
                returnKeyType="next"
                selectionColor={theme.notes.accent.primary}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.notes.bg.surface,
                    borderColor: theme.notes.border.subtle,
                    color: theme.notes.text.primary,
                  },
                ]}
                value={formTitle}
              />

              <Text
                style={[styles.fieldLabel, { color: theme.notes.text.secondary, marginTop: NoteSpacing.md }]}
              >
                Fecha límite (opcional)
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setFormDueDate}
                placeholder="YYYY-MM-DD"
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
                value={formDueDate}
              />

              <Text
                style={[styles.fieldLabel, { color: theme.notes.text.secondary, marginTop: NoteSpacing.md }]}
              >
                Prioridad
              </Text>
              <View style={styles.priorityRow}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const isActive = formPriority === opt.key;
                  return (
                    <Pressable
                      key={opt.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      onPress={() => {
                        void haptic.tap.light();
                        setFormPriority(opt.key);
                      }}
                      style={[
                        styles.priorityPill,
                        {
                          backgroundColor: isActive
                            ? theme.notes.accent.primary
                            : theme.notes.bg.surface,
                          borderColor: isActive
                            ? theme.notes.accent.primary
                            : theme.notes.border.subtle,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.priorityLabel,
                          {
                            color: isActive
                              ? theme.notes.text.primary
                              : theme.notes.text.secondary,
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.modalActions}>
                {editingItem ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Eliminar tarea"
                    onPress={handleDeleteFromModal}
                    style={({ pressed }) => [
                      styles.modalDanger,
                      {
                        borderColor: theme.notes.semantic.danger,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.modalDangerText, { color: theme.notes.semantic.danger }]}>
                      Eliminar
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.modalDanger} />
                )}
                <View style={styles.modalActionsRight}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleCancel}
                    style={({ pressed }) => [
                      styles.modalSecondary,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.modalSecondaryText, { color: theme.notes.text.secondary }]}>
                      Cancelar
                    </Text>
                  </Pressable>
                  <ButtonBrand
                    disabled={!canSubmit}
                    loading={saving}
                    onPress={() => void handleSubmit()}
                    title={editingItem ? 'Guardar' : 'Crear'}
                  />
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

interface FlatListTareasProps {
  items: TareaRow[];
  onToggle: (id: number) => void;
  onPressRow: (id: number) => void;
  onDelete: (id: number) => void;
  emptyState: React.ReactElement;
}

function FlatListTareas({
  items,
  onToggle,
  onPressRow,
  onDelete,
  emptyState,
}: FlatListTareasProps) {
  const theme = useTheme();

  const renderRow = useCallback(
    ({ item }: { item: TareaRow }) => {
      const due = formatDueDate(item.due_date);
      return (
        <View style={styles.itemWrapper}>
          <View style={{ flex: 1 }}>
            <EditorialTaskItem
              title={item.title}
              status={item.status}
              dueDate={due}
              priority={item.priority}
              onToggle={() => onToggle(item.id)}
              onPress={() => onPressRow(item.id)}
            />
          </View>
          <Pressable
            accessibilityLabel="Eliminar tarea"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onDelete(item.id)}
            style={({ pressed }) => [
              styles.deleteBtn,
              { opacity: pressed ? 0.5 : 1 },
            ]}
          >
            <Text style={[styles.deleteBtnText, { color: theme.notes.text.muted }]}>
              ×
            </Text>
          </Pressable>
        </View>
      );
    },
    [onToggle, onPressRow, onDelete, theme],
  );

  return (
    <FlatList
      ListEmptyComponent={emptyState}
      contentContainerStyle={styles.listContent}
      data={items}
      keyExtractor={(item) => String(item.id)}
      keyboardShouldPersistTaps="handled"
      renderItem={renderRow}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Estilos
// ──────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Filter
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

  // Error banner
  errorBanner: {
    alignItems: 'center',
    borderLeftWidth: 4,
    borderRadius: Radii.md,
    flexDirection: 'row',
    gap: NoteSpacing.md,
    justifyContent: 'space-between',
    marginHorizontal: NoteSpacing.md,
    marginTop: NoteSpacing.md,
    padding: NoteSpacing.md,
  },
  errorText: {
    ...Typography.body,
    flex: 1,
  },

  // List
  listWrap: { flex: 1, marginTop: NoteSpacing.md },
  listContent: {
    flexGrow: 1,
    paddingBottom: NoteSpacing['2xl'],
    paddingHorizontal: NoteSpacing.md,
  },
  loadingWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },

  // Card
  card: {
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    marginBottom: NoteSpacing.md,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  checkbox: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: IconSize.md + 4,
  },
  checkboxFallback: {
    fontSize: IconSize.md,
    lineHeight: IconSize.md,
  },
  cardBody: { flex: 1, gap: 4 },
  title: {
    ...Typography.body,
    fontWeight: Typography.subtitle.weight,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  tag: {
    borderRadius: Radii.pill,
    borderWidth: 1,
    paddingHorizontal: NoteSpacing.sm,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  itemWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: NoteSpacing.md,
  },
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: IconSize.md + 4,
    padding: NoteSpacing.xs,
  },
  deleteBtnText: {
    fontSize: 18,
    lineHeight: 18,
  },

  // FAB
  fab: {
    alignItems: 'center',
    borderRadius: Radii.full,
    elevation: 8,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: NoteSpacing.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    width: 56,
  },
  fabPlus: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 30,
  },

  // Modal
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'flex-start',
  },
  modalKeyboardAvoid: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  modalPanel: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 720,
    padding: NoteSpacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    width: '92%',
  },
  modalTitle: {
    ...Typography.title,
    marginBottom: NoteSpacing.md,
  },
  fieldLabel: {
    ...Typography.caption,
    fontWeight: '600',
    marginBottom: NoteSpacing.xs,
    textTransform: 'uppercase',
  },
  input: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  priorityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: NoteSpacing.xs,
  },
  priorityPill: {
    borderRadius: Radii.pill,
    borderWidth: 1,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.xs,
  },
  priorityLabel: {
    ...Typography.caption,
    fontWeight: '600',
  },
  modalActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: NoteSpacing.lg,
  },
  modalActionsRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
  },
  modalDanger: {
    alignItems: 'center',
    borderRadius: Radii.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 92,
    paddingHorizontal: NoteSpacing.md,
  },
  modalDangerText: {
    ...Typography.body,
    fontWeight: '600',
  },
  modalSecondary: {
    alignItems: 'center',
    borderRadius: Radii.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
  },
  modalSecondaryText: {
    ...Typography.body,
    fontWeight: '600',
  },
});
