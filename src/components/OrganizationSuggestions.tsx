import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { NoteSpacing, Typography } from '@/constants/theme';
import { getById } from '@/db/queries/notes';
import type { Note } from '@/db/queries/notes';
import {
  addNoteToCollection,
  getNoteCollections,
} from '@/db/queries/collections';
import type { CollectionRow } from '@/db/queries/collections';
import { suggestOrganization } from '@/db/queries/organization-suggestions';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { useCollectionsStore } from '@/stores/collections';
import { useNotesStore } from '@/stores/notes';
import { TagPill } from '@/components/TagPill';

export interface OrganizationSuggestionsProps {
  note: Note;
  onCollectionsUpdated: (collections: CollectionRow[]) => void;
  onNoteUpdated: (note: Note | null) => void;
}

interface SuggestionState {
  noteId: number;
  section: string | null;
  collection: { id: number; name: string } | null;
  tags: string[];
}

interface SuggestionChip {
  key: string;
  label: string;
  onPress: () => void;
}

export function OrganizationSuggestions({
  note,
  onCollectionsUpdated,
  onNoteUpdated,
}: OrganizationSuggestionsProps) {
  const theme = useTheme();
  const noteId = note.id;
  const setNoteSection = useCollectionsStore((state) => state.setNoteSection);
  const updateNote = useNotesStore((state) => state.updateNote);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<string[]>([]);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void suggestOrganization(noteId)
      .then((next) => {
        if (!active) return;
        setSuggestion({ noteId, ...next });
      })
      .catch(() => {
        // La sugerencia es opcional: un fallo no debe afectar al detalle.
      });
    return () => {
      active = false;
    };
  }, [noteId]);

  const applySuggestion = useCallback(
    async (key: string, action: () => Promise<void>) => {
      // ponytail: un único guard local evita dobles taps sin añadir estado persistente;
      // si hacen falta aplicaciones paralelas, pasar a estado por chip.
      if (applyingKey !== null) return;
      setApplyingKey(key);
      try {
        await action();
        setAppliedKeys((current) => (current.includes(key) ? current : [...current, key]));
      } catch {
        // El chip sigue visible para que el usuario pueda reintentarlo.
      } finally {
        setApplyingKey(null);
      }
    },
    [applyingKey],
  );

  const handleDismiss = useCallback(() => {
    void haptic.tap.light();
    setSuggestion(null);
  }, []);

  const currentSuggestion = suggestion?.noteId === noteId ? suggestion : null;
  if (currentSuggestion == null) return null;

  const chips: SuggestionChip[] = [];
  if (currentSuggestion.section !== null && !appliedKeys.includes('section')) {
    chips.push({
      key: 'section',
      label: `Sección: ${currentSuggestion.section}`,
      onPress: () =>
        void applySuggestion('section', async () => {
          await setNoteSection(note.id, currentSuggestion.section);
          onNoteUpdated(await getById(note.id));
        }),
    });
  }
  const suggestedCollection = currentSuggestion.collection;
  if (suggestedCollection !== null) {
    const key = `collection:${suggestedCollection.id}`;
    if (!appliedKeys.includes(key)) {
      chips.push({
        key,
        label: `Colección: ${suggestedCollection.name}`,
        onPress: () =>
          void applySuggestion(key, async () => {
            await addNoteToCollection(note.id, suggestedCollection.id);
            onCollectionsUpdated(await getNoteCollections(note.id));
          }),
      });
    }
  }
  for (const tag of currentSuggestion.tags) {
    const key = `tag:${tag.toLocaleLowerCase()}`;
    if (appliedKeys.includes(key)) continue;
    chips.push({
      key,
      label: `Tag: #${tag}`,
      onPress: () =>
        void applySuggestion(key, async () => {
          const tags = [...note.tags];
          if (!tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
            tags.push(tag);
          }
          await updateNote(note.id, { tagNames: tags });
          onNoteUpdated(await getById(note.id));
        }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <View style={[styles.container, { borderTopColor: theme.notes.border.subtle }]}>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          {Platform.OS === 'ios' ? (
            <SymbolView name="sparkles" size={14} tintColor={theme.notes.text.accent} />
          ) : (
            <Text style={[styles.fallbackIcon, { color: theme.notes.text.accent }]}>✦</Text>
          )}
          <Text style={[styles.title, { color: theme.notes.text.secondary }]}>Organización sugerida</Text>
        </View>
        <Pressable
          accessibilityLabel="Descartar sugerencias de organización"
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleDismiss}
          style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
        >
          <Text style={[styles.dismissText, { color: theme.notes.text.muted }]}>Ahora no ×</Text>
        </Pressable>
      </View>
      <View style={styles.chipsRow}>
        {chips.map((chip) => (
          <TagPill
            key={chip.key}
            name={chip.label}
            variant="filter"
            onPress={applyingKey === null ? chip.onPress : undefined}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: NoteSpacing.sm,
    marginTop: NoteSpacing.lg,
    paddingTop: NoteSpacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.xs,
  },
  title: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
  },
  fallbackIcon: {
    fontSize: Typography.body.size,
  },
  dismiss: {
    paddingHorizontal: NoteSpacing.xs,
    paddingVertical: NoteSpacing.xs,
  },
  dismissText: {
    fontSize: Typography.caption.size,
  },
  pressed: {
    opacity: 0.6,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: NoteSpacing.xs,
  },
});
