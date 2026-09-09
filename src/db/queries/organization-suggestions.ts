import { getDb } from '../index';

// Sugerencias de organización puramente locales (EZE-297). Se leen del grafo de
// tags y colecciones que ya existe: si las notas parecidas coinciden en una
// sección, una colección o un tag, eso es la señal. Sin LLM, sin red y sin
// persistir nada — la sugerencia se calcula al abrir la nota y se aplica solo
// si el usuario la toca.

// Cuántas notas parecidas tienen que coincidir en el mismo valor para que
// merezca la pena mostrar algo. Con 1 solo par, cualquier nota arrastraría la
// sección del vecino y la sugerencia sería ruido antes que ayuda.
const MIN_AGREEMENT = 2;

// Máximo de tags sugeridos: tres caben en una línea sin convertir la nota en
// un formulario de metadatos.
const MAX_SUGGESTED_TAGS = 3;

export interface OrganizationSuggestion {
  section: string | null;
  collection: { id: number; name: string } | null;
  tags: string[];
}

const EMPTY_SUGGESTION: OrganizationSuggestion = {
  section: null,
  collection: null,
  tags: [],
};

// CTE compartida por las tres consultas. «Pares» = notas vivas que comparten un
// tag o una colección con la nota, excluida ella misma.
const PEERS_CTE = `
  WITH target_tags AS (
    SELECT tag_id FROM note_tags WHERE note_id = ?
  ),
  target_colls AS (
    SELECT collection_id FROM note_collections WHERE note_id = ?
  ),
  peers AS (
    SELECT DISTINCT nt.note_id AS id
    FROM note_tags nt
    JOIN target_tags tt ON tt.tag_id = nt.tag_id
    JOIN notes n ON n.id = nt.note_id
    WHERE nt.note_id <> ? AND n.deleted_at IS NULL
    UNION
    SELECT nc.note_id AS id
    FROM note_collections nc
    JOIN target_colls tc ON tc.collection_id = nc.collection_id
    JOIN notes n ON n.id = nc.note_id
    WHERE nc.note_id <> ? AND n.deleted_at IS NULL
  )`;

interface ModeRow {
  name: string;
  support: number;
}

// Agrupa por valor y se queda con el más repetido; el desempate alfabético hace
// que el chip no cambie de sitio entre aperturas.
async function modeOf(
  db: Awaited<ReturnType<typeof getDb>>,
  noteId: number,
  expression: string,
): Promise<string | null> {
  const rows = await db.getAllAsync<ModeRow>(
    `${PEERS_CTE}
     SELECT ${expression} AS name, COUNT(*) AS support
     FROM peers p
     JOIN notes n ON n.id = p.id
     WHERE ${expression} IS NOT NULL
     GROUP BY ${expression}
     HAVING support >= ?
     ORDER BY support DESC, name COLLATE NOCASE ASC
     LIMIT 1`,
    noteId,
    noteId,
    noteId,
    noteId,
    MIN_AGREEMENT,
  );
  return rows[0]?.name ?? null;
}

export async function suggestOrganization(
  noteId: number,
): Promise<OrganizationSuggestion> {
  const db = await getDb();

  const [section, collectionRow, tagRows] = await Promise.all([
    modeOf(db, noteId, 'n.section'),
    db.getAllAsync<{ id: number; name: string }>(
      `${PEERS_CTE}
       SELECT c.id AS id, c.name AS name, COUNT(*) AS support
       FROM peers p
       JOIN note_collections nc ON nc.note_id = p.id
       JOIN collections c ON c.id = nc.collection_id
       WHERE nc.collection_id NOT IN (SELECT collection_id FROM target_colls)
       GROUP BY c.id, c.name
       HAVING support >= ?
       ORDER BY support DESC, c.name COLLATE NOCASE ASC
       LIMIT 1`,
      noteId,
      noteId,
      noteId,
      noteId,
      MIN_AGREEMENT,
    ),
    db.getAllAsync<ModeRow>(
      `${PEERS_CTE}
       SELECT t.name AS name, COUNT(*) AS support
       FROM peers p
       JOIN note_tags nt ON nt.note_id = p.id
       JOIN tags t ON t.id = nt.tag_id
       WHERE nt.tag_id NOT IN (SELECT tag_id FROM target_tags)
       GROUP BY t.name
       HAVING support >= ?
       ORDER BY support DESC, t.name COLLATE NOCASE ASC
       LIMIT ?`,
      noteId,
      noteId,
      noteId,
      noteId,
      MIN_AGREEMENT,
      MAX_SUGGESTED_TAGS,
    ),
  ]);

  if (section === null && collectionRow.length === 0 && tagRows.length === 0) {
    return EMPTY_SUGGESTION;
  }

  return {
    section,
    collection: collectionRow[0]
      ? { id: collectionRow[0].id, name: collectionRow[0].name }
      : null,
    tags: tagRows.map((row) => row.name),
  };
}
