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
  let width = 0;
  let height = 0;
  let animationFrame;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function initialize() {
    const radius = Math.max(80, Math.min(width, height) * 0.32);
    data.nodes.forEach((node, index) => {
      const angle = (index / Math.max(1, data.nodes.length)) * Math.PI * 2;
      positions.set(node.id, {
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      });
      velocities.set(node.id, { x: 0, y: 0 });
    });
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
    context.arc(point.x, point.y, isFocus ? 25 : 21, 0, Math.PI * 2);
    context.fillStyle = isFocus ? colors.accent : colors.background;
    context.fill();
    context.strokeStyle = colors.accent;
    context.lineWidth = isFocus ? 3 : 1.5;
    context.stroke();
    context.fillStyle = isFocus ? colors.background : colors.text;
    context.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const label = node.title.trim() || 'Sin título';
    context.fillText(label.length > 22 ? label.slice(0, 21) + '…' : label, point.x, point.y);
  }

  function render() {
    step();
    context.clearRect(0, 0, width, height);
    data.edges.forEach(drawEdge);
    data.nodes.forEach(drawNode);
    animationFrame = window.requestAnimationFrame(render);
  }

  canvas.addEventListener('click', (event) => {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    for (const node of data.nodes) {
      const point = positions.get(node.id);
      if (Math.hypot(point.x - x, point.y - y) <= 28) {
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
