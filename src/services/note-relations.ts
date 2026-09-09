import { getActiveLLMConfig } from './llm-providers';
import { getById } from '@/db/queries/notes';
import {
  findCandidateNotes,
  getRelatedNotes,
  upsertRelation,
} from '@/db/queries/note-relations';
import type { RelatedNoteItem, CandidateNote } from '@/db/queries/note-relations';
import type { Note } from '@/db/queries/notes';

interface AIRefinedRelation {
  noteId: number;
  confidence: number;
  reason: string;
}

const SYSTEM_RELATIONS_PROMPT = `Eres un evaluador de relaciones de conocimiento en un second brain personal.
Dado el contenido de una nota de referencia y una lista de notas candidatas, determina cuáles están genuinamente conectadas por tema, proyecto o contexto conceptual.

Responde SOLO un array JSON válido:
[
  {
    "noteId": <número>,
    "confidence": <número entre 0.0 y 1.0>,
    "reason": "<una frase concisa en español explicando por qué están relacionadas, máx 80 caracteres>"
  }
]

Reglas:
- Si ninguna candidata tiene relación temática real, devuelve [].
- No relaciones notas solo porque compartan palabras genéricas.
- Devuelve como máximo 3 relaciones de alta confianza (confidence >= 0.6).
- Responde estrictamente con JSON puro, sin bloques markdown ni texto adicional.`;

async function evaluateCandidatesWithLLM(
  currentNote: Note,
  candidates: CandidateNote[],
): Promise<AIRefinedRelation[]> {
  const config = await getActiveLLMConfig();
  if (!config.apiKey) return [];

  const userContent = `Nota de referencia:
ID: ${currentNote.id}
Título: "${currentNote.title || 'Sin título'}"
Etiquetas: [${currentNote.tags.join(', ')}]
Contenido: "${currentNote.body_md.slice(0, 400)}"

Notas candidatas:
${candidates
  .map(
    (c) =>
      `ID: ${c.note.id} | Título: "${c.note.title || 'Sin título'}" | Etiquetas: [${c.note.tags.join(
        ', ',
      )}] | Contenido: "${c.note.body_md.slice(0, 250)}"`,
  )
  .join('\n\n')}`;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_RELATIONS_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM call failed with status ${response.status}`);
  }

  const json = await response.json();
  const rawText = json?.choices?.[0]?.message?.content?.trim() ?? '[]';
  const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleanJson);

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item): item is AIRefinedRelation =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.noteId === 'number' &&
        typeof item.confidence === 'number' &&
        typeof item.reason === 'string',
    )
    .filter((item) => item.confidence >= 0.6);
}

export async function generateAndPersistSuggestions(
  noteId: number,
  options?: { maxSuggestions?: number },
): Promise<RelatedNoteItem[]> {
  const note = await getById(noteId);
  if (!note || note.deleted_at != null) return [];

  const max = options?.maxSuggestions ?? 3;
  // 1. Obtener candidatos locales (FTS5 + tags) sin llamar al LLM todavía
  const candidates = await findCandidateNotes(noteId, 6);
  if (candidates.length === 0) {
    return getRelatedNotes(noteId);
  }

  // 2. Intentar refinamiento con LLM
  let usedAI = false;
  try {
    const refined = await evaluateCandidatesWithLLM(note, candidates);
    if (refined.length > 0) {
      usedAI = true;
      for (const item of refined.slice(0, max)) {
        await upsertRelation({
          sourceNoteId: noteId,
          targetNoteId: item.noteId,
          origin: 'ai',
          status: 'suggested',
          similarityScore: item.confidence,
          reason: item.reason,
        });
      }
    }
  } catch (llmError) {
    // LLM no configurado, red caída o error HTTP → degradación local-first
    console.warn('[note-relations] LLM refinement skipped/failed, using local heuristics', llmError);
  }

  // 3. Si la IA no se utilizó o devolvió vacío por fallo, usar candidatos heurísticos locales
  if (!usedAI) {
    for (const candidate of candidates.slice(0, max)) {
      if (candidate.score >= 0.25) {
        await upsertRelation({
          sourceNoteId: noteId,
          targetNoteId: candidate.note.id,
          origin: 'semantic',
          status: 'suggested',
          similarityScore: candidate.score,
          reason: candidate.reason,
        });
      }
    }
  }

  return getRelatedNotes(noteId);
}
