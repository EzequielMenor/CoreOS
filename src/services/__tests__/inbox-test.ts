import * as SecureStore from 'expo-secure-store';

import {
  dispatchRoutedResult,
  getDb,
  getNextPendingInboxRetryAt,
  getPendingInbox,
  insertInbox,
  type InboxRow,
} from '@/db';
import { captureInbox } from '../capture';
import { processInboxItem, processPendingInbox, triggerAutomaticInboxProcessing } from '../inbox';

jest.mock('@/db', () => ({
  dispatchRoutedResult: jest.fn(),
  getDb: jest.fn(),
  getNextPendingInboxRetryAt: jest.fn(),
  getPendingInbox: jest.fn(),
  insertInbox: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
}));

const mockGetPendingInbox = jest.mocked(getPendingInbox);
const mockGetNextPendingInboxRetryAt = jest.mocked(getNextPendingInboxRetryAt);
const mockGetDb = jest.mocked(getDb);
const mockInsertInbox = jest.mocked(insertInbox);
const mockDispatchRoutedResult = jest.mocked(dispatchRoutedResult);
const mockFetch = jest.fn();
const mockGetSecureItem = jest.mocked(SecureStore.getItemAsync);

type MutableInboxRow = Omit<InboxRow, 'status'> & { status: InboxRow['status'] };

function llmResponse(content: string): Response {
  return {
    json: async () => ({ choices: [{ message: { content } }] }),
    ok: true,
    status: 200,
    statusText: 'OK',
  } as Response;
}

function httpErrorResponse(status: number): Response {
  return {
    json: async () => ({ error: { message: 'respuesta privada del proveedor' } }),
    ok: false,
    status,
    statusText: 'Provider private detail',
  } as Response;
}

function pendingRow(id: number, rawText: string, createdAt: number): MutableInboxRow {
  return {
    id,
    raw_text: rawText,
    created_at: createdAt,
    status: 'pending',
    error_code: null,
    last_attempt_at: null,
    attempt_count: 0,
    next_retry_at: null,
  };
}

function useFakeDb(rows: MutableInboxRow[]) {
  const db = {
    getFirstAsync: jest.fn(async (_query: string, id: number) => {
      const row = rows.find((candidate) => candidate.id === id);
      return row ? { ...row } : null;
    }),
    runAsync: jest.fn(
      async (query: string, ...args: unknown[]) => {
        if (query.includes('SET error_code')) {
          const [errorCode, lastAttemptAt, nextRetryAt, id, expectedStatus] = args as [
            InboxRow['error_code'],
            number,
            number | null,
            number,
            InboxRow['status'],
          ];
          const row = rows.find((candidate) => candidate.id === id);
          if (!row || row.status !== expectedStatus) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          row.error_code = errorCode;
          row.last_attempt_at = lastAttemptAt;
          row.attempt_count++;
          row.next_retry_at = nextRetryAt;
          return { changes: 1, lastInsertRowId: 0 };
        }

        const [nextStatus, lastAttemptAt, id, expectedStatus, expectedRawText] = args as [
          InboxRow['status'],
          number,
          number,
          InboxRow['status'],
          string,
        ];
        const row = rows.find((candidate) => candidate.id === id);
        if (!row || row.status !== expectedStatus || row.raw_text !== expectedRawText) {
          return { changes: 0, lastInsertRowId: 0 };
        }
        row.status = nextStatus;
        row.error_code = null;
        row.last_attempt_at = lastAttemptAt;
        row.attempt_count++;
        row.next_retry_at = null;
        return { changes: 1, lastInsertRowId: 0 };
      },
    ),
    withTransactionAsync: jest.fn(async (task: () => Promise<void>) => {
      const snapshots = rows.map((row) => ({ ...row }));
      try {
        await task();
      } catch (error) {
        rows.forEach((row, index) => Object.assign(row, snapshots[index]));
        throw error;
      }
    }),
  };

  mockGetDb.mockResolvedValue(
    db as unknown as Awaited<ReturnType<typeof getDb>>,
  );
  mockGetPendingInbox.mockImplementation(async () => (
    rows.filter((row) => row.status === 'pending')
  ));
  return db;
}

describe('pipeline de inbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNextPendingInboxRetryAt.mockResolvedValue(null);
    mockGetSecureItem.mockImplementation(async (key) => (
      key === 'llm.apiKey' ? 'test-api-key' : null
    ));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('persiste la captura antes de iniciar la clasificación', async () => {
    let finishInsert!: (id: number) => void;
    mockInsertInbox.mockReturnValue(
      new Promise<number>((resolve) => {
        finishInsert = resolve;
      }),
    );
    mockGetPendingInbox.mockResolvedValue([]);

    const capturePromise = captureInbox('Texto original');
    await Promise.resolve();

    expect(mockInsertInbox).toHaveBeenCalledWith('Texto original');
    expect(mockGetPendingInbox).not.toHaveBeenCalled();

    finishInsert(42);
    const capture = await capturePromise;
    await capture.processing;

    expect(capture.inboxId).toBe(42);
    expect(mockGetPendingInbox).toHaveBeenCalledTimes(1);
  });

  test('despacha una respuesta LLM válida y marca la captura como procesada', async () => {
    const rawText = 'Pagar la luz mañana';
    const row = pendingRow(7, rawText, 1);
    useFakeDb([row]);
    mockFetch.mockResolvedValue(llmResponse(JSON.stringify({
      type: 'tarea',
      content: {
        title: 'Pagar la luz',
        due_date: '2026-09-07',
        priority: 'alta',
      },
    })));
    mockDispatchRoutedResult.mockImplementation(async () => {
      expect(row.status).toBe('processed');
      return [99];
    });

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      routeType: 'tarea',
      inboxId: row.id,
    });
    expect(mockDispatchRoutedResult).toHaveBeenCalledWith(
      'tarea',
      {
        title: 'Pagar la luz',
        due_date: '2026-09-07',
        priority: 'alta',
      },
      rawText,
    );
    expect(row.status).toBe('processed');
    expect(row.attempt_count).toBe(1);
    expect(row.error_code).toBeNull();
  });

  test('no despacha una respuesta antigua si la captura se edita durante el reintento', async () => {
    const row = pendingRow(16, 'Texto antiguo', 16);
    useFakeDb([row]);
    mockFetch.mockImplementation(async () => {
      row.raw_text = 'Texto editado';
      return llmResponse(JSON.stringify({
        type: 'tarea',
        content: { title: 'No debe guardarse', due_date: null, priority: null },
      }));
    });

    const result = await processInboxItem(row.id);

    expect(result).toEqual({ skipped: true, reason: 'not_pending' });
    expect(mockDispatchRoutedResult).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'pending', raw_text: 'Texto editado', attempt_count: 0 });
  });

  test('bloquea el reintento automático y conserva raw_text ante una respuesta inválida', async () => {
    const rawText = 'Texto que no se puede perder';
    const row = pendingRow(8, rawText, 2);
    const db = useFakeDb([row]);
    mockFetch.mockResolvedValue(llmResponse('respuesta sin JSON'));

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      error: 'La IA devolvió una respuesta no válida. Reinténtalo manualmente.',
      errorCode: 'invalid_response',
      retryable: false,
      inboxId: row.id,
    });
    expect(db.runAsync).toHaveBeenCalledTimes(1);
    expect(mockDispatchRoutedResult).not.toHaveBeenCalled();
    expect(row).toMatchObject({
      status: 'pending',
      raw_text: rawText,
      error_code: 'invalid_response',
      attempt_count: 1,
      next_retry_at: null,
    });
  });

  test('programa un reintento y conserva raw_text ante un fallo de red', async () => {
    const rawText = 'Otra captura importante';
    const row = pendingRow(9, rawText, 3);
    const db = useFakeDb([row]);
    mockFetch.mockRejectedValue(new Error('sin conexión'));

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      error: 'Sin conexión. La captura se reintentará automáticamente.',
      errorCode: 'network',
      retryable: true,
      inboxId: row.id,
    });
    expect(db.runAsync).toHaveBeenCalledTimes(1);
    expect(mockDispatchRoutedResult).not.toHaveBeenCalled();
    expect(row).toMatchObject({
      status: 'pending',
      raw_text: rawText,
      error_code: 'network',
      attempt_count: 1,
    });
    expect(row.next_retry_at).toBeGreaterThan(row.last_attempt_at ?? 0);
  });

  test('pausa los reintentos automáticos al alcanzar el máximo de intentos', async () => {
    const row = pendingRow(15, 'Captura con red inestable', 15);
    row.attempt_count = 4;
    useFakeDb([row]);
    mockFetch.mockRejectedValue(new Error('sin conexión'));

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      error: 'Los reintentos automáticos están pausados. Reinténtalo manualmente.',
      errorCode: 'network',
      retryable: false,
      inboxId: row.id,
    });
    expect(row).toMatchObject({
      status: 'pending',
      raw_text: 'Captura con red inestable',
      error_code: 'network',
      attempt_count: 5,
      next_retry_at: null,
    });
  });

  test.each([
    [401, 'authentication', false, 'La configuración de IA no es válida. Revísala en Ajustes.'],
    [429, 'rate_limit', true, 'La IA está saturada. La captura se reintentará automáticamente.'],
  ] as const)(
    'clasifica HTTP %i como %s sin exponer la respuesta del proveedor',
    async (status, errorCode, retryable, publicMessage) => {
      const row = pendingRow(status, `captura privada ${status}`, status);
      useFakeDb([row]);
      mockFetch.mockResolvedValue(httpErrorResponse(status));

      const result = await processInboxItem(row.id);

      expect(result).toEqual({
        skipped: false,
        error: publicMessage,
        errorCode,
        retryable,
        inboxId: row.id,
      });
      expect(row.error_code).toBe(errorCode);
      expect(row.next_retry_at === null).toBe(!retryable);
    },
  );

  test('distingue la falta de configuración sin iniciar una petición', async () => {
    const row = pendingRow(12, 'contenido sin configurar', 12);
    useFakeDb([row]);
    mockGetSecureItem.mockResolvedValue(null);

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      error: 'Configura la IA en Ajustes para clasificar esta captura.',
      errorCode: 'not_configured',
      retryable: false,
      inboxId: row.id,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(row).toMatchObject({
      status: 'pending',
      raw_text: 'contenido sin configurar',
      error_code: 'not_configured',
      attempt_count: 1,
      next_retry_at: null,
    });
  });

  test('clasifica y persiste un fallo de dispatch sin perder la captura', async () => {
    const rawText = 'Captura que falla al despachar';
    const row = pendingRow(13, rawText, 13);
    useFakeDb([row]);
    mockFetch.mockResolvedValue(llmResponse(JSON.stringify({
      type: 'tarea',
      content: { title: 'Tarea', due_date: null, priority: null },
    })));
    mockDispatchRoutedResult.mockRejectedValue(new Error(`SQL error ${rawText}`));

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      error: 'No se pudo guardar la clasificación. Reinténtalo manualmente.',
      errorCode: 'dispatch',
      retryable: false,
      inboxId: row.id,
    });
    expect(row).toMatchObject({
      status: 'pending',
      raw_text: rawText,
      error_code: 'dispatch',
      attempt_count: 1,
      next_retry_at: null,
    });
  });

  test('los logs no contienen texto capturado ni detalles privados del proveedor', async () => {
    const rawText = 'SECRETO-CAPTURA-123';
    const row = pendingRow(14, rawText, 14);
    useFakeDb([row]);
    mockFetch.mockResolvedValue(httpErrorResponse(401));

    await processInboxItem(row.id);

    const logs = [
      ...jest.mocked(console.error).mock.calls,
      ...jest.mocked(console.warn).mock.calls,
      ...jest.mocked(console.info).mock.calls,
    ].map((call) => call.map((value) => (
      typeof value === 'string' ? value : JSON.stringify(value)
    )).join(' ')).join('\n');
    expect(logs).not.toContain(rawText);
    expect(logs).not.toContain('respuesta privada del proveedor');
    expect(logs).not.toContain('Provider private detail');
    expect(logs).not.toContain('test-api-key');
  });

  test('un reintento manual incluye pendientes bloqueados', async () => {
    mockGetPendingInbox.mockResolvedValue([]);

    await processPendingInbox({ force: true });

    expect(mockGetPendingInbox).toHaveBeenCalledWith(true);
  });

  test('procesa secuencialmente y no duplica capturas con batches concurrentes', async () => {
    const rows: MutableInboxRow[] = [
      pendingRow(10, 'Primera captura', 4),
      pendingRow(11, 'Segunda captura', 5),
    ];
    useFakeDb(rows);
    let activeRequests = 0;
    let maxActiveRequests = 0;
    mockFetch.mockImplementation(async () => {
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      activeRequests--;
      return llmResponse(JSON.stringify({
        type: 'tarea',
        content: { title: 'Tarea clasificada', due_date: null, priority: null },
      }));
    });
    mockDispatchRoutedResult.mockResolvedValue([100]);

    await Promise.all([processPendingInbox(), processPendingInbox()]);

    const dispatchedRawTexts = mockDispatchRoutedResult.mock.calls.map(
      ([, , rawText]) => rawText,
    );
    expect(maxActiveRequests).toBe(1);
    expect(dispatchedRawTexts).toEqual(['Primera captura', 'Segunda captura']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(rows.every((row) => row.status === 'processed')).toBe(true);
  });

  test('serializa reintentos individuales concurrentes', async () => {
    const rows: MutableInboxRow[] = [
      pendingRow(17, 'Reintento uno', 6),
      pendingRow(18, 'Reintento dos', 7),
    ];
    useFakeDb(rows);
    let activeRequests = 0;
    let maxActiveRequests = 0;
    mockFetch.mockImplementation(async () => {
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      activeRequests--;
      return llmResponse(JSON.stringify({
        type: 'tarea',
        content: { title: 'Tarea clasificada', due_date: null, priority: null },
      }));
    });
    mockDispatchRoutedResult.mockResolvedValue([101]);

    await Promise.all([processInboxItem(17), processInboxItem(18)]);

    expect(maxActiveRequests).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(rows.every((row) => row.status === 'processed')).toBe(true);
  });
  test('agrupa disparadores de lifecycle en un único batch', async () => {
    const row = pendingRow(19, 'Captura tras recuperar conexión', 8);
    useFakeDb([row]);
    const pendingRead = Promise.withResolvers<InboxRow[]>();
    mockGetPendingInbox.mockReturnValue(pendingRead.promise);
    mockFetch.mockResolvedValue(llmResponse(JSON.stringify({
      type: 'tarea',
      content: { title: 'Tarea recuperada', due_date: null, priority: null },
    })));
    mockDispatchRoutedResult.mockResolvedValue([102]);

    const first = triggerAutomaticInboxProcessing();
    const second = triggerAutomaticInboxProcessing();
    expect(second).toBe(first);

    pendingRead.resolve([row]);
    await first;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('processed');
  });
});
