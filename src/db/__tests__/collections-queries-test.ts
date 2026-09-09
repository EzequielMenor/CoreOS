import { bootDb, type BootedDb } from '../testing/boot-db';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));

describe('consultas de colecciones', () => {
  let booted!: BootedDb;

  beforeEach(async () => {
    booted = await bootDb();
  });

  it('hace idempotente la creación ignorando mayúsculas y espacios exteriores', async () => {
    const firstId = await booted.collections.createCollection('X');

    await expect(booted.collections.createCollection('x')).resolves.toBe(firstId);
    await expect(booted.collections.createCollection('  X  ')).resolves.toBe(firstId);
    await expect(booted.collections.listCollections()).resolves.toHaveLength(1);
  });

  it('mantiene distintas las diferencias de espacios interiores', async () => {
    const firstId = await booted.collections.createCollection('a  b');
    const secondId = await booted.collections.createCollection('a b');

    expect(secondId).not.toBe(firstId);
    expect(await booted.collections.listCollections()).toHaveLength(2);
  });

  it('rechaza renombrar una colección con el nombre de otra', async () => {
    const firstId = await booted.collections.createCollection('Primera');
    const secondId = await booted.collections.createCollection('Segunda');

    await expect(
      booted.collections.updateCollection(secondId, {
        name: '  primera  ',
        description: null,
      }),
    ).rejects.toThrow('Ya existe una colección con ese nombre');

    expect((await booted.collections.listCollections()).map((row) => row.name).sort())
      .toEqual(['Primera', 'Segunda']);
    expect(firstId).not.toBe(secondId);
  });

  it('limpia membresías al borrar con foreign_keys desactivadas', async () => {
    const noteId = await booted.notes.createNote({
      title: 'Nota conservada',
      body_md: 'Contenido',
    });
    await booted.tags.setTagsForNote(noteId, ['importante']);
    const collectionId = await booted.collections.createCollection('Borrar');
    await booted.collections.addNoteToCollection(noteId, collectionId);

    booted.raw.prepare('PRAGMA foreign_keys = OFF').run();
    expect(booted.raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 0 });

    await booted.collections.deleteCollection(collectionId);

    expect(await booted.collections.getCollection(collectionId)).toBeNull();
    expect(booted.raw.prepare(
      'SELECT COUNT(*) AS count FROM note_collections WHERE collection_id = ?',
    ).get(collectionId)).toEqual({ count: 0 });
    expect((await booted.notes.getById(noteId))?.tags).toEqual(['importante']);
  });
});
