import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteSpacing, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';

import { ButtonBrand } from './ButtonBrand';
import { SearchBar } from './SearchBar';

export interface ModelSelectorModalProps {
  visible: boolean;
  providerName: string;
  selectedModel: string;
  models: string[];
  loading: boolean;
  error: string | null;
  onSelectModel: (modelId: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

export function ModelSelectorModal({
  visible,
  providerName,
  selectedModel,
  models,
  loading,
  error,
  onSelectModel,
  onRetry,
  onClose,
}: ModelSelectorModalProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualText, setManualText] = useState('');

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, query]);

  const handleSelect = (modelId: string) => {
    void haptic.tap.light();
    onSelectModel(modelId);
    handleClose();
  };

  const handleClose = () => {
    setQuery('');
    setShowManualInput(false);
    setManualText('');
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      visible={visible}
    >
      <SafeAreaView
        style={[styles.modalContainer, { backgroundColor: theme.notes.bg.base }]}
        edges={['top', 'bottom']}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.notes.border.subtle }]}>
            <View style={styles.headerTitleGroup}>
              <Text style={[styles.title, { color: theme.notes.text.primary }]}>
                Elegir modelo
              </Text>
              <Text style={[styles.subtitle, { color: theme.notes.text.muted }]}>
                {providerName}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={handleClose}
              style={styles.closeButton}
            >
              <Text style={[styles.closeText, { color: theme.notes.accent.primary }]}>
                Cerrar
              </Text>
            </Pressable>
          </View>

          {/* Modo entrada manual */}
          {showManualInput ? (
            <View style={styles.manualContainer}>
              <Text style={[styles.manualHeading, { color: theme.notes.text.primary }]}>
                Introducir modelo manualmente
              </Text>
              <Text style={[styles.manualHint, { color: theme.notes.text.muted }]}>
                Escribe el identificador exacto del modelo soportado por {providerName}.
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onChangeText={setManualText}
                placeholder="Ej. gpt-4o, llama3:latest, MiniMax-Text-01"
                placeholderTextColor={theme.notes.text.muted}
                style={[
                  styles.manualInput,
                  {
                    backgroundColor: theme.notes.bg.surface,
                    borderColor: theme.notes.border.strong,
                    color: theme.notes.text.primary,
                  },
                ]}
                value={manualText}
              />
              <View style={styles.manualActions}>
                <ButtonBrand
                  onPress={() => setShowManualInput(false)}
                  size="sm"
                  title="Volver a la lista"
                  variant="secondary"
                />
                <ButtonBrand
                  disabled={!manualText.trim()}
                  onPress={() => handleSelect(manualText.trim())}
                  size="sm"
                  title="Seleccionar modelo"
                  variant="primary"
                />
              </View>
            </View>
          ) : (
            <>
              {/* Buscador */}
              <View style={styles.searchContainer}>
                <SearchBar
                  onChangeText={setQuery}
                  onClear={() => setQuery('')}
                  placeholder="Buscar modelo…"
                  value={query}
                />
              </View>

              {/* Contenido principal */}
              {loading ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator color={theme.notes.accent.primary} size="large" />
                  <Text style={[styles.centerText, { color: theme.notes.text.secondary }]}>
                    Consultando modelos de {providerName}…
                  </Text>
                </View>
              ) : error ? (
                <View style={styles.centerContainer}>
                  <Text style={[styles.errorTitle, { color: theme.notes.semantic.danger }]}>
                    No se pudieron cargar los modelos
                  </Text>
                  <Text style={[styles.errorDetail, { color: theme.notes.text.muted }]}>
                    {error}
                  </Text>
                  <View style={styles.centerActions}>
                    <ButtonBrand
                      onPress={onRetry}
                      size="sm"
                      title="Reintentar"
                      variant="secondary"
                    />
                    <ButtonBrand
                      onPress={() => setShowManualInput(true)}
                      size="sm"
                      title="Entrada manual"
                      variant="primary"
                    />
                  </View>
                </View>
              ) : models.length === 0 ? (
                <View style={styles.centerContainer}>
                  <Text style={[styles.emptyTitle, { color: theme.notes.text.primary }]}>
                    Sin modelos disponibles
                  </Text>
                  <Text style={[styles.emptyText, { color: theme.notes.text.muted }]}>
                    No se han cargado modelos aún o el proveedor requiere entrada manual.
                  </Text>
                  <View style={styles.centerActions}>
                    <ButtonBrand
                      onPress={onRetry}
                      size="sm"
                      title="Cargar modelos"
                      variant="secondary"
                    />
                    <ButtonBrand
                      onPress={() => setShowManualInput(true)}
                      size="sm"
                      title="Introducir manual"
                      variant="primary"
                    />
                  </View>
                </View>
              ) : filteredModels.length === 0 ? (
                <View style={styles.centerContainer}>
                  <Text style={[styles.emptyTitle, { color: theme.notes.text.primary }]}>
                    Sin coincidencias
                  </Text>
                  <Text style={[styles.emptyText, { color: theme.notes.text.muted }]}>
                    No encontramos ningún modelo que coincida con «{query}».
                  </Text>
                  <View style={styles.centerActions}>
                    <ButtonBrand
                      onPress={() => handleSelect(query.trim())}
                      size="sm"
                      title={`Usar «${query.trim()}»`}
                      variant="primary"
                    />
                  </View>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.listContainer}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.listHeaderRow}>
                    <Text style={[styles.listHeaderCount, { color: theme.notes.text.muted }]}>
                      {filteredModels.length}{' '}
                      {filteredModels.length === 1 ? 'modelo disponible' : 'modelos disponibles'}
                    </Text>
                    <TouchableOpacity
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => setShowManualInput(true)}
                    >
                      <Text style={[styles.manualLink, { color: theme.notes.accent.primary }]}>
                        Entrada manual
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {filteredModels.map((m) => {
                    const isSelected = m === selectedModel;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        key={m}
                        onPress={() => handleSelect(m)}
                        style={({ pressed }) => [
                          styles.modelItem,
                          {
                            backgroundColor: isSelected
                              ? theme.notes.accent.primaryDim
                              : theme.notes.bg.surface,
                            borderColor: isSelected
                              ? theme.notes.accent.primary
                              : theme.notes.border.subtle,
                          },
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <View style={styles.modelInfo}>
                          <Text
                            ellipsizeMode="middle"
                            numberOfLines={1}
                            style={[
                              styles.modelId,
                              {
                                color: isSelected
                                  ? theme.notes.text.primary
                                  : theme.notes.text.secondary,
                                fontWeight: isSelected ? '700' : '500',
                              },
                            ]}
                          >
                            {m}
                          </Text>
                        </View>
                        {isSelected && (
                          <View
                            style={[
                              styles.checkCircle,
                              { backgroundColor: theme.notes.accent.primary },
                            ]}
                          >
                            <Text style={styles.checkMark}>✓</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: NoteSpacing.lg,
    paddingVertical: NoteSpacing.md,
    borderBottomWidth: 1,
  },
  headerTitleGroup: {
    gap: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
  },
  closeButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchContainer: {
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.md,
    paddingBottom: NoteSpacing.xs,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: NoteSpacing.xl,
    gap: NoteSpacing.md,
  },
  centerText: {
    fontSize: 15,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorDetail: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  centerActions: {
    flexDirection: 'row',
    gap: NoteSpacing.md,
    marginTop: NoteSpacing.sm,
  },
  listContainer: {
    paddingHorizontal: NoteSpacing.lg,
    paddingVertical: NoteSpacing.sm,
    gap: NoteSpacing.sm,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: NoteSpacing.xs,
    paddingHorizontal: 2,
  },
  listHeaderCount: {
    fontSize: 12,
    fontFamily: 'ui-monospace',
    fontWeight: '600',
  },
  manualLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modelInfo: {
    flex: 1,
    marginRight: NoteSpacing.sm,
  },
  modelId: {
    fontSize: 15,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  manualContainer: {
    flex: 1,
    padding: NoteSpacing.xl,
    gap: NoteSpacing.md,
  },
  manualHeading: {
    fontSize: 18,
    fontWeight: '700',
  },
  manualHint: {
    fontSize: 14,
    lineHeight: 20,
  },
  manualInput: {
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    marginTop: NoteSpacing.xs,
  },
  manualActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: NoteSpacing.md,
    marginTop: NoteSpacing.sm,
  },
});
