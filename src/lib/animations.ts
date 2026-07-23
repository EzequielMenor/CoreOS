/**
 * Animation presets + haptic wrappers para Notes v1.
 *
 * Regla: los componentes IMPORTAN de aquí. Nada inline. Si necesitas una
 * nueva animación, añade el preset aquí y documéntalo con JSDoc.
 *
 * Reanimated 4 API: no existe `useAnimatedGestureHandler`. Worklets vía
 * `withTiming` / `withSpring` / `withRepeat` / `withSequence` / `withDelay`.
 * Gestos con `Gesture.Pan()` de react-native-gesture-handler.
 *
 * Spec completo: docs/sdd/active/feat-notes-v1/design.md §2
 */

import * as Haptics from 'expo-haptics';
import {
  Easing,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// ──────────────────────────────────────────────────────────────────────────
//  Presets de animación
// ──────────────────────────────────────────────────────────────────────────

/**
 * 1. entrance.spring — ENTRADA de cards/pantallas (fade-up + scale sutil).
 *
 * Uso: NoteCard al añadirse, EmptyState enter, Hub stats.
 * Aplica a SharedValues `opacity` y `translateY` (mismo SV, no múltiples).
 *
 * @param sv SharedValue que recibe { opacity, translateY }.
 * @param opts.toValue Opacity destino (default 1).
 * @param opts.delay Delay antes de empezar (ms). Default 0.
 * @param opts.y translateY destino (px). Default 0 (entra desde translateY actual del componente).
 */
const entranceSpring = {
  durationHint: 320,
  apply: (
    sv: SharedValue<{ opacity: number; translateY: number }>,
    opts?: { toValue?: 0 | 1; delay?: number; y?: number },
  ) =>
    withDelay(
      opts?.delay ?? 0,
      withSpring(
        { opacity: opts?.toValue ?? 1, translateY: opts?.y ?? 0 },
        { damping: 18, stiffness: 200 },
      ),
    ),
};

/**
 * 2. exit.timing — SALIDA de overlays/empty states (fade out + slight y).
 *
 * @param sv SharedValue { opacity, translateY }.
 * @param delay Delay antes de empezar (ms). Default 0.
 */
const exitTiming = {
  apply: (sv: SharedValue<{ opacity: number; translateY: number }>, delay?: number) =>
    withDelay(
      delay ?? 0,
      withTiming(
        { opacity: 0, translateY: -8 },
        { duration: 200, easing: Easing.out(Easing.ease) },
      ),
    ),
};

/**
 * 3. swipe.threshold.timing — AL CRUZAR threshold: card completa swipe hacia fuera.
 *
 * Tras detectar release > 30% rowWidth.
 *
 * @param translateX_sv SharedValue<number> que controla la X del card.
 * @param targetX Coordenada X final (negativa = swipe-left, positiva = swipe-right).
 */
const swipeThresholdTiming = {
  apply: (translateX_sv: SharedValue<number>, targetX: number) =>
    withTiming(targetX, { duration: 180, easing: Easing.out(Easing.quad) }),
};

/**
 * 4. swipe.return.spring — RELEASE SIN LLEGAR a threshold → card vuelve a 0.
 *
 * Spec exacto: damping 18, stiffness 180.
 *
 * @param translateX_sv SharedValue<number> que controla la X del card.
 */
const swipeReturnSpring = {
  apply: (translateX_sv: SharedValue<number>) =>
    withSpring(0, { damping: 18, stiffness: 180 }),
};

/**
 * 5. press.scale — TAP feedback. Card / TagPill / FAB.
 *
 * 100ms a 0.96, 100ms back a 1.0. Total 200ms.
 *
 * @param scale_sv SharedValue<number> vinculado a transform.scale.
 */
const pressScale = {
  apply: (scale_sv: SharedValue<number>) =>
    withSequence(
      withTiming(0.96, { duration: 100, easing: Easing.out(Easing.quad) }),
      withTiming(1.0, { duration: 100, easing: Easing.out(Easing.quad) }),
    ),
};

/**
 * 6. dot.pulse — AUTO-SAVE dirty indicator. Opacity 0.4 ↔ 1.0 cada 1.6s, infinito.
 *
 * Spec exacto: 800ms a 1.0, 800ms a 0.4, reverse=false (la secuencia ya alterna).
 *
 * @param op_sv SharedValue<number> vinculado a opacity del dot.
 */
const dotPulse = {
  apply: (op_sv: SharedValue<number>) =>
    withRepeat(
      withSequence(
        withTiming(1.0, { duration: 800 }),
        withTiming(0.4, { duration: 800 }),
      ),
      -1,
      false,
    ),
};

/**
 * 7. dot.saved — AUTO-SAVE success: opacity 1 verde 200ms, hold 2s, fade a 0.6.
 *
 * Spec exacto: 200ms a 1, delay 2000ms, 300ms a 0.6. Total ~2.5s.
 * El color lo gestiona el componente (swap a notes.semantic.success en el `withTiming` callback).
 *
 * @param op_sv SharedValue<number> vinculado a opacity del dot.
 */
const dotSaved = {
  apply: (op_sv: SharedValue<number>) =>
    withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(2000, withTiming(0.6, { duration: 300 })),
    ),
};

/**
 * 8. stagger.fadein — HUB stats refresh: cada StatCard entra con delay idx * 50ms.
 *
 * ponytail: si delay crece demasiado con N cards → limitar a 3 cards (cap N=3 en caller).
 *
 * @param sv SharedValue { opacity, translateY }.
 * @param idx Índice de la card (0-based).
 */
const staggerFadein = {
  apply: (sv: SharedValue<{ opacity: number; translateY: number }>, idx: number) =>
    withDelay(
      idx * 50,
      withTiming(
        { opacity: 1, translateY: 0 },
        { duration: 200, easing: Easing.out(Easing.ease) },
      ),
    ),
};

/**
 * 9. tabswitch.fade — IDEAS tabs (Inbox ↔ Procesadas ↔ Descartadas): crossfade 200ms.
 *
 * @param op_sv SharedValue<number> vinculado a opacity del contenedor de tab.
 */
const tabswitchFade = {
  apply: (op_sv: SharedValue<number>) =>
    withTiming(1, { duration: 200, easing: Easing.inOut(Easing.ease) }),
};

// ──────────────────────────────────────────────────────────────────────────
//  Haptics wrappers
// ──────────────────────────────────────────────────────────────────────────

// ponytail: 3 niveles son suficientes. Wrap de expo-haptics para tipado lazy
// y para poder mockear en tests futuros sin tocar callers.

const haptic = {
  tap: {
    /** Tap ligero: tap sobre pills, chips, iconos inline. */
    light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    /** Tap medio: tap sobre cards, list items. */
    medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    /** Tap fuerte: FAB press, swipe-threshold crossed. */
    heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  },
  notify: {
    /** Auto-save success, idea convertida a nota. */
    success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    /** Confirmación de acción reversible (delete, discard). */
    warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
    /** Error de validación, fallo de DB. */
    error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  },
};

// ──────────────────────────────────────────────────────────────────────────
//  Export público
// ──────────────────────────────────────────────────────────────────────────

export const animations = {
  entrance: { spring: entranceSpring },
  exit: { timing: exitTiming },
  swipe: {
    threshold: { timing: swipeThresholdTiming },
    return: { spring: swipeReturnSpring },
  },
  press: { scale: pressScale },
  dot: { pulse: dotPulse, saved: dotSaved },
  stagger: { fadein: staggerFadein },
  tabswitch: { fade: tabswitchFade },
} as const;

export { haptic };