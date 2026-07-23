import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { SymbolView } from 'expo-symbols';

import { IconSize, NoteSpacing, Radii } from '@/constants/theme';
import type { Note } from '@/db/queries/notes';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useNotesStore } from '@/stores/notes';
import { useTagsStore } from '@/stores/tags';

import { SearchBar } from '@/components/SearchBar';
import { SectionedNoteList } from '@/components/SectionedNoteList';
import { TagPill } from '@/components/TagPill';

const SEARCH_DEBOUNCE_MS = 300;

export default function NotesListScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sections = useNotesStore((state) => state.sections);
  const searchResults = useNotesStore((state) => state.searchResults);
  const loading = useNotesStore((state) => state.loading);
  const fetchSections = useNotesStore((state) => state.fetchSections);
  const search = useNotesStore((state) => state.search);
  const clearSearch = useNotesStore((state) => state.clearSearch);
  const deleteNote = useNotesStore((state) => state.deleteNote);
  const restoreNote = useNotesStore((state) => state.restoreNote);
  const pinNote = useNotesStore((state) => state.pinNote);
  const selectedTagIds = useNotesStore((state) => state.selectedTagIds);
  const tags = useTagsStore((state) => state.tags);
  const toggleTagFilter = useNotesStore((state) => state.toggleTagFilter);

  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchMode = query.trim().length > 0;

  const refreshSections = useCallback(() => {
    void fetchSections();
  }, [fetchSections]);

  useFocusEffect(
    useCallback(() => {
      refreshSections();
    }, [refreshSections]),
  );

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const trimmed = query.trim();
    if (!trimmed) {
      clearSearch();
      return;
    }
    debounceRef.current = setTimeout(() => {
      void search(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, search, clearSearch]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleNotePress = useCallback(
    (id: number) => {
      router.push(`/notas/${id}`);
    },
    [router],
  );

  const handleSwipeLeft = useCallback(
    (note: Note) => {
      void deleteNote(note.id)
        .then(() => {
          void haptic.notify.warning();
          Toast.show({
            type: 'info',
            text1: 'Nota eliminada',
            text2: 'Pulsa para deshacer',
            visibilityTime: 5000,
            onPress: () => {
              void restoreNote(note.id);
            },
          });
        })
        .catch(() => {
          void haptic.notify.error();
        });
    },
    [deleteNote, restoreNote],
  );

  const handleSwipeRight = useCallback(
    (note: Note) => {
      void pinNote(note.id, !Boolean(note.pinned))
        .then(() => {
          void haptic.tap.medium();
        })
        .catch(() => {
          void haptic.notify.error();
        });
    },
    [pinNote],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['top']}
    >
      <Stack.Screen options={{ title: 'Notas', headerShown: false }} />
      <View style={[styles.searchWrap, { paddingTop: NoteSpacing.sm }]}>
        <SearchBar
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Buscar notas…"
          value={query}
        />
      </View>
      {tags.length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.tagRow}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.tagRowWrap}
        >
          <TagPill
            name="Todas"
            variant="filter"
            selected={selectedTagIds.length === 0}
            onPress={() => {
              if (selectedTagIds.length === 0) return;
              // Limpia todos los tags seleccionados toggleando cada uno.
              void Promise.all(
                selectedTagIds.map((tagId) =>
                  useNotesStore.getState().toggleTagFilter(tagId),
                ),
              );
            }}
          />
          {tags.map((tag) => (
            <TagPill
              key={tag.id}
              name={`${tag.name} · ${tag.note_count}`}
              variant="filter"
              selected={selectedTagIds.includes(tag.id)}
              onPress={() => {
                void toggleTagFilter(tag.id);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.listWrap}>
        <SectionedNoteList
          onNotePress={handleNotePress}
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleSwipeRight}
          searchMode={searchMode}
          searchResults={searchResults}
          sections={sections}
          selectedTagIds={selectedTagIds}
          refreshing={loading}
          onRefresh={refreshSections}
        />
      </View>

      {/* FAB — mismo patrón que gastos/tareas/hub (audit-ui-scout #5) */}
      <Pressable
        accessibilityLabel="Crear nota"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => {
          void haptic.tap.light();
          router.push('/notas/new');
        }}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: theme.notes.accent.primary,
            bottom: insets.bottom + NoteSpacing.lg,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {Platform.OS === 'ios' ? (
          <SymbolView
            name="plus"
            size={IconSize.lg}
            tintColor={theme.notes.text.primary}
          />
        ) : (
          <Text style={[styles.fabPlus, { color: theme.notes.text.primary }]}>+</Text>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrap: {
    paddingHorizontal: NoteSpacing.md,
    paddingTop: NoteSpacing.sm,
  },
  tagRowWrap: {
    flexGrow: 0,
    flexShrink: 0,
    marginTop: NoteSpacing.sm,
    maxHeight: 48,
  },
  tagRow: {
    alignItems: 'center',
    gap: NoteSpacing.xs,
    paddingHorizontal: NoteSpacing.md,
  },
  listWrap: {
    flex: 1,
    marginTop: NoteSpacing.sm,
  },
  fab: {
    alignItems: 'center',
    borderRadius: Radii.full,
    elevation: 8,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: NoteSpacing.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    width: 56,
  },
  fabPlus: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 30,
  },
});