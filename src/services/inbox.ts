/**
 * Servicio de orquestación del inbox — pipeline LLM → dispatch transaccional.
 *
 * Asunciones (D10):
 * - initDb() ya fue llamada desde _layout.tsx. getDb() siempre resuelve una instancia.
 * - dispatchRoutedResult cubre los 5 RouteType (exhaustivo via switch en db/index.tsx).
 *
 * Invariantes (no violar sin actualizar design.md):
 * - I1: dispatchRoutedResult NO debe usar withTransactionAsync internamente.
 * - I2: UPDATE con guard WHERE status='pending' VA ANTES que dispatchRoutedResult.
 * - I3: Procesamiento de items es secuencial (for/await, NO Promise.all).
 * - I4: Las funciones exportadas nunca lanzan — siempre retornan ProcessResult o BatchResult.
 */

import type { InboxRow } from '@/db';
import { dispatchRoutedResult, getDb, getPendingInbox } from '@/db';
import {
  getInboxErrorMessage,
  InboxPipelineError,
  isInboxErrorRetryable,
  type InboxErrorCode,
} from './inbox-diagnostics';
import { processInboxText, type RouteType } from './llm';

export type ProcessResult =
  | { skipped: true;  reason: 'not_found' | 'not_pending' }
  | { skipped: false; routeType: RouteType; inboxId: number }
  | {
      skipped: false;
      error: string;
      errorCode: InboxErrorCode;
      retryable: boolean;
      inboxId: number;
    };

export type BatchResult = {
  processed: number;
  failed: number;
  skipped: number;
  errors: { inboxId: number; error: string; errorCode: InboxErrorCode }[];
};

type SafeDiagnosis = {
  code: InboxErrorCode;
  technicalCode: string;
};

const MAX_AUTO_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 30_000;

function diagnose(error: unknown, fallbackCode: InboxErrorCode): SafeDiagnosis {
  if (error instanceof InboxPipelineError) {
    return { code: error.code, technicalCode: error.technicalCode };
  }
  const safeType = error instanceof TypeError
    ? 'TypeError'
    : error instanceof Error
      ? 'Error'
      : typeof error;
  return { code: fallbackCode, technicalCode: safeType };
}

function nextRetryAt(code: InboxErrorCode, attempt: number, now: number): number | null {
  if (!isInboxErrorRetryable(code) || attempt >= MAX_AUTO_ATTEMPTS) return null;
  const delay = BASE_RETRY_DELAY_MS * (2 ** Math.min(attempt - 1, 6));
  return now + delay;
}

async function recordFailure(
  db: Awaited<ReturnType<typeof getDb>>,
  item: InboxRow,
  diagnosis: SafeDiagnosis,
): Promise<boolean> {
  const attempt = item.attempt_count + 1;
  const attemptedAt = Date.now();
  const retryAt = nextRetryAt(diagnosis.code, attempt, attemptedAt);
  try {
    await db.runAsync(
      `UPDATE inbox
        SET error_code=?, last_attempt_at=?, attempt_count=attempt_count+1, next_retry_at=?
        WHERE id=? AND status=?`,
      diagnosis.code,
      attemptedAt,
      retryAt,
      item.id,
      'pending',
    );
  } catch (error) {
    const persistenceFailure = diagnose(error, 'storage');
    console.warn('[inbox] diagnostic persistence failed', {
      inboxId: item.id,
      category: persistenceFailure.code,
      detail: persistenceFailure.technicalCode,
    });
  }
  return retryAt !== null;
}

async function failedResult(
  db: Awaited<ReturnType<typeof getDb>>,
  item: InboxRow,
  diagnosis: SafeDiagnosis,
): Promise<ProcessResult> {
  const retryable = await recordFailure(db, item, diagnosis);
  console.warn('[inbox] item failed', {
    inboxId: item.id,
    category: diagnosis.code,
    detail: diagnosis.technicalCode,
    attempt: item.attempt_count + 1,
    retryable,
  });
  return {
    skipped: false,
    error:
      !retryable && isInboxErrorRetryable(diagnosis.code)
        ? 'Los reintentos automáticos están pausados. Reinténtalo manualmente.'
        : getInboxErrorMessage(diagnosis.code),
    errorCode: diagnosis.code,
    retryable,
    inboxId: item.id,
  };
}

export async function processInboxItem(id: number): Promise<ProcessResult> {
  // 1. resolver DB (D11: try/catch — getDb puede lanzar si DB no inicializada)
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (error) {
    const diagnosis = diagnose(error, 'storage');
    console.warn('[inbox] database unavailable', {
      inboxId: id,
      category: diagnosis.code,
      detail: diagnosis.technicalCode,
    });
    return {
      skipped: false,
      error: getInboxErrorMessage(diagnosis.code),
      errorCode: diagnosis.code,
      retryable: false,
      inboxId: id,
    };
  }

  // 2. leer item por id (SELECT inline — D3)
  let item: InboxRow | null;
  try {
    item = await db.getFirstAsync<InboxRow>('SELECT * FROM inbox WHERE id=?', id);
  } catch (error) {
    const diagnosis = diagnose(error, 'storage');
    console.warn('[inbox] item read failed', {
      inboxId: id,
      category: diagnosis.code,
      detail: diagnosis.technicalCode,
    });
    return {
      skipped: false,
      error: getInboxErrorMessage(diagnosis.code),
      errorCode: diagnosis.code,
      retryable: false,
      inboxId: id,
    };
  }
  if (!item || item.status !== 'pending') {
    return { skipped: true, reason: !item ? 'not_found' : 'not_pending' };
  }

  // 3. LLM (D6: try/catch separado para distinguir fallo LLM de fallo dispatch)
  let routed: Awaited<ReturnType<typeof processInboxText>>;
  try {
    routed = await processInboxText(item.raw_text);
  } catch (error) {
    return failedResult(db, item, diagnose(error, 'provider_error'));
  }

  // 4. transacción con lock optimista (D12, I2)
  try {
    await db.withTransactionAsync(async () => {
      // ponytail: helper existente no lleva WHERE status='pending', inline necesario
      const result = await db.runAsync(
        `UPDATE inbox
          SET status=?, error_code=NULL, last_attempt_at=?,
              attempt_count=attempt_count+1, next_retry_at=NULL
          WHERE id=? AND status=?`,
        'processed', Date.now(), id, 'pending',
      );
      // Si otro caller ya procesó este item, changes=0 → early return (commit vacío)
      if (result.changes === 0) return;

      // I1: dispatchRoutedResult debe usar solo runAsync/getFirstAsync directos,
      // nunca withTransactionAsync. Como getDb() retorna singleton, las queries
      // internas de dispatchRoutedResult corren en la misma conexión → misma tx.
      // V1: raw_text viaja como argumento; para 'nota' es el cuerpo íntegro.
      await dispatchRoutedResult(routed.type, routed.content as Record<string, unknown>, item.raw_text);
    });

    return { skipped: false, routeType: routed.type, inboxId: id };
  } catch (error) {
    return failedResult(db, item, diagnose(error, 'dispatch'));
  }
}

// D13: mutex a nivel de módulo — evita batches concurrentes (callers reciben la misma promesa)
let _batchInFlight: Promise<BatchResult> | null = null;
// Si un caller llega con el batch en vuelo, su insert es posterior a la lista
// que el batch ya leyó: se marca retry y el owner da otra pasada al terminar.
let _retryRequested = false;
let _forceRetryRequested = false;

export async function processPendingInbox(options: { force?: boolean } = {}): Promise<BatchResult> {
  // Si ya hay un batch en vuelo, unirse y pedir pasada extra para el trabajo nuevo
  if (_batchInFlight) {
    _retryRequested = true;
    _forceRetryRequested ||= options.force === true;
    return await _batchInFlight;
  }

  _batchInFlight = doProcess(options.force === true);
  try {
    let result = await _batchInFlight;
    // Capturas nuevas mientras volábamos: pasar hasta drenar
    while (_retryRequested) {
      _retryRequested = false;
      const force = _forceRetryRequested;
      _forceRetryRequested = false;
      _batchInFlight = doProcess(force);
      result = await _batchInFlight;
    }
    return result;
  } finally {
    _batchInFlight = null;
  }

  async function doProcess(force: boolean): Promise<BatchResult> {
    let items: InboxRow[];
    try {
      items = await getPendingInbox(force);
    } catch (error) {
      const diagnosis = diagnose(error, 'storage');
      console.warn('[inbox] batch read failed', {
        category: diagnosis.code,
        detail: diagnosis.technicalCode,
      });
      return {
        processed: 0,
        failed: 1,
        skipped: 0,
        errors: [{
          inboxId: -1,
          error: getInboxErrorMessage(diagnosis.code),
          errorCode: diagnosis.code,
        }],
      };
    }

    const result: BatchResult = { processed: 0, failed: 0, skipped: 0, errors: [] };

    if (items.length === 0) return result;

    console.info(`[inbox] batch start, ${items.length} items pending`);

    // I3: secuencial, nunca Promise.all.
    for (const item of items) {
      const r = await processInboxItem(item.id);
      if (r.skipped) {
        result.skipped++;
      } else if ('routeType' in r) {
        result.processed++;
      } else {
        result.failed++;
        result.errors.push({ inboxId: r.inboxId, error: r.error, errorCode: r.errorCode });
      }
    }

    console.info(
      `[inbox] batch done, processed=${result.processed} failed=${result.failed} skipped=${result.skipped}`
    );
    return result;
  }
}
