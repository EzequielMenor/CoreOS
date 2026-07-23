import { StyleSheet, Text, View } from 'react-native';
import Toast, { type ToastConfig } from 'react-native-toast-message';

import { NoteSpacing, Radii, Typography, ZIndex } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ICONS = {
  success: '✓',
  error: '✗',
  info: 'ℹ',
} as const;

type Variant = keyof typeof ICONS;

function ToastBody({
  variant,
  text1,
  text2,
}: {
  variant: Variant;
  text1?: string;
  text2?: string;
}) {
  const theme = useTheme();
  const stripeColor =
    variant === 'success'
      ? theme.notes.semantic.success
      : variant === 'error'
        ? theme.notes.semantic.danger
        : theme.notes.semantic.info;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.notes.bg.elevated,
          borderColor: theme.notes.border.subtle,
        },
      ]}
    >
      <View style={[styles.stripe, { backgroundColor: stripeColor }]} />
      <View style={styles.iconWrap}>
        <Text
          style={[
            styles.icon,
            {
              color:
                variant === 'success'
                  ? theme.notes.semantic.success
                  : variant === 'error'
                    ? theme.notes.semantic.danger
                    : theme.notes.semantic.info,
            },
          ]}
        >
          {ICONS[variant]}
        </Text>
      </View>
      <View style={styles.text}>
        {text1 ? (
          <Text
            numberOfLines={2}
            style={[styles.title, { color: theme.notes.text.primary }]}
          >
            {text1}
          </Text>
        ) : null}
        {text2 ? (
          <Text
            numberOfLines={3}
            style={[styles.subtitle, { color: theme.notes.text.secondary }]}
          >
            {text2}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const toastConfig: ToastConfig = {
  success: ({ text1, text2 }) => (
    <ToastBody text1={text1} text2={text2} variant="success" />
  ),
  error: ({ text1, text2 }) => <ToastBody text1={text1} text2={text2} variant="error" />,
  info: ({ text1, text2 }) => <ToastBody text1={text1} text2={text2} variant="info" />,
};

export const toastVisibility = {
  success: 3000,
  error: 4000,
  info: 3000,
} as const;

export function ToastHost() {
  // ponytail: Toast necesita estar montado en el root del layout. La config se
  // lee una vez en mount; los nuevos Toast.show() usan las funciones del config
  // que internamente llaman a useTheme(), así que los colores siguen al scheme.
  return (
    <Toast
      config={toastConfig}
      position="top"
      topOffset={NoteSpacing['2xl']}
      visibilityTime={3000}
    />
  );
}

// ponytail: ZIndex.toast lo expone por si callers necesitan anclar algo al
// mismo plano (raro). Re-export por conveniencia.
export const toastZIndex = ZIndex.toast;

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: NoteSpacing.sm,
    marginHorizontal: NoteSpacing.md,
    minHeight: 56,
    overflow: 'hidden',
    paddingVertical: NoteSpacing.sm,
  },
  stripe: {
    alignSelf: 'stretch',
    width: 4,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: NoteSpacing.xs,
    width: 32,
  },
  icon: {
    fontSize: 18,
    fontWeight: '700',
  },
  text: {
    flex: 1,
    paddingRight: NoteSpacing.md,
  },
  title: {
    fontSize: Typography.body.size,
    fontWeight: Typography.title.weight,
    lineHeight: Typography.body.lineHeight,
  },
  subtitle: {
    fontSize: Typography.caption.size,
    lineHeight: Typography.caption.lineHeight,
    marginTop: 2,
  },
});