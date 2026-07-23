import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { Fonts, NoteSpacing, Radii, Shadows, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { animations } from '@/lib/animations';

export interface StatCardProps {
  label: string;
  value: number | string;
  trend?: { value: number; positive: boolean };
  icon?: string;
  index?: number;
}

export function StatCard({ label, value, trend, icon, index = 0 }: StatCardProps) {
  const theme = useTheme();
  const motion = useSharedValue({ opacity: 0, translateY: 8 });
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: motion.value.opacity,
    transform: [{ translateY: motion.value.translateY }],
  }));

  useEffect(() => {
    motion.set(animations.stagger.fadein.apply(motion, index));
  }, [index, motion]);

  const trendText = trend
    ? `${trend.positive ? '↑' : '↓'} ${trend.value}`
    : null;
  const trendColor = trend
    ? trend.positive
      ? theme.notes.semantic.success
      : theme.notes.semantic.danger
    : null;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: theme.notes.bg.surface,
          borderColor: theme.notes.border.subtle,
        },
        Shadows.sm,
        animatedStyle,
      ]}
    >
      <View style={styles.header}>
        {icon ? (
          Platform.OS === 'ios' ? (
            <SymbolView
              name={icon as SFSymbol}
              size={IconSizeInline}
              tintColor={theme.notes.text.muted}
            />
          ) : (
            <Text style={[styles.iconFallback, { color: theme.notes.text.muted }]}>
              {icon}
            </Text>
          )
        ) : null}
        <Text
          numberOfLines={1}
          style={[styles.label, { color: theme.notes.text.muted }]}
        >
          {label}
        </Text>
      </View>
      <View style={styles.footer}>
        <Text style={[styles.value, { color: theme.notes.text.primary }]}>{value}</Text>
        {trendText && trendColor ? (
          <View style={[styles.trendBadge, { backgroundColor: `${trendColor}20` }]}>
            <Text style={[styles.trend, { color: trendColor }]}>{trendText}</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const IconSizeInline = 14;

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.md,
    borderWidth: 1,
    gap: NoteSpacing.sm,
    padding: NoteSpacing.md,
    minWidth: 140,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  label: {
    flex: 1,
    fontSize: Typography.caption.size,
    fontWeight: '500',
    letterSpacing: Typography.caption.letterSpacing,
    lineHeight: Typography.caption.lineHeight,
  },
  iconFallback: {
    fontSize: IconSizeInline,
  },
  footer: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    justifyContent: 'space-between',
  },
  value: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  trendBadge: {
    borderRadius: Radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  trend: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
});