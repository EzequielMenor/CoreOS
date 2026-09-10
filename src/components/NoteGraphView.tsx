import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';

import type { GraphEdge, GraphNode } from '@/db/queries/graph';
import { useTheme } from '@/hooks/use-theme';

export interface NoteGraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusNodeId?: number;
  onNodePress: (noteId: number) => void;
}

function serializeGraph(value: { nodes: GraphNode[]; edges: GraphEdge[] }): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function createGraphHtml(
  data: { nodes: GraphNode[]; edges: GraphEdge[] },
  colors: { background: string; text: string; accent: string; muted: string },
  focusNodeId?: number,
): string {
  const graphData = serializeGraph(data);
  const focusId = Number.isFinite(focusNodeId) ? focusNodeId : null;

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body, canvas { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body { background: ${colors.background}; }
  canvas { display: block; touch-action: none; }
</style>
</head>
<body>
<canvas id="graph"></canvas>
<script>
(() => {
  const data = ${graphData};
  const colors = ${JSON.stringify(colors)};
  const focusId = ${focusId === null ? 'null' : focusId};
  const canvas = document.getElementById('graph');
  const context = canvas.getContext('2d');
  const positions = new Map();
  const velocities = new Map();
  const labelDirections = new Map();
  const pointers = new Map();
  const nodeRadius = 24;
  const labelMaxWidth = 148;
  const minZoom = 0.65;
  const maxZoom = 2.5;
  let width = 0;
  let height = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let gesture = null;
  let suppressClickUntil = 0;
  let initialized = false;
  let animationFrame;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (initialized) fitGraph();
  }

  function initialize() {
    const count = data.nodes.length;
    const centerX = width / 2;
    const centerY = height / 2;
    const compactSpacing = Math.min(105, Math.max(82, width * 0.18));

    if (count === 1) {
      positions.set(data.nodes[0].id, { x: centerX, y: centerY });
      labelDirections.set(data.nodes[0].id, 1);
    } else if (count === 2) {
      positions.set(data.nodes[0].id, { x: centerX - compactSpacing, y: centerY });
      positions.set(data.nodes[1].id, { x: centerX + compactSpacing, y: centerY });
      labelDirections.set(data.nodes[0].id, -1);
      labelDirections.set(data.nodes[1].id, 1);
    } else if (count === 3) {
      positions.set(data.nodes[0].id, { x: centerX, y: centerY - 72 });
      positions.set(data.nodes[1].id, { x: centerX - compactSpacing, y: centerY + 54 });
      positions.set(data.nodes[2].id, { x: centerX + compactSpacing, y: centerY + 54 });
      labelDirections.set(data.nodes[0].id, -1);
      labelDirections.set(data.nodes[1].id, 1);
      labelDirections.set(data.nodes[2].id, 1);
    } else {
      const radius = Math.max(110, Math.min(220, Math.min(width, height) * 0.28));
      data.nodes.forEach((node, index) => {
        const angle = (index / Math.max(1, count)) * Math.PI * 2;
        positions.set(node.id, {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      });
    }

    data.nodes.forEach((node) => {
      velocities.set(node.id, { x: 0, y: 0 });
    });
    initialized = true;
    fitGraph();
  }

  function splitLongWord(word) {
    const chunks = [];
    let current = '';
    for (const character of word) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > labelMaxWidth) {
        chunks.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function getLabelLines(value) {
    const label = value.trim() || 'Sin título';
    const words = label.split(/\\s+/);
    const lines = [];
    let current = '';

    words.forEach((word) => {
      if (context.measureText(word).width > labelMaxWidth) {
        if (current) lines.push(current);
        const chunks = splitLongWord(word);
        lines.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] || '';
        return;
      }

      const candidate = current ? current + ' ' + word : word;
      if (current && context.measureText(candidate).width > labelMaxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);

    if (lines.length <= 2) return lines;
    const secondLine = lines.slice(1).join(' ');
    let truncated = secondLine;
    while (context.measureText(truncated + '…').width > labelMaxWidth && truncated.length > 1) {
      truncated = truncated.slice(0, -1);
    }
    return [lines[0], truncated.trimEnd() + '…'];
  }

  function getLabelDirection(node, point) {
    return labelDirections.get(node.id) || (point.y <= height / 2 ? -1 : 1);
  }

  function fitGraph() {
    if (!positions.size || width === 0 || height === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    data.nodes.forEach((node) => {
      const point = positions.get(node.id);
      minX = Math.min(minX, point.x - nodeRadius - labelMaxWidth / 2);
      maxX = Math.max(maxX, point.x + nodeRadius + labelMaxWidth / 2);
      minY = Math.min(minY, point.y - nodeRadius - 42);
      maxY = Math.max(maxY, point.y + nodeRadius + 42);
    });

    const padding = 24;
    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const fitZoom = Math.min(
      (width - padding * 2) / graphWidth,
      (height - padding * 2) / graphHeight,
    );
    zoom = clamp(Math.min(1, fitZoom), minZoom, maxZoom);
    panX = width / 2 - ((minX + maxX) / 2) * zoom;
    panY = height / 2 - ((minY + maxY) / 2) * zoom;
  }

  function step() {
    const forces = new Map(data.nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    const repulsion = Math.min(5000, Math.max(1800, data.nodes.length * 140));

    for (let first = 0; first < data.nodes.length; first += 1) {
      for (let second = first + 1; second < data.nodes.length; second += 1) {
        const a = positions.get(data.nodes[first].id);
        const b = positions.get(data.nodes[second].id);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distanceSquared = Math.max(100, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const force = repulsion / distanceSquared;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        forces.get(data.nodes[first].id).x += fx;
        forces.get(data.nodes[first].id).y += fy;
        forces.get(data.nodes[second].id).x -= fx;
        forces.get(data.nodes[second].id).y -= fy;
      }
    }

    data.edges.forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (distance - 135) * 0.0007;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      forces.get(edge.source).x += fx;
      forces.get(edge.source).y += fy;
      forces.get(edge.target).x -= fx;
      forces.get(edge.target).y -= fy;
    });

    data.nodes.forEach((node) => {
      const point = positions.get(node.id);
      const velocity = velocities.get(node.id);
      const force = forces.get(node.id);
      force.x += (width / 2 - point.x) * 0.00025;
      force.y += (height / 2 - point.y) * 0.00025;
      velocity.x = (velocity.x + force.x) * 0.985;
      velocity.y = (velocity.y + force.y) * 0.985;
      point.x = Math.max(30, Math.min(width - 30, point.x + velocity.x));
      point.y = Math.max(30, Math.min(height - 30, point.y + velocity.y));
    });
  }

  function drawEdge(edge) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.setLineDash(edge.status === 'suggested' || edge.origin !== 'manual' ? [5, 5] : []);
    context.strokeStyle = edge.origin === 'manual' ? colors.accent : colors.muted;
    context.globalAlpha = edge.status === 'confirmed' ? 0.8 : 0.5;
    context.lineWidth = edge.status === 'confirmed' ? 2.2 : 1.2;
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
  }

  function drawNode(node) {
    const point = positions.get(node.id);
    const isFocus = node.id === focusId;
    context.beginPath();
    context.arc(point.x, point.y, isFocus ? 28 : nodeRadius, 0, Math.PI * 2);
    context.fillStyle = isFocus ? colors.accent : colors.background;
    context.fill();
    context.strokeStyle = colors.accent;
    context.lineWidth = isFocus ? 3 : 1.5;
    context.stroke();
  }

  function drawLabel(node) {
    const point = positions.get(node.id);
    context.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    const lines = getLabelLines(node.title);
    const lineHeight = 15;
    const labelHeight = lines.length * lineHeight;
    const labelWidth = Math.min(
      labelMaxWidth,
      Math.max(48, ...lines.map((line) => context.measureText(line).width)) + 12,
    );
    const direction = getLabelDirection(node, point);
    const labelCenterY = point.y + direction * (nodeRadius + 12 + labelHeight / 2);
    const left = point.x - labelWidth / 2;
    const top = labelCenterY - labelHeight / 2 - 4;

    context.fillStyle = colors.background;
    context.fillRect(left, top, labelWidth, labelHeight + 8);
    context.fillStyle = node.id === focusId ? colors.accent : colors.text;
    context.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    lines.forEach((line, index) => {
      context.fillText(line, point.x, labelCenterY - (labelHeight - lineHeight) / 2 + index * lineHeight);
    });
  }

  function render() {
    step();
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(panX, panY);
    context.scale(zoom, zoom);
    data.edges.forEach(drawEdge);
    data.nodes.forEach(drawNode);
    data.nodes.forEach(drawLabel);
    context.restore();
    animationFrame = window.requestAnimationFrame(render);
  }

  function getCanvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function getPinchState() {
    const [first, second] = Array.from(pointers.values());
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    return { distance, midpoint };
  }

  function beginGesture() {
    if (pointers.size >= 2) {
      const { distance, midpoint } = getPinchState();
      gesture = {
        type: 'pinch',
        distance,
        midpoint,
        startZoom: zoom,
        startPanX: panX,
        startPanY: panY,
        anchorX: (midpoint.x - panX) / zoom,
        anchorY: (midpoint.y - panY) / zoom,
        moved: false,
      };
      return;
    }

    const [point] = Array.from(pointers.values());
    if (point) {
      gesture = {
        type: 'pan',
        startX: point.x,
        startY: point.y,
        startPanX: panX,
        startPanY: panY,
        moved: false,
      };
    }
  }

  function updateGesture() {
    if (!gesture) return;
    if (pointers.size >= 2) {
      if (gesture.type !== 'pinch') beginGesture();
      const { distance, midpoint } = getPinchState();
      const scale = distance / gesture.distance;
      zoom = clamp(gesture.startZoom * scale, minZoom, maxZoom);
      panX = midpoint.x - gesture.anchorX * zoom;
      panY = midpoint.y - gesture.anchorY * zoom;
      gesture.moved = gesture.moved || Math.abs(scale - 1) > 0.02;
      return;
    }

    const [point] = Array.from(pointers.values());
    if (!point) return;
    if (gesture.type !== 'pan') beginGesture();
    const deltaX = point.x - gesture.startX;
    const deltaY = point.y - gesture.startY;
    panX = gesture.startPanX + deltaX;
    panY = gesture.startPanY + deltaY;
    gesture.moved = gesture.moved || Math.hypot(deltaX, deltaY) > 6;
  }

  function handlePointerDown(event) {
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    const point = getCanvasPoint(event);
    pointers.set(event.pointerId, point);
    beginGesture();
  }

  function handlePointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, getCanvasPoint(event));
    updateGesture();
  }

  function handlePointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size) {
      beginGesture();
    } else {
      if (gesture?.moved) suppressClickUntil = Date.now() + 250;
      gesture = null;
    }
  }

  function zoomAt(point, nextZoom) {
    const worldX = (point.x - panX) / zoom;
    const worldY = (point.y - panY) / zoom;
    zoom = clamp(nextZoom, minZoom, maxZoom);
    panX = point.x - worldX * zoom;
    panY = point.y - worldY * zoom;
  }

  canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
  canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const point = getCanvasPoint(event);
    zoomAt(point, zoom * Math.exp(-event.deltaY * 0.001));
  }, { passive: false });
  canvas.addEventListener('click', (event) => {
    if (Date.now() < suppressClickUntil) return;
    const point = getCanvasPoint(event);
    const worldX = (point.x - panX) / zoom;
    const worldY = (point.y - panY) / zoom;
    for (const node of data.nodes) {
      const nodePoint = positions.get(node.id);
      if (Math.hypot(nodePoint.x - worldX, nodePoint.y - worldY) <= nodeRadius + 8) {
        window.ReactNativeWebView.postMessage(String(node.id));
        return;
      }
    }
  });

  window.addEventListener('resize', resize);
  resize();
  initialize();
  render();
})();
</script>
</body>
</html>`;
}

export function NoteGraphView({
  nodes,
  edges,
  focusNodeId,
  onNodePress,
}: NoteGraphViewProps) {
  const theme = useTheme();
  const [webViewError, setWebViewError] = useState(false);
  const html = useMemo(
    () =>
      createGraphHtml(
        { nodes, edges },
        {
          background: theme.notes.bg.base,
          text: theme.notes.text.primary,
          accent: theme.notes.accent.primary,
          muted: theme.notes.text.muted,
        },
        focusNodeId,
      ),
    [edges, focusNodeId, nodes, theme],
  );

  if (Platform.OS === 'web' || webViewError) {
    return (
      <View style={[styles.fallback, { backgroundColor: theme.notes.bg.surface }]}> 
        <Text style={[styles.fallbackTitle, { color: theme.notes.text.primary }]}>
          El grafo no está disponible aquí
        </Text>
        <Text style={[styles.fallbackText, { color: theme.notes.text.secondary }]}> 
          Abrí CoreOS en un dispositivo compatible para explorar tus conexiones.
        </Text>
      </View>
    );
  }

  return (
    <WebView
      originWhitelist={['*']}
      javaScriptEnabled
      onError={() => setWebViewError(true)}
      onMessage={(event) => {
        const noteId = Number(event.nativeEvent.data);
        if (Number.isInteger(noteId) && noteId > 0) onNodePress(noteId);
      }}
      scrollEnabled={false}
      source={{ html }}
      style={[styles.webView, { backgroundColor: theme.notes.bg.base }]}
    />
  );
}

const styles = StyleSheet.create({
  webView: {
    flex: 1,
  },
  fallback: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  fallbackTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  fallbackText: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    textAlign: 'center',
  },
});
