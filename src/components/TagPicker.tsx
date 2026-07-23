import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteSpacing, Radii, Shadows, Typography } from '@/constants/theme';
import type { TagWithCount } from '@/db/queries/tags';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';

import { ButtonBrand } from './ButtonBrand';
import { SearchBar } from './SearchBar';

export interface TagPickerProps {
  selectedTagNames: string[];
  availableTags: TagWithCount[];
  onChange: (names: string[]) => void;
  onClose: () => void;
  // ponytail: Batch 4 (editor) necesita controlar visibilidad y creación de
  // nuevos tags on-the-fly sin abrir otra pantalla.
  visible?: boolean;
  onCreate?: (name: string) => void | Promise<void>;
}

export function TagPicker({
  selectedTagNames,
  availableTags,
  onChange,
  onClose,
  visible = true,
  onCreate,
}: TagPickerProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [newTag, setNewTag] = useState('');
  const filteredTags = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es-ES');
    if (!normalized) {
      return availableTags;
    }
    return availableTags.filter((tag) =>
      tag.name.toLocaleLowerCase('es-ES').includes(normalized),
    );
  }, [availableTags, query]);

  const toggleTag = (name: string) => {
    void haptic.tap.light();
    onChange(
      selectedTagNames.includes(name)
        ? selectedTagNames.filter((selected) => selected !== name)
        : [...selectedTagNames, name],
    );
  };

  const addNewTag = () => {
    const name = newTag.trim();
    if (!name) {
      return;
    }
    if (onCreate) {
      void onCreate(name);
    } else if (!selectedTagNames.includes(name)) {
      onChange([...selectedTagNames, name]);
    }
    setNewTag('');
    void haptic.tap.light();
  };

  const handleClose = () => {
    setQuery('');
    setNewTag('');
    onClose();
  };

  const content = (
    <>
      <View style={[styles.header, { borderBottomColor: theme.notes.border.subtle }]}>
        <Text style={[styles.title, { color: theme.notes.text.primary }]}>Añadir tags</Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={handleClose}>
          <Text style={[styles.close, { color: theme.notes.text.accent }]}>Cerrar</Text>
        </Pressable>
      </View>
      <View style={styles.search}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Buscar tags"
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.tagList}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.tagScroll}
      >
        {filteredTags.length ? (
          filteredTags.map((tag) => {
            const selected = selectedTagNames.includes(tag.name);
            return (
              <Pressable
                accessibilityLabel={`${tag.name}, ${tag.note_count} notas`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={tag.id}
                onPress={() => toggleTag(tag.name)}
                style={({ pressed }) => [
                  styles.tagOption,
                  {
                    backgroundColor: selected
                      ? theme.notes.accent.primaryDim
                      : theme.notes.bg.surface,
                    borderColor: selected
                      ? theme.notes.accent.primary
                      : theme.notes.border.subtle,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  ellipsizeMode="tail"
                  numberOfLines={1}
                  style={[styles.tagName, { color: theme.notes.text.primary }]}
                >
                  {tag.name}
                </Text>
                <Text style={[styles.count, { color: theme.notes.text.muted }]}>
                  {tag.note_count}
                </Text>
                {selected ? (
                  <Text style={[styles.check, { color: theme.notes.text.accent }]}>✓</Text>
                ) : null}
              </Pressable>
            );
          })
        ) : (
          <Text style={[styles.empty, { color: theme.notes.text.muted }]}>Sin tags</Text>
        )}
      </ScrollView>
      <View style={[styles.createSection, { borderTopColor: theme.notes.border.subtle }]}>
        <Text style={[styles.createLabel, { color: theme.notes.text.primary }]}>Crear un tag</Text>
        <TextInput
          accessibilityLabel="Nombre del nuevo tag"
          onChangeText={setNewTag}
          onSubmitEditing={addNewTag}
          placeholder="Nombre del tag"
          placeholderTextColor={theme.notes.text.muted}
          returnKeyType="done"
          selectionColor={theme.notes.accent.primary}
          style={[
            styles.createInput,
            {
              backgroundColor: theme.notes.bg.surface,
              borderColor: theme.notes.border.strong,
              color: theme.notes.text.primary,
            },
          ]}
          value={newTag}
        />
        <ButtonBrand
          disabled={!newTag.trim()}
          onPress={addNewTag}
          style={styles.createButton}
          title="Crear tag"
        />
      </View>
    </>
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalRoot}
      >
        <Pressable
          accessibilityLabel="Cerrar selector de tags"
          accessibilityRole="button"
          onPress={handleClose}
          style={styles.backdrop}
        />
        <SafeAreaView
          accessibilityViewIsModal
          edges={['bottom']}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.notes.bg.elevated,
              borderColor: theme.notes.border.subtle,
            },
          ]}
        >
          {content}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: '82%',
    ...Shadows.lg,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: NoteSpacing.md,
  },
  title: {
    fontSize: Typography.title.size,
    fontWeight: Typography.title.weight,
    letterSpacing: Typography.title.letterSpacing,
    lineHeight: Typography.title.lineHeight,
  },
  close: {
    fontSize: Typography.body.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.body.lineHeight,
  },
  search: {
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  tagScroll: {
    flex: 1,
  },
  tagList: {
    gap: NoteSpacing.sm,
    paddingBottom: NoteSpacing.md,
    paddingHorizontal: NoteSpacing.md,
  },
  tagOption: {
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    minHeight: 48,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
    width: '100%',
  },
  tagName: {
    flex: 1,
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    minWidth: 0,
  },
  count: {
    fontSize: Typography.caption.size,
    lineHeight: Typography.caption.lineHeight,
  },
  check: {
    fontSize: Typography.body.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.body.lineHeight,
  },
  empty: {
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    paddingVertical: NoteSpacing.lg,
    textAlign: 'center',
  },
  createSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: NoteSpacing.sm,
    padding: NoteSpacing.md,
  },
  createLabel: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
    lineHeight: Typography.subtitle.lineHeight,
  },
  createInput: {
    borderRadius: Radii.md,
    borderWidth: 1,
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
    minHeight: 44,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.sm,
  },
  createButton: {
    width: '100%',
  },
  pressed: {
    opacity: 0.75,
  },
});
