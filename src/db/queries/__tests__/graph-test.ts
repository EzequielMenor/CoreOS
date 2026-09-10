/* eslint-disable @typescript-eslint/no-require-imports */
import { bootDb, type BootedDb } from '../../testing/boot-db';
import type { DatabaseSync } from 'node:sqlite';

jest.mock('expo-sqlite', () => jest.requireActual('../../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../../testing/file-system-node-shim'));

type GraphModule = typeof import('../graph');

function graphQueries(): GraphModule {
  return require('../graph') as GraphModule;
}

function insertRelation(
  raw: DatabaseSync,
  source: number,
  target: number,
  options: {
    origin?: 'manual' | 'ai' | 'semantic';
    status?: 'suggested' | 'confirmed' | 'rejected';
    similarityScore?: number | null;
    updatedAt?: number;
  } = {},
): void {
  raw.prepare(
    `INSERT INTO note_relations
       (source_note_id, target_note_id, origin, status, similarity_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    source,
    target,
    options.origin ?? 'manual',
    options.status ?? 'confirmed',
    options.similarityScore ?? null,
    100,
    options.updatedAt ?? 100,
  );
}

async function createNote(booted: BootedDb, title: string): Promise<number> {
  return booted.notes.createNote({ title, body_md: title });
}

describe('graph queries', () => {
  it('returns non-deleted notes and non-rejected relations in global mode', async () => {
    const booted = await bootDb();
    const first = await createNote(booted, 'Primera');
    const confirmed = await createNote(booted, 'Confirmada');
    const rejected = await createNote(booted, 'Rechazada');
    const deleted = await createNote(booted, 'Eliminada');

    insertRelation(booted.raw, first, confirmed);
    insertRelation(booted.raw, first, rejected, { status: 'rejected' });
    insertRelation(booted.raw, first, deleted);
    await booted.notes.deleteNote(deleted);

    const graph = await graphQueries().getGraphData();

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      { id: first, title: 'Primera' },
      { id: confirmed, title: 'Confirmada' },
      { id: rejected, title: 'Rechazada' },
    ]));
    expect(graph.nodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: deleted }),
    ]));
    expect(graph.edges).toEqual([
      {
        source: first,
        target: confirmed,
        origin: 'manual',
        status: 'confirmed',
        similarityScore: null,
      },
    ]);
  });

  it('caps local neighbors at 25 and orders them by similarity score', async () => {
    const booted = await bootDb();
    const root = await createNote(booted, 'Raíz');
    const neighbors: number[] = [];

    for (let index = 0; index < 27; index += 1) {
      const neighbor = await createNote(booted, `Vecina ${index}`);
      neighbors.push(neighbor);
      insertRelation(booted.raw, root, neighbor, {
        similarityScore: index === 26 ? null : 1 - index / 100,
      });
    }

    const graph = await graphQueries().getGraphData({ noteId: root });

    expect(graph.nodes).toHaveLength(26);
    expect(graph.nodes[0]).toEqual({ id: root, title: 'Raíz' });
    expect(graph.nodes.slice(1).map((node) => node.id)).toEqual(neighbors.slice(0, 25));
    expect(graph.nodes.map((node) => node.id)).not.toContain(neighbors[26]);
  });

  it('includes edges between selected neighbors in local mode', async () => {
    const booted = await bootDb();
    const root = await createNote(booted, 'Raíz');
    const firstNeighbor = await createNote(booted, 'Primera vecina');
    const secondNeighbor = await createNote(booted, 'Segunda vecina');
    insertRelation(booted.raw, root, firstNeighbor, { similarityScore: 0.9 });
    insertRelation(booted.raw, root, secondNeighbor, { similarityScore: 0.8 });
    insertRelation(booted.raw, firstNeighbor, secondNeighbor, {
      origin: 'semantic',
      similarityScore: 0.7,
    });

    const graph = await graphQueries().getGraphData({ noteId: root });

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: firstNeighbor,
        target: secondNeighbor,
        origin: 'semantic',
        similarityScore: 0.7,
      }),
    ]));
  });

  it('never returns rejected, deleted, or self-loop edges in local mode', async () => {
    const booted = await bootDb();
    const root = await createNote(booted, 'Raíz');
    const visible = await createNote(booted, 'Visible');
    const rejected = await createNote(booted, 'Rechazada');
    const deleted = await createNote(booted, 'Borrada');
    insertRelation(booted.raw, root, visible);
    insertRelation(booted.raw, root, rejected, { status: 'rejected' });
    insertRelation(booted.raw, root, deleted);
    await booted.notes.deleteNote(deleted);

    const graph = await graphQueries().getGraphData({ noteId: root });

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges.every((edge) => edge.source !== edge.target)).toBe(true);
    expect(graph.edges[0]).toMatchObject({ source: root, target: visible });
  });
});
