import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { getGraphData, type GraphData, type GraphEdge } from '@/db/queries/graph';
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

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: theme.notes.bg.base }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: headerTitle,
          headerBackTitle: 'Notas',
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filters: {
    alignItems: 'center',
    gap: NoteSpacing.xs,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
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
