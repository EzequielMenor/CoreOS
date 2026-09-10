/* eslint-disable @typescript-eslint/no-require-imports */
import { bootDb, type BootedDb } from '../testing/boot-db';

jest.mock('expo-sqlite', () => jest.requireActual('../testing/sqlite-node-shim'));
jest.mock('expo-file-system', () => jest.requireActual('../testing/file-system-node-shim'));
jest.mock('@/services/llm', () => ({
  processInboxText: async (): Promise<never> => {
    throw new Error('LLM caído');
  },
}));

function noteIds(sections: Awaited<ReturnType<BootedDb['notes']['getSections']>>): number[] {
  return Object.values(sections).flat().map((note) => note.id);
}

async function expectOrganization(
  booted: BootedDb,
  noteId: number,
  collectionId: number,
  section: string,
  tags: string[],
): Promise<void> {
  const note = await booted.notes.getById(noteId);
  expect(note?.section).toBe(section);
  expect(note?.tags).toHaveLength(tags.length);
  expect(note?.tags).toEqual(expect.arrayContaining(tags));
  expect(await booted.collections.getNoteCollections(noteId)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: collectionId })]),
  );
  expect(await booted.collections.getNoteCollections(noteId)).toHaveLength(1);
}

describe('regresiones mínimas de Biblioteca', () => {
  it('crea una nota sin organización y la hace encontrable', async () => {
    const booted = await bootDb();
    const id = await booted.notes.createNote({ title: 'Apunte simple', body_md: 'Cuerpo breve' });

    expect(id).toEqual(expect.any(Number));
    expect(await booted.notes.getById(id)).toMatchObject({ id, tags: [] });
    expect(noteIds(await booted.notes.getSections(null))).toContain(id);
    expect((await booted.notes.searchNotesWithScore('simple')).map(({ note }) => note.id)).toContain(id);
  });

  it('conserva la organización en cada edición', async () => {
    const booted = await bootDb();
    const noteId = await booted.notes.createNote({ title: 'Título inicial', body_md: 'Cuerpo inicial' });
    const collectionId = await booted.collections.createCollection('Colección estable');
    const tags = ['alpha', 'beta'];
    await booted.collections.setNoteSection(noteId, 'Estudio');
    await booted.collections.addNoteToCollection(noteId, collectionId);
    await booted.tags.setTagsForNote(noteId, tags);

    await booted.notes.updateNote(noteId, { title: 'Título corregido' });
    await expectOrganization(booted, noteId, collectionId, 'Estudio', tags);

    await booted.notes.updateNote(noteId, { body_md: 'Cuerpo actualizado buscable' });
    await expectOrganization(booted, noteId, collectionId, 'Estudio', tags);
    expect((await booted.notes.searchNotesWithScore('actualizado')).map(({ note }) => note.id)).toContain(noteId);

    await booted.notes.updateNote(noteId, { tagNames: ['beta', 'alpha'] });
    await expectOrganization(booted, noteId, collectionId, 'Estudio', tags);
    const indexedTags = (booted.raw.prepare('SELECT tags_names FROM notes_fts WHERE rowid = ?').get(noteId) as {
      tags_names: string;
    }).tags_names.split(' ').sort();
    expect(indexedTags).toEqual(['alpha', 'beta']);
  });

  it('mantiene el ciclo de vida de una sección', async () => {
    const booted = await bootDb();
    const noteId = await booted.notes.createNote({ title: 'Sección', body_md: 'Contenido' });

    await booted.collections.setNoteSection(noteId, 'Estudio');
    expect(await booted.collections.listNoteSections()).toEqual(['Estudio']);
    await booted.collections.setNoteSection(noteId, 'Personal');
    expect(await booted.collections.listNoteSections()).toEqual(['Personal']);
    expect(await booted.collections.listNoteSections()).not.toContain('Estudio');
    await booted.collections.setNoteSection(noteId, null);
    expect(await booted.collections.listNoteSections()).toEqual([]);
    expect((await booted.notes.getById(noteId))?.section).toBeNull();
  });

  it('mantiene las membresías y permite reordenar un subconjunto', async () => {
    const booted = await bootDb();
    const first = await booted.notes.createNote({ title: 'Uno', body_md: 'uno' });
    await booted.collections.setNoteSection(first, 'Estudio');
    await booted.tags.setTagsForNote(first, ['importante']);
    const second = await booted.notes.createNote({ title: 'Dos', body_md: 'dos' });
    const third = await booted.notes.createNote({ title: 'Tres', body_md: 'tres' });
    const collectionId = await booted.collections.createCollection('Orden');
    await booted.collections.addNoteToCollection(first, collectionId);
    expect(await booted.collections.getNoteCollections(first)).toHaveLength(1);
    await booted.collections.removeNoteFromCollection(first, collectionId);
    expect(await booted.collections.getNoteCollections(first)).toHaveLength(0);
    expect(await booted.notes.getById(first)).toMatchObject({ section: 'Estudio', tags: ['importante'] });
    await booted.collections.addNoteToCollection(first, collectionId);
    await booted.collections.addNoteToCollection(second, collectionId);
    await booted.collections.addNoteToCollection(third, collectionId);

    await booted.collections.setCollectionOrder(collectionId, [third, first]);
    const memberships = await booted.collections.listCollectionNotes(collectionId);
    expect(memberships).toHaveLength(3);
    expect(Object.fromEntries(memberships.map((row) => [row.note_id, row.position]))).toEqual({
      [first]: 1,
      [second]: null,
      [third]: 0,
    });
  });

  it('restaura una nota borrada sin perder organización ni FTS', async () => {
    const booted = await bootDb();
    const noteId = await booted.notes.createNote({ title: 'Conservar', body_md: 'Texto recuperable' });
    const collectionId = await booted.collections.createCollection('Archivo');
    await booted.collections.setNoteSection(noteId, 'Personal');
    await booted.collections.addNoteToCollection(noteId, collectionId);
    await booted.tags.setTagsForNote(noteId, ['seguro']);
    const ftsBefore = booted.raw.prepare('SELECT tags_names FROM notes_fts WHERE rowid = ?').get(noteId);

    await booted.notes.deleteNote(noteId);
    expect(noteIds(await booted.notes.getSections(null))).not.toContain(noteId);
    expect((await booted.notes.searchNotesWithScore('Conservar')).map(({ note }) => note.id)).not.toContain(noteId);
    expect(booted.raw.prepare('SELECT tags_names FROM notes_fts WHERE rowid = ?').get(noteId)).toEqual(ftsBefore);

    await booted.notes.restoreNote(noteId);
    expect(await booted.notes.getById(noteId)).toMatchObject({ id: noteId, section: 'Personal', tags: ['seguro'] });
    expect(await booted.collections.getNoteCollections(noteId)).toHaveLength(1);
    expect(booted.raw.prepare('SELECT tags_names FROM notes_fts WHERE rowid = ?').get(noteId)).toEqual(ftsBefore);
  });

  it('no bloquea Biblioteca cuando falla la IA', async () => {
    const booted = await bootDb();
    const noteId = await booted.notes.createNote({ title: 'Sin IA', body_md: 'Biblioteca operativa' });
    expect((await booted.notes.searchNotesWithScore('operativa')).map(({ note }) => note.id)).toContain(noteId);
    expect(noteIds(await booted.notes.getSections(null))).toContain(noteId);
    const noteCountBefore = (booted.raw.prepare('SELECT COUNT(*) AS count FROM notes').get() as { count: number }).count;

    const { captureInbox } = require('@/services/capture') as typeof import('@/services/capture');
    const { processPendingInbox } = require('@/services/inbox') as typeof import('@/services/inbox');
    const capture = await captureInbox('apunte sin ia');
    const captured = booted.raw.prepare('SELECT status, attempt_count FROM inbox WHERE id = ?').get(capture.inboxId);
    expect(captured).toEqual({ status: 'pending', attempt_count: 0 });

    const firstBatch = await capture.processing;
    expect(firstBatch).toMatchObject({ processed: 0, failed: 1 });
    expect(firstBatch.errors[0]?.errorCode).toBe('provider_error');
    expect((booted.raw.prepare('SELECT COUNT(*) AS count FROM notes').get() as { count: number }).count)
      .toBe(noteCountBefore);

    const secondBatch = await processPendingInbox();
    expect(secondBatch.processed).toBe(0);
    expect((booted.raw.prepare('SELECT attempt_count FROM inbox WHERE id = ?').get(capture.inboxId) as { attempt_count: number }).attempt_count)
      .toBe(1);
    expect((booted.raw.prepare('SELECT COUNT(*) AS count FROM notes').get() as { count: number }).count)
      .toBe(noteCountBefore);
  });

  it('recorre crear, encontrar, agrupar y corregir sin duplicar notas', async () => {
    const booted = await bootDb();
    const first = await booted.notes.createNote({ title: '', body_md: 'cuerpo alfa original' });
    const second = await booted.notes.createNote({ title: '', body_md: 'cuerpo beta original' });
    const createdCount = (booted.raw.prepare('SELECT COUNT(*) AS count FROM notes').get() as { count: number }).count;
    expect((await booted.notes.searchNotesWithScore('alfa original')).map(({ note }) => note.id)).toContain(first);
    expect((await booted.notes.searchNotesWithScore('beta original')).map(({ note }) => note.id)).toContain(second);

    const collectionId = await booted.collections.createCollection('Sesión de prueba');
    await booted.collections.addNoteToCollection(first, collectionId);
    await booted.collections.addNoteToCollection(second, collectionId);
    await booted.collections.setNoteSection(first, 'Estudio');
    await booted.tags.setTagsForNote(second, ['conservar', 'quitar']);
    await booted.notes.updateNote(second, { tagNames: ['conservar'] });

    expect((await booted.notes.searchNotesWithScore('alfa original')).map(({ note }) => note.id)).toContain(first);
    expect((await booted.notes.searchNotesWithScore('beta original')).map(({ note }) => note.id)).toContain(second);
    expect(await booted.collections.listCollectionNotes(collectionId)).toHaveLength(2);
    expect((await booted.notes.getById(first))?.section).toBe('Estudio');
    expect((await booted.notes.getById(second))?.tags).toEqual(['conservar']);
    expect((booted.raw.prepare('SELECT COUNT(*) AS count FROM notes').get() as { count: number }).count)
      .toBe(createdCount);
    expect((booted.raw.prepare('SELECT COUNT(*) AS count FROM notes_fts').get() as { count: number }).count)
      .toBe(2);
  });
});
