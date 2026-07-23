import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { IconSize, NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { animations, haptic } from '@/lib/animations';

export interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Buscar notas…',
  onClear,
  autoFocus = false,
}: SearchBarProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const clearScale = useSharedValue(1);
  const clearStyle = useAnimatedStyle(() => ({
    transform: [{ scale: clearScale.value }],
  }));

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.notes.bg.surface,
          borderColor: focused ? theme.notes.accent.primary : theme.notes.border.subtle,
        },
      ]}
    >
      <Text accessibilityElementsHidden style={styles.searchIcon}>
        🔍
      </Text>
      <TextInput
        autoFocus={autoFocus}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={theme.notes.text.muted}
        selectionColor={theme.notes.accent.primary}
        style={[styles.input, { color: theme.notes.text.primary }]}
        value={value}
      />
      {value ? (
        <Animated.View style={clearStyle}>
          <Pressable
            accessibilityLabel="Limpiar búsqueda"
            accessibilityRole="button"
            hitSlop={8}
            onPressIn={() => {
              clearScale.set(animations.press.scale.apply(clearScale));
            }}
            onPress={() => {
              void haptic.tap.light();
              if (onClear) {
                onClear();
              } else {
                onChangeText('');
              }
            }}
          >
            <Text style={[styles.clear, { color: theme.notes.text.muted }]}>×</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: NoteSpacing.md,
  },
  searchIcon: {
    fontSize: IconSize.sm,
    marginRight: NoteSpacing.sm,
  },
  input: {
    flex: 1,
    fontSize: Typography.body.size,
    fontWeight: Typography.body.weight,
    letterSpacing: Typography.body.letterSpacing,
    lineHeight: Typography.body.lineHeight,
    paddingVertical: NoteSpacing.md,
  },
  clear: {
    fontSize: IconSize.md,
    lineHeight: IconSize.md,
  },
});
