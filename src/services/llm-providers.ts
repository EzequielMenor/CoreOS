import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export type ProviderId = 'minimax' | 'openai' | 'openrouter' | 'custom' | 'anthropic' | 'gemini';
export type SupportedProviderId = 'minimax' | 'openai' | 'openrouter' | 'custom';
export type AuthMethod = 'apiKey' | 'oauth' | 'chatgpt-codex';
export type OpenAIAuthMode = 'apiKey' | 'chatgpt-codex';
export type TransportType = 'openai-compatible' | 'anthropic' | 'gemini';
export type ProviderStatus = 'ready' | 'coming-soon';

export interface LLMProvider {
  id: ProviderId;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
  authMethods: AuthMethod[];
  transport: TransportType;
  status: ProviderStatus;
  supportsModelList: boolean;
  requiresCustomBaseUrl?: boolean;
  subscriptionNote?: string;
  getHeaders?: (apiKey: string) => Record<string, string>;
}

export const PROVIDERS: Record<ProviderId, LLMProvider> = {
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-Text-01',
    authMethods: ['apiKey'],
    transport: 'openai-compatible',
    status: 'ready',
    supportsModelList: true,
    subscriptionNote: 'Obtén tu API Key desde la plataforma oficial platform.minimaxi.com.',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    authMethods: ['apiKey', 'chatgpt-codex'],
    transport: 'openai-compatible',
    status: 'ready',
    supportsModelList: true,
    subscriptionNote:
      'Una suscripción de ChatGPT Plus o Team no incluye acceso a la API comercial de OpenAI. El acceso vía suscripción oficial de Codex requiere un entorno desktop (App Server).',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    authMethods: ['apiKey', 'oauth'],
    transport: 'openai-compatible',
    status: 'ready',
    supportsModelList: true,
    subscriptionNote:
      'Conecta tu cuenta mediante OAuth oficial o introduce tu API Key desde openrouter.ai/keys.',
    getHeaders: (apiKey: string) => ({
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/EzequielMenor/CoreOS',
      'X-Title': 'CoreOS',
    }),
  },
  custom: {
    id: 'custom',
    name: 'Personalizado',
    defaultBaseUrl: '',
    defaultModel: '',
    authMethods: ['apiKey'],
    transport: 'openai-compatible',
    status: 'ready',
    supportsModelList: true,
    requiresCustomBaseUrl: true,
    subscriptionNote:
      'Compatible con servidores locales (Ollama con /v1, LM Studio) o proxies compatibles con OpenAI.',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    authMethods: ['apiKey'],
    transport: 'anthropic',
    status: 'coming-soon',
    supportsModelList: false,
    subscriptionNote:
      'Una suscripción de Claude Pro no incluye acceso a la API de Anthropic.',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-1.5-flash',
    authMethods: ['apiKey'],
    transport: 'gemini',
    status: 'coming-soon',
    supportsModelList: false,
    subscriptionNote:
      'Las suscripciones de Gemini Advanced de consumo no corresponden a las claves de Google AI Studio.',
  },
};

export const SECURE_KEYS = {
  LEGACY_BASE_URL: 'llm.baseUrl',
  LEGACY_API_KEY: 'llm.apiKey',
  LEGACY_MODEL: 'llm.model',
  ACTIVE_PROVIDER: 'llm.activeProvider',
  providerApiKey: (id: string) => `llm.provider.${id}.apiKey`,
  providerModel: (id: string) => `llm.provider.${id}.model`,
  providerBaseUrl: (id: string) => `llm.provider.${id}.baseUrl`,
  providerAuthMethod: (id: string) => `llm.provider.${id}.authMethod`,
} as const;

export function getSupportedProviders(): (LLMProvider & { id: SupportedProviderId })[] {
  return Object.values(PROVIDERS).filter((p) => p.status === 'ready') as (LLMProvider & {
    id: SupportedProviderId;
  })[];
}

export function isSupportedProvider(id: string): id is SupportedProviderId {
  return id in PROVIDERS && PROVIDERS[id as ProviderId].status === 'ready';
}

export function getProvider(id: string): LLMProvider | undefined {
  if (id in PROVIDERS) {
    return PROVIDERS[id as ProviderId];
  }
  return undefined;
}

export async function migrateLegacyConfigIfNeeded(): Promise<void> {
  if (Platform.OS === 'web') return;

  const activeProvider = await SecureStore.getItemAsync(SECURE_KEYS.ACTIVE_PROVIDER);
  if (activeProvider) {
    return; // Ya migrado
  }

  // Leer claves legacy
  const [legacyBaseUrl, legacyApiKey, legacyModel] = await Promise.all([
    SecureStore.getItemAsync(SECURE_KEYS.LEGACY_BASE_URL),
    SecureStore.getItemAsync(SECURE_KEYS.LEGACY_API_KEY),
    SecureStore.getItemAsync(SECURE_KEYS.LEGACY_MODEL),
  ]);

  if (!legacyApiKey && !legacyBaseUrl && !legacyModel) {
    await SecureStore.setItemAsync(SECURE_KEYS.ACTIVE_PROVIDER, 'minimax');
    return;
  }

  // Deducir proveedor previo
  let detectedProvider: SupportedProviderId = 'minimax';
  const url = (legacyBaseUrl ?? '').toLowerCase();

  if (url.includes('openai.com')) {
    detectedProvider = 'openai';
  } else if (url.includes('openrouter.ai')) {
    detectedProvider = 'openrouter';
  } else if (url && !url.includes('minimax.io')) {
    detectedProvider = 'custom';
  } else {
    detectedProvider = 'minimax';
  }

  const tasks: Promise<void>[] = [
    SecureStore.setItemAsync(SECURE_KEYS.ACTIVE_PROVIDER, detectedProvider),
  ];

  if (legacyApiKey) {
    tasks.push(SecureStore.setItemAsync(SECURE_KEYS.providerApiKey(detectedProvider), legacyApiKey));
  }
  if (legacyModel) {
    tasks.push(SecureStore.setItemAsync(SECURE_KEYS.providerModel(detectedProvider), legacyModel));
  }
  if (legacyBaseUrl) {
    tasks.push(SecureStore.setItemAsync(SECURE_KEYS.providerBaseUrl(detectedProvider), legacyBaseUrl));
  }

  await Promise.all(tasks);
}

export interface ProviderStoredConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export async function getProviderConfig(providerId: SupportedProviderId): Promise<ProviderStoredConfig> {
  const provider = PROVIDERS[providerId];
  if (Platform.OS === 'web') {
    return {
      apiKey: '',
      model: provider?.defaultModel ?? '',
      baseUrl: provider?.defaultBaseUrl ?? '',
    };
  }

  await migrateLegacyConfigIfNeeded();

  const [apiKey, model, baseUrl] = await Promise.all([
    SecureStore.getItemAsync(SECURE_KEYS.providerApiKey(providerId)),
    SecureStore.getItemAsync(SECURE_KEYS.providerModel(providerId)),
    SecureStore.getItemAsync(SECURE_KEYS.providerBaseUrl(providerId)),
  ]);

  return {
    apiKey: apiKey ?? '',
    model: model || provider.defaultModel,
    baseUrl: baseUrl || provider.defaultBaseUrl,
  };
}

export async function isProviderConfigured(providerId: SupportedProviderId): Promise<boolean> {
  const config = await getProviderConfig(providerId);
  const provider = PROVIDERS[providerId];
  if (!config.apiKey.trim() && providerId !== 'custom') {
    return false;
  }
  if (provider.requiresCustomBaseUrl && !config.baseUrl.trim()) {
    return false;
  }
  return true;
}

export async function getActiveProviderId(): Promise<SupportedProviderId> {
  if (Platform.OS === 'web') return 'minimax';

  await migrateLegacyConfigIfNeeded();

  const stored = await SecureStore.getItemAsync(SECURE_KEYS.ACTIVE_PROVIDER);
  if (stored && isSupportedProvider(stored)) {
    return stored;
  }
  return 'minimax';
}

export async function setActiveProvider(providerId: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('SecureStore no está disponible en web.');
  }

  if (!isSupportedProvider(providerId)) {
    throw new Error(`El proveedor "${providerId}" no está soportado o aún no está disponible.`);
  }

  await SecureStore.setItemAsync(SECURE_KEYS.ACTIVE_PROVIDER, providerId);

  // Sincronizar claves legacy para mantener compatibilidad total con lectores existentes
  const config = await getProviderConfig(providerId);
  const tasks: Promise<void>[] = [
    SecureStore.setItemAsync(SECURE_KEYS.LEGACY_BASE_URL, config.baseUrl),
    SecureStore.setItemAsync(SECURE_KEYS.LEGACY_MODEL, config.model),
  ];
  if (config.apiKey) {
    tasks.push(SecureStore.setItemAsync(SECURE_KEYS.LEGACY_API_KEY, config.apiKey));
  } else {
    tasks.push(SecureStore.deleteItemAsync(SECURE_KEYS.LEGACY_API_KEY).catch(() => {}));
  }
  await Promise.all(tasks);
}

export async function saveProviderConfig(
  providerId: string,
  params: { apiKey?: string; model?: string; baseUrl?: string; makeActive?: boolean },
): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('SecureStore no está disponible en web.');
  }

  if (!isSupportedProvider(providerId)) {
    throw new Error(`El proveedor "${providerId}" no está soportado.`);
  }

  const tasks: Promise<unknown>[] = [];

  if (params.apiKey !== undefined) {
    tasks.push(SecureStore.setItemAsync(SECURE_KEYS.providerApiKey(providerId), params.apiKey.trim()));
  }
  if (params.model !== undefined) {
    tasks.push(SecureStore.setItemAsync(SECURE_KEYS.providerModel(providerId), params.model.trim()));
  }
  if (params.baseUrl !== undefined) {
    tasks.push(SecureStore.setItemAsync(SECURE_KEYS.providerBaseUrl(providerId), params.baseUrl.trim()));
  }

  await Promise.all(tasks);

  if (params.makeActive) {
    await setActiveProvider(providerId);
  } else {
    const active = await getActiveProviderId();
    if (active === providerId) {
      await setActiveProvider(providerId);
    }
  }
}

export interface CodexRuntimeCheck {
  supported: boolean;
  reason: string;
}

export function checkCodexPlatformSupport(): CodexRuntimeCheck {
  // El acceso oficial a la suscripción de ChatGPT mediante Codex requiere el daemon
  // local Codex App Server (codex-rs / CLI en macOS, Linux y Windows).
  // En iOS y Web (plataformas de CoreOS), el sandbox impide ejecutar daemons nativos
  // y OpenAI no ofrece un SDK o flujo OAuth público para clientes móviles sin backend.
  if (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web') {
    return {
      supported: false,
      reason:
        'El acceso mediante suscripción de ChatGPT requiere el runtime oficial de Codex App Server (disponible exclusivamente en entornos desktop/CLI como macOS, Linux y Windows). En iOS y Web, el sandbox del sistema no permite ejecutar procesos o daemons nativos en segundo plano, y OpenAI no ofrece un SDK móvil ni un flujo OAuth público para clientes móviles sin backend. Para respetar la arquitectura local-first de CoreOS y no usar endpoints privados ni tokens extraídos, esta opción se encuentra deshabilitada en esta plataforma.',
    };
  }

  return {
    supported: true,
    reason: 'Plataforma compatible con el runtime oficial de Codex App Server.',
  };
}

export async function getProviderAuthMethod(providerId: SupportedProviderId): Promise<AuthMethod> {
  if (Platform.OS === 'web') return 'apiKey';
  const val = await SecureStore.getItemAsync(SECURE_KEYS.providerAuthMethod(providerId));
  if (val === 'chatgpt-codex' || val === 'oauth' || val === 'apiKey') {
    return val as AuthMethod;
  }
  return 'apiKey';
}

export async function saveProviderAuthMethod(
  providerId: SupportedProviderId,
  method: AuthMethod,
): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(SECURE_KEYS.providerAuthMethod(providerId), method);
}

export async function disconnectProvider(providerId: SupportedProviderId): Promise<void> {
  if (Platform.OS === 'web') return;

  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_KEYS.providerApiKey(providerId)).catch(() => {}),
    SecureStore.deleteItemAsync(SECURE_KEYS.providerModel(providerId)).catch(() => {}),
    SecureStore.deleteItemAsync(SECURE_KEYS.providerBaseUrl(providerId)).catch(() => {}),
    SecureStore.deleteItemAsync(SECURE_KEYS.providerAuthMethod(providerId)).catch(() => {}),
  ]);

  const activeId = await getActiveProviderId();
  if (activeId === providerId) {
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_KEYS.LEGACY_API_KEY).catch(() => {}),
      SecureStore.deleteItemAsync(SECURE_KEYS.LEGACY_MODEL).catch(() => {}),
    ]);
  }
}

export async function validateProviderConnection(
  providerId: SupportedProviderId,
  params: { baseUrl?: string; apiKey?: string; model?: string },
): Promise<{ ok: boolean; error?: string }> {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    return { ok: false, error: 'Proveedor no soportado.' };
  }

  const apiKey = (params.apiKey ?? '').trim();
  const baseUrl = (params.baseUrl ?? provider.defaultBaseUrl).trim().replace(/\/$/, '');

  if (provider.requiresCustomBaseUrl && !baseUrl) {
    return { ok: false, error: 'La Base URL es obligatoria para el proveedor personalizado.' };
  }

  if (!apiKey && providerId !== 'custom') {
    return { ok: false, error: 'La API Key no puede estar vacía.' };
  }

  const headers: Record<string, string> = {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(provider.getHeaders ? provider.getHeaders(apiKey) : {}),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.status === 401) {
      return {
        ok: false,
        error: 'Credenciales inválidas (401 Unauthorized). Comprueba que tu API Key sea correcta y esté activa.',
      };
    }
    if (response.status === 403) {
      return {
        ok: false,
        error: 'Acceso denegado (403 Forbidden). Tu clave no cuenta con permisos suficientes.',
      };
    }
    if (!response.ok) {
      if (providerId === 'custom') {
        // En servidores personalizados que no implementen /models, no bloqueamos si responde
        return { ok: true };
      }
      return {
        ok: false,
        error: `Error de respuesta del proveedor (${response.status} ${response.statusText}).`,
      };
    }

    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.toLowerCase().includes('abort')) {
      return {
        ok: false,
        error: 'Tiempo de espera agotado al verificar las credenciales con el proveedor (10s).',
      };
    }
    return {
      ok: false,
      error: `No se pudo conectar con ${provider.name}. Comprueba tu conexión a internet o la URL base.`,
    };
  }
}

export async function initiateOpenRouterOAuth(): Promise<{
  apiKey?: string;
  error?: string;
  cancelled?: boolean;
}> {
  if (Platform.OS === 'web') {
    return { error: 'OAuth no está disponible en la versión web.' };
  }

  try {
    const redirectUrl = Linking.createURL('oauth');
    const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(redirectUrl)}`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { cancelled: true };
    }

    if (result.type === 'success' && result.url) {
      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code;
      if (typeof code === 'string') {
        const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (response.ok) {
          const json = (await response.json()) as { key?: string };
          if (json?.key) {
            return { apiKey: json.key };
          }
        }
        return { error: 'No se pudo canjear el código de autorización de OpenRouter.' };
      }
    }

    return { cancelled: true };
  } catch (err) {
    return { error: `Error durante la autenticación OAuth: ${(err as Error).message}` };
  }
}

export interface ActiveLLMConfig {
  providerId: SupportedProviderId;
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
}

export async function getActiveLLMConfig(): Promise<ActiveLLMConfig> {
  if (Platform.OS === 'web') {
    throw new Error('SecureStore no está disponible en web. Configura el proveedor de IA desde un dispositivo nativo.');
  }

  await migrateLegacyConfigIfNeeded();

  const providerId = await getActiveProviderId();
  const provider = PROVIDERS[providerId];
  const stored = await getProviderConfig(providerId);

  const authMethod = await getProviderAuthMethod(providerId);
  if (providerId === 'openai' && authMethod === 'chatgpt-codex') {
    const codexCheck = checkCodexPlatformSupport();
    if (!codexCheck.supported) {
      throw new Error(
        `ChatGPT / Codex no está disponible en esta plataforma (${Platform.OS}). Configura una API Key de OpenAI o utiliza el proveedor Personalizado.`,
      );
    }
  }

  if (!stored.apiKey.trim()) {
    throw new Error(`API Key no configurada para ${provider.name}. Ve a Ajustes y configura tu proveedor.`);
  }

  const baseUrl = stored.baseUrl.trim();
  if (provider.requiresCustomBaseUrl && !baseUrl) {
    throw new Error(`Base URL no configurada para el proveedor ${provider.name}. Ve a Ajustes.`);
  }

  const model = stored.model.trim() || provider.defaultModel;
  if (!model) {
    throw new Error(`Modelo no configurado para ${provider.name}. Ve a Ajustes.`);
  }

  const defaultHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${stored.apiKey.trim()}`,
  };

  const customHeaders = provider.getHeaders ? provider.getHeaders(stored.apiKey.trim()) : {};

  return {
    providerId,
    provider,
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey: stored.apiKey.trim(),
    model,
    headers: {
      ...defaultHeaders,
      ...customHeaders,
    },
  };
}

export async function fetchProviderModels(
  providerId: SupportedProviderId,
  override?: { baseUrl?: string; apiKey?: string; authMethod?: AuthMethod },
): Promise<string[]> {
  const provider = PROVIDERS[providerId];
  if (!provider || !provider.supportsModelList) {
    return [];
  }

  const effectiveAuthMethod =
    override?.authMethod ?? (await getProviderAuthMethod(providerId));

  // En ChatGPT/Codex, los modelos se obtienen dinámicamente mediante el protocolo
  // JSON-RPC de Codex App Server (model/list) cuando exista un runtime activo.
  if (providerId === 'openai' && effectiveAuthMethod === 'chatgpt-codex') {
    return [];
  }

  const stored = await getProviderConfig(providerId);
  const baseUrl = (override?.baseUrl ?? stored.baseUrl).trim().replace(/\/$/, '');
  const apiKey = (override?.apiKey ?? stored.apiKey).trim();

  if (!apiKey) {
    throw new Error(`Introduce la API Key para ${provider.name} primero.`);
  }

  if (provider.requiresCustomBaseUrl && !baseUrl) {
    throw new Error('Introduce la Base URL primero.');
  }

  const targetUrl = baseUrl || provider.defaultBaseUrl;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...(provider.getHeaders ? provider.getHeaders(apiKey) : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${targetUrl.replace(/\/$/, '')}/models`, { headers });
  } catch (err) {
    throw new Error(`Error de red al consultar modelos: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(
      `No se pudieron obtener los modelos (${response.status} ${response.statusText}). Revisa tus credenciales.`,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error('Respuesta inválida del servidor al listar modelos.');
  }

  const data = (json as Record<string, unknown>)?.data;
  if (!Array.isArray(data)) {
    throw new Error('El endpoint no devolvió una lista de modelos en el formato esperado.');
  }

  const models: string[] = data
    .map((item: unknown) => {
      if (
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof (item as { id: unknown }).id === 'string'
      ) {
        return (item as { id: string }).id;
      }
      return '';
    })
    .filter((id) => Boolean(id));

  return models.sort((a, b) => a.localeCompare(b));
}
