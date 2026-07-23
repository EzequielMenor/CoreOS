import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { NoteSpacing, Typography } from '@/constants/theme';
import { getById } from '@/db/queries/notes';
import type { UpdateNoteInput } from '@/db/queries/notes';
import { useTheme } from '@/hooks/use-theme';
import { useNoteEditor } from '@/hooks/use-note-editor';
import { useNotesStore } from '@/stores/notes';
import { useTagsStore } from '@/stores/tags';

import { AutoSaveDot } from '@/components/AutoSaveDot';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import {
  MARKDOWN_TOOLBAR_NATIVE_ID,
  MarkdownToolbar,
} from '@/components/MarkdownToolbar';
import { TagPicker } from '@/components/TagPicker';
import { TagPill } from '@/components/TagPill';

export default function NoteEditorScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const noteId = Number(params.id);
  const updateNote = useNotesStore((state) => state.updateNote);
  const createTag = useTagsStore((state) => state.createTag);
  const availableTags = useTagsStore((state) => state.tags);

  // ponytail: loader inline memoizado; estable entre renders gracias a useCallback.
  const loadNote = useCallback(async (id: number) => {
    const note = await getById(id);
    if (!note) return null;
    return { title: note.title, body_md: note.body_md, tags: note.tags };
  }, []);

  const editor = useNoteEditor({
    existingNoteId: noteId,
    loadNote,
    onUpdateNote: async (id: number, patch: UpdateNoteInput) => updateNote(id, patch),
    onCreateTag: async (name: string) => {
      await createTag(name);
    },
  });

  const pickerAvailable = useMemo(
    () => availableTags.filter((tag) => !editor.tagNames.includes(tag.name)),
    [availableTags, editor.tagNames],
  );

  if (editor.loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.notes.bg.base }]}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Atrás' }} />
        <ActivityIndicator color={theme.notes.text.accent} />
      </View>
    );
  }

  if (editor.notFound) {
    return (
      <View style={[styles.center, { backgroundColor: theme.notes.bg.base }]}>
        <Stack.Screen options={{ title: '', headerBackTitle: 'Atrás' }} />
        <Text style={[styles.notFound, { color: theme.notes.text.primary }]}>
          No se pudo cargar la nota.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      style={[styles.flex, { backgroundColor: theme.notes.bg.base }]}
    >
      <Stack.Screen
        options={{
          title: '',
          headerBackTitle: 'Atrás',
          headerRight: () => (
            <View style={styles.headerRight}>
              <AutoSaveDot dirty={editor.dirty} lastSavedAt={editor.lastSavedAt} />
              <Pressable
                accessibilityLabel="Guardar ahora"
                accessibilityRole="button"
                hitSlop={8}
                onPress={editor.handleSavePress}
              >
                <Text
                  style={[styles.saveAction, { color: theme.notes.text.accent }]}
                >
                  ✓ Guardar
                </Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.tagBar,
            {
              backgroundColor: theme.notes.bg.surface,
              borderColor: theme.notes.border.subtle,
            },
          ]}
        >
          {editor.tagNames.length > 0 ? (
            <View style={styles.tagsWrap}>
              {editor.tagNames.map((name) => (
                <TagPill
                  key={name}
                  name={name}
                  variant="display"
                  onRemove={() => editor.handleRemoveTag(name)}
                />
              ))}
            </View>
          ) : (
            <Text style={[styles.tagHint, { color: theme.notes.text.muted }]}>
              Sin tags todavía
            </Text>
          )}
          <Pressable
            accessibilityLabel="Añadir tag"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => editor.setPickerOpen(true)}
            style={[styles.addTag, { borderColor: theme.notes.border.subtle }]}
          >
            <Text style={[styles.addTagLabel, { color: theme.notes.text.accent }]}>
              + Tag
            </Text>
          </Pressable>
        </View>
        <View style={styles.editorWrap}>
          <MarkdownEditor
            inputAccessoryViewID={MARKDOWN_TOOLBAR_NATIVE_ID}
            onChangeText={editor.handleContentChange}
            onSelectionChange={editor.handleSelectionChange}
            placeholder="Empieza a escribir — la primera línea es el título"
            value={editor.content}
          />
        </View>
      </ScrollView>
      <MarkdownToolbar onFormat={editor.handleFormat} />
      <TagPicker
        availableTags={pickerAvailable}
        onChange={editor.handleTagChange}
        onClose={() => editor.setPickerOpen(false)}
        onCreate={editor.handleCreateTag}
        selectedTagNames={editor.tagNames}
        visible={editor.pickerOpen}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    paddingBottom: NoteSpacing['2xl'],
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.md,
  },
  tagBar: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  tagsWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: NoteSpacing.xs,
  },
  tagHint: {
    flex: 1,
    fontSize: Typography.caption.size,
    fontStyle: 'italic',
    lineHeight: Typography.caption.lineHeight,
  },
  addTag: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: NoteSpacing.sm,
    paddingVertical: NoteSpacing.xs,
  },
  addTagLabel: {
    fontSize: Typography.caption.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.caption.lineHeight,
  },
  editorWrap: {
    marginTop: NoteSpacing.md,
    minHeight: 320,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
  },
  saveAction: {
    fontSize: Typography.body.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.body.lineHeight,
    paddingHorizontal: NoteSpacing.xs,
  },
  notFound: {
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    paddingHorizontal: NoteSpacing.lg,
    textAlign: 'center',
  },
});
