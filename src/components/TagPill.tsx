import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { NoteSpacing, Radii, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { animations, haptic } from '@/lib/animations';

export interface TagPillProps {
  name: string;
  variant: 'filter' | 'display';
  selected?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}

export function TagPill({
  name,
  variant,
  selected = false,
  onPress,
  onRemove,
}: TagPillProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const pillStyle = [
    styles.pill,
    variant === 'filter'
      ? {
          backgroundColor: selected ? theme.notes.accent.primary : theme.notes.bg.elevated,
          borderColor: selected ? theme.notes.accent.primary : 'transparent',
        }
      : {
          backgroundColor: theme.notes.bg.surface,
          borderColor: theme.notes.border.subtle,
        },
  ];

  if (variant === 'display') {
    return (
      <View style={pillStyle}>
        <Text numberOfLines={1} style={[styles.text, { color: theme.notes.text.primary }]}>
          {name}
        </Text>
        {onRemove ? (
          <Pressable
            accessibilityLabel={`Eliminar tag ${name}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void haptic.tap.light();
              onRemove();
            }}
          >
            <Text style={[styles.remove, { color: theme.notes.text.muted }]}>×</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        disabled={!onPress}
        onPressIn={() => {
          scale.set(animations.press.scale.apply(scale));
        }}
        onPress={() => {
          void haptic.tap.light();
          onPress?.();
        }}
        style={pillStyle}
      >
        <Text numberOfLines={1} style={[styles.text, { color: theme.notes.text.primary }]}>
          {name}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: NoteSpacing.xs,
    paddingHorizontal: NoteSpacing.sm,
    paddingVertical: NoteSpacing.xs,
  },
  text: {
    fontSize: Typography.caption.size,
    fontWeight: Typography.caption.weight,
    letterSpacing: Typography.caption.letterSpacing,
    lineHeight: Typography.caption.lineHeight,
  },
  remove: {
    fontSize: Typography.body.size,
    lineHeight: Typography.caption.lineHeight,
  },
});
