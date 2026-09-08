import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { BottomTabInset, NoteSpacing, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ButtonBrand } from '@/components/ButtonBrand';
import { ModelSelectorModal } from '@/components/ModelSelectorModal';
import {
  checkCodexPlatformSupport,
  disconnectProvider,
  fetchProviderModels,
  getActiveProviderId,
  getProviderAuthMethod,
  getProviderConfig,
  getSupportedProviders,
  initiateOpenRouterOAuth,
  isProviderConfigured,
  PROVIDERS,
  saveProviderAuthMethod,
  saveProviderConfig,
  type OpenAIAuthMode,
  type SupportedProviderId,
  validateProviderConnection,
} from '@/services/llm-providers';
import { triggerAutomaticInboxProcessing } from '@/services/inbox';

export default function AjustesScreen() {
  const theme = useTheme();
  const providers = getSupportedProviders();

  const [activeProviderId, setActiveProviderId] = useState<SupportedProviderId>('minimax');
  const [selectedProviderId, setSelectedProviderId] = useState<SupportedProviderId>('minimax');
  const [openAiAuthMethod, setOpenAiAuthMethod] = useState<OpenAIAuthMode>('apiKey');

  // Valores activos en el sistema
  const [activeModel, setActiveModel] = useState('');
  const [activeApiKey, setActiveApiKey] = useState('');
  const [activeBaseUrl, setActiveBaseUrl] = useState('');

  // Valores en edición para el proveedor seleccionado
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [isCurrentConfigured, setIsCurrentConfigured] = useState(false);

  // Estado del selector de modelos
  const [modelos, setModelos] = useState<string[]>([]);
  const [cargandoModelos, setCargandoModelos] = useState(false);
  const [errorModelos, setErrorModelos] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  // Estados de carga y validación
  const [saving, setSaving] = useState(false);
  const [authenticatingOAuth, setAuthenticatingOAuth] = useState(false);

  const isWeb = Platform.OS === 'web';

  // Carga inicial de estado desde SecureStore
  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (Platform.OS === 'web') return;
      try {
        const currentActive = await getActiveProviderId();
        const activeConfig = await getProviderConfig(currentActive);
        if (!isMounted) return;

        setActiveProviderId(currentActive);
        setSelectedProviderId(currentActive);

        setActiveBaseUrl(activeConfig.baseUrl);
        setActiveApiKey(activeConfig.apiKey);
        setActiveModel(activeConfig.model);

        setBaseUrl(activeConfig.baseUrl);
        setApiKey(activeConfig.apiKey);
        setModel(activeConfig.model);

        const configured = await isProviderConfigured(currentActive);
        if (isMounted) setIsCurrentConfigured(configured);

        const openAiMethod = await getProviderAuthMethod('openai');
        if (isMounted) {
          setOpenAiAuthMethod(openAiMethod === 'chatgpt-codex' ? 'chatgpt-codex' : 'apiKey');
        }
      } catch {
        // Retener defaults en caso de fallo
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  // Al cambiar de proveedor seleccionado en las pestañas
  const handleSelectProvider = async (providerId: SupportedProviderId) => {
    setSelectedProviderId(providerId);
    setModelos([]);
    setErrorModelos(null);

    if (providerId === 'openai') {
      try {
        const method = await getProviderAuthMethod('openai');
        setOpenAiAuthMethod(method === 'chatgpt-codex' ? 'chatgpt-codex' : 'apiKey');
      } catch {
        setOpenAiAuthMethod('apiKey');
      }
    }

    try {
      const config = await getProviderConfig(providerId);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setModel(config.model);
      const configured = await isProviderConfigured(providerId);
      setIsCurrentConfigured(configured);
    } catch {
      const def = PROVIDERS[providerId];
      setBaseUrl(def.defaultBaseUrl);
      setApiKey('');
      setModel(def.defaultModel);
      setIsCurrentConfigured(false);
    }
  };

  const selectedProvider = PROVIDERS[selectedProviderId];
  const activeProvider = PROVIDERS[activeProviderId];

  // Cálculo de si el proveedor activo tiene conexión válida configurada
  const isConnectionActive = Boolean(
    activeApiKey.trim().length > 0 &&
      (!activeProvider.requiresCustomBaseUrl || activeBaseUrl.trim().length > 0) &&
      activeModel.trim().length > 0,
  );

  const guardar = async () => {
    if (isWeb) {
      Alert.alert('No disponible', 'El almacenamiento seguro no está disponible en la web.');
      return;
    }

    if (selectedProvider.requiresCustomBaseUrl && !baseUrl.trim()) {
      Alert.alert('Error', 'La Base URL no puede estar vacía para el proveedor personalizado.');
      return;
    }

    if (selectedProviderId === 'openai' && openAiAuthMethod === 'chatgpt-codex') {
      const codexCheck = checkCodexPlatformSupport();
      if (!codexCheck.supported) {
        Alert.alert(
          'Modo no disponible en esta plataforma',
          `${codexCheck.reason}\n\nPara activar OpenAI, selecciona el método 'API Key'.`,
        );
        return;
      }
    }

    if (!apiKey.trim()) {
      Alert.alert('Error', `La API Key para ${selectedProvider.name} no puede estar vacía.`);
      return;
    }
    if (!model.trim()) {
      Alert.alert('Error', 'El modelo no puede estar vacío.');
      return;
    }

    setSaving(true);
    try {
      // Validación previa mediante petición mínima segura
      const validation = await validateProviderConnection(selectedProviderId, {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      });

      if (!validation.ok) {
        Alert.alert(
          'Fallo de validación',
          `${validation.error ?? 'No se pudo verificar la clave.'}\n\nLa configuración activa anterior se ha mantenido sin cambios.`,
        );
        return;
      }

      // Solo si la validación es exitosa se persiste y se activa
      await saveProviderConfig(selectedProviderId, {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        makeActive: true,
      });

      if (selectedProviderId === 'openai') {
        await saveProviderAuthMethod('openai', openAiAuthMethod);
      }

      await SecureStore.setItemAsync('hasOnboarded', 'true');

      // Actualizar de inmediato el estado activo reflejado en la tarjeta superior
      setActiveProviderId(selectedProviderId);
      setActiveModel(model.trim());
      setActiveApiKey(apiKey.trim());
      setActiveBaseUrl(baseUrl.trim());
      setIsCurrentConfigured(true);

      // Reintento fire-and-forget de capturas pendientes tras un guardado válido.
      // No bloquea ni la navegación ni el guardado: el mutex del inbox absorbe la pasada.
      void triggerAutomaticInboxProcessing({ force: true });

      Alert.alert(
        'Conexión exitosa',
        `Conexión verificada correctamente con ${selectedProvider.name}. Es ahora tu proveedor activo.`,
      );
    } catch (err) {
      Alert.alert('Error', `No se pudo guardar la configuración: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthLogin = async () => {
    if (selectedProviderId !== 'openrouter') return;

    setAuthenticatingOAuth(true);
    try {
      const result = await initiateOpenRouterOAuth();

      if (result.cancelled) {
        Alert.alert('Autenticación cancelada', 'Se conserva la configuración anterior.');
        return;
      }

      if (result.error) {
        Alert.alert('Error de autenticación', result.error);
        return;
      }

      if (result.apiKey) {
        setApiKey(result.apiKey);
        // Validar y guardar con la nueva clave obtenida por OAuth
        const validation = await validateProviderConnection('openrouter', {
          apiKey: result.apiKey,
          model: model.trim() || selectedProvider.defaultModel,
        });

        if (validation.ok) {
          await saveProviderConfig('openrouter', {
            apiKey: result.apiKey,
            model: model.trim() || selectedProvider.defaultModel,
            makeActive: true,
          });
          setActiveProviderId('openrouter');
          setActiveApiKey(result.apiKey);
          setActiveModel(model.trim() || selectedProvider.defaultModel);
          setIsCurrentConfigured(true);
          Alert.alert('Conectado', 'Cuenta de OpenRouter conectada y validada correctamente.');
        } else {
          Alert.alert('Aviso', 'Se obtuvo la clave pero falló la validación inicial.');
        }
      }
    } catch (err) {
      Alert.alert('Error', `Fallo al iniciar sesión: ${(err as Error).message}`);
    } finally {
      setAuthenticatingOAuth(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      `¿Desconectar ${selectedProvider.name}?`,
      'Se eliminarán las credenciales guardadas en este dispositivo para este proveedor.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar',
          style: 'destructive',
          onPress: async () => {
            try {
              await disconnectProvider(selectedProviderId);
              setApiKey('');
              setModel(selectedProvider.defaultModel);
              setBaseUrl(selectedProvider.defaultBaseUrl);
              setIsCurrentConfigured(false);

              if (selectedProviderId === 'openai') {
                setOpenAiAuthMethod('apiKey');
              }

              if (selectedProviderId === activeProviderId) {
                setActiveApiKey('');
              }
              Alert.alert('Desconectado', `Las credenciales de ${selectedProvider.name} han sido eliminadas.`);
            } catch (err) {
              Alert.alert('Error', `No se pudo desconectar: ${(err as Error).message}`);
            }
          },
        },
      ],
    );
  };

  const consultarModelos = async () => {
    if (isWeb) return;

    if (!apiKey.trim()) {
      setErrorModelos(`Introduce la API Key para ${selectedProvider.name} primero.`);
      return;
    }
    if (selectedProvider.requiresCustomBaseUrl && !baseUrl.trim()) {
      setErrorModelos('Introduce la Base URL primero.');
      return;
    }

    setCargandoModelos(true);
    setErrorModelos(null);

    try {
      const ids = await fetchProviderModels(selectedProviderId, {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      });
      setModelos(ids);
      // No seleccionamos silenciosamente el primer modelo: respetamos la elección del usuario
    } catch (err) {
      setErrorModelos((err as Error).message);
    } finally {
      setCargandoModelos(false);
    }
  };

  const abrirSelectorModelos = () => {
    setModalVisible(true);
    if (modelos.length === 0 && apiKey.trim()) {
      void consultarModelos();
    }
  };

  const supportsOAuth = selectedProvider.authMethods.includes('oauth');

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={[]}
    >
      <Stack.Screen options={{ title: 'Ajustes' }} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: BottomTabInset + NoteSpacing['2xl'] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSection}>
          <Text style={[styles.title, { color: theme.notes.text.primary }]}>
            Ajustes
          </Text>
          <Text style={[styles.subtitle, { color: theme.notes.text.muted }]}>
            Configuración de IA y conexión
          </Text>
        </View>

        {/* Notificación para navegador Web */}
        {isWeb && (
          <View
            style={[
              styles.webBanner,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.strong,
              },
            ]}
          >
            <Text style={[styles.webBannerTitle, { color: theme.notes.semantic.warning }]}>
              Almacenamiento seguro no disponible en Web
            </Text>
            <Text style={[styles.webBannerText, { color: theme.notes.text.secondary }]}>
              CoreOS guarda tus claves de API de manera cifrada en el Keychain del dispositivo.
              Para configurar tu proveedor de IA, abre la aplicación en un dispositivo iOS o Android.
            </Text>
          </View>
        )}

        {/* Tarjeta de estado activo superior */}
        <View
          style={[
            styles.statusCard,
            {
              backgroundColor: theme.notes.bg.surface,
              borderColor: theme.notes.border.subtle,
            },
          ]}
        >
          <View style={styles.statusHeaderRow}>
            <View style={styles.statusTitleGroup}>
              <Text style={[styles.statusCardPretitle, { color: theme.notes.text.muted }]}>
                CONFIGURACIÓN ACTIVA
              </Text>
              <Text style={[styles.statusCardTitle, { color: theme.notes.text.primary }]}>
                {activeProvider?.name ?? 'MiniMax'}
              </Text>
            </View>

            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: isConnectionActive
                    ? theme.notes.accent.primaryDim
                    : theme.notes.bg.elevated,
                  borderColor: isConnectionActive
                    ? theme.notes.semantic.success
                    : theme.notes.border.subtle,
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isConnectionActive
                      ? theme.notes.semantic.success
                      : theme.notes.semantic.warning,
                  },
                ]}
              />
              <Text
                style={[
                  styles.statusPillText,
                  {
                    color: isConnectionActive
                      ? theme.notes.semantic.success
                      : theme.notes.semantic.warning,
                  },
                ]}
              >
                {isConnectionActive ? 'Conectado' : 'Pendiente'}
              </Text>
            </View>
          </View>

          <View style={[styles.statusDivider, { backgroundColor: theme.notes.border.subtle }]} />

          <View style={styles.statusDetailRow}>
            <View style={styles.statusDetailItem}>
              <Text style={[styles.statusDetailLabel, { color: theme.notes.text.muted }]}>
                Modelo en uso
              </Text>
              <Text
                ellipsizeMode="middle"
                numberOfLines={1}
                style={[styles.statusDetailValue, { color: theme.notes.text.primary }]}
              >
                {activeModel || activeProvider?.defaultModel || 'Sin configurar'}
              </Text>
            </View>
            <View style={styles.statusDetailItem}>
              <Text style={[styles.statusDetailLabel, { color: theme.notes.text.muted }]}>
                Transporte
              </Text>
              <Text style={[styles.statusDetailValue, { color: theme.notes.text.secondary }]}>
                OpenAI Compatible
              </Text>
            </View>
          </View>
        </View>

        {/* Selector de proveedor por pestañas */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
            PROVEEDOR
          </Text>

          <View style={styles.providerTabs}>
            {providers.map((p) => {
              const isSelected = p.id === selectedProviderId;
              const isActive = p.id === activeProviderId;
              return (
                <TouchableOpacity
                  activeOpacity={0.75}
                  key={p.id}
                  onPress={() => handleSelectProvider(p.id)}
                  style={[
                    styles.providerTab,
                    {
                      backgroundColor: isSelected
                        ? theme.notes.bg.elevated
                        : theme.notes.bg.surface,
                      borderColor: isSelected
                        ? theme.notes.accent.primary
                        : theme.notes.border.subtle,
                    },
                  ]}
                >
                  <View style={styles.providerTabHeader}>
                    <Text
                      style={[
                        styles.providerTabText,
                        {
                          color: isSelected
                            ? theme.notes.text.primary
                            : theme.notes.text.secondary,
                          fontWeight: isSelected ? '700' : '500',
                        },
                      ]}
                    >
                      {p.name}
                    </Text>
                    {isActive && (
                      <View
                        style={[
                          styles.activeMiniBadge,
                          { backgroundColor: theme.notes.accent.primaryDim },
                        ]}
                      >
                        <Text
                          style={[
                            styles.activeMiniBadgeText,
                            { color: theme.notes.accent.primary },
                          ]}
                        >
                          Activo
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Ajustes de conexión del proveedor seleccionado */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
            AUTENTICACIÓN — {selectedProvider.name.toUpperCase()}
          </Text>

          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
              },
            ]}
          >
            {/* Si es OpenAI, selector de método: API Key vs ChatGPT / Codex */}
            {selectedProvider.id === 'openai' && (
              <View style={[styles.authMethodSelector, { borderColor: theme.notes.border.subtle }]}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    setOpenAiAuthMethod('apiKey');
                  }}
                  style={[
                    styles.authMethodTab,
                    {
                      backgroundColor:
                        openAiAuthMethod === 'apiKey'
                          ? theme.notes.bg.elevated
                          : theme.notes.bg.surface,
                      borderColor:
                        openAiAuthMethod === 'apiKey'
                          ? theme.notes.accent.primary
                          : theme.notes.border.subtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.authMethodTabText,
                      {
                        color:
                          openAiAuthMethod === 'apiKey'
                            ? theme.notes.text.primary
                            : theme.notes.text.secondary,
                        fontWeight: openAiAuthMethod === 'apiKey' ? '700' : '500',
                      },
                    ]}
                  >
                    API Key
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    setOpenAiAuthMethod('chatgpt-codex');
                  }}
                  style={[
                    styles.authMethodTab,
                    {
                      backgroundColor:
                        openAiAuthMethod === 'chatgpt-codex'
                          ? theme.notes.bg.elevated
                          : theme.notes.bg.surface,
                      borderColor:
                        openAiAuthMethod === 'chatgpt-codex'
                          ? theme.notes.accent.primary
                          : theme.notes.border.subtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.authMethodTabText,
                      {
                        color:
                          openAiAuthMethod === 'chatgpt-codex'
                            ? theme.notes.text.primary
                            : theme.notes.text.secondary,
                        fontWeight: openAiAuthMethod === 'chatgpt-codex' ? '700' : '500',
                      },
                    ]}
                  >
                    ChatGPT / Codex
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Vista condicional: Modo ChatGPT / Codex vs Modo API Key / Proveedores estándar */}
            {selectedProvider.id === 'openai' && openAiAuthMethod === 'chatgpt-codex' ? (
              <View style={styles.codexContainer}>
                <View
                  style={[
                    styles.codexStatusCard,
                    {
                      backgroundColor: theme.notes.bg.elevated,
                      borderColor: theme.notes.border.subtle,
                    },
                  ]}
                >
                  <View style={styles.codexHeaderRow}>
                    <Text style={[styles.codexTitle, { color: theme.notes.text.primary }]}>
                      Suscripción de ChatGPT (Codex)
                    </Text>
                    <View
                      style={[
                        styles.codexBadge,
                        {
                          backgroundColor: 'rgba(199, 125, 42, 0.12)',
                          borderColor: theme.notes.semantic.warning,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.codexBadgeText,
                          { color: theme.notes.semantic.warning },
                        ]}
                      >
                        No disponible en iOS
                      </Text>
                    </View>
                  </View>

                  <Text style={[styles.codexDescription, { color: theme.notes.text.secondary }]}>
                    Permite utilizar los límites de Codex incluidos en tu suscripción de ChatGPT Plus, Pro o Team mediante autenticación OAuth gestionada.
                  </Text>

                  <View
                    style={[
                      styles.codexBlockerBox,
                      {
                        backgroundColor: theme.notes.bg.surface,
                        borderColor: theme.notes.border.subtle,
                      },
                    ]}
                  >
                    <Text style={[styles.codexBlockerTitle, { color: theme.notes.text.primary }]}>
                      🔒 Requisito técnico de runtime
                    </Text>
                    <Text style={[styles.codexBlockerText, { color: theme.notes.text.secondary }]}>
                      OpenAI únicamente ofrece este acceso a través del daemon oficial Codex App Server (CLI en escritorio). En iOS / Expo no es posible ejecutar daemons en segundo plano ni procesos nativos, y OpenAI no dispone de un SDK móvil ni de un flujo OAuth público para clientes móviles sin backend.
                    </Text>
                    <Text style={[styles.codexBlockerText, { color: theme.notes.text.muted }]}>
                      Para respetar la arquitectura local-first de CoreOS y evitar workarounds no soportados (como extracción de tokens o ingeniería inversa), esta opción se encuentra deshabilitada en esta plataforma.
                    </Text>
                  </View>

                  <ButtonBrand
                    disabled
                    onPress={() => {}}
                    size="md"
                    title="Continuar con ChatGPT (Codex)"
                    variant="secondary"
                  />
                </View>

                {/* Botón de desconexión */}
                {isCurrentConfigured && !isWeb && (
                  <View style={styles.disconnectContainer}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={handleDisconnect}
                      style={styles.disconnectButton}
                    >
                      <Text style={[styles.disconnectText, { color: theme.notes.semantic.danger }]}>
                        Desconectar {selectedProvider.name}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              // Modo estándar API Key / Proveedores normales
              <>
                {/* Nota explicativa de consumo vs API */}
                {selectedProvider.subscriptionNote && (
                  <View
                    style={[
                      styles.subscriptionCallout,
                      {
                        backgroundColor: theme.notes.bg.elevated,
                        borderColor: theme.notes.border.subtle,
                      },
                    ]}
                  >
                    <Text style={[styles.subscriptionCalloutText, { color: theme.notes.text.secondary }]}>
                      💡 {selectedProvider.subscriptionNote}
                    </Text>
                  </View>
                )}

                {/* Si el proveedor ofrece OAuth oficial, mostrar botón de conexión */}
                {supportsOAuth && (
                  <View style={styles.oauthSection}>
                    <ButtonBrand
                      disabled={authenticatingOAuth || isWeb}
                      loading={authenticatingOAuth}
                      onPress={handleOAuthLogin}
                      size="md"
                      title="Conectar con OpenRouter (OAuth)"
                      variant="secondary"
                    />
                    <View style={styles.dividerRow}>
                      <View style={[styles.dividerLine, { backgroundColor: theme.notes.border.subtle }]} />
                      <Text style={[styles.dividerText, { color: theme.notes.text.muted }]}>
                        o mediante API Key
                      </Text>
                      <View style={[styles.dividerLine, { backgroundColor: theme.notes.border.subtle }]} />
                    </View>
                  </View>
                )}

                {/* Base URL */}
                {selectedProvider.requiresCustomBaseUrl ? (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.notes.text.primary }]}>
                      Base URL (compatible con OpenAI)
                    </Text>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      onChangeText={setBaseUrl}
                      placeholder="http://localhost:11434/v1"
                      placeholderTextColor={theme.notes.text.muted}
                      style={[
                        styles.input,
                        {
                          backgroundColor: theme.notes.bg.elevated,
                          borderColor: theme.notes.border.strong,
                          color: theme.notes.text.primary,
                        },
                      ]}
                      value={baseUrl}
                    />
                    <Text style={[styles.hint, { color: theme.notes.text.muted }]}>
                      Servidor local (Ollama, LM Studio) o proxy compatible con Chat Completions.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.notes.text.muted }]}>
                      Endpoint oficial
                    </Text>
                    <Text style={[styles.readOnlyUrl, { color: theme.notes.text.secondary }]}>
                      {selectedProvider.defaultBaseUrl}
                    </Text>
                  </View>
                )}

                {/* Formulario de API Key */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: theme.notes.text.primary }]}>
                    API Key
                  </Text>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setApiKey}
                    placeholder={selectedProvider.id === 'custom' ? 'sk-... (opcional si es local)' : 'sk-...'}
                    placeholderTextColor={theme.notes.text.muted}
                    secureTextEntry
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.notes.bg.elevated,
                        borderColor: theme.notes.border.strong,
                        color: theme.notes.text.primary,
                      },
                    ]}
                    value={apiKey}
                  />
                  {!isWeb && (
                    <Text style={[styles.hint, { color: theme.notes.text.muted }]}>
                      Se almacena de forma segura en el Keychain del dispositivo.
                    </Text>
                  )}
                </View>

                {/* Selector de Modelo con modal */}
                <View style={styles.field}>
                  <Text style={[styles.label, { color: theme.notes.text.primary }]}>
                    Modelo seleccionado
                  </Text>

                  <View
                    style={[
                      styles.modelSelectionCard,
                      {
                        backgroundColor: theme.notes.bg.elevated,
                        borderColor: theme.notes.border.strong,
                      },
                    ]}
                  >
                    <View style={styles.modelTextContainer}>
                      <Text
                        ellipsizeMode="middle"
                        numberOfLines={1}
                        style={[styles.modelNameDisplay, { color: theme.notes.text.primary }]}
                      >
                        {model || selectedProvider.defaultModel || 'Sin modelo seleccionado'}
                      </Text>
                      <Text style={[styles.modelProviderCaption, { color: theme.notes.text.muted }]}>
                        Proveedor: {selectedProvider.name}
                      </Text>
                    </View>

                    <ButtonBrand
                      onPress={abrirSelectorModelos}
                      size="sm"
                      title="Elegir modelo"
                      variant="secondary"
                    />
                  </View>
                </View>

                {/* Botón de desconexión si el proveedor ya está configurado */}
                {isCurrentConfigured && !isWeb && (
                  <View style={styles.disconnectContainer}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={handleDisconnect}
                      style={styles.disconnectButton}
                    >
                      <Text style={[styles.disconnectText, { color: theme.notes.semantic.danger }]}>
                        Desconectar {selectedProvider.name}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        {/* Botón de guardar / activar con validación previa */}
        {!isWeb && (
          <View style={styles.buttonContainer}>
            {selectedProviderId === 'openai' && openAiAuthMethod === 'chatgpt-codex' ? (
              <View
                style={[
                  styles.disabledActionNote,
                  {
                    backgroundColor: theme.notes.bg.elevated,
                    borderColor: theme.notes.border.subtle,
                  },
                ]}
              >
                <Text style={[styles.disabledActionNoteText, { color: theme.notes.text.muted }]}>
                  El modo ChatGPT / Codex no puede activarse en iOS. Cambia a «API Key» para configurar y conectar OpenAI.
                </Text>
              </View>
            ) : (
              <ButtonBrand
                disabled={saving}
                loading={saving}
                onPress={guardar}
                size="md"
                title={
                  saving
                    ? 'Verificando conexión…'
                    : selectedProviderId === activeProviderId
                      ? 'Verificar y Guardar'
                      : `Verificar y Activar ${selectedProvider.name}`
                }
                variant="primary"
              />
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal de selección de modelo */}
      <ModelSelectorModal
        error={errorModelos}
        loading={cargandoModelos}
        models={modelos}
        onClose={() => setModalVisible(false)}
        onRetry={consultarModelos}
        onSelectModel={(selected) => setModel(selected)}
        providerName={selectedProvider.name}
        selectedModel={model}
        visible={modalVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.lg,
  },
  headerSection: {
    marginBottom: NoteSpacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
  },
  webBanner: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.md,
    marginBottom: NoteSpacing.lg,
    gap: 4,
  },
  webBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  webBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.lg,
    marginBottom: NoteSpacing.xl,
    gap: NoteSpacing.md,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusTitleGroup: {
    gap: 2,
  },
  statusCardPretitle: {
    fontFamily: 'ui-monospace',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  statusCardTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.sm,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusDivider: {
    height: 1,
    width: '100%',
  },
  statusDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: NoteSpacing.md,
  },
  statusDetailItem: {
    flex: 1,
    gap: 2,
  },
  statusDetailLabel: {
    fontSize: 12,
  },
  statusDetailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    marginBottom: NoteSpacing.xl,
  },
  sectionTitle: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: NoteSpacing.md,
  },
  providerTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: NoteSpacing.sm,
  },
  providerTab: {
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: '47%',
    flex: 1,
  },
  providerTabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerTabText: {
    fontSize: 14,
  },
  activeMiniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.sm,
  },
  activeMiniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  card: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.lg,
    gap: NoteSpacing.lg,
  },
  subscriptionCallout: {
    borderWidth: 1,
    borderRadius: Radii.sm,
    padding: NoteSpacing.md,
  },
  subscriptionCalloutText: {
    fontSize: 13,
    lineHeight: 18,
  },
  oauthSection: {
    gap: NoteSpacing.md,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: NoteSpacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 12,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  readOnlyUrl: {
    fontSize: 13,
    fontFamily: 'ui-monospace',
  },
  input: {
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  modelSelectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: NoteSpacing.sm,
  },
  modelTextContainer: {
    flex: 1,
    gap: 2,
  },
  modelNameDisplay: {
    fontSize: 15,
    fontWeight: '600',
  },
  modelProviderCaption: {
    fontSize: 12,
  },
  disconnectContainer: {
    paddingTop: NoteSpacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  disconnectButton: {
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  disconnectText: {
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    marginTop: 2,
  },
  buttonContainer: {
    marginTop: NoteSpacing.sm,
  },
  authMethodSelector: {
    flexDirection: 'row',
    borderRadius: Radii.md,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  authMethodTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  authMethodTabText: {
    fontSize: 13,
  },
  codexContainer: {
    gap: NoteSpacing.lg,
  },
  codexStatusCard: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.md,
    gap: NoteSpacing.sm,
  },
  codexHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: NoteSpacing.xs,
  },
  codexTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  codexBadge: {
    borderWidth: 1,
    borderRadius: Radii.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  codexBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  codexDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  codexBlockerBox: {
    borderWidth: 1,
    borderRadius: Radii.sm,
    padding: NoteSpacing.sm,
    gap: 6,
  },
  codexBlockerTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  codexBlockerText: {
    fontSize: 12,
    lineHeight: 16,
  },
  disabledActionNote: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.md,
    alignItems: 'center',
  },
  disabledActionNoteText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});