import { bootDb, type BootedDb } from '../testing/boot-db';
import { normalizedName } from '../queries/collections';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));

describe('migración de nombres de colecciones', () => {
  it('fusiona duplicados con diferencias de mayúsculas Unicode', async () => {
    const booted: BootedDb = await bootDb();
    const noteIds = [
      await booted.notes.createNote({ title: 'Compartida' }),
      await booted.notes.createNote({ title: 'Otra' }),
      await booted.notes.createNote({ title: 'Última' }),
    ];
    const keeperId = await booted.collections.createCollection('Investigación');

    // Se reproduce una base antigua: la API actual ya impide crear estos duplicados.
    booted.raw.exec('DROP INDEX IF EXISTS idx_collections_name_unique');
    const insertCollection = booted.raw.prepare(
      'INSERT INTO collections (name, description, created_at, updated_at) VALUES (?, NULL, ?, ?)',
    );
    const duplicateOne = Number(insertCollection.run('investigación', 2, 2).lastInsertRowid);
    const duplicateTwo = Number(insertCollection.run('  Investigación  ', 3, 3).lastInsertRowid);
    const duplicateThree = Number(insertCollection.run('INVESTIGACIÓN', 4, 4).lastInsertRowid);
    await booted.collections.addNoteToCollection(noteIds[0], keeperId, 5);
    await booted.collections.addNoteToCollection(noteIds[0], duplicateOne, 2);
    await booted.collections.addNoteToCollection(noteIds[1], duplicateTwo);
    await booted.collections.addNoteToCollection(noteIds[2], duplicateThree, 1);

    const membershipsBefore = booted.raw.prepare(
      'SELECT COUNT(*) AS count FROM note_collections',
    ).get();
    const distinctNotesBefore = booted.raw.prepare(
      'SELECT COUNT(DISTINCT note_id) AS count FROM note_collections',
    ).get();
    expect(membershipsBefore).toEqual({ count: 4 });
    expect(distinctNotesBefore).toEqual({ count: 3 });

    booted.raw.prepare(
      "DELETE FROM schema_meta WHERE key = 'collections_name_dedupe_v1'",
    ).run();
    await booted.dbModule.initDb();

    const collections = await booted.collections.listCollections();
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({ id: keeperId, name: 'Investigación', note_count: 3 });
    expect(booted.raw.prepare('SELECT COUNT(*) AS count FROM note_collections').get())
      .toEqual({ count: 3 });
    expect(booted.raw.prepare(
      'SELECT COUNT(DISTINCT note_id) AS count FROM note_collections',
    ).get()).toEqual(distinctNotesBefore);
    expect(booted.raw.prepare(
      'SELECT COUNT(*) AS count FROM note_collections WHERE collection_id IN (?, ?, ?)',
    ).get(duplicateOne, duplicateTwo, duplicateThree)).toEqual({ count: 0 });
    expect(new Set(collections.map((row) => normalizedName(row.name))).size)
      .toBe(collections.length);
    expect(booted.raw.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_collections_name_unique'",
    ).get()).toEqual({ count: 1 });
  });

  it('fusiona duplicados y conserva todas sus membresías', async () => {
    const booted: BootedDb = await bootDb();
    const noteIds = [
      await booted.notes.createNote({ title: 'Una' }),
      await booted.notes.createNote({ title: 'Dos' }),
      await booted.notes.createNote({ title: 'Tres' }),
    ];
    const keeperId = await booted.collections.createCollection('Hábitos');

    // La primera versión de la migración crea el índice único; se quita aquí
    // para reproducir una base post-v1 que acumuló duplicados.
    booted.raw.exec('DROP INDEX IF EXISTS idx_collections_name_unique');
    const insertCollection = booted.raw.prepare(
      'INSERT INTO collections (name, description, created_at, updated_at) VALUES (?, NULL, ?, ?)',
    );
    const duplicateOne = Number(insertCollection.run('hábitos', 2, 2).lastInsertRowid);
    const duplicateTwo = Number(insertCollection.run('  Hábitos  ', 3, 3).lastInsertRowid);
    await booted.collections.addNoteToCollection(noteIds[0], keeperId, 7);
    booted.raw.prepare(
      'INSERT INTO note_collections (note_id, collection_id, position, added_at) VALUES (?, ?, ?, ?)',
    ).run(noteIds[1], duplicateOne, 2, 2);
    booted.raw.prepare(
      'INSERT INTO note_collections (note_id, collection_id, position, added_at) VALUES (?, ?, ?, ?)',
    ).run(noteIds[2], duplicateTwo, 1, 1);
    expect(booted.raw.prepare('SELECT COUNT(*) AS count FROM note_collections').get())
      .toEqual({ count: 3 });

    booted.raw.prepare(
      "DELETE FROM schema_meta WHERE key = 'collections_name_dedupe_v1'",
    ).run();
    await booted.dbModule.initDb();

    const collections = await booted.collections.listCollections();
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({ id: keeperId, name: 'Hábitos', note_count: 3 });
    expect(booted.raw.prepare('SELECT COUNT(*) AS count FROM note_collections').get())
      .toEqual({ count: 3 });
    expect(booted.raw.prepare(
      'SELECT COUNT(*) AS count FROM note_collections WHERE collection_id IN (?, ?)',
    ).get(duplicateOne, duplicateTwo)).toEqual({ count: 0 });
    expect(booted.raw.prepare('SELECT COUNT(*) AS count FROM notes').get())
      .toEqual({ count: 3 });
    expect(booted.raw.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_collections_name_unique'",
    ).get()).toEqual({ count: 1 });
    expect(booted.raw.prepare(
      "SELECT value FROM schema_meta WHERE key = 'collections_name_dedupe_v1'",
    ).get()).toEqual({ value: '1' });

    await expect(booted.collections.createCollection('HÁBITOS')).resolves.toBe(keeperId);
    expect(await booted.collections.listCollections()).toHaveLength(1);
  });
});
