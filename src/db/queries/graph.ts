import { getDb } from '../index';

export interface GraphNode {
  id: number;
  title: string;
}

export interface GraphEdge {
  source: number;
  target: number;
  origin: 'manual' | 'ai' | 'semantic';
  status: 'suggested' | 'confirmed';
  similarityScore: number | null;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface RawNode {
  id: number;
  title: string;
}

interface RawEdge {
  source: number;
  target: number;
  origin: GraphEdge['origin'];
  status: GraphEdge['status'];
  similarity_score: number | null;
}

function formatEdges(rows: RawEdge[]): GraphEdge[] {
  return rows.map((row) => ({
    source: row.source,
    target: row.target,
    origin: row.origin,
    status: row.status,
    similarityScore: row.similarity_score,
  }));
}

export async function getGraphData({ noteId }: { noteId?: number } = {}): Promise<GraphData> {
  const db = await getDb();
  const isLocal = noteId !== undefined;

  if (!isLocal) {
    const nodes = await db.getAllAsync<RawNode>(
      `SELECT id, title
       FROM notes
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC`,
    );
    const edges = await db.getAllAsync<RawEdge>(
      `SELECT r.source_note_id AS source,
              r.target_note_id AS target,
              r.origin,
              r.status,
              r.similarity_score
       FROM note_relations r
       JOIN notes source_note ON source_note.id = r.source_note_id
       JOIN notes target_note ON target_note.id = r.target_note_id
       WHERE r.status != 'rejected'
         AND source_note.deleted_at IS NULL
         AND target_note.deleted_at IS NULL
         AND r.source_note_id != r.target_note_id`,
    );
    return { nodes, edges: formatEdges(edges) };
  }

  const root = await db.getFirstAsync<RawNode>(
    `SELECT id, title
     FROM notes
     WHERE id = ? AND deleted_at IS NULL`,
    noteId,
  );
  if (!root) return { nodes: [], edges: [] };

  const neighborRows = await db.getAllAsync<RawNode>(
    `WITH ranked_neighbors AS (
       SELECT n.id,
              n.title,
              r.similarity_score,
              r.updated_at,
              ROW_NUMBER() OVER (
                PARTITION BY n.id
                ORDER BY r.similarity_score IS NULL ASC,
                         r.similarity_score DESC,
                         r.updated_at DESC
              ) AS relation_rank
       FROM note_relations r
       JOIN notes n ON n.id = CASE
         WHEN r.source_note_id = ? THEN r.target_note_id
         ELSE r.source_note_id
       END
       WHERE (r.source_note_id = ? OR r.target_note_id = ?)
         AND r.status != 'rejected'
         AND n.deleted_at IS NULL
         AND n.id != ?
         AND r.source_note_id != r.target_note_id
     )
     SELECT id, title
     FROM ranked_neighbors
     WHERE relation_rank = 1
     ORDER BY similarity_score IS NULL ASC,
              similarity_score DESC,
              updated_at DESC
     LIMIT 25`,
    noteId,
    noteId,
    noteId,
    noteId,
  );

  const nodes = [root];
  const nodeIds = new Set<number>([root.id]);
  for (const neighbor of neighborRows) {
    if (nodeIds.has(neighbor.id)) continue;
    nodes.push(neighbor);
    nodeIds.add(neighbor.id);
    if (nodes.length === 26) break;
  }

  const placeholders = nodes.map(() => '?').join(', ');
  const edges = await db.getAllAsync<RawEdge>(
    `SELECT r.source_note_id AS source,
            r.target_note_id AS target,
            r.origin,
            r.status,
            r.similarity_score
     FROM note_relations r
     JOIN notes source_note ON source_note.id = r.source_note_id
     JOIN notes target_note ON target_note.id = r.target_note_id
     WHERE r.status != 'rejected'
       AND source_note.deleted_at IS NULL
       AND target_note.deleted_at IS NULL
       AND r.source_note_id != r.target_note_id
       AND r.source_note_id IN (${placeholders})
       AND r.target_note_id IN (${placeholders})`,
    ...nodes.map((node) => node.id),
    ...nodes.map((node) => node.id),
  );

  return { nodes, edges: formatEdges(edges) };
}
