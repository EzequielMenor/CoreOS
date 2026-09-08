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
import { dispatchRoutedResult, getDb, getNextPendingInboxRetryAt, getPendingInbox } from '@/db';
import {
  getInboxErrorMessage,
  InboxPipelineError,
  isInboxErrorRetryable,
  type InboxErrorCode,
} from './inbox-diagnostics';
import { processInboxText, type RouteType } from './llm';

export type ProcessResult =
  | { skipped: true;  reason: 'not_found' | 'not_pending' }
  | { skipped: false; routeType: RouteType; inboxId: number; targetIds: number[] }
  | {
      skipped: false;
      error: string;
      errorCode: InboxErrorCode;
      retryable: boolean;
      inboxId: number;
    };

// Resultado atribuible a UNA captura: el inboxId de origen y los rowids
// insertados por dispatchRoutedResult (nota → notes.id, tarea → tareas.id, …).
export type CaptureOutcome = {
  inboxId: number;
  routeType: RouteType;
  targetIds: number[];
};

export type BatchResult = {
  processed: number;
  failed: number;
  skipped: number;
  outcomes: CaptureOutcome[];
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

async function processInboxItemInternal(id: number): Promise<ProcessResult> {
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
    let claimed = false;
    let targetIds: number[] = [];
    await db.withTransactionAsync(async () => {
      // ponytail: helper existente no lleva WHERE status='pending', inline necesario
      const result = await db.runAsync(
        `UPDATE inbox
          SET status=?, error_code=NULL, last_attempt_at=?,
              attempt_count=attempt_count+1, next_retry_at=NULL
          WHERE id=? AND status=? AND raw_text=?`,
        'processed', Date.now(), id, 'pending', item.raw_text,
      );
      // Si otro caller ya procesó este item, changes=0 → early return (commit vacío)
      if (result.changes === 0) return;
      claimed = true;

      // I1: dispatchRoutedResult debe usar solo runAsync/getFirstAsync directos,
      // nunca withTransactionAsync. Como getDb() retorna singleton, las queries
      // internas de dispatchRoutedResult corren en la misma conexión → misma tx.
      // V1: raw_text viaja como argumento; para 'nota' es el cuerpo íntegro.
      targetIds = await dispatchRoutedResult(routed.type, routed.content as Record<string, unknown>, item.raw_text);
    });

    // Una edición concurrente conserva la captura editada y descarta esta respuesta antigua.
    if (!claimed) return { skipped: true, reason: 'not_pending' };
    return { skipped: false, routeType: routed.type, inboxId: id, targetIds };
  } catch (error) {
    return failedResult(db, item, diagnose(error, 'dispatch'));
  }
}

// I3 también cubre reintentos individuales que coinciden con el drenaje automático.
let _itemQueue: Promise<void> = Promise.resolve();

export async function processInboxItem(id: number): Promise<ProcessResult> {
  const previous = _itemQueue;
  let release!: () => void;
  _itemQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await processInboxItemInternal(id);
  } finally {
    release();
  }
}

// D13: mutex a nivel de módulo — evita batches concurrentes. El valor de
// `_batchInFlight` es la promesa del DRENAJE COMPLETO: los callers que llegan
// a mitad de vuelo reciben el resultado acumulado de todas las pasadas
// (incluida la suya), no solo la primera. Así el feedback es atribuible por
// inboxId y nunca se inventa desde totales.
let _batchInFlight: Promise<BatchResult> | null = null;
// Si un caller llega con el batch en vuelo, su insert es posterior a la lista
// que el batch ya leyó: se marca retry y el owner da otra pasada al terminar.
let _retryRequested = false;
let _forceRetryRequested = false;

const MAX_TIMER_DELAY_MS = 2_147_000_000;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _retryTimerAt: number | null = null;
let _automaticRun: Promise<void> | null = null;

async function scheduleAutomaticRetry(): Promise<void> {
  let nextRetryAt: number | null;
  try {
    nextRetryAt = await getNextPendingInboxRetryAt();
  } catch (error) {
    console.warn('[inbox] retry schedule read failed', {
      detail: error instanceof Error ? error.name : typeof error,
    });
    return;
  }

  if (nextRetryAt === null) {
    if (_retryTimer) clearTimeout(_retryTimer);
    _retryTimer = null;
    _retryTimerAt = null;
    return;
  }

  if (_retryTimer && _retryTimerAt !== null && _retryTimerAt <= nextRetryAt) return;
  if (_retryTimer) clearTimeout(_retryTimer);

  _retryTimerAt = nextRetryAt;
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    _retryTimerAt = null;
    void triggerAutomaticInboxProcessing();
  }, Math.min(Math.max(0, nextRetryAt - Date.now()), MAX_TIMER_DELAY_MS));
}

export function triggerAutomaticInboxProcessing(options: { force?: boolean } = {}): Promise<void> {
  if (_automaticRun) {
    // Un guardado válido de configuración desbloquea también errores anteriores
    // de credenciales; el mutex del pipeline absorbe la pasada extra.
    if (options.force) void processPendingInbox({ force: true });
    return _automaticRun;
  }

  _automaticRun = processPendingInbox({ force: options.force === true })
    .then(() => undefined)
    .catch((error) => {
      // I4 protege el pipeline; este catch cubre fallos inesperados del caller.
      console.warn('[inbox] automatic processing failed', {
        detail: error instanceof Error ? error.name : typeof error,
      });
    })
    .finally(() => {
      _automaticRun = null;
    });
  return _automaticRun;
}

export async function processPendingInbox(options: { force?: boolean } = {}): Promise<BatchResult> {
  // Unirse al drenaje en vuelo y pedir pasada extra para el trabajo nuevo
  // (el insert propio es posterior a la lista que la pasada en curso ya leyó).
  if (_batchInFlight) {
    _retryRequested = true;
    _forceRetryRequested ||= options.force === true;
    return await _batchInFlight;
  }

  const total: BatchResult = { processed: 0, failed: 0, skipped: 0, outcomes: [], errors: [] };
  let settle!: (result: BatchResult) => void;
  _batchInFlight = new Promise<BatchResult>((resolve) => {
    settle = resolve;
  });

  try {
    let force = options.force === true;
    for (;;) {
      _retryRequested = false;
      _forceRetryRequested = false;
      const pass = await doProcess(force);
      // Misma referencia `total` para todos los joiners: fusionar es síncrono.
      total.processed += pass.processed;
      total.failed += pass.failed;
      total.skipped += pass.skipped;
      total.outcomes.push(...pass.outcomes);
      total.errors.push(...pass.errors);
      force = _forceRetryRequested;
      if (!_retryRequested && !_forceRetryRequested) break;
    }
  } catch (error) {
    // I4 protege el pipeline; este catch cubre rechazos inesperados de doProcess.
    console.warn('[inbox] batch drain aborted', {
      detail: error instanceof Error ? error.name : typeof error,
    });
  }

  // Resolver y liberar el mutex en el mismo tick: un caller que llegue a
  // partir de aquí inicia un drenaje nuevo en vez de unirse a uno ya cerrado.
  settle(total);
  _batchInFlight = null;
  void scheduleAutomaticRetry();
  return total;

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
        outcomes: [],
        errors: [{
          inboxId: -1,
          error: getInboxErrorMessage(diagnosis.code),
          errorCode: diagnosis.code,
        }],
      };
    }

    const result: BatchResult = { processed: 0, failed: 0, skipped: 0, outcomes: [], errors: [] };

    if (items.length === 0) return result;

    console.info(`[inbox] batch start, ${items.length} items pending`);

    // I3: secuencial, nunca Promise.all.
    for (const item of items) {
      const r = await processInboxItem(item.id);
      if (r.skipped) {
        result.skipped++;
      } else if ('routeType' in r) {
        result.processed++;
        result.outcomes.push({ inboxId: r.inboxId, routeType: r.routeType, targetIds: r.targetIds });
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
