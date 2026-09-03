import { useMemo } from 'react';
import { Platform, SectionList, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { IconSize, NoteSpacing } from '@/constants/theme';
import type { Note, Sections } from '@/db/queries/notes';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useNotesStore } from '@/stores/notes';

import { EmptyState } from './EmptyState';
import { SectionHeader } from './SectionHeader';
import { SwipeableRow } from './SwipeableRow';
import { TagPill } from './TagPill';

export interface SectionedNoteListProps {
  sections: Sections;
  searchMode?: boolean;
  searchResults?: Note[];
  onNotePress: (id: number) => void;
  selectedTagIds?: number[];
  refreshing?: boolean;
  onRefresh?: () => void;
  // ponytail: si se pasan, reemplazan el delete/pin por defecto para que la
  // pantalla pueda envolver con toast undo, haptics extra, etc. Sin ellos,
  // comportamiento intacto (retrocompat con Batch 3a).
  onSwipeLeft?: (note: Note) => void;
  onSwipeRight?: (note: Note) => void;
}

type NoteSection = {
  title: string;
  data: Note[];
};

const DAY_MS = 86_400_000;

function formatRelative(ts: number): string {
  const date = new Date(ts > 10_000_000_000 ? ts : ts * 1000);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const noteDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.floor((today - noteDay) / DAY_MS);

  if (dayDifference <= 0) {
    const elapsed = Math.max(0, now.getTime() - date.getTime());
    const minutes = Math.max(1, Math.floor(elapsed / 60_000));
    return minutes < 60 ? `hace ${minutes}m` : `hace ${Math.floor(minutes / 60)}h`;
  }
  if (dayDifference === 1) {
    return 'ayer';
  }
  if (dayDifference <= 7) {
    return `hace ${dayDifference}d`;
  }
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function PinIcon({ color }: { color: string }) {
  if (Platform.OS === 'ios') {
    return <SymbolView name="pin.fill" size={IconSize.sm} tintColor={color} />;
  }
  return <Text style={styles.pinFallback}>📌</Text>;
}

// ponytail: NoteRow ya no usa <Pressable> ni animación de scale. El tap se
// delega al SwipeableRow (Gesture.Race(pan, tap)) para que conviva limpio con
// el pan. Upgrade path: si se quiere feedback de press, envolver el View con
// un Gesture.Tap().onBegin()/.onFinalize() que actualice un useSharedValue.
function NoteRow({ note }: { note: Note }) {
  const theme = useTheme();
  const visibleTags = note.tags.slice(0, 3);
  const hiddenTagCount = note.tags.length - visibleTags.length;

  return (
    <View
      accessible
      accessibilityRole="button"
      style={[
        styles.row,
        {
          backgroundColor: theme.notes.bg.surface,
          borderBottomColor: theme.notes.border.subtle,
          borderLeftColor: note.pinned ? theme.notes.accent.primary : 'transparent',
        },
      ]}
    >
      <View style={styles.titleRow}>
        {note.pinned ? <PinIcon color={theme.notes.text.accent} /> : null}
        <Text
          numberOfLines={1}
          style={[styles.noteTitle, { color: theme.notes.text.primary }]}
        >
          {note.title.trim() || 'Sin título'}
        </Text>
      </View>
      <View style={styles.metadata}>
        <View style={styles.tags}>
          {visibleTags.map((name) => (
            <TagPill key={name} name={name} variant="display" />
          ))}
          {hiddenTagCount > 0 ? <TagPill name={`+${hiddenTagCount}`} variant="display" /> : null}
        </View>
        <Text style={[styles.timestamp, { color: theme.notes.text.muted }]}>
          {formatRelative(note.created_at)}
        </Text>
      </View>
    </View>
  );
}

export function SectionedNoteList({
  sections,
  searchMode = false,
  searchResults = [],
  onNotePress,
  selectedTagIds = [],
  refreshing = false,
  onRefresh,
  onSwipeLeft,
  onSwipeRight,
}: SectionedNoteListProps) {
  const theme = useTheme();
  const deleteNote = useNotesStore((state) => state.deleteNote);
  const pinNote = useNotesStore((state) => state.pinNote);

  const handleSwipeLeft = (note: Note) => {
    if (onSwipeLeft) {
      onSwipeLeft(note);
      return;
    }
    void deleteNote(note.id).catch(() => {
      void haptic.notify.error();
    });
  };

  const handleSwipeRight = (note: Note) => {
    if (onSwipeRight) {
      onSwipeRight(note);
      return;
    }
    void pinNote(note.id, !Boolean(note.pinned)).catch(() => {
      void haptic.notify.error();
    });
  };
  const listSections = useMemo<NoteSection[]>(() => {
    const items = searchMode
      ? [{ title: '', data: searchResults }]
      : [
          { title: 'PINNED', data: sections.pinned },
          { title: 'HOY', data: sections.today },
          { title: 'AYER', data: sections.yesterday },
          { title: 'ESTA SEMANA', data: sections.thisWeek },
          { title: 'ANTERIORES', data: sections.earlier },
        ];
    return items.filter((section) => section.data.length > 0);
  }, [searchMode, searchResults, sections]);

  return (
    <SectionList<Note, NoteSection>
      contentContainerStyle={listSections.length ? styles.content : styles.emptyContent}
      extraData={selectedTagIds}
      keyExtractor={(note) => String(note.id)}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        <EmptyState
          illustration={searchMode ? 'sf.magnifyingglass' : 'sf.doc.text'}
          title={searchMode ? 'Sin resultados' : 'Sin notas todavía'}
          subtitle={
            searchMode
              ? 'Prueba con otra búsqueda.'
              : selectedTagIds.length
                ? 'No hay notas con estos tags.'
                : 'Tus notas aparecerán aquí.'
          }
        />
      }
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderItem={({ item }) => (
        <SwipeableRow
          leftAction={() => handleSwipeRight(item)}
          rightAction={() => handleSwipeLeft(item)}
          onTap={() => {
            void haptic.tap.light();
            onNotePress(item.id);
          }}
        >
          <NoteRow note={item} />
        </SwipeableRow>
      )}
      renderSectionHeader={({ section }) =>
        searchMode ? null : <SectionHeader title={section.title} count={section.data.length} />
      }
      sections={listSections}
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
      style={{ backgroundColor: theme.notes.bg.base }}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: NoteSpacing['2xl'],
  },
  emptyContent: {
    flexGrow: 1,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 2,
    gap: NoteSpacing.xs,
    paddingVertical: NoteSpacing.md,
    paddingHorizontal: NoteSpacing.lg,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
  },
  noteTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  metadata: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    justifyContent: 'space-between',
  },
  tags: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: NoteSpacing.xs,
  },
  timestamp: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
  },
  pinFallback: {
    fontSize: IconSize.sm,
  },
});
