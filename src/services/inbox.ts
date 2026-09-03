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
import { getDb, getPendingInbox, dispatchRoutedResult } from '@/db';
import { processInboxText, type RouteType } from './llm';

export type ProcessResult =
  | { skipped: true;  reason: 'not_found' | 'not_pending' }
  | { skipped: false; routeType: RouteType; inboxId: number }
  | { skipped: false; error: string; retryable: true; inboxId: number };

export type BatchResult = {
  processed: number;
  failed: number;
  skipped: number;
  errors: { inboxId: number; error: string }[];
};

// ponytail: helper local de soporte — coercea a string y trunca con …
function truncate(s: unknown, n = 80): string {
  const str = typeof s === 'string' ? s : String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

// ponytail: helper local de soporte — normaliza Error a string, null-safe
function toErrorMessage(err: unknown): string {
  try {
    return err instanceof Error ? err.message : String(err);
  } catch {
    return '[unserializable error]';
  }
}

export async function processInboxItem(id: number): Promise<ProcessResult> {
  // 1. resolver DB (D11: try/catch — getDb puede lanzar si DB no inicializada)
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (err) {
    const msg = toErrorMessage(err);
    console.warn(`[inbox] item ${id} db fail: ${truncate(msg)}`);
    return { skipped: false, error: msg, retryable: true, inboxId: id };
  }

  // 2. leer item por id (SELECT inline — D3)
  const item = await db.getFirstAsync<InboxRow>('SELECT * FROM inbox WHERE id=?', id);
  if (!item || item.status !== 'pending') {
    return { skipped: true, reason: !item ? 'not_found' : 'not_pending' };
  }

  // 3. LLM (D6: try/catch separado para distinguir fallo LLM de fallo dispatch)
  let routed: Awaited<ReturnType<typeof processInboxText>>;
  try {
    routed = await processInboxText(item.raw_text);
  } catch (err) {
    const msg = toErrorMessage(err);
    console.warn(`[inbox] item ${id} LLM fail: ${truncate(msg)} | raw="${truncate(item.raw_text)}"`);
    return { skipped: false, error: msg, retryable: true, inboxId: id };
  }

  // 4. transacción con lock optimista (D12, I2)
  try {
    await db.withTransactionAsync(async () => {
      // ponytail: helper existente no lleva WHERE status='pending', inline necesario
      const result = await db.runAsync(
        'UPDATE inbox SET status=? WHERE id=? AND status=?',
        'processed', id, 'pending',
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
  } catch (err) {
    const msg = toErrorMessage(err);
    console.warn(`[inbox] item ${id} dispatch fail: ${truncate(msg)} | raw="${truncate(item.raw_text)}"`);
    return { skipped: false, error: msg, retryable: true, inboxId: id };
  }
}

// D13: mutex a nivel de módulo — evita batches concurrentes (callers reciben la misma promesa)
let _batchInFlight: Promise<BatchResult> | null = null;
// Si un caller llega con el batch en vuelo, su insert es posterior a la lista
// que el batch ya leyó: se marca retry y el owner da otra pasada al terminar.
let _retryRequested = false;

export async function processPendingInbox(): Promise<BatchResult> {
  // Si ya hay un batch en vuelo, unirse y pedir pasada extra para el trabajo nuevo
  if (_batchInFlight) {
    _retryRequested = true;
    return await _batchInFlight;
  }

  _batchInFlight = doProcess();
  try {
    let result = await _batchInFlight;
    // Capturas nuevas mientras volábamos: pasar hasta drenar
    while (_retryRequested) {
      _retryRequested = false;
      _batchInFlight = doProcess();
      result = await _batchInFlight;
    }
    return result;
  } finally {
    _batchInFlight = null;
  }

  async function doProcess(): Promise<BatchResult> {
    let items: InboxRow[];
    try {
      items = await getPendingInbox();
    } catch (err) {
      const msg = toErrorMessage(err);
      console.warn(`[inbox] batch fail: db getPendingInbox → ${msg}`);
      return { processed: 0, failed: 1, skipped: 0, errors: [{ inboxId: -1, error: msg }] };
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
        result.errors.push({ inboxId: r.inboxId, error: r.error });
      }
    }

    console.info(
      `[inbox] batch done, processed=${result.processed} failed=${result.failed} skipped=${result.skipped}`
    );
    return result;
  }
}
