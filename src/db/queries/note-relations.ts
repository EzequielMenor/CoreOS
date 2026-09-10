import { getDb } from '../index';
import { getById } from './notes';
import type { Note } from './notes';

export type RelationOrigin = 'manual' | 'ai' | 'semantic';
export type RelationStatus = 'suggested' | 'confirmed' | 'rejected';

export interface NoteRelationRow {
  id: number;
  source_note_id: number;
  target_note_id: number;
  origin: RelationOrigin;
  status: RelationStatus;
  similarity_score: number | null;
  reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface RelatedNoteItem {
  relationId: number;
  noteId: number;
  title: string;
  body_md: string;
  tags: string[];
  origin: RelationOrigin;
  status: RelationStatus;
  similarity_score: number | null;
  reason: string | null;
  updated_at: number;
  isSource: boolean;
}

export interface CandidateNote {
  note: Note;
  score: number;
  reason: string;
}

const STOPWORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un',
  'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le',
  'ya', 'o', 'este', 'sí', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre',
  'también', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante',
  'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'esto',
  'mí', 'antes', 'algunos', 'qué', 'unos', 'yo', 'otro', 'otras', 'otra', 'él', 'tanto',
  'esa', 'estos', 'mucho', 'quienes', 'nada', 'muchos', 'cual', 'sea', 'poco', 'ella',
  'the', 'and', 'with', 'this', 'that', 'from', 'have', 'what', 'your', 'will', 'about',
  'notas', 'nota', 'note', 'notes',
]);

export function extractSearchTerms(title: string, body: string): string[] {
  const combined = `${title} ${body.slice(0, 300)}`.toLowerCase();
  const words = combined
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, 8);
}

export async function getRelatedNotes(
  noteId: number,
  statusFilter?: RelationStatus,
): Promise<RelatedNoteItem[]> {
  const db = await getDb();
  let query = `
    SELECT
      r.id AS relation_id,
      r.source_note_id,
      r.target_note_id,
      r.origin,
      r.status,
      r.similarity_score,
      r.reason,
      r.updated_at,
      n.id AS note_id,
      n.title,
      n.body_md,
      (
        SELECT GROUP_CONCAT(t.name, ' ')
        FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id = n.id
      ) AS tag_names
    FROM note_relations r
    JOIN notes n ON n.id = CASE WHEN r.source_note_id = ? THEN r.target_note_id ELSE r.source_note_id END
    WHERE (r.source_note_id = ? OR r.target_note_id = ?)
      AND n.deleted_at IS NULL
  `;
  const params: (number | string)[] = [noteId, noteId, noteId];

  if (statusFilter) {
    query += ` AND r.status = ?`;
    params.push(statusFilter);
  } else {
    query += ` AND r.status != 'rejected'`;
  }

  query += ` ORDER BY CASE r.status WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
             r.similarity_score DESC,
             r.updated_at DESC`;

  interface RawRow {
    relation_id: number;
    source_note_id: number;
    target_note_id: number;
    origin: RelationOrigin;
    status: RelationStatus;
    similarity_score: number | null;
    reason: string | null;
    updated_at: number;
    note_id: number;
    title: string;
    body_md: string;
    tag_names: string | null;
  }

  const rows = await db.getAllAsync<RawRow>(query, ...params);

  return rows.map((row) => ({
    relationId: row.relation_id,
    noteId: row.note_id,
    title: row.title,
    body_md: row.body_md,
    tags: row.tag_names ? row.tag_names.split(' ').filter(Boolean) : [],
    origin: row.origin,
    status: row.status,
    similarity_score: row.similarity_score,
    reason: row.reason,
    updated_at: row.updated_at,
    isSource: row.source_note_id === noteId,
  }));
}

export async function getRelationBetween(
  noteA: number,
  noteB: number,
): Promise<NoteRelationRow | null> {
  const db = await getDb();
  return db.getFirstAsync<NoteRelationRow>(
    `SELECT * FROM note_relations
     WHERE (source_note_id = ? AND target_note_id = ?)
        OR (source_note_id = ? AND target_note_id = ?)`,
    noteA,
    noteB,
    noteB,
    noteA,
  );
}

export async function upsertRelation(input: {
  sourceNoteId: number;
  targetNoteId: number;
  origin: RelationOrigin;
  status: RelationStatus;
  similarityScore?: number | null;
  reason?: string | null;
}): Promise<number> {
  const { sourceNoteId, targetNoteId, origin, status, similarityScore = null, reason = null } = input;
  if (sourceNoteId === targetNoteId) {
    throw new Error('No se puede relacionar una nota consigo misma');
  }

  const db = await getDb();
  const existing = await getRelationBetween(sourceNoteId, targetNoteId);

  if (existing) {
    const finalOrigin = existing.origin === 'manual' && origin !== 'manual' ? 'manual' : origin;
    await db.runAsync(
      `UPDATE note_relations
       SET origin = ?, status = ?, similarity_score = ?, reason = ?, updated_at = unixepoch()
       WHERE id = ?`,
      finalOrigin,
      status,
      similarityScore,
      reason,
      existing.id,
    );
    return existing.id;
  }

  const result = await db.runAsync(
    `INSERT INTO note_relations
       (source_note_id, target_note_id, origin, status, similarity_score, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
    sourceNoteId,
    targetNoteId,
    origin,
    status,
    similarityScore,
    reason,
  );
  return result.lastInsertRowId;
}

export async function confirmRelation(relationId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE note_relations
     SET status = 'confirmed', updated_at = unixepoch()
     WHERE id = ?`,
    relationId,
  );
}

export async function rejectRelation(relationId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE note_relations
     SET status = 'rejected', updated_at = unixepoch()
     WHERE id = ?`,
    relationId,
  );
}

export async function deleteRelation(relationId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM note_relations WHERE id = ?', relationId);
}

export async function findCandidateNotes(
  noteId: number,
  limit = 5,
): Promise<CandidateNote[]> {
  const currentNote = await getById(noteId);
  if (!currentNote) return [];

  const db = await getDb();

  // Excluir relaciones existentes (confirmadas, sugeridas o rechazadas)
  const existingRelations = await db.getAllAsync<{ source_note_id: number; target_note_id: number }>(
    `SELECT source_note_id, target_note_id FROM note_relations
     WHERE source_note_id = ? OR target_note_id = ?`,
    noteId,
    noteId,
  );

  const excludedIds = new Set<number>([noteId]);
  for (const rel of existingRelations) {
    excludedIds.add(rel.source_note_id === noteId ? rel.target_note_id : rel.source_note_id);
  }

  const candidateMap = new Map<number, { note: Note; score: number; reasons: string[] }>();

  // 1. Candidatos por tags compartidos
  if (currentNote.tags.length > 0) {
    const placeholders = currentNote.tags.map(() => '?').join(',');
    interface TagMatchRow {
      note_id: number;
      shared_tag_count: number;
      matched_tags: string;
    }
    const tagRows = await db.getAllAsync<TagMatchRow>(
      `SELECT nt.note_id,
              COUNT(nt.tag_id) AS shared_tag_count,
              GROUP_CONCAT(t.name, ', ') AS matched_tags
       FROM note_tags nt
       JOIN tags t ON t.id = nt.tag_id
       WHERE t.name IN (${placeholders})
       GROUP BY nt.note_id`,
      ...currentNote.tags,
    );

    for (const row of tagRows) {
      if (excludedIds.has(row.note_id)) continue;
      const note = await getById(row.note_id);
      if (!note || note.deleted_at != null) continue;

      const tagScore = Math.min(0.6, (row.shared_tag_count / Math.max(1, currentNote.tags.length)) * 0.6);
      candidateMap.set(row.note_id, {
        note,
        score: tagScore,
        reasons: [`Etiquetas comunes: ${row.matched_tags}`],
      });
    }
  }

  // 2. Candidatos por búsqueda léxica/FTS5
  const searchTerms = extractSearchTerms(currentNote.title, currentNote.body_md);
  if (searchTerms.length > 0) {
    const ftsQuery = searchTerms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    try {
      interface FtsRow {
        rowid: number;
        bm25_score: number;
      }
      const ftsRows = await db.getAllAsync<FtsRow>(
        `SELECT rowid, bm25(notes_fts) AS bm25_score
         FROM notes_fts
         WHERE notes_fts MATCH ?
         LIMIT 10`,
        ftsQuery,
      );

      // ponytail: score por ranking, no por |bm25| absoluto. bm25 depende del
      // tamaño del corpus y SQLite clampa el IDF (~1e-6) cuando un término
      // aparece en >= 50% de los documentos; con umbral absoluto sobre |bm25|
      // el top de FTS quedaba siempre por debajo del gate y el LLM jamás
      // llegaba a ver candidatos. Aquí solo se RETRIEVA y ORDENA (top-10);
      // la decisión final la toma el LLM (o el gate 0.25 del service en
      // modo sin IA), que es lo que mantiene el control de ruido.
      const rankedFts = [...ftsRows].sort((a, b) => a.bm25_score - b.bm25_score);
      let ftsRank = 0;
      for (const row of rankedFts) {
        if (excludedIds.has(row.rowid)) continue;
        const note = await getById(row.rowid);
        if (!note || note.deleted_at != null) continue;

        const ftsScore = Math.max(0.1, 0.4 - ftsRank * 0.05);
        ftsRank += 1;
        const existing = candidateMap.get(row.rowid);
        if (existing) {
          existing.score += ftsScore;
          existing.reasons.push('Coincidencia temática en contenido');
        } else {
          candidateMap.set(row.rowid, {
            note,
            score: ftsScore,
            reasons: ['Coincidencia temática en contenido'],
          });
        }
      }
    } catch {
      // Si FTS5 falla por sintaxis, no abortamos
    }
  }

  const results: CandidateNote[] = [];
  for (const candidate of candidateMap.values()) {
    if (candidate.score >= 0.2) {
      results.push({
        note: candidate.note,
        score: Math.min(1, Number(candidate.score.toFixed(2))),
        reason: candidate.reasons.join(' · '),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
