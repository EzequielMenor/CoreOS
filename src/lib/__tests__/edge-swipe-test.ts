import {
  EDGE_BACK_FLICK_DX,
  EDGE_BACK_MIN_DX,
  EDGE_BACK_MIN_VX,
  shouldEdgeSwipeBack,
} from '@/lib/edge-swipe';

describe('shouldEdgeSwipeBack', () => {
  it('triggers on a dominant rightward drag', () => {
    expect(shouldEdgeSwipeBack(EDGE_BACK_MIN_DX, 0, 0, 0)).toBe(true);
    expect(shouldEdgeSwipeBack(200, 0, 0, 0)).toBe(true);
  });

  it('rejects drags below the distance threshold without a fast flick', () => {
    expect(shouldEdgeSwipeBack(EDGE_BACK_MIN_DX - 1, 0, 100, 0)).toBe(false);
  });

  it('accepts a fast rightward flick with a small drag', () => {
    expect(shouldEdgeSwipeBack(EDGE_BACK_FLICK_DX, 0, EDGE_BACK_MIN_VX, 0)).toBe(true);
    expect(shouldEdgeSwipeBack(60, 0, 1200, 0)).toBe(true);
  });

  it('rejects slow short drags', () => {
    expect(shouldEdgeSwipeBack(EDGE_BACK_FLICK_DX - 1, 0, EDGE_BACK_MIN_VX, 0)).toBe(false);
    expect(shouldEdgeSwipeBack(EDGE_BACK_FLICK_DX, 0, EDGE_BACK_MIN_VX - 1, 0)).toBe(false);
  });

  it('requires horizontal predominance of 2 to 1', () => {
    expect(shouldEdgeSwipeBack(100, 50, 0, 0)).toBe(true);
    expect(shouldEdgeSwipeBack(100, 50.5, 0, 0)).toBe(false);
    expect(shouldEdgeSwipeBack(30, 120, 0, 0)).toBe(false);
  });

  it('never triggers for leftward or zero drags', () => {
    expect(shouldEdgeSwipeBack(-100, 0, 0, 0)).toBe(false);
    expect(shouldEdgeSwipeBack(0, 0, 0, 0)).toBe(false);
  });

  it('rejects a rightward drift inside a vertical drag', () => {
    expect(shouldEdgeSwipeBack(20, 300, 100, 1500)).toBe(false);
  });
});
