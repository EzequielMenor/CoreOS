/**
 * Tests del borrador de Capturar (useCaptureDraft).
 * Cubren los criterios de aceptación observables desde el hook:
 * restauración al montar/relanzar, debounce de escritura, borrado solo
 * tras confirmación (discardDraft), flush en interrupciones y que el
 * borrador jamás se envía al inbox.
 */

import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import {
  AppState,
  type AppStateEvent,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import { insertInbox } from '@/db';
import { clearCaptureDraft, saveCaptureDraft } from '@/db/queries/draft';

import { useCaptureDraft, type CaptureDraftResult } from '../use-capture-draft';

jest.mock('@/db', () => ({
  insertInbox: jest.fn(),
}));

// Variables prefijadas `mock`: exigidas por babel-plugin-jest-hoist dentro
// de la factory. El store simula la fila `capture_draft` de schema_meta: lo
// que persiste un montaje es lo que lee el siguiente (relanzar la app).
const mockDraftStore = { value: '' };

jest.mock('@/db/queries/draft', () => ({
  getCaptureDraft: jest.fn(async () => mockDraftStore.value),
  saveCaptureDraft: jest.fn(async (text: string) => {
    mockDraftStore.value = text;
  }),
  clearCaptureDraft: jest.fn(async () => {
    mockDraftStore.value = '';
  }),
}));

const mockInsertInbox = jest.mocked(insertInbox);
const mockSave = jest.mocked(saveCaptureDraft);
const mockClear = jest.mocked(clearCaptureDraft);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let appStateHandler: ((status: AppStateStatus) => void) | null = null;

function renderDraft() {
  let result: CaptureDraftResult | undefined;
  function Probe() {
    result = useCaptureDraft();
    return null;
  }
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(createElement(Probe));
  });
  return {
    get current(): CaptureDraftResult {
      if (!result) throw new Error('hook no montado');
      return result;
    },
    async unmount() {
      await act(async () => {
        tree?.unmount();
      });
    },
  };
}

/** Monta y deja resolver el getCaptureDraft inicial. */
async function mountRestoring() {
  const view = renderDraft();
  await act(async () => {});
  return view;
}

describe('borrador de Capturar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockDraftStore.value = '';
    jest.clearAllMocks();
    appStateHandler = null;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(
        (_type: AppStateEvent, handler: (status: AppStateStatus) => void) => {
          appStateHandler = handler;
          return { remove: jest.fn() } as unknown as NativeEventSubscription;
        },
      );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('restaura el borrador al montar (volver a la tab / relanzar)', async () => {
    mockDraftStore.value = 'compra pendiente';
    const view = await mountRestoring();
    expect(view.current.text).toBe('compra pendiente');
    await view.unmount();
  });

  it('no restaura un borrador en blanco', async () => {
    mockDraftStore.value = '';
    const view = await mountRestoring();
    expect(view.current.text).toBe('');
    await view.unmount();
  });

  it('debounce: pulsaciones rápidas colapsan en una sola escritura', async () => {
    const view = await mountRestoring();

    act(() => view.current.handleChangeText('a'));
    act(() => {
      jest.advanceTimersByTime(100);
      view.current.handleChangeText('ab');
    });
    act(() => {
      jest.advanceTimersByTime(100);
      view.current.handleChangeText('abc');
    });
    // Antes de cumplir el debounce no hubo ninguna escritura en disco.
    expect(mockSave).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockDraftStore.value).toBe('abc');
    await view.unmount();
  });

  it('el texto sobrevive a desmontaje + remontaje (persistencia real)', async () => {
    const view = await mountRestoring();
    act(() => view.current.handleChangeText('idea rápida'));
    act(() => {
      jest.advanceTimersByTime(600);
    });
    await view.unmount();

    const remounted = await mountRestoring();
    expect(remounted.current.text).toBe('idea rápida');
    await remounted.unmount();
  });

  it('discardDraft borra en disco, cancela el timer pendiente y no reaparece', async () => {
    const view = await mountRestoring();
    act(() => view.current.handleChangeText('pendiente tras discard'));
    // Sin dejar disparar el debounce: discard debe cancelarlo (si no,
    // rescribiría el texto ya capturado en el borrador).
    act(() => view.current.discardDraft());
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(view.current.text).toBe('');
    await view.unmount();

    const remounted = await mountRestoring();
    expect(remounted.current.text).toBe('');
    await remounted.unmount();
  });

  it('pasar a background con escritura pendiente hace flush inmediato', async () => {
    const view = await mountRestoring();
    act(() => view.current.handleChangeText('interrupción'));

    expect(mockSave).not.toHaveBeenCalled();
    act(() => appStateHandler?.('background'));

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith('interrupción');
    // El timer quedó cancelado: avanzar el reloj no duplica la escritura.
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('desmontar con timer pendiente persiste el último texto', async () => {
    const view = await mountRestoring();
    act(() => view.current.handleChangeText('al cambiar de tab'));
    await view.unmount();

    expect(mockSave).toHaveBeenCalledWith('al cambiar de tab');
  });

  it('un montaje sin escritura nunca borra el borrador existente', async () => {
    mockDraftStore.value = 'sigue intacto';
    const view = await mountRestoring();
    await view.unmount();

    expect(mockClear).not.toHaveBeenCalled();
    expect(mockDraftStore.value).toBe('sigue intacto');
  });

  it('escribir y borrar todo limpia el borrador en disco', async () => {
    const view = await mountRestoring();
    act(() => view.current.handleChangeText('texto'));
    act(() => view.current.handleChangeText(''));
    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockDraftStore.value).toBe('');
    await view.unmount();
  });

  it('el borrador nunca se envía al inbox por sí solo', async () => {
    const view = await mountRestoring();
    act(() => view.current.handleChangeText('texto que no debe capturarse'));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    await view.unmount();

    expect(mockInsertInbox).not.toHaveBeenCalled();
  });
});
