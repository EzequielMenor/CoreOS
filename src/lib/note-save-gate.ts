/**
 * note-save-gate — sincroniza el flush del editor con el fetch de la lista.
 *
 * Cuando el editor de notas pierde foco, su useFocusEffect cleanup hace
 * fire-and-forget del flushSave (la promise no se puede await dentro de un
 * cleanup). Sin coordinación, la lista ejecuta fetchSections antes de que
 * el INSERT termine y muestra estado anterior al guardado.
 *
 * Este módulo expone un slot único:
 *  - el editor registra su Promise con setPendingSave al perder foco
 *  - la lista la drena con waitForPendingSave al recibir foco, ANTES de
 *    fetchear
 *
 * ponytail: single-slot. Si hay dos navegaciones rápidas (back-back), la
 * segunda sobrescribe a la primera. La primera aún se completa en
 * background sin coordinación, pero como flushSave ya está protegido con
 * su propio mutex (savingRef) y no comparte estado post-INSERT, no hay
 * deriva observable. Upgrade a Map<noteId, Promise> solo si aparece un
 * patrón editor-1 -> editor-2 simultáneo.
 */

let pending: Promise<void> | null = null;

export function setPendingSave(promise: Promise<void> | null): void {
  pending = promise;
}

export async function waitForPendingSave(): Promise<void> {
  const p = pending;
  pending = null;
  if (!p) return;
  try {
    await p;
  } catch {
    // el editor ya muestra toast de error — el gate no debe relanzar
  }
}
