import { useCallback, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

import { NoteSpacing, Typography } from '@/constants/theme';
import type { CreateNoteInput, UpdateNoteInput } from '@/db/queries/notes';
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

export default function NewNoteScreen() {
  const theme = useTheme();
  const router = useRouter();
  const createNote = useNotesStore((state) => state.createNote);
  const updateNote = useNotesStore((state) => state.updateNote);
  const createTag = useTagsStore((state) => state.createTag);
  const availableTags = useTagsStore((state) => state.tags);

  const editor = useNoteEditor({
    onCreateNote: async (input: CreateNoteInput) => createNote(input),
    onUpdateNote: async (id: number, patch: UpdateNoteInput) => updateNote(id, patch),
    onCreateTag: async (name: string) => {
      await createTag(name);
    },
  });

  // ponytail: navegar solo después de que el flush termine. Si handleSavePress
  // lanza, el await propaga y NO navegamos — el usuario conserva la nota.
  const handleSaveAndExit = useCallback(async () => {
    await editor.handleSavePress();
    router.back();
  }, [editor, router]);

  const pickerAvailable = useMemo(
    () => availableTags.filter((tag) => !editor.tagNames.includes(tag.name)),
    [availableTags, editor.tagNames],
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.flex, { backgroundColor: theme.notes.bg.base }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
        style={styles.flex}
      >
        <Stack.Screen
          options={{
            title: 'Nueva nota',
            headerBackTitle: 'Notas',
            headerRight: () => (
              <View style={styles.headerRight}>
                <AutoSaveDot dirty={editor.dirty} lastSavedAt={editor.lastSavedAt} />
                <Pressable
                  accessibilityLabel="Guardar ahora"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={handleSaveAndExit}
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
              autoFocus
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
});
