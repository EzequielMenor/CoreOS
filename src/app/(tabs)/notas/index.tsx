import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { SymbolView } from 'expo-symbols';

import { IconSize, NoteSpacing, Radii } from '@/constants/theme';
import { listNoteSections } from '@/db/queries/collections';
import type { Note } from '@/db/queries/notes';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { pickLibraryView } from '@/lib/library-view';
import { waitForPendingSave } from '@/lib/note-save-gate';
import { useCollectionsStore } from '@/stores/collections';
import { useNotesStore } from '@/stores/notes';
import { useTagsStore } from '@/stores/tags';

import { EmptyState } from '@/components/EmptyState';
import { SearchBar } from '@/components/SearchBar';
import { SectionedNoteList } from '@/components/SectionedNoteList';
import { SwipeableRow } from '@/components/SwipeableRow';
import { TagPill } from '@/components/TagPill';

const SEARCH_DEBOUNCE_MS = 300;

type FilteredNoteRowProps = {
  note: Note;
  onPress: () => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
};

function FilteredNoteRow({
  note,
  onPress,
  onSwipeLeft,
  onSwipeRight,
}: FilteredNoteRowProps) {
  const theme = useTheme();
  const visibleTags = note.tags.slice(0, 3);
  const hiddenTagCount = note.tags.length - visibleTags.length;

  return (
    <SwipeableRow
      leftAction={onSwipeRight}
      rightAction={onSwipeLeft}
      onTap={onPress}
    >
      <View
        accessible
        accessibilityRole="button"
        style={[
          styles.filteredRow,
          {
            backgroundColor: theme.notes.bg.surface,
            borderBottomColor: theme.notes.border.subtle,
            borderLeftColor: note.pinned ? theme.notes.accent.primary : 'transparent',
          },
        ]}
      >
        <View style={styles.filteredTitleRow}>
          {note.pinned ? (
            Platform.OS === 'ios' ? (
              <SymbolView name="pin.fill" size={IconSize.sm} tintColor={theme.notes.text.accent} />
            ) : (
              <Text style={styles.filteredPinFallback}>📌</Text>
            )
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.filteredTitle, { color: theme.notes.text.primary }]}
          >
            {note.title.trim() || 'Sin título'}
          </Text>
        </View>
        <View style={styles.filteredMetadata}>
          <View style={styles.filteredTags}>
            {visibleTags.map((name) => (
              <TagPill key={name} name={name} variant="display" />
            ))}
            {hiddenTagCount > 0 ? (
              <TagPill name={`+${hiddenTagCount}`} variant="display" />
            ) : null}
          </View>
          <Text style={[styles.filteredTimestamp, { color: theme.notes.text.muted }]}>
            {new Date(
              note.created_at > 10_000_000_000
                ? note.created_at
                : note.created_at * 1000,
            ).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      </View>
    </SwipeableRow>
  );
}

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
  const sectionFilter = useNotesStore((state) => state.sectionFilter);
  const collectionFilter = useNotesStore((state) => state.collectionFilter);
  const filteredNotes = useNotesStore((state) => state.filteredNotes);
  const setSectionFilter = useNotesStore((state) => state.setSectionFilter);
  const setCollectionFilter = useNotesStore((state) => state.setCollectionFilter);
  const tags = useTagsStore((state) => state.tags);
  const collections = useCollectionsStore((state) => state.collections);
  const fetchCollections = useCollectionsStore((state) => state.fetchCollections);
  const fetchTags = useTagsStore((state) => state.fetchTags);
  const toggleTagFilter = useNotesStore((state) => state.toggleTagFilter);
  const clearTagFilter = useNotesStore((state) => state.clearTagFilter);
  const clearAllFilters = useNotesStore((state) => state.clearAllFilters);

  const [sectionNames, setSectionNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchMode = query.trim().length > 0;
  const libraryView = pickLibraryView(searchMode, filteredNotes);

  const refreshSections = useCallback(() => {
    void fetchSections();
  }, [fetchSections]);

  const refreshOrganizationFilters = useCallback(async () => {
    try {
      const [nextSections] = await Promise.all([
        listNoteSections(),
        fetchCollections(),
        fetchTags(),
      ]);
      setSectionNames(nextSections);
    } catch {
      setSectionNames([]);
    }
  }, [fetchCollections, fetchTags]);

  useFocusEffect(
    useCallback(() => {
      // ponytail: drena el gate del editor antes de fetchear. Sin esto, una
      // navegacion rapida back desde el editor provoca que fetchSections lea
      // la DB antes de que el flushSave termine el INSERT — la lista muestra
      // la version anterior y el swipe-to-delete queda en estado fantasma.
      void (async () => {
        await waitForPendingSave();
        refreshSections();
            void refreshOrganizationFilters();
      })();
    }, [refreshOrganizationFilters, refreshSections]),
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

  // EZE-293: escribir primero. El estado vacio de Biblioteca invita a
  // crear sin exigir seccion, coleccion ni tags (mismo destino que el FAB).
  const handleCreateNote = useCallback(() => {
    void haptic.tap.light();
    router.push('/notas/new');
  }, [router]);

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

  const headerRight = useCallback(
    () => (
      <Pressable
        accessibilityLabel="Ajustes"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => {
          void haptic.tap.light();
          router.push('/ajustes');
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        {Platform.OS === 'ios' ? (
          <SymbolView
            name="gearshape"
            size={IconSize.md}
            tintColor={theme.notes.text.primary}
          />
        ) : (
          <Text style={{ color: theme.notes.text.primary, fontSize: 16 }}>⚙️</Text>
        )}
      </Pressable>
    ),
    [router, theme],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={['bottom']}
    >
      <Stack.Screen
        options={{
          title: 'Notas',
          headerRight,
          headerTitleAlign: 'center',
        }}
      />
      <View style={[styles.searchWrap, { paddingTop: NoteSpacing.sm }]}>
        <SearchBar
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Buscar notas…"
          value={query}
        />
      </View>
      {sectionNames.length > 0 ? (
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
                selected={sectionFilter === null && collectionFilter === null}
                onPress={() => {
                  setQuery('');
                  void setSectionFilter(null);
                }}
              />
              {sectionNames.map((section) => (
                <TagPill
                  key={section}
                  name={section}
                  variant="filter"
                  selected={sectionFilter === section}
                  onPress={() => {
                    setQuery('');
                    void setSectionFilter(sectionFilter === section ? null : section);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}
          {collections.length > 0 ? (
            <ScrollView
              contentContainerStyle={styles.tagRow}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.tagRowWrap}
            >
              {collections.map((collection) => (
                <TagPill
                  key={collection.id}
                  name={collection.name}
                  variant="filter"
                  selected={collectionFilter === collection.id}
                  onPress={() => {
                    setQuery('');
                    void setCollectionFilter(
                      collectionFilter === collection.id ? null : collection.id,
                    );
                  }}
                />
              ))}
              <TagPill
                name="Gestionar"
                variant="filter"
                onPress={() => router.push('../colecciones')}
              />
            </ScrollView>
          ) : null}
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
              setQuery('');
              void clearTagFilter();
            }}
          />
          {tags.map((tag) => (
            <TagPill
              key={tag.id}
              name={`${tag.name} · ${tag.note_count}`}
              variant="filter"
              selected={selectedTagIds.includes(tag.id)}
              onPress={() => {
                setQuery('');
                void toggleTagFilter(tag.id);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.listWrap}>
        {libraryView === 'filtered' ? (
          <FlatList
            contentContainerStyle={
              filteredNotes?.length ? styles.filteredContent : styles.emptyContent
            }
            data={filteredNotes ?? []}
            keyExtractor={(note) => String(note.id)}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <EmptyState
                illustration="sf.line.3.horizontal.decrease.circle"
                title="Sin notas con este filtro"
                subtitle="Prueba con otra sección o colección."
                cta={{
                  label: 'Mostrar todas',
                  onPress: () => {
                    setQuery('');
                    void clearAllFilters();
                  },
                }}
              />
            }
            onRefresh={refreshSections}
            refreshing={loading}
            renderItem={({ item }) => (
              <FilteredNoteRow
                note={item}
                onPress={() => handleNotePress(item.id)}
                onSwipeLeft={() => handleSwipeLeft(item)}
                onSwipeRight={() => handleSwipeRight(item)}
              />
            )}
            showsVerticalScrollIndicator={false}
            style={{ backgroundColor: theme.notes.bg.base }}
          />
        ) : (
          <SectionedNoteList
            onNotePress={handleNotePress}
            onCreateNote={handleCreateNote}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
            searchMode={searchMode}
            searchResults={searchResults}
            sections={sections}
            selectedTagIds={selectedTagIds}
            refreshing={loading}
            onRefresh={refreshSections}
          />
        )}
      </View>

      {/* FAB — mismo patron que gastos/tareas/hub (audit-ui-scout #5) */}
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
  filteredContent: {
    paddingBottom: NoteSpacing['2xl'],
  },
  emptyContent: {
    flexGrow: 1,
  },
  filteredRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 2,
    gap: NoteSpacing.xs,
    paddingHorizontal: NoteSpacing.lg,
    paddingVertical: NoteSpacing.md,
  },
  filteredTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
  },
  filteredTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  filteredMetadata: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    justifyContent: 'space-between',
  },
  filteredTags: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: NoteSpacing.xs,
  },
  filteredTimestamp: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
  },
  filteredPinFallback: {
    fontSize: IconSize.sm,
  },
  fab: {
    alignItems: 'center',
    borderRadius: Radii.full,
    elevation: 8,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: NoteSpacing.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    width: 48,
  },
  fabPlus: {
    fontSize: 24,
    fontWeight: '300',
    lineHeight: 30,
  },
});
