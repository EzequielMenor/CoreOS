// Edge gesture de back del grafo en iOS (EZE-352): el pop nativo del stack no
// gana cuando el touch arranca sobre el WKWebView, asi que una franja RN del
// borde izquierdo detecta el pan por su cuenta y dispara router.back().
// Unidades: dx/dy en px acumulados del gesto; vx/vy en px/s (gestureState de RN).

export const EDGE_SWIPE_WIDTH = 30;

// Umbral de arrastre dominante: un pan lento hacia la derecha vuelve al
// superar esta distancia (comparable al gesto nativo de iOS).
export const EDGE_BACK_MIN_DX = 72;

// Flick rapido: arrastre minimo + velocidad para volver sin llegar al umbral.
export const EDGE_BACK_FLICK_DX = 24;
export const EDGE_BACK_MIN_VX = 450;

// Exige predominio horizontal claro para no robar drags verticales/diagonales
// del canvas: |dx| >= 2 |dy|.
const HORIZONTAL_RATIO = 2;

export function shouldEdgeSwipeBack(dx: number, dy: number, vx: number, vy: number): boolean {
  if (dx <= 0) return false;
  if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) return false;
  const dominantDrag = dx >= EDGE_BACK_MIN_DX;
  const fastFlick = dx >= EDGE_BACK_FLICK_DX && vx >= EDGE_BACK_MIN_VX;
  return dominantDrag || fastFlick;
}
