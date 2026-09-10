import { createContext, runInContext } from 'node:vm';

import { createGraphHtml, RECENTER_SCRIPT } from '../NoteGraphView';

jest.mock('react-native-webview', () => 'WebView');
jest.mock('@/hooks/use-theme', () => ({ useTheme: jest.fn() }));

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface RenderFrame {
  translate: Point;
  scale: Point;
  events: string[];
  arcs: { x: number; y: number; radius: number }[];
  segments: { from: Point; to: Point }[];
  labelRects: { x: number; y: number; width: number; height: number }[];
  labelTexts: { value: string; x: number; y: number }[];
}

interface CanvasContext {
  frames: RenderFrame[];
  setTransform: jest.Mock;
  clearRect: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  translate: jest.Mock;
  scale: jest.Mock;
  beginPath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  setLineDash: jest.Mock;
  stroke: jest.Mock;
  arc: jest.Mock;
  fill: jest.Mock;
  strokeRect: jest.Mock;
  fillRect: jest.Mock;
  fillText: jest.Mock;
  measureText: jest.Mock;
}

interface GraphHarness {
  canvas: {
    width: number;
    height: number;
    style: Record<string, string>;
    getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => void;
    setPointerCapture: jest.Mock;
  };
  context: CanvasContext;
  messages: string[];
  setViewport: (width: number, height: number) => void;
  dispatchCanvasEvent: (type: string, event?: Record<string, unknown>) => void;
  flushAnimationFrame: () => void;
  injectJavaScript: (script: string) => void;
}

function framePoint(frame: RenderFrame, point: Point): Point {
  return {
    x: frame.translate.x + point.x * frame.scale.x,
    y: frame.translate.y + point.y * frame.scale.y,
  };
}

function frameRect(frame: RenderFrame, rect: { x: number; y: number; width: number; height: number }): Bounds {
  const topLeft = framePoint(frame, rect);
  const bottomRight = framePoint(frame, {
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  });
  return {
    minX: topLeft.x,
    maxX: bottomRight.x,
    minY: topLeft.y,
    maxY: bottomRight.y,
  };
}

function renderedBounds(frame: RenderFrame): Bounds {
  const bounds: Bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  frame.arcs.forEach((arc) => {
    const center = framePoint(frame, arc);
    const radiusX = arc.radius * frame.scale.x;
    const radiusY = arc.radius * frame.scale.y;
    bounds.minX = Math.min(bounds.minX, center.x - radiusX);
    bounds.maxX = Math.max(bounds.maxX, center.x + radiusX);
    bounds.minY = Math.min(bounds.minY, center.y - radiusY);
    bounds.maxY = Math.max(bounds.maxY, center.y + radiusY);
  });
  frame.segments.forEach((segment) => {
    const from = framePoint(frame, segment.from);
    const to = framePoint(frame, segment.to);
    bounds.minX = Math.min(bounds.minX, from.x, to.x);
    bounds.maxX = Math.max(bounds.maxX, from.x, to.x);
    bounds.minY = Math.min(bounds.minY, from.y, to.y);
    bounds.maxY = Math.max(bounds.maxY, from.y, to.y);
  });
  frame.labelRects.forEach((rect) => {
    const rectBounds = frameRect(frame, rect);
    bounds.minX = Math.min(bounds.minX, rectBounds.minX);
    bounds.maxX = Math.max(bounds.maxX, rectBounds.maxX);
    bounds.minY = Math.min(bounds.minY, rectBounds.minY);
    bounds.maxY = Math.max(bounds.maxY, rectBounds.maxY);
  });
  return bounds;
}

function latestFrame(harness: GraphHarness): RenderFrame {
  const frame = harness.context.frames.at(-1);
  if (!frame) throw new Error('render frame not found');
  return frame;
}

function expectInsideViewport(frame: RenderFrame, width: number, height: number, inset = 20): void {
  const bounds = renderedBounds(frame);
  expect(bounds.minX).toBeGreaterThanOrEqual(inset);
  expect(bounds.maxX).toBeLessThanOrEqual(width - inset);
  expect(bounds.minY).toBeGreaterThanOrEqual(inset);
  expect(bounds.maxY).toBeLessThanOrEqual(height - inset);
  frame.labelTexts.forEach((label) => {
    const point = framePoint(frame, label);
    expect(point.x).toBeGreaterThanOrEqual(inset);
    expect(point.x).toBeLessThanOrEqual(width - inset);
    expect(point.y).toBeGreaterThanOrEqual(inset);
    expect(point.y).toBeLessThanOrEqual(height - inset);
  });
}

function transformOf(frame: RenderFrame): [number, number, number, number] {
  return [frame.translate.x, frame.translate.y, frame.scale.x, frame.scale.y];
}

function makeGraphHarness(html: string): GraphHarness {
  const script = html.match(/<script>\s*([\s\S]*?)\s<\/script>/)?.[1];
  if (!script) throw new Error('graph HTML script not found');

  const messages: string[] = [];
  const windowListeners = new Map<string, (() => void)[]>();
  const canvasListeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  const resizeObservers: (() => void)[] = [];
  const animationFrames: (() => void)[] = [];
  const viewport = { width: 0, height: 0 };
  let currentFrame: RenderFrame | null = null;
  let pendingMove: Point | null = null;

  const context: CanvasContext = {
    frames: [],
    setTransform: jest.fn(),
    clearRect: jest.fn(() => {
      currentFrame = {
        translate: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        events: ['clearRect'],
        arcs: [],
        segments: [],
        labelRects: [],
        labelTexts: [],
      };
      context.frames.push(currentFrame);
    }),
    save: jest.fn(() => {
      currentFrame?.events.push('save');
    }),
    restore: jest.fn(() => {
      currentFrame?.events.push('restore');
    }),
    translate: jest.fn((x: number, y: number) => {
      if (!currentFrame) return;
      currentFrame.translate = { x, y };
      currentFrame.events.push(`translate:${x},${y}`);
    }),
    scale: jest.fn((x: number, y: number) => {
      if (!currentFrame) return;
      currentFrame.scale = { x, y };
      currentFrame.events.push(`scale:${x},${y}`);
    }),
    beginPath: jest.fn(() => {
      pendingMove = null;
    }),
    moveTo: jest.fn((x: number, y: number) => {
      pendingMove = { x, y };
    }),
    lineTo: jest.fn((x: number, y: number) => {
      if (currentFrame && pendingMove) {
        currentFrame.segments.push({ from: pendingMove, to: { x, y } });
      }
    }),
    setLineDash: jest.fn(),
    stroke: jest.fn(() => {
      pendingMove = null;
    }),
    arc: jest.fn((x: number, y: number, radius: number) => {
      currentFrame?.arcs.push({ x, y, radius });
    }),
    fill: jest.fn(),
    strokeRect: jest.fn(),
    fillRect: jest.fn((x: number, y: number, width: number, height: number) => {
      currentFrame?.labelRects.push({ x, y, width, height });
    }),
    fillText: jest.fn((value: string, x: number, y: number) => {
      currentFrame?.labelTexts.push({ value, x, y });
    }),
    measureText: jest.fn((value: string) => ({ width: value.length * 7 })),
  };

  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    getContext: () => context,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: canvas.style.width === '100%' ? viewport.width : Number.parseFloat(canvas.style.width) || viewport.width,
      height: canvas.style.height === '100%' ? viewport.height : Number.parseFloat(canvas.style.height) || viewport.height,
    }),
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
      const listeners = canvasListeners.get(type) ?? [];
      listeners.push(listener);
      canvasListeners.set(type, listeners);
    },
    setPointerCapture: jest.fn(),
  };

  const windowObject = {
    innerWidth: 0,
    innerHeight: 0,
    devicePixelRatio: 2,
    ReactNativeWebView: {
      postMessage: (message: string) => messages.push(message),
    },
    addEventListener: (type: string, listener: () => void) => {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    requestAnimationFrame: (callback: () => void) => {
      animationFrames.push(callback);
      return animationFrames.length;
    },
  };

  class TestResizeObserver {
    constructor(callback: () => void) {
      resizeObservers.push(callback);
    }

    observe(): void {}
  }

  const documentObject = {
    documentElement: { clientWidth: 0, clientHeight: 0 },
    body: { clientWidth: 0, clientHeight: 0 },
    getElementById: () => canvas,
  };

  const vmContext = createContext({
    Date,
    Infinity,
    JSON,
    Map,
    Math,
    ResizeObserver: TestResizeObserver,
    Set,
    window: windowObject,
    document: documentObject,
  });
  runInContext(script, vmContext);

  return {
    canvas,
    context,
    messages,
    setViewport(width: number, height: number) {
      viewport.width = width;
      viewport.height = height;
      windowObject.innerWidth = width;
      windowObject.innerHeight = height;
      documentObject.documentElement.clientWidth = width;
      documentObject.documentElement.clientHeight = height;
      documentObject.body.clientWidth = width;
      documentObject.body.clientHeight = height;
      windowListeners.get('resize')?.forEach((listener) => listener());
      resizeObservers.forEach((listener) => listener());
    },
    dispatchCanvasEvent(type: string, event: Record<string, unknown> = {}) {
      canvasListeners.get(type)?.forEach((listener) => listener({
        preventDefault: jest.fn(),
        ...event,
      }));
    },
    flushAnimationFrame() {
      animationFrames.shift()?.();
    },
    injectJavaScript(script: string) {
      runInContext(script, vmContext);
    },
  };
}

const triangle = {
  nodes: [
    { id: 101, title: 'Primer nodo' },
    { id: 202, title: 'Segundo nodo' },
    { id: 303, title: 'Tercer nodo' },
  ],
  edges: [
    { source: 101, target: 202, origin: 'manual' as const, status: 'confirmed' as const, similarityScore: null },
    { source: 202, target: 303, origin: 'manual' as const, status: 'confirmed' as const, similarityScore: null },
    { source: 303, target: 101, origin: 'manual' as const, status: 'confirmed' as const, similarityScore: null },
  ],
};

const singleNode = { nodes: [triangle.nodes[0]], edges: [] };
const twoNodes = { nodes: triangle.nodes.slice(0, 2), edges: [triangle.edges[0]] };
const fourNodes = {
  nodes: [...triangle.nodes, { id: 404, title: 'Cuarto nodo' }],
  edges: [...triangle.edges, {
    source: 101,
    target: 404,
    origin: 'manual' as const,
    status: 'confirmed' as const,
    similarityScore: null,
  }],
};
const longLabelTriangle = {
  ...triangle,
  nodes: triangle.nodes.map((node, index) => ({
    ...node,
    title: `${node.title} con una etiqueta deliberadamente larga ${index} para probar los límites`,
  })),
};

const colors = {
  background: '#ffffff',
  text: '#111111',
  accent: '#7c5cff',
  muted: '#999999',
};

describe('NoteGraphView inline HTML engine', () => {
  it('boots at 0x0, then renders a centred complete triangle inside the final viewport', () => {
    const harness = makeGraphHarness(createGraphHtml(triangle, colors));

    harness.setViewport(420, 720);
    harness.flushAnimationFrame();

    const frame = latestFrame(harness);
    const bounds = renderedBounds(frame);
    expect(harness.canvas.width).toBe(Math.round(420 * 2));
    expect(harness.canvas.height).toBe(Math.round(720 * 2));
    expect(harness.canvas.style.width).toBe('100%');
    expect(harness.canvas.style.height).toBe('100%');
    expect(harness.context.setTransform.mock.calls.every((call) => call.every((value: number, index: number) => value === [2, 0, 0, 2, 0, 0][index]))).toBe(true);
    expect(frame.arcs).toHaveLength(3);
    expect(frame.labelRects).toHaveLength(3);
    expect(frame.labelTexts.length).toBeGreaterThanOrEqual(3);
    // El sintoma original: las aristas se cortaban contra el borde superior.
    // Las tres aristas del triangulo deben dibujarse completas dentro del viewport.
    const renderedEdges = frame.segments.map((segment) => ({
      from: framePoint(frame, segment.from),
      to: framePoint(frame, segment.to),
    }));
    expect(renderedEdges).toHaveLength(3);
    renderedEdges.forEach((edge) => {
      expect(edge.from.x).toBeGreaterThanOrEqual(20);
      expect(edge.from.x).toBeLessThanOrEqual(400);
      expect(edge.from.y).toBeGreaterThanOrEqual(20);
      expect(edge.from.y).toBeLessThanOrEqual(700);
      expect(edge.to.x).toBeGreaterThanOrEqual(20);
      expect(edge.to.x).toBeLessThanOrEqual(400);
      expect(edge.to.y).toBeGreaterThanOrEqual(20);
      expect(edge.to.y).toBeLessThanOrEqual(700);
    });
    // Triangulo real, no colapso: los tres centros son distinctos entre si.
    const centers = frame.arcs.map((arc) => framePoint(frame, arc));
    const [apex, left, right] = centers;
    expect(Math.hypot(apex.x - left.x, apex.y - left.y)).toBeGreaterThan(80);
    expect(Math.hypot(apex.x - right.x, apex.y - right.y)).toBeGreaterThan(80);
    expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThan(80);
    expectInsideViewport(frame, 420, 720);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(210);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(360);
    expect(frame.events[0]).toBe('clearRect');
    expect(frame.events).toContain('save');
    expect(frame.events).toContain('restore');
  });

  it('centres one node and keeps two nodes deterministic through the rendered transform', () => {
    const one = makeGraphHarness(createGraphHtml(singleNode, colors));
    one.setViewport(420, 720);
    const oneFrame = latestFrame(one);
    expectInsideViewport(oneFrame, 420, 720);
    const oneBounds = renderedBounds(oneFrame);
    // El fit centra el conjunto nodo+label (esa es la unidad visible que no debe
    // cortarse), por eso el circulo queda levemente sobre el centro geometrico.
    expect((oneBounds.minX + oneBounds.maxX) / 2).toBeCloseTo(210);
    expect((oneBounds.minY + oneBounds.maxY) / 2).toBeCloseTo(360);
    const oneCenter = framePoint(oneFrame, oneFrame.arcs[0]);
    expect(oneCenter.x).toBeCloseTo(210);
    expect(oneCenter.y).toBeGreaterThan(20);
    expect(oneCenter.y).toBeLessThan(360);

    const two = makeGraphHarness(createGraphHtml(twoNodes, colors));
    two.setViewport(420, 720);
    const twoFrame = latestFrame(two);
    expect(twoFrame.arcs).toEqual([
      { x: 128, y: 360, radius: 24 },
      { x: 292, y: 360, radius: 24 },
    ]);
    const first = framePoint(twoFrame, twoFrame.arcs[0]);
    const second = framePoint(twoFrame, twoFrame.arcs[1]);
    expect(first.y).toBeCloseTo(second.y);
    expectInsideViewport(twoFrame, 420, 720);
  });

  it('uses real rendered label and node bounds after a second viewport resize', () => {
    const harness = makeGraphHarness(createGraphHtml(longLabelTriangle, colors));
    harness.setViewport(390, 663);
    harness.flushAnimationFrame();
    harness.setViewport(412, 915);
    harness.flushAnimationFrame();

    const frame = latestFrame(harness);
    expect(harness.canvas.width).toBe(Math.round(412 * 2));
    expect(harness.canvas.height).toBe(Math.round(915 * 2));
    expectInsideViewport(frame, 412, 915);
    expect(harness.context.setTransform.mock.calls.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
    expect((renderedBounds(frame).minX + renderedBounds(frame).maxX) / 2).toBeCloseTo(206);
    expect((renderedBounds(frame).minY + renderedBounds(frame).maxY) / 2).toBeCloseTo(457.5);
  });

  it('stops larger graph movement after the settled rendered frame', () => {
    const harness = makeGraphHarness(createGraphHtml(fourNodes, colors));
    harness.setViewport(420, 720);

    for (let frame = 0; frame < 181; frame += 1) harness.flushAnimationFrame();
    const settled = latestFrame(harness);
    harness.flushAnimationFrame();
    const afterSettle = latestFrame(harness);
    expect(transformOf(afterSettle)).toEqual(transformOf(settled));
    expect(afterSettle.arcs).toEqual(settled.arcs);
    expectInsideViewport(settled, 420, 720);
  });

  it('keeps pan, pinch, wheel, dblclick, and the injected recenter bridge on one transform', () => {
    const harness = makeGraphHarness(createGraphHtml(triangle, colors));
    harness.setViewport(420, 720);
    const initial = latestFrame(harness);
    const initialTransform = transformOf(initial);
    expect(RECENTER_SCRIPT).toContain('__coreosNoteGraphRecenter');

    harness.dispatchCanvasEvent('pointerdown', { pointerId: 1, clientX: 180, clientY: 300 });
    harness.dispatchCanvasEvent('pointermove', { pointerId: 1, clientX: 210, clientY: 330 });
    harness.flushAnimationFrame();
    const panned = latestFrame(harness);
    expect(transformOf(panned)).not.toEqual(initialTransform);
    harness.dispatchCanvasEvent('pointerup', { pointerId: 1 });

    harness.dispatchCanvasEvent('pointerdown', { pointerId: 1, clientX: 150, clientY: 300 });
    harness.dispatchCanvasEvent('pointerdown', { pointerId: 2, clientX: 240, clientY: 300 });
    harness.dispatchCanvasEvent('pointermove', { pointerId: 2, clientX: 280, clientY: 300 });
    harness.flushAnimationFrame();
    const pinched = latestFrame(harness);
    expect(transformOf(pinched)).not.toEqual(transformOf(panned));
    harness.dispatchCanvasEvent('pointerup', { pointerId: 1 });
    harness.dispatchCanvasEvent('pointerup', { pointerId: 2 });

    harness.dispatchCanvasEvent('wheel', { clientX: 210, clientY: 360, deltaY: -100 });
    harness.flushAnimationFrame();
    const wheeled = latestFrame(harness);
    expect(transformOf(wheeled)).not.toEqual(transformOf(pinched));

    harness.dispatchCanvasEvent('dblclick');
    harness.flushAnimationFrame();
    expect(transformOf(latestFrame(harness))).toEqual(initialTransform);

    harness.dispatchCanvasEvent('wheel', { clientX: 210, clientY: 360, deltaY: 100 });
    harness.injectJavaScript(RECENTER_SCRIPT);
    harness.flushAnimationFrame();
    expect(transformOf(latestFrame(harness))).toEqual(initialTransform);
  });

  it('posts the unchanged node id when tapping a transformed rendered node', () => {
    const harness = makeGraphHarness(createGraphHtml(triangle, colors));
    harness.setViewport(420, 720);
    const frame = latestFrame(harness);
    const node = frame.arcs[1];
    const screenPoint = framePoint(frame, node);

    harness.dispatchCanvasEvent('click', { clientX: screenPoint.x, clientY: screenPoint.y });

    expect(harness.messages).toContain('202');
  });
});
