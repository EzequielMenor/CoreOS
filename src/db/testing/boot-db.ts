/* eslint-disable @typescript-eslint/no-require-imports */
// Los requires de abajo son deliberados: cada test necesita un registry limpio
// tras jest.resetModules(), y un import estático quedaría hoisted y cacheado.
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type DbModule = typeof import('@/db');
type NotesModule = typeof import('@/db/queries/notes');
type TagsModule = typeof import('@/db/queries/tags');
type CollectionsModule = typeof import('@/db/queries/collections');

export interface BootedDb {
  path: string;
  db: Awaited<ReturnType<DbModule['getDb']>>;
  raw: DatabaseSync;
  notes: NotesModule;
  tags: TagsModule;
  collections: CollectionsModule;
  dbModule: DbModule;
}

let testNumber = 0;

// Las fábricas de jest.mock son locales al fichero de test: deben permanecer allí
// porque los mocks declarados en este helper no se aplicarían al consumidor.
export async function bootDb(seed?: (raw: DatabaseSync) => void): Promise<BootedDb> {
  const directory = join(tmpdir(), `coreos-db-${process.pid}-${Date.now()}-${testNumber++}`);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'coreos.db');
  process.env.COREOS_DB_PATH = path;

  if (seed) {
    const seededDb = new DatabaseSync(path);
    seed(seededDb);
    seededDb.close();
  }

  jest.resetModules();
  const dbModule = require('@/db') as DbModule;
  const notes = require('@/db/queries/notes') as NotesModule;
  const tags = require('@/db/queries/tags') as TagsModule;
  const collections = require('@/db/queries/collections') as CollectionsModule;
  await dbModule.initDb();
  const db = await dbModule.getDb();
  const raw = (jest.requireMock('expo-sqlite') as typeof import('./sqlite-node-shim')).__raw();

  return { path, db, raw, notes, tags, collections, dbModule };
}
