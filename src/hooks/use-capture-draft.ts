/**
 * useCaptureDraft — borrador persistente de la tab Capturar.
 *
 * Un único texto (v0.2) guardado en SQLite vía `@/db/queries/draft`
 * (nunca SecureStore: no es una credencial). Maneja:
 *  - Restauración al montar (volver a la tab o relanzar la app).
 *  - Autosave con debounce: las pulsaciones rápidas colapsan en una escritura.
 *  - Flush del timer pendiente al pasar a background y al desmontar.
 *  - `discardDraft()` solo tras confirmar `insertInbox()`; si el guardado de
 *    la captura falla, texto y borrador se mantienen intactos.
 *
 * Invariante: el borrador NUNCA se envía al inbox — aquí no se toca
 * `insertInbox`; solo persiste texto local.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { clearCaptureDraft, getCaptureDraft, saveCaptureDraft } from '@/db/queries/draft';

const DRAFT_DEBOUNCE_MS = 500;

export interface CaptureDraftResult {
  text: string;
  handleChangeText: (value: string) => void;
  /** Borrar borrador en disco + estado tras confirmar la persistencia. */
  discardDraft: () => void;
}

export function useCaptureDraft(): CaptureDraftResult {
  const [text, setText] = useState('');

  // textRef espeja el valor para callbacks no-React (AppState, unmount).
  const textRef = useRef(text);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const persistDraft = useCallback((value: string) => {
    // Un borrador en blanco se borra, no se guarda: nada que restaurar.
    const op = value.trim() ? saveCaptureDraft(value) : clearCaptureDraft();
    // ponytail: un fallo del borrador nunca interrumpe la escritura.
    op.catch((e: unknown) => {
      console.warn('[capturar] fallo guardando borrador:', e);
    });
  }, []);

  const handleChangeText = useCallback(
    (value: string) => {
      setText(value);
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        draftTimer.current = null;
        persistDraft(value);
      }, DRAFT_DEBOUNCE_MS);
    },
    [persistDraft],
  );

  // El flush solo actúa si hay un timer pendiente; si no, el disco ya está
  // al día. Así un fetch de restauración lento o fallido nunca borra con el
  // texto vacío inicial un borrador que sí existe en disco.
  const flushDraft = useCallback(() => {
    if (!draftTimer.current) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = null;
    persistDraft(textRef.current);
  }, [persistDraft]);

  // Restaurar el borrador al montar (volver a la tab o relanzar la app).
  useEffect(() => {
    let active = true;
    getCaptureDraft()
      .then((draft) => {
        // No pisar lo que el usuario ya escribió durante el await.
        if (active && draft.trim() && textRef.current === '') setText(draft);
      })
      .catch(() => {
        // Sin borrador legible no hay nada que restaurar.
      });
    return () => {
      active = false;
    };
  }, []);

  // Interrupciones: pasar a background o desmontar con escritura pendiente.
  useEffect(() => {
    const onAppState = (status: AppStateStatus) => {
      if (status !== 'active') flushDraft();
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      sub.remove();
      flushDraft();
    };
  }, [flushDraft]);

  const discardDraft = useCallback(() => {
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    setText('');
    clearCaptureDraft().catch((e: unknown) => {
      console.warn('[capturar] fallo borrando draft:', e);
    });
  }, []);

  return { text, handleChangeText, discardDraft };
}
