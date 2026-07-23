import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY_BASE_URL = 'llm.baseUrl';
const KEY_API_KEY = 'llm.apiKey';
const KEY_MODEL = 'llm.model';

const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MODEL = 'MiniMax-Text-01';

const SYSTEM_PROMPT = `Eres un router de inbox. Clasifica el texto del usuario en uno de estos tipos y devuelve SOLO JSON válido.

Tipos:

1. "nota" — ideas largas, reflexiones o conocimiento. Debes fragmentar el texto del usuario en múltiples notas atómicas (mini-ensayos) que capturen un único concepto cada una.
   content: { "original_text": string, "atomic_notes": [ { "title": string, "body": string, "tags": string[] } ] }

2. "gasto" — dinero gastado o ingreso.
   content: { "amount": number, "description": string, "category": string, "date": string (ISO 8601 o "today") }

3. "tarea" — acción pendiente.
   content: { "title": string, "due_date": string | null, "priority": "low" | "medium" | "high" }

4. "habito" — rutinas y acciones repetitivas.
   content: { "habit_name": string, "status": "done" | "missed", "date": string }

5. "sueno" — registro de descanso.
   content: { "hours": number, "deep_sleep_percentage": number, "quality": string, "date": string }

Reglas:
- Responde SOLO con JSON válido. Sin markdown, sin \`\`\`json, sin explicaciones antes ni después.
- Si dudas entre tipos, elige "nota".
IMPORTANTE: NO incluyas etiquetas , notas de razonamiento, ni texto introductorio. Responde ÚNICAMENTE con un JSON puro que siga estrictamente el esquema definido. Si no puedes cumplirlo, devuelve un objeto JSON con error: "failed".`;

export type RouteType = 'nota' | 'gasto' | 'tarea' | 'habito' | 'sueno';

export interface NotaContent {
  original_text: string;
  atomic_notes: { title: string; body: string; tags: string[] }[];
}

export type RoutedResult = { type: 'nota'; content: NotaContent }
  | { type: Exclude<RouteType, 'nota'>; content: Record<string, unknown> };

interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function getLLMConfig(): Promise<LLMConfig> {
  if (Platform.OS === 'web') {
    throw new Error('SecureStore no está disponible en web. Configura el proveedor de IA desde un dispositivo nativo.');
  }

  const [baseUrl, apiKey, model] = await Promise.all([
    SecureStore.getItemAsync(KEY_BASE_URL),
    SecureStore.getItemAsync(KEY_API_KEY),
    SecureStore.getItemAsync(KEY_MODEL),
  ]);

  if (!apiKey) {
    throw new Error('API Key no configurada. Ve a Ajustes y configura tu API Key de MiniMax.');
  }

  return {
    baseUrl: baseUrl ?? DEFAULT_BASE_URL,
    apiKey,
    model: model ?? DEFAULT_MODEL,
  };
}

export async function processInboxText(text: string): Promise<RoutedResult> {
  const config = await getLLMConfig();
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
      }),
    });
  } catch (err) {
    throw new Error(`LLM request failed: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('LLM response: fallo al parsear JSON de la respuesta HTTP');
  }

  const bodyObj = body as Record<string, unknown>;
  const choices = bodyObj.choices as Array<Record<string, unknown>> | undefined;
  const rawContent = choices?.[0]?.message as Record<string, unknown> | undefined;
  const contentStr = rawContent?.content;

  if (typeof contentStr !== 'string') {
    throw new Error('LLM response: no se encontró choices[0].message.content');
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
    return {
      type: 'nota',
      content: {
        original_text: text,
        atomic_notes: [
          {
            title: 'Nota Recuperada',
            body: text,
            tags: ['recuperada'],
          },
        ],
      },
    };
  }

  const type = parsed.type as string;
  if (!['nota', 'gasto', 'tarea', 'habito', 'sueno'].includes(type)) {
    throw new Error(`LLM response: type inválido "${type}"`);
  }

  if (!parsed.content || typeof parsed.content !== 'object') {
    throw new Error('LLM response: falta content o no es un objeto');
  }

  if (type === 'nota') {
    const content = parsed.content as Record<string, unknown>;
    if (!Array.isArray(content.atomic_notes)) {
      // Fallback: la IA devolvió formato legacy con title/body planos
      const title = content.title as string | undefined;
      const body = content.body as string | undefined;
      const tags = content.tags as string[] | undefined;

      if (title || body) {
        parsed.content = {
          original_text: text,
          atomic_notes: [{
            title: title ?? 'Nota sin título',
            body: body ?? text,
            tags: Array.isArray(tags) ? tags : [],
          }],
        };
      } else {
        // Degenerado: ni atomic_notes ni campos legacy
        console.error('LLM: nota sin atomic_notes ni campos title/body legacy');
        return {
          type: 'nota',
          content: { original_text: text, atomic_notes: [] },
        } as RoutedResult;
      }
    }
  }

  return { type: type as RouteType, content: parsed.content as Record<string, unknown> } as RoutedResult;
}
