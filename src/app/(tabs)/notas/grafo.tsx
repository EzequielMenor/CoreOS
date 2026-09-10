import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { getGraphData, type GraphData, type GraphEdge } from '@/db/queries/graph';
import { EDGE_SWIPE_WIDTH, shouldEdgeSwipeBack } from '@/lib/edge-swipe';
import { NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { NoteGraphView } from '@/components/NoteGraphView';
import { TagPill } from '@/components/TagPill';

type OriginFilter = 'all' | 'manual' | 'automatic';

function parseNoteId(value: string | string[] | undefined): number | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue) return undefined;
  const noteId = Number(rawValue);
  return Number.isInteger(noteId) && noteId > 0 ? noteId : undefined;
}

function matchesOriginFilter(edge: GraphEdge, filter: OriginFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'manual') return edge.origin === 'manual';
  return edge.origin === 'ai' || edge.origin === 'semantic';
}

export default function GraphScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ noteId?: string | string[] }>();
  const noteId = useMemo(() => parseNoteId(params.noteId), [params.noteId]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [filter, setFilter] = useState<OriginFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(false);
      void getGraphData(noteId === undefined ? {} : { noteId })
        .then((data) => {
          if (active) setGraph(data);
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [noteId]),
  );

  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => matchesOriginFilter(edge, filter)),
    [filter, graph.edges],
  );
  const localTitle = noteId === undefined
    ? null
    : graph.nodes.find((node) => node.id === noteId)?.title.trim() || 'Sin título';
  const headerTitle = localTitle ?? 'Grafo de notas';

  const handleNodePress = useCallback(
    (selectedNoteId: number) => {
      router.push(`/notas/${selectedNoteId}`);
    },
    [router],
  );

  // Un solo back por gesto fisico: onUpdate puede seguir disparandose mientras
  // translationX crece tras superar el umbral. Estado (no ref): la regla
  // react-hooks/refs no permite leer refs en los closures del GestureDetector.
  const [lastEdgeBackAt, setLastEdgeBackAt] = useState(0);
  const handleEdgeSwipeBack = useCallback(() => {
    const now = Date.now();
    if (now - lastEdgeBackAt < 600) return;
    setLastEdgeBackAt(now);
    router.back();
  }, [lastEdgeBackAt, router]);

  // Edge gesture nativo (RNGH): los primeros 30 px del borde izquierdo son del back.
  // El pop nativo del stack esta deshabilitado en esta pantalla (gestureEnabled: false)
  // para que haya un unico dueno del edge swipe; el back ejecuta router.back().
  const edgePan = useMemo(
    () =>
      Gesture.Pan()
        // Gesto de navegacion: sin worklets. Los callbacks corren en JS runtime
        // (si no, al llamar shouldEdgeSwipeBack crashea el UI Runtime).
        .runOnJS(true)
        .activeOffsetX(12)
        .failOffsetY([-24, 24])
        .onUpdate((event) => {
          if (
            shouldEdgeSwipeBack(event.translationX, event.translationY, event.velocityX, event.velocityY)
          ) {
            handleEdgeSwipeBack();
          }
        }),
    [handleEdgeSwipeBack],
  );

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: headerTitle,
          // ponytail: pop nativo deshabilitado en ESTA pantalla: el edge swipe del
          // borde tiene un unico dueno (GestureDetector del strip + router.back()).
          gestureEnabled: false,
          headerStyle: { backgroundColor: theme.notes.bg.base },
          headerTintColor: theme.notes.accent.primary,
          headerTitleStyle: { color: theme.notes.text.primary, fontWeight: '600' },
          headerShadowVisible: false,
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.notes.accent.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.messageTitle, { color: theme.notes.text.primary }]}>No se pudo cargar el grafo</Text>
          <Text style={[styles.messageText, { color: theme.notes.text.secondary }]}>Inténtalo de nuevo más tarde.</Text>
        </View>
      ) : graph.edges.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.messageTitle, { color: theme.notes.text.primary }]}>Todavía no hay conexiones</Text>
          <Text style={[styles.messageText, { color: theme.notes.text.secondary }]}>Añádelas desde la sección «Notas relacionadas» de una nota.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.filters}
            style={styles.filtersScroll}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <TagPill
              name="Todas"
              variant="filter"
              selected={filter === 'all'}
              onPress={() => setFilter('all')}
            />
            <TagPill
              name="Manual"
              variant="filter"
              selected={filter === 'manual'}
              onPress={() => setFilter('manual')}
            />
            <TagPill
              name="Automática"
              variant="filter"
              selected={filter === 'automatic'}
              onPress={() => setFilter('automatic')}
            />
          </ScrollView>
          {visibleEdges.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.messageTitle, { color: theme.notes.text.primary }]}>No hay conexiones con este filtro</Text>
              <Text style={[styles.messageText, { color: theme.notes.text.secondary }]}>Prueba con otro origen.</Text>
            </View>
          ) : (
            <NoteGraphView
              edges={visibleEdges}
              focusNodeId={noteId}
              nodes={graph.nodes}
              onNodePress={handleNodePress}
            />
          )}
        </>
      )}
      {Platform.OS === 'ios' ? (
        // Franja del borde izquierdo (iOS): territorio exclusivo de navegacion.
        // Un gesto que empieza aca es del back; uno que empieza fuera es del grafo.
        <GestureDetector gesture={edgePan}>
          <View
            // Superficie RN nativa real: box-only la convierte en el unico hit-test
            // target de su area; collapsable={false} evita el aplanado en Android/plataforma.
            pointerEvents="box-only"
            collapsable={false}
            style={styles.edgeSwipeZone}
          />
        </GestureDetector>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  edgeSwipeZone: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: EDGE_SWIPE_WIDTH,
    zIndex: 3,
  },
  filtersScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filters: {
    alignItems: 'center',
    flexGrow: 0,
    gap: NoteSpacing.xs,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.xs,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: NoteSpacing.xl,
  },
  messageTitle: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
    textAlign: 'center',
  },
  messageText: {
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    marginTop: NoteSpacing.sm,
    textAlign: 'center',
  },
});
