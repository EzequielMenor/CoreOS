/**
 * Feedback de destino por captura — asocia el resultado del pipeline a UNA
 * captura concreta (por inboxId), nunca a los totales del batch.
 *
 * Reglas:
 * - Persistencia local («Captura guardada / Pendiente de clasificar») y
 *   clasificación («Guardado como X») son mensajes distintos.
 * - «Guardado como X» solo tras el commit de la transacción de dispatch
 *   (los outcomes los emite inbox.ts después de withTransactionAsync).
 * - «Abrir» solo para dominios con pantalla de destino en V1:
 *   nota → /notas/[id], tarea → /tareas.
 * - gasto/hábito/sueño: confirmar el guardado sin inventar pantalla.
 */
import Toast from 'react-native-toast-message';
import { router } from 'expo-router';

import type { BatchResult, CaptureOutcome, ProcessResult } from '@/services/inbox';
import type { RouteType } from '@/services/llm';

const LABEL: Record<RouteType, string> = {
  nota: 'nota',
  tarea: 'tarea',
  gasto: 'gasto',
  habito: 'hábito',
  sueno: 'sueño',
};

const PENDING_MESSAGE = 'Guardada, pendiente de clasificar';

// ponytail: destino solo donde hay pantalla V1; al abrir UI de gastos/
// hábitos/sueño, añadir su ruta aquí (targetIds ya trae el rowid).
function openActionFor(outcome: CaptureOutcome): (() => void) | null {
  const [targetId] = outcome.targetIds;
  if (targetId === undefined) return null;
  if (outcome.routeType === 'nota') return () => router.push(`/notas/${targetId}`);
  if (outcome.routeType === 'tarea') return () => router.push('/tareas');
  return null;
}

function showSavedAs(outcome: CaptureOutcome): void {
  const open = openActionFor(outcome);
  Toast.show({
    type: open ? 'successAction' : 'success',
    text1: `Guardado como ${LABEL[outcome.routeType]}`,
    visibilityTime: open ? 4000 : 2500,
    props: open
      ? {
          actionLabel: 'Abrir',
          onAction: () => {
            Toast.hide();
            open();
          },
        }
      : undefined,
  });
}

function showPending(reason?: string): void {
  Toast.show({
    type: 'info',
    text1: PENDING_MESSAGE,
    text2: reason,
    visibilityTime: 3500,
  });
}

// Confirmación de persistencia: la captura está a salvo en inbox; NO afirma
// clasificación (el resultado aún no existe).
export function notifyCapturePersisted(count = 1): void {
  Toast.show({
    type: 'info',
    text1: count > 1 ? `${count} capturas guardadas` : 'Captura guardada',
    text2: 'Pendiente de clasificar',
    visibilityTime: 2500,
  });
}

// resultado del drenaje completo del batch — el outcome propio puede llegar en
// una pasada posterior a la del caller (mutex D13): la búsqueda es por inboxId.
export function trackCaptureOutcome(
  processing: Promise<BatchResult>,
  inboxId: number,
): void {
  void processing
    .then((result) => {
      const outcome = result.outcomes.find((candidate) => candidate.inboxId === inboxId);
      if (outcome) {
        showSavedAs(outcome);
        return;
      }
      const failure = result.errors.find((candidate) => candidate.inboxId === inboxId);
      showPending(failure?.error);
    })
    .catch(() => {
      // I4 hace esto defensivo: el pipeline nunca rechaza.
      showPending();
    });
}

// Reintento manual con ProcessResult en mano (lista de capturas pendientes).
export function notifyClassification(result: ProcessResult): void {
  if (result.skipped) return; // la clasificó otro flujo; la lista se recarga igual
  if ('routeType' in result) {
    showSavedAs(result);
  } else {
    Toast.show({
      type: 'error',
      text1: 'No se pudo procesar',
      text2: result.error,
      visibilityTime: 4000,
    });
  }
}
