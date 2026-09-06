import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { InboxPipelineError } from './inbox-diagnostics';

const KEY_BASE_URL = 'llm.baseUrl';
const KEY_API_KEY = 'llm.apiKey';
const KEY_MODEL = 'llm.model';

const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MODEL = 'MiniMax-Text-01';

const SYSTEM_PROMPT = `Eres un router de inbox. Clasifica el texto del usuario en uno de estos tipos y devuelve SOLO JSON válido.

Tipos:

1. "nota" — ideas largas, reflexiones o conocimiento. El texto original ya está guardado; tú solo aportas clasificación y metadata.
   content: { "title"?: string, "tags"?: string[] }
   - "title": título corto sugerido (máx. 80 caracteres). Opcional.
   - "tags": 0-5 etiquetas cortas sugeridas. Opcional.
   - NO devuelvas el texto del usuario, NO lo reescribas, NO lo resumas, NO lo fragmentes. El cuerpo original ya está guardado.

2. "gasto" — dinero gastado o ingreso.
   content: { "amount": number, "description": string, "category": string, "date": string (ISO 8601 o "today") }

3. "tarea" — acción pendiente.
   content: { "title": string, "due_date": string (YYYY-MM-DD, ej. "2026-09-03") | null, "priority": "alta" | "media" | "baja" | null }

4. "habito" — rutinas y acciones repetitivas.
   content: { "habit_name": string, "status": "done" | "missed", "date": string }

5. "sueno" — registro de descanso.
   content: { "hours": number, "deep_sleep_percentage": number, "quality": string, "date": string }

Reglas:
- Responde SOLO con JSON válido. Sin markdown, sin \`\`\`json, sin explicaciones antes ni después.
- Formato obligatorio en la raíz: {"type": "<nota|gasto|tarea|habito|sueno>", "content": <objeto del tipo>}. "type" siempre en minúsculas.
- Ejemplo: {"type": "gasto", "content": {"amount": 4.5, "description": "Café", "category": "comida", "date": "today"}}
- Si dudas entre tipos, elige "nota".
IMPORTANTE: NO incluyas etiquetas , notas de razonamiento, ni texto introductorio. Responde ÚNICAMENTE con un JSON puro que siga estrictamente el esquema definido. Si no puedes cumplirlo, devuelve un objeto JSON con error: "failed".`;

export type RouteType = 'nota' | 'gasto' | 'tarea' | 'habito' | 'sueno';

// V1: el LLM solo aporta metadata para notas. El cuerpo es siempre
// inbox.raw_text (lo inserta dispatchRoutedResult, nunca el LLM).
export interface NotaContent {
  title?: string;
  tags?: string[];
}

export type RoutedResult = { type: 'nota'; content: NotaContent }
  | { type: Exclude<RouteType, 'nota'>; content: Record<string, unknown> };

// Fecha local en YYYY-MM-DD. Evita UTC: getFullYear/getMonth/getDate ya
// operan en la zona del dispositivo.
function localDateISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function getLLMConfig(): Promise<LLMConfig> {
  if (Platform.OS === 'web') {
    throw new InboxPipelineError('not_configured', 'secure_store_unavailable');
  }

  let values: [string | null, string | null, string | null];
  try {
    values = await Promise.all([
      SecureStore.getItemAsync(KEY_BASE_URL),
      SecureStore.getItemAsync(KEY_API_KEY),
      SecureStore.getItemAsync(KEY_MODEL),
    ]);
  } catch {
    throw new InboxPipelineError('not_configured', 'secure_store_read_failed');
  }
  const [baseUrl, apiKey, model] = values;

  if (!apiKey) {
    throw new InboxPipelineError('not_configured', 'api_key_missing');
  }

  return {
    baseUrl: baseUrl ?? DEFAULT_BASE_URL,
    apiKey,
    model: model ?? DEFAULT_MODEL,
  };
}

export async function processInboxText(text: string): Promise<RoutedResult> {
  const config = await getLLMConfig();
  const systemContent =
    `${SYSTEM_PROMPT}\nFecha local actual: ${localDateISO()}. Interpreta fechas relativas como hoy, mañana y pasado mañana respecto a esta fecha. Para tareas devuelve due_date siempre como YYYY-MM-DD.`;
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
      }),
    });
  } catch {
    throw new InboxPipelineError('network', 'fetch_failed');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new InboxPipelineError('authentication', `http_${response.status}`);
    }
    if (response.status === 429) {
      throw new InboxPipelineError('rate_limit', 'http_429');
    }
    if (response.status === 408 || response.status >= 500) {
      throw new InboxPipelineError('network', `http_${response.status}`);
    }
    throw new InboxPipelineError('provider_error', `http_${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InboxPipelineError('invalid_response', 'http_json_invalid');
  }

  const bodyObj = body as Record<string, unknown>;
  const choices = bodyObj.choices as Record<string, unknown>[] | undefined;
  const rawContent = choices?.[0]?.message as Record<string, unknown> | undefined;
  const contentStr = rawContent?.content;

  if (typeof contentStr !== 'string') {
    throw new InboxPipelineError('invalid_response', 'content_missing');
  }

  let cleanResponse = contentStr;
  // 1. Eliminar etiquetas de razonamiento
  cleanResponse = cleanResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // 2. Extraer solo el bloque JSON (busca el primer '{' y el último '}')
  const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleanResponse = jsonMatch[0];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanResponse) as Record<string, unknown>;
  } catch {
    throw new InboxPipelineError('invalid_response', 'model_json_invalid');
  }

  // Normalización defensiva del type: el modelo a veces responde mayúsculas,
  // espacios o la clave "tipo". Sin type válido la fila queda pendiente.
  const rawType =
    typeof parsed.type === 'string'
      ? parsed.type
      : typeof parsed.tipo === 'string'
        ? parsed.tipo
        : '';
  const type = rawType.trim().toLowerCase();

  if (!['nota', 'gasto', 'tarea', 'habito', 'sueno'].includes(type)) {
    throw new InboxPipelineError('invalid_response', 'route_type_invalid');
  }

  if (type === 'nota') {
    // V1: content es SOLO metadata (title/tags). Se descarta cualquier otro
    // campo que el LLM devuelva — el cuerpo nunca viene del LLM.
    const raw =
      parsed.content && typeof parsed.content === 'object'
        ? (parsed.content as Record<string, unknown>)
        : {};
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 0,
        )
      : [];
    return { type: 'nota', content: { ...(title ? { title } : {}), tags } };
  }

  if (!parsed.content || typeof parsed.content !== 'object') {
    throw new InboxPipelineError('invalid_response', 'route_content_invalid');
  }

  const content = parsed.content as Record<string, unknown>;
  switch (type) {
    case 'gasto':
      if (typeof content.amount !== 'number') {
        throw new InboxPipelineError('invalid_response', 'gasto_amount_invalid');
      }
      break;
    case 'tarea':
      if (typeof content.title !== 'string' || content.title.trim().length === 0) {
        throw new InboxPipelineError('invalid_response', 'tarea_title_invalid');
      }
      break;
    case 'habito':
      if (typeof content.habit_name !== 'string' || content.habit_name.trim().length === 0) {
        throw new InboxPipelineError('invalid_response', 'habito_name_invalid');
      }
      break;
    case 'sueno':
      if (typeof content.hours !== 'number') {
        throw new InboxPipelineError('invalid_response', 'sueno_hours_invalid');
      }
      break;
  }

  return { type: type as RouteType, content } as RoutedResult;
}
