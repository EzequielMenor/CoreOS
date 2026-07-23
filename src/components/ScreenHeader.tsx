import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { IconSize, NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ScreenHeaderRightAction {
  label?: string;
  symbolName?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

export interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  rightAction?: ScreenHeaderRightAction;
  subtitle?: string;
}

const HIT_AREA = 44;

export function ScreenHeader({
  title,
  onBack,
  rightAction,
  subtitle,
}: ScreenHeaderProps) {
  const theme = useTheme();
  const hasBack = !!onBack;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.notes.bg.base }]}
    >
      <View
        style={[
          styles.container,
          { borderBottomColor: theme.notes.border.subtle },
        ]}
      >
        <View style={styles.slot}>
          {hasBack ? (
            <Pressable
              accessibilityLabel="Volver"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onBack}
              style={styles.slotPressable}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="chevron.left"
                  size={IconSize.md}
                  tintColor={theme.notes.text.primary}
                />
              ) : (
                <Text style={[styles.backFallback, { color: theme.notes.text.primary }]}>
                  ‹
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.titleColumn}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: theme.notes.text.primary }]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={[styles.subtitle, { color: theme.notes.text.secondary }]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={[styles.slot, styles.slotRight]}>
          {rightAction ? (
            <Pressable
              accessibilityLabel={
                rightAction.accessibilityLabel ?? rightAction.label ?? 'Acción'
              }
              accessibilityRole="button"
              hitSlop={8}
              onPress={rightAction.onPress}
              style={styles.slotPressable}
            >
              {rightAction.label ? (
                <Text
                  numberOfLines={1}
                  style={[
                    styles.rightLabel,
                    { color: theme.notes.text.primary },
                  ]}
                >
                  {rightAction.label}
                </Text>
              ) : rightAction.symbolName ? (
                Platform.OS === 'ios' ? (
                  <SymbolView
                    name={rightAction.symbolName as SFSymbol}
                    size={IconSize.md}
                    tintColor={theme.notes.text.primary}
                  />
                ) : (
                  <Text
                    style={[
                      styles.rightFallback,
                      { color: theme.notes.text.primary },
                    ]}
                  >
                    {rightAction.symbolName}
                  </Text>
                )
              ) : null}
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    // bg primary aplicado inline; SafeAreaView añade paddingTop = safe area inset.
  },
  container: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: NoteSpacing.md,
    paddingVertical: NoteSpacing.md,
  },
  slot: {
    minHeight: HIT_AREA,
    minWidth: HIT_AREA,
  },
  slotRight: {
    alignItems: 'flex-end',
  },
  slotPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: HIT_AREA,
    minWidth: HIT_AREA,
  },
  titleColumn: {
    flex: 1,
    paddingHorizontal: NoteSpacing.sm,
  },
  title: {
    fontSize: Typography.title.size,
    fontWeight: Typography.title.weight,
    letterSpacing: Typography.title.letterSpacing,
    lineHeight: Typography.title.lineHeight,
  },
  subtitle: {
    fontSize: Typography.caption.size,
    fontWeight: Typography.caption.weight,
    letterSpacing: Typography.caption.letterSpacing,
    lineHeight: Typography.caption.lineHeight,
    marginTop: 2,
  },
  backFallback: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 28,
  },
  rightLabel: {
    fontSize: Typography.subtitle.size,
    fontWeight: Typography.subtitle.weight,
    letterSpacing: Typography.subtitle.letterSpacing,
    lineHeight: Typography.subtitle.lineHeight,
  },
  rightFallback: {
    fontSize: IconSize.md,
    fontWeight: '500',
  },
});

export default ScreenHeader;
