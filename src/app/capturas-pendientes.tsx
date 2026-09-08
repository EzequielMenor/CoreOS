import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { getPendingInbox, deleteInboxItem, updatePendingInboxText, type InboxRow } from '@/db';
import { NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import {
  getInboxErrorShortLabel,
  InboxPipelineError,
  isInboxErrorRetryable,
} from '@/services/inbox-diagnostics';
import { processInboxItem, processPendingInbox } from '@/services/inbox';
import { getLLMConfig } from '@/services/llm';

function formatAge(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} días`;
  return new Date(timestamp).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatAttempt(timestamp: number | null): string {
  if (!timestamp) return 'Aún no se ha intentado';
  return `Último intento: ${new Date(timestamp).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function getSnippet(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

export default function CapturasPendientesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [processingAll, setProcessingAll] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pending, provider] = await Promise.allSettled([
        getPendingInbox(true),
        getLLMConfig(),
      ]);
      if (pending.status === 'rejected') throw pending.reason;
      setItems(pending.value);
      if (provider.status === 'fulfilled') {
        setProviderConfigured(true);
      } else if (provider.reason instanceof InboxPipelineError && provider.reason.code === 'not_configured') {
        setProviderConfigured(false);
      }
      setNow(Date.now());
    } catch {
      setError('No se pudieron cargar las capturas pendientes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const retryItem = useCallback(async (id: number) => {
    if (processingAll || retryingId !== null) return;
    setRetryingId(id);
    void haptic.tap.light();
    try {
      const result = await processInboxItem(id);
      if (!result.skipped && 'routeType' in result) {
        Toast.show({ type: 'success', text1: 'Captura clasificada' });
      } else if (!result.skipped) {
        Toast.show({ type: 'error', text1: 'No se pudo procesar', text2: result.error });
      }
    } finally {
      await reload();
      setRetryingId(null);
    }
  }, [processingAll, reload, retryingId]);

  const retryAll = useCallback(async () => {
    if (processingAll || retryingId !== null) return;
    setProcessingAll(true);
    void haptic.tap.medium();
    try {
      const result = await processPendingInbox({ force: true });
      if (result.processed > 0) {
        Toast.show({
          type: 'success',
          text1: result.processed === 1 ? '1 captura clasificada' : `${result.processed} capturas clasificadas`,
        });
      } else if (result.failed > 0) {
        Toast.show({ type: 'error', text1: 'No se pudieron procesar', text2: result.errors[0]?.error });
      }
    } finally {
      await reload();
      setProcessingAll(false);
    }
  }, [processingAll, reload, retryingId]);

  const openEditor = useCallback((item: InboxRow) => {
    setEditingId(item.id);
    setEditingText(item.raw_text);
  }, []);

  const saveEdit = useCallback(async (retryAfter: boolean) => {
    if (editingId === null || savingEdit) return;
    const text = editingText.trim();
    if (!text) {
      Toast.show({ type: 'error', text1: 'Escribe algo antes de guardar' });
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await updatePendingInboxText(editingId, text);
      if (!updated) {
        Toast.show({ type: 'error', text1: 'La captura ya no está pendiente' });
        setEditingId(null);
        await reload();
        return;
      }
      const id = editingId;
      setEditingId(null);
      setEditingText('');
      await reload();
      if (retryAfter) await retryItem(id);
      else Toast.show({ type: 'success', text1: 'Captura actualizada' });
    } catch {
      Toast.show({ type: 'error', text1: 'No se pudo actualizar la captura' });
    } finally {
      setSavingEdit(false);
    }
  }, [editingId, editingText, reload, retryItem, savingEdit]);

  const confirmDelete = useCallback((id: number) => {
    if (processingAll || retryingId !== null) return;
    Alert.alert(
      'Eliminar captura',
      'Esta acción solo eliminará esta captura y no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const deleted = await deleteInboxItem(id);
                if (deleted) {
                  void haptic.notify.warning();
                  Toast.show({ type: 'info', text1: 'Captura eliminada' });
                }
                await reload();
              } catch {
                Toast.show({ type: 'error', text1: 'No se pudo eliminar la captura' });
              }
            })();
          },
        },
      ],
    );
  }, [processingAll, reload, retryingId]);

  const hasUnconfiguredProvider = !providerConfigured || items.some((item) => item.error_code === 'not_configured');
  const editingItem = editingId === null ? null : items.find((item) => item.id === editingId) ?? null;
  const actionsDisabled = processingAll || retryingId !== null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.notes.bg.base }]} edges={[]}>
      <Stack.Screen options={{ title: 'Capturas pendientes' }} />

      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.notes.text.primary }]}>Recupera tus capturas</Text>
        <Text style={[styles.subtitle, { color: theme.notes.text.secondary }]}>Revisa cada captura antes de volver a clasificarla.</Text>
      </View>

      {hasUnconfiguredProvider ? (
        <View
          style={[styles.providerBanner, { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle }]}
        >
          <View style={styles.providerCopy}>
            <Text style={[styles.providerTitle, { color: theme.notes.text.primary }]}>La IA no está configurada</Text>
            <Text style={[styles.providerText, { color: theme.notes.text.secondary }]}>Configúrala para poder clasificar estas capturas.</Text>
          </View>
          <Pressable
            accessibilityLabel="Abrir Ajustes para configurar la IA"
            accessibilityRole="button"
            onPress={() => router.push('/ajustes')}
            style={({ pressed }) => [styles.linkButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.linkButtonText, { color: theme.notes.accent.primary }]}>Ajustes</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.globalActionWrap}>
        <Pressable
          accessibilityLabel="Reintentar todas las capturas"
          accessibilityRole="button"
          accessibilityState={{ disabled: actionsDisabled, busy: processingAll }}
          disabled={actionsDisabled || items.length === 0}
          onPress={() => void retryAll()}
          style={({ pressed }) => [
            styles.globalButton,
            { backgroundColor: theme.notes.accent.primary, opacity: pressed || actionsDisabled || items.length === 0 ? 0.55 : 1 },
          ]}
        >
          {processingAll ? <ActivityIndicator color={theme.notes.text.primary} /> : null}
          <Text style={[styles.globalButtonText, { color: theme.notes.text.primary }]}>
            {processingAll ? 'Procesando capturas...' : 'Reintentar todas'}
          </Text>
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={theme.notes.accent.primary} />
          <Text style={[styles.stateText, { color: theme.notes.text.secondary }]}>Cargando capturas...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={[styles.stateTitle, { color: theme.notes.text.primary }]}>No se pudo cargar la bandeja</Text>
          <Text style={[styles.stateText, { color: theme.notes.text.secondary }]}>{error}</Text>
          <Pressable
            accessibilityLabel="Reintentar carga"
            accessibilityRole="button"
            onPress={() => void reload()}
            style={({ pressed }) => [styles.outlineButton, { borderColor: theme.notes.border.strong, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.outlineButtonText, { color: theme.notes.accent.primary }]}>Reintentar</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={[styles.stateTitle, { color: theme.notes.text.primary }]}>No hay capturas pendientes</Text>
          <Text style={[styles.stateText, { color: theme.notes.text.secondary }]}>Las nuevas capturas aparecerán aquí si necesitan atención.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const waitingForRetry = item.error_code !== null
              && isInboxErrorRetryable(item.error_code)
              && item.next_retry_at !== null
              && item.next_retry_at > now;
            const stateLabel = waitingForRetry
              ? 'Reintento automático pendiente'
              : item.error_code
                ? getInboxErrorShortLabel(item.error_code)
                : 'Pendiente de procesar';
            const isRetrying = retryingId === item.id;

            return (
              <View
                style={[styles.card, { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle }]}
              >
                <Text style={[styles.snippet, { color: theme.notes.text.primary }]} numberOfLines={3}>
                  {getSnippet(item.raw_text)}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, { color: theme.notes.text.muted }]}>{formatAge(item.created_at, now)}</Text>
                  <Text style={[styles.meta, { color: theme.notes.text.muted }]}>{formatAttempt(item.last_attempt_at)}</Text>
                </View>
                <Text style={[styles.state, { color: item.error_code ? theme.notes.semantic.warning : theme.notes.text.secondary }]}>
                  {stateLabel}
                </Text>
                <View style={styles.actionRow}>
                  <Pressable
                    accessibilityLabel={`Reintentar captura ${item.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: actionsDisabled, busy: isRetrying }}
                    disabled={actionsDisabled}
                    onPress={() => void retryItem(item.id)}
                    style={({ pressed }) => [styles.smallPrimary, { backgroundColor: theme.notes.accent.primary, opacity: pressed || actionsDisabled ? 0.55 : 1 }]}
                  >
                    {isRetrying ? <ActivityIndicator color={theme.notes.text.primary} size="small" /> : null}
                    <Text style={[styles.smallPrimaryText, { color: theme.notes.text.primary }]}>{isRetrying ? 'Procesando...' : 'Reintentar'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Editar captura ${item.id}`}
                    accessibilityRole="button"
                    disabled={actionsDisabled}
                    onPress={() => openEditor(item)}
                    style={({ pressed }) => [styles.smallSecondary, { borderColor: theme.notes.border.strong, opacity: pressed || actionsDisabled ? 0.55 : 1 }]}
                  >
                    <Text style={[styles.smallSecondaryText, { color: theme.notes.text.secondary }]}>Editar</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Eliminar captura ${item.id}`}
                    accessibilityRole="button"
                    disabled={actionsDisabled}
                    onPress={() => confirmDelete(item.id)}
                    style={({ pressed }) => [styles.deleteButton, { opacity: pressed || actionsDisabled ? 0.55 : 1 }]}
                  >
                    <Text style={[styles.deleteText, { color: theme.notes.semantic.danger }]}>Eliminar</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal
        animationType="slide"
        onRequestClose={() => setEditingId(null)}
        transparent
        visible={editingItem !== null}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View
            style={[styles.modalCard, { backgroundColor: theme.notes.bg.elevated }]}
          >
            <Text style={[styles.modalTitle, { color: theme.notes.text.primary }]}>Editar captura</Text>
            <Text style={[styles.modalHint, { color: theme.notes.text.secondary }]}>El texto sustituirá el contenido de esta única captura.</Text>
            <TextInput
              autoFocus
              multiline
              onChangeText={setEditingText}
              placeholder="Texto de la captura"
              placeholderTextColor={theme.notes.text.muted}
              style={[styles.editor, { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.strong, color: theme.notes.text.primary }]}
              value={editingText}
            />
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditingId(null)}
                style={({ pressed }) => [styles.modalCancel, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.modalCancelText, { color: theme.notes.text.secondary }]}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={savingEdit}
                onPress={() => void saveEdit(false)}
                style={({ pressed }) => [styles.modalSave, { borderColor: theme.notes.border.strong, opacity: pressed || savingEdit ? 0.55 : 1 }]}
              >
                <Text style={[styles.modalSaveText, { color: theme.notes.text.secondary }]}>Guardar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={savingEdit}
                onPress={() => void saveEdit(true)}
                style={({ pressed }) => [styles.modalRetry, { backgroundColor: theme.notes.accent.primary, opacity: pressed || savingEdit ? 0.55 : 1 }]}
              >
                {savingEdit ? <ActivityIndicator color={theme.notes.text.primary} size="small" /> : null}
                <Text style={[styles.modalRetryText, { color: theme.notes.text.primary }]}>Guardar y reintentar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: NoteSpacing.lg, paddingTop: NoteSpacing.lg, gap: NoteSpacing.xs },
  title: { ...Typography.title },
  subtitle: { ...Typography.body, fontSize: 15 },
  providerBanner: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radii.md, margin: NoteSpacing.lg, marginBottom: 0, padding: NoteSpacing.md, gap: NoteSpacing.md },
  providerCopy: { flex: 1, gap: NoteSpacing.xs },
  providerTitle: { fontSize: 15, fontWeight: '600' },
  providerText: { fontSize: 13, lineHeight: 18 },
  linkButton: { padding: NoteSpacing.sm },
  linkButtonText: { fontSize: 14, fontWeight: '700' },
  globalActionWrap: { paddingHorizontal: NoteSpacing.lg, paddingTop: NoteSpacing.lg, paddingBottom: NoteSpacing.sm },
  globalButton: { alignItems: 'center', borderRadius: Radii.md, flexDirection: 'row', gap: NoteSpacing.sm, justifyContent: 'center', minHeight: 46, paddingHorizontal: NoteSpacing.md },
  globalButtonText: { fontSize: 15, fontWeight: '700' },
  listContent: { padding: NoteSpacing.lg, paddingTop: NoteSpacing.sm, gap: NoteSpacing.md, paddingBottom: NoteSpacing['2xl'] },
  card: { borderRadius: Radii.md, borderWidth: 1, padding: NoteSpacing.md, gap: NoteSpacing.sm },
  snippet: { ...Typography.body, lineHeight: 22 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: NoteSpacing.sm },
  meta: { fontSize: 12 },
  state: { fontSize: 13, fontWeight: '600' },
  actionRow: { alignItems: 'center', flexDirection: 'row', gap: NoteSpacing.sm, paddingTop: NoteSpacing.xs },
  smallPrimary: { alignItems: 'center', borderRadius: Radii.sm, flexDirection: 'row', gap: NoteSpacing.xs, minHeight: 38, paddingHorizontal: NoteSpacing.md },
  smallPrimaryText: { fontSize: 13, fontWeight: '700' },
  smallSecondary: { alignItems: 'center', borderRadius: Radii.sm, borderWidth: 1, minHeight: 38, justifyContent: 'center', paddingHorizontal: NoteSpacing.md },
  smallSecondaryText: { fontSize: 13, fontWeight: '600' },
  deleteButton: { marginLeft: 'auto', minHeight: 38, justifyContent: 'center', paddingHorizontal: NoteSpacing.xs },
  deleteText: { fontSize: 13, fontWeight: '600' },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: NoteSpacing.xl, gap: NoteSpacing.sm },
  stateTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  outlineButton: { borderRadius: Radii.sm, borderWidth: 1, marginTop: NoteSpacing.sm, paddingHorizontal: NoteSpacing.lg, paddingVertical: NoteSpacing.sm },
  outlineButtonText: { fontSize: 14, fontWeight: '700' },
  modalOverlay: { backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: Radii.lg, borderTopRightRadius: Radii.lg, gap: NoteSpacing.md, padding: NoteSpacing.lg, paddingBottom: NoteSpacing.xl },
  modalTitle: { ...Typography.subtitle },
  modalHint: { fontSize: 13, lineHeight: 18 },
  editor: { borderRadius: Radii.md, borderWidth: 1, minHeight: 140, padding: NoteSpacing.md, textAlignVertical: 'top', ...Typography.body },
  modalActions: { alignItems: 'center', flexDirection: 'row', gap: NoteSpacing.sm, flexWrap: 'wrap' },
  modalCancel: { minHeight: 44, justifyContent: 'center', paddingHorizontal: NoteSpacing.sm },
  modalCancelText: { fontSize: 14, fontWeight: '600' },
  modalSave: { borderRadius: Radii.sm, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: NoteSpacing.md },
  modalSaveText: { fontSize: 14, fontWeight: '600' },
  modalRetry: { alignItems: 'center', borderRadius: Radii.sm, flexDirection: 'row', gap: NoteSpacing.xs, justifyContent: 'center', minHeight: 44, paddingHorizontal: NoteSpacing.md },
  modalRetryText: { fontSize: 14, fontWeight: '700' },
});
