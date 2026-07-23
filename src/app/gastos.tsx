import { useCallback, useMemo, useState } from 'react';
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

import { Fonts, IconSize, NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useGastosStore } from '@/stores/gastos';
import { useUiStore } from '@/stores/ui';

import { ButtonBrand } from '@/components/ButtonBrand';
import { EmptyState } from '@/components/EmptyState';

import type {
  CreateGastoInput,
  GastoRow,
  UpdateGastoInput,
} from '@/db/queries/gastos';

// ponytail: Intl.NumberFormat por llamada, sin memo. Memo cuando la lista pase
// de >100 filas (no es el caso en single-user local). Ver design.md §UI gastos.
const formatEUR = (amount: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount);

function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
  });
}

// ponytail: aritmética simple sobre copia, no toco Date — single-user, sin TZ.
function shiftMonth(
  y: number,
  m: number,
  delta: 1 | -1,
): { year: number; month: number } {
  let next = m + delta;
  let year = y;
  if (next < 0) {
    next = 11;
    year -= 1;
  } else if (next > 11) {
    next = 0;
    year += 1;
  }
  return { year, month: next };
}

function formatDateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export default function GastosScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const items = useGastosStore((s) => s.items);
  const monthTotal = useGastosStore((s) => s.monthTotal);
  const selectedMonth = useGastosStore((s) => s.selectedMonth);
  const loading = useGastosStore((s) => s.loading);
  const error = useGastosStore((s) => s.error);
  const fetchItems = useGastosStore((s) => s.fetchItems);
  const setSelectedMonth = useGastosStore((s) => s.setSelectedMonth);
  const createGasto = useGastosStore((s) => s.createGasto);
  const updateGasto = useGastosStore((s) => s.updateGasto);
  const deleteGasto = useGastosStore((s) => s.deleteGasto);

  const isEditorOpen = useUiStore((s) => s.isEditorOpen);
  const editorMode = useUiStore((s) => s.editorMode);
  const editorNoteId = useUiStore((s) => s.editorNoteId);
  const editorDomain = useUiStore((s) => s.editorDomain);
  const openEditor = useUiStore((s) => s.openEditor);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const setEditorDomain = useUiStore((s) => s.setEditorDomain);

  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDate, setFormDate] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchItems();
    }, [fetchItems]),
  );

  const handlePrevMonth = useCallback(() => {
    void haptic.tap.light();
    void setSelectedMonth(
      shiftMonth(selectedMonth.year, selectedMonth.month, -1),
    );
  }, [selectedMonth, setSelectedMonth]);

  const handleNextMonth = useCallback(() => {
    void haptic.tap.light();
    void setSelectedMonth(
      shiftMonth(selectedMonth.year, selectedMonth.month, 1),
    );
  }, [selectedMonth, setSelectedMonth]);

  const handleOpenCreate = useCallback(() => {
    setFormAmount('');
    setFormDescription('');
    setFormCategory('');
    setFormDate('');
    void haptic.tap.medium();
    setEditorDomain('gasto');
    openEditor('create');
  }, [openEditor, setEditorDomain]);

  const handleOpenEdit = useCallback(
    (id: number) => {
      const g = items.find((i) => i.id === id);
      if (g) {
        setFormAmount(String(g.amount));
        setFormDescription(g.description ?? '');
        setFormCategory(g.category ?? '');
        setFormDate(g.date ?? '');
      } else {
        setFormAmount('');
        setFormDescription('');
        setFormCategory('');
        setFormDate('');
      }
      void haptic.tap.light();
      setEditorDomain('gasto');
      openEditor('edit', id);
    },
    [items, openEditor, setEditorDomain],
  );

  const handleDelete = useCallback(
    (id: number) => {
      void haptic.notify.warning();
      void deleteGasto(id)
        .then(() => {
          Toast.show({ type: 'info', text1: 'Gasto eliminado' });
        })
        .catch(() => {
          void haptic.notify.error();
          Toast.show({ type: 'error', text1: 'No se pudo eliminar el gasto' });
        });
    },
    [deleteGasto],
  );

  const handleSubmit = useCallback(async () => {
    const trimmedAmount = formAmount.trim().replace(',', '.');
    const amount = Number.parseFloat(trimmedAmount);
    if (!Number.isFinite(amount) || saving) return;
    setSaving(true);
    try {
      const date = formDate.trim() || null;
      const description = formDescription.trim() || null;
      const category = formCategory.trim() || null;
      if (editorMode === 'edit' && editorNoteId != null) {
        const patch: UpdateGastoInput = {
          amount,
          date,
          description,
          category,
        };
        await updateGasto(editorNoteId, patch);
      } else {
        const input: CreateGastoInput = {
          amount,
          date,
          description,
          category,
        };
        await createGasto(input);
      }
      void haptic.notify.success();
      closeEditor();
    } catch (e) {
      void haptic.notify.error();
      Toast.show({
        type: 'error',
        text1: 'No se pudo guardar el gasto',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }, [
    formAmount,
    formDescription,
    formCategory,
    formDate,
    saving,
    editorMode,
    editorNoteId,
    createGasto,
    updateGasto,
    closeEditor,
  ]);

  const handleCancel = useCallback(() => {
    closeEditor();
  }, [closeEditor]);

  const handleDeleteFromModal = useCallback(async () => {
    if (editorMode !== 'edit' || editorNoteId == null) return;
    try {
      await deleteGasto(editorNoteId);
      void haptic.notify.warning();
      closeEditor();
      Toast.show({ type: 'info', text1: 'Gasto eliminado' });
    } catch {
      void haptic.notify.error();
      Toast.show({ type: 'error', text1: 'No se pudo eliminar el gasto' });
    }
  }, [editorMode, editorNoteId, deleteGasto, closeEditor]);

  const modalVisible = isEditorOpen && editorDomain === 'gasto';
  const editingId = editorMode === 'edit' ? editorNoteId : null;
  const editingItem =
    editingId != null ? items.find((g) => g.id === editingId) : null;
  const canSubmit = formAmount.trim().length > 0 && !saving;

  const monthLabel =
    formatMonthLabel(selectedMonth.year, selectedMonth.month);
  const monthLabelCapitalized =
    monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const totalLabel = formatEUR(monthTotal?.total ?? 0);
  const totalCount = monthTotal?.count ?? 0;
  const totalCountLabel = `${totalCount} ${totalCount === 1 ? 'gasto' : 'gastos'}`;

  // ponytail: O(n) sobre items, sin cache; suficiente para single-user.
  const categoryBreakdown = useMemo(() => {
    if (items.length === 0) return [];
    const buckets = new Map<string, number>();
    for (const item of items) {
      const trimmed = item.category?.trim();
      const key =
        trimmed && trimmed.length > 0 ? trimmed.toUpperCase() : 'OTROS';
      buckets.set(key, (buckets.get(key) ?? 0) + item.amount);
    }
    return Array.from(buckets, ([label, total]) => ({ label, total })).sort(
      (a, b) => b.total - a.total,
    );
  }, [items]);

  const breakdownText = categoryBreakdown
    .map(
      ({ label, total }) =>
        `${label.toUpperCase()} ${total.toLocaleString('es-ES', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} €`,
    )
    .join(' · ');

  const emptyState = (() => {
    if (items.length === 0) {
      return (
        <EmptyState
          illustration="sf.eurosign.circle"
          title="Sin gastos este mes"
          subtitle="Toca + para añadir uno."
        />
      );
    }
    return null;
  })();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['top']}
    >
      <Stack.Screen options={{ title: 'Gastos' }} />

      {/* Selector de mes */}
      <View
        style={[
          styles.monthBar,
          {
            backgroundColor: theme.notes.bg.surface,
            borderColor: theme.notes.border.subtle,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Mes anterior"
          accessibilityRole="button"
          hitSlop={8}
          onPress={handlePrevMonth}
          style={({ pressed }) => [
            styles.monthArrow,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {Platform.OS === 'ios' ? (
            <SymbolView
              name="chevron.left"
              size={IconSize.md}
              tintColor={theme.notes.text.secondary}
            />
          ) : (
            <Text
              style={[styles.monthArrowText, { color: theme.notes.text.secondary }]}
            >
              ‹
            </Text>
          )}
        </Pressable>
        <Text style={[styles.monthLabel, { color: theme.notes.text.primary }]}>
          {monthLabelCapitalized}
        </Text>
        <Pressable
          accessibilityLabel="Mes siguiente"
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleNextMonth}
          style={({ pressed }) => [
            styles.monthArrow,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {Platform.OS === 'ios' ? (
            <SymbolView
              name="chevron.right"
              size={IconSize.md}
              tintColor={theme.notes.text.secondary}
            />
          ) : (
            <Text
              style={[styles.monthArrowText, { color: theme.notes.text.secondary }]}
            >
              ›
            </Text>
          )}
        </Pressable>
      </View>

      {/* Tarjeta de total mensual */}
      <View
        style={[
          styles.totalCard,
          {
            backgroundColor: theme.notes.bg.surface,
            borderColor: theme.notes.border.subtle,
          },
        ]}
      >
        <Text style={[styles.totalLabel, { color: theme.notes.text.secondary }]}>
          {`Total del mes · ${totalCountLabel}`}
        </Text>
        <Text style={[styles.totalAmount, { color: theme.notes.text.primary }]}>
          {totalLabel}
        </Text>
        {categoryBreakdown.length > 0 ? (
          <Text
            numberOfLines={2}
            style={[styles.breakdown, { color: theme.notes.text.muted }]}
          >
            {breakdownText}
          </Text>
        ) : null}
      </View>

      {/* Banner de error */}
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
          <FlatListGastos
            emptyState={emptyState}
            items={items}
            onDelete={handleDelete}
            onPressRow={handleOpenEdit}
          />
        )}
      </View>

      {/* FAB */}
      <Pressable
        accessibilityLabel="Crear gasto"
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

      {/* Modal editor gasto (gated por useUiStore) */}
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
                {editingItem ? 'Editar gasto' : 'Nuevo gasto'}
              </Text>

              <Text style={[styles.fieldLabel, { color: theme.notes.text.secondary }]}>
                Importe (€)
              </Text>
              <TextInput
                autoFocus={!editingItem}
                inputMode="decimal"
                keyboardType="decimal-pad"
                onChangeText={setFormAmount}
                placeholder="0,00"
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
                value={formAmount}
              />

              <Text
                style={[
                  styles.fieldLabel,
                  { color: theme.notes.text.secondary, marginTop: NoteSpacing.md },
                ]}
              >
                Descripción
              </Text>
              <TextInput
                onChangeText={setFormDescription}
                placeholder="Ej. Cena con amigos"
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
                value={formDescription}
              />

              <Text
                style={[
                  styles.fieldLabel,
                  { color: theme.notes.text.secondary, marginTop: NoteSpacing.md },
                ]}
              >
                Categoría
              </Text>
              <TextInput
                onChangeText={setFormCategory}
                placeholder="Ej. Ocio"
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
                value={formCategory}
              />

              <Text
                style={[
                  styles.fieldLabel,
                  { color: theme.notes.text.secondary, marginTop: NoteSpacing.md },
                ]}
              >
                Fecha
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setFormDate}
                placeholder="YYYY-MM-DD (opcional)"
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
                value={formDate}
              />

              <View style={styles.modalActions}>
                {editingItem ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Eliminar gasto"
                    onPress={handleDeleteFromModal}
                    style={({ pressed }) => [
                      styles.modalDanger,
                      {
                        borderColor: theme.notes.semantic.danger,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalDangerText,
                        { color: theme.notes.semantic.danger },
                      ]}
                    >
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
                    <Text
                      style={[
                        styles.modalSecondaryText,
                        { color: theme.notes.text.secondary },
                      ]}
                    >
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

interface FlatListGastosProps {
  items: GastoRow[];
  onPressRow: (id: number) => void;
  onDelete: (id: number) => void;
  emptyState: React.ReactElement | null;
}

function FlatListGastos({
  items,
  onPressRow,
  onDelete,
  emptyState,
}: FlatListGastosProps) {
  const theme = useTheme();

  const renderRow = useCallback(
    ({ item }: { item: GastoRow }) => {
      const dateLabel = formatDateLabel(item.date);
      return (
        <View style={styles.itemRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onPressRow(item.id)}
            style={styles.rowBody}
          >
            <View style={styles.mainInfo}>
              <Text style={[styles.amount, { color: theme.notes.text.primary }]}>
                {formatEUR(item.amount)}
              </Text>
              {item.description ? (
                <Text
                  numberOfLines={1}
                  style={[styles.description, { color: theme.notes.text.secondary }]}
                >
                  {item.description}
                </Text>
              ) : null}
            </View>
            {(item.category || dateLabel) && (
              <View style={styles.metaRow}>
                {item.category ? (
                  <Text style={[styles.metaText, { color: theme.notes.text.secondary }]}>
                    {item.category.toUpperCase()}
                  </Text>
                ) : null}
                {dateLabel ? (
                  <Text style={[styles.metaText, { color: theme.notes.text.muted }]}>
                    {dateLabel}
                  </Text>
                ) : null}
              </View>
            )}
          </Pressable>

          <Pressable
            accessibilityLabel="Eliminar gasto"
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
    [onPressRow, onDelete, theme],
  );

  return (
    <FlatList
      ListEmptyComponent={emptyState ?? <View />}
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

  // Month navigator
  monthBar: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: NoteSpacing.md,
    marginTop: NoteSpacing.md,
    paddingHorizontal: NoteSpacing.xs,
    paddingVertical: 2,
  },
  monthArrow: {
    alignItems: 'center',
    borderRadius: Radii.full,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 36,
    padding: NoteSpacing.xs,
  },
  monthArrowText: {
    fontSize: 24,
    lineHeight: 26,
    textAlign: 'center',
  },
  monthLabel: {
    ...Typography.subtitle,
    flex: 1,
    textAlign: 'center',
    textTransform: 'capitalize',
  },

  // Total card
  totalCard: {
    borderRadius: Radii.md,
    borderWidth: 1,
    marginHorizontal: NoteSpacing.md,
    marginTop: NoteSpacing.md,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.md,
  },
  totalLabel: {
    ...Typography.caption,
    fontWeight: '600',
    marginBottom: NoteSpacing.xs,
    textTransform: 'uppercase',
  },
  totalAmount: {
    ...Typography.display,
  },
  breakdown: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 0.3,
    marginTop: NoteSpacing.xs,
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

  // Item Row editorial
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
    paddingVertical: NoteSpacing.md,
    gap: NoteSpacing.sm,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  mainInfo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: NoteSpacing.sm,
  },
  amount: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'ui-monospace',
  },
  description: {
    ...Typography.body,
    fontSize: 15,
    flex: 1,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NoteSpacing.sm,
    marginTop: 2,
  },
  metaText: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
    letterSpacing: 0.5,
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
