import * as SecureStore from 'expo-secure-store';

import {
  dispatchRoutedResult,
  getDb,
  getPendingInbox,
  insertInbox,
  type InboxRow,
} from '@/db';

import { captureInbox } from '../capture';
import { processInboxItem, processPendingInbox } from '../inbox';

jest.mock('@/db', () => ({
  dispatchRoutedResult: jest.fn(),
  getDb: jest.fn(),
  getPendingInbox: jest.fn(),
  insertInbox: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
}));

const mockGetPendingInbox = jest.mocked(getPendingInbox);
const mockGetDb = jest.mocked(getDb);
const mockInsertInbox = jest.mocked(insertInbox);
const mockDispatchRoutedResult = jest.mocked(dispatchRoutedResult);
const mockGetSecureItem = jest.mocked(SecureStore.getItemAsync);
const mockFetch = jest.fn();

type MutableInboxRow = Omit<InboxRow, 'status'> & { status: InboxRow['status'] };

function llmResponse(content: string): Response {
  return {
    json: async () => ({ choices: [{ message: { content } }] }),
    ok: true,
    status: 200,
    statusText: 'OK',
  } as Response;
}

function useFakeDb(rows: MutableInboxRow[]) {
  const db = {
    getFirstAsync: jest.fn(async (_query: string, id: number) => (
      rows.find((row) => row.id === id) ?? null
    )),
    runAsync: jest.fn(
      async (_query: string, nextStatus: InboxRow['status'], id: number, expectedStatus: InboxRow['status']) => {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row || row.status !== expectedStatus) {
          return { changes: 0, lastInsertRowId: 0 };
        }
        row.status = nextStatus;
        return { changes: 1, lastInsertRowId: 0 };
      },
    ),
    withTransactionAsync: jest.fn(async (task: () => Promise<void>) => task()),
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
    mockGetSecureItem.mockImplementation(async (key) => (
      key === 'llm.apiKey' ? 'test-api-key' : null
    ));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
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
    const row: MutableInboxRow = {
      id: 7,
      raw_text: rawText,
      created_at: 1,
      status: 'pending',
    };
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
  });

  test('mantiene pending y conserva raw_text ante una respuesta LLM inválida', async () => {
    const rawText = 'Texto que no se puede perder';
    const row: MutableInboxRow = {
      id: 8,
      raw_text: rawText,
      created_at: 2,
      status: 'pending',
    };
    const db = useFakeDb([row]);
    mockFetch.mockResolvedValue(llmResponse('respuesta sin JSON'));

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      error: 'LLM: JSON inválido del modelo',
      retryable: true,
      inboxId: row.id,
    });
    expect(db.runAsync).not.toHaveBeenCalled();
    expect(mockDispatchRoutedResult).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'pending', raw_text: rawText });
  });

  test('mantiene pending y conserva raw_text ante un fallo de red', async () => {
    const rawText = 'Otra captura importante';
    const row: MutableInboxRow = {
      id: 9,
      raw_text: rawText,
      created_at: 3,
      status: 'pending',
    };
    const db = useFakeDb([row]);
    mockFetch.mockRejectedValue(new Error('sin conexión'));

    const result = await processInboxItem(row.id);

    expect(result).toEqual({
      skipped: false,
      error: 'LLM request failed: sin conexión',
      retryable: true,
      inboxId: row.id,
    });
    expect(db.runAsync).not.toHaveBeenCalled();
    expect(mockDispatchRoutedResult).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'pending', raw_text: rawText });
  });

  test('procesa secuencialmente y no duplica capturas con batches concurrentes', async () => {
    const rows: MutableInboxRow[] = [
      { id: 10, raw_text: 'Primera captura', created_at: 4, status: 'pending' },
      { id: 11, raw_text: 'Segunda captura', created_at: 5, status: 'pending' },
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
});
