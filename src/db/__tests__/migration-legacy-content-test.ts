import { DatabaseSync } from 'node:sqlite';

import { bootDb } from '../testing/boot-db';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));

describe('migración del contenido legacy de notas', () => {
  // Esquema pre-v1 real (el que crea el bloque legacy de initDb) con las aristas
  // que importan: body_md añadido por ALTER, dos notas con cuerpo propio, una con
  // content vacío y una con content de solo espacios.
  function seedLegacyNotes(seedDb: DatabaseSync): void {
    seedDb.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        section TEXT,
        content_type TEXT NOT NULL DEFAULT 'markdown',
        created_at INTEGER NOT NULL
      );
    `);
    const createdAt = Math.floor(Date.now() / 1000);
    const insert = seedDb.prepare(
      'INSERT INTO notes (title, content, tags, section, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('Nota con cuerpo', 'el mtu define el tamaño máximo de paquete', '["red"]', 'Estudio', createdAt);
    insert.run('Nota con ambos', 'content viejo', '[]', null, createdAt);
    insert.run('Nota vacía', '', '[]', null, createdAt);
    insert.run('Nota moderna', '', '[]', null, createdAt);
    insert.run('Nota con espacios', '   ', '[]', null, createdAt);
    seedDb.exec("ALTER TABLE notes ADD COLUMN body_md TEXT NOT NULL DEFAULT '';");
    seedDb.prepare('UPDATE notes SET body_md = ? WHERE id = ?').run('cuerpo moderno', 2);
    seedDb.prepare('UPDATE notes SET body_md = ? WHERE id = ?').run('cuerpo existente', 4);
  }

  it('recupera cuerpos, etiquetas e índice FTS sin perder contenido', async () => {
    const { dbModule, notes, tags, raw } = await bootDb(seedLegacyNotes);

    expect((await notes.getById(1))?.body_md).toBe('el mtu define el tamaño máximo de paquete');
    const sections = await notes.getSections(null);
    const listedNotes = Object.values(sections).flat();
    expect(listedNotes.map((note) => note.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(listedNotes.find((note) => note.id === 1)?.body_md)
      .toBe('el mtu define el tamaño máximo de paquete');
    expect((await notes.searchNotesWithScore('mtu')).map(({ note }) => note.id)).toEqual([1]);

    expect((await notes.getById(2))?.body_md).toBe('cuerpo moderno');
    expect((await notes.getById(3))?.body_md).toBe('');
    expect((await notes.getById(4))?.body_md).toBe('cuerpo existente');
    expect((await notes.getById(5))?.body_md).toBe('   ');

    expect(raw.prepare('SELECT COUNT(*) AS count FROM note_tags WHERE note_id = 1').get())
      .toEqual({ count: 1 });
    expect((await tags.listTags()).map((tag) => tag.name)).toEqual(['red']);
    expect(raw.prepare('SELECT content FROM notes WHERE id = 1').get())
      .toEqual({ content: 'el mtu define el tamaño máximo de paquete' });
    expect(raw.prepare('SELECT content FROM notes WHERE id = 2').get())
      .toEqual({ content: 'content viejo' });
    expect(raw.prepare('SELECT content FROM notes WHERE id = 5').get())
      .toEqual({ content: '   ' });

    expect(raw.prepare('SELECT COUNT(*) AS count FROM notes_fts').get())
      .toEqual({ count: 5 });
    expect(raw.prepare('SELECT body_md FROM notes_fts WHERE rowid = 1').get())
      .toEqual({ body_md: 'el mtu define el tamaño máximo de paquete' });

    const beforeBodies = raw.prepare('SELECT id, body_md FROM notes ORDER BY id').all();
    const beforeCount = raw.prepare('SELECT COUNT(*) AS count FROM notes').get();
    await dbModule.initDb();
    expect(raw.prepare('SELECT id, body_md FROM notes ORDER BY id').all()).toEqual(beforeBodies);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual(beforeCount);
  });

  // El caso del dispositivo que migró hace meses: notes_v1_migration ya está
  // aplicada y notes_fts existe con sus filas vacías. Sin borrar la key, la
  // recuperación nunca correría y esas notas seguirían huecas.
  it('recupera cuerpos en una base que ya migró en el pasado', async () => {
    const { dbModule, notes, raw } = await bootDb(seedLegacyNotes);

    // Se deja la base como estaba antes de este fix: v1 aplicada y cuerpos perdidos.
    raw.exec(`
      DELETE FROM schema_meta WHERE key = 'notes_body_from_content_v1';
      UPDATE notes SET body_md = '' WHERE id IN (1, 3, 5);
    `);
    expect((await notes.searchNotesWithScore('mtu'))).toEqual([]);

    await dbModule.initDb();

    expect((await notes.getById(1))?.body_md).toBe('el mtu define el tamaño máximo de paquete');
    expect((await notes.getById(4))?.body_md).toBe('cuerpo existente');
    expect((await notes.searchNotesWithScore('mtu')).map(({ note }) => note.id)).toEqual([1]);
    expect(raw.prepare('SELECT body_md FROM notes_fts WHERE rowid = 1').get())
      .toEqual({ body_md: 'el mtu define el tamaño máximo de paquete' });
  });
});
