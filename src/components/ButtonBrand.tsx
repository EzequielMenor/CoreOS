import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';

import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Variant = 'primary' | 'secondary' | 'danger';
export type Size = 'sm' | 'md';

export interface ButtonBrandProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function ButtonBrand({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
}: ButtonBrandProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const bgStyle = isDisabled
    ? { backgroundColor: theme.notes.bg.elevated, borderColor: theme.notes.border.subtle, borderWidth: 1 }
    : variant === 'primary'
      ? { backgroundColor: theme.notes.accent.primary }
      : variant === 'secondary'
        ? { backgroundColor: 'transparent', borderColor: theme.notes.accent.primary, borderWidth: 1 }
        : { backgroundColor: theme.notes.semantic.danger };

  const textColor = isDisabled
    ? theme.notes.text.muted
    : variant === 'secondary'
      ? theme.notes.accent.primary
      : '#FFFFFF';

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[size],
        bgStyle,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.text, styles[`text${size === 'sm' ? 'Sm' : 'Md'}`], { color: textColor }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
  },
  sm: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  md: {
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  pressed: {
    opacity: 0.82,
  },
  text: {
    fontWeight: '600',
  },
  textSm: {
    fontSize: 14,
    lineHeight: 20,
  },
  textMd: {
    fontSize: 16,
    lineHeight: 22,
  },
});

export default ButtonBrand;
