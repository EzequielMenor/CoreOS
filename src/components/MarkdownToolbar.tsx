import { useEffect, useState } from 'react';
import {
  type KeyboardEvent,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { InputAccessoryView } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { IconSize, NoteSpacing, Radii, ZIndex } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';

export type MarkdownFormatAction =
  | 'bold'
  | 'italic'
  | 'h1'
  | 'h2'
  | 'code'
  | 'link'
  | 'checklist';

export interface MarkdownToolbarProps {
  onFormat: (action: MarkdownFormatAction) => void;
}

export const MARKDOWN_TOOLBAR_NATIVE_ID = 'editor-toolbar';

type ButtonSpec = {
  action: MarkdownFormatAction;
  label: string;
  symbol: { ios: string };
  fallback: string;
};

const BUTTONS: ButtonSpec[] = [
  { action: 'bold', label: 'Negrita', symbol: { ios: 'bold' }, fallback: 'B' },
  { action: 'italic', label: 'Cursiva', symbol: { ios: 'italic' }, fallback: 'I' },
  {
    action: 'h1',
    label: 'Encabezado 1',
    symbol: { ios: 'h.square' },
    fallback: 'H1',
  },
  {
    action: 'h2',
    label: 'Encabezado 2',
    symbol: { ios: 'h.square.fill' },
    fallback: 'H2',
  },
  {
    action: 'code',
    label: 'Código',
    symbol: { ios: 'chevron.left.forwardslash.chevron.right' },
    fallback: '</>',
  },
  { action: 'link', label: 'Enlace', symbol: { ios: 'link' }, fallback: '🔗' },
  {
    action: 'checklist',
    label: 'Checklist',
    symbol: { ios: 'checklist' },
    fallback: '☑',
  },
];

function ToolbarButtons({ onFormat }: { onFormat: MarkdownToolbarProps['onFormat'] }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: theme.notes.bg.elevated, borderTopColor: theme.notes.border.subtle },
      ]}
    >
      {BUTTONS.map((button) => (
        <Pressable
          accessibilityLabel={button.label}
          accessibilityRole="button"
          hitSlop={6}
          key={button.action}
          onPress={() => {
            void haptic.tap.light();
            onFormat(button.action);
          }}
          style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
        >
          {Platform.OS === 'ios' ? (
            <SymbolView
              name={button.symbol.ios as SFSymbol}
              size={IconSize.md}
              tintColor={theme.notes.text.primary}
            />
          ) : (
            <Text style={[styles.fallback, { color: theme.notes.text.primary }]}>
              {button.fallback}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

export function MarkdownToolbar({ onFormat }: MarkdownToolbarProps) {
  if (Platform.OS === 'ios') {
    return (
      <InputAccessoryView nativeID={MARKDOWN_TOOLBAR_NATIVE_ID}>
        <ToolbarButtons onFormat={onFormat} />
      </InputAccessoryView>
    );
  }

  return <AndroidToolbar onFormat={onFormat} />;
}

function AndroidToolbar({ onFormat }: { onFormat: MarkdownToolbarProps['onFormat'] }) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const onShow = (event: KeyboardEvent) => {
      setKeyboardHeight(event.endCoordinates.height);
    };
    const onHide = () => {
      setKeyboardHeight(0);
    };
    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ponytail: iOS usa InputAccessoryView nativo que se pega al teclado y se
  // oculta solo. En Android el contenedor es absolute y, con bottom:0, se
  // solapa con la tab bar cuando no hay teclado. Se oculta hasta que el
  // teclado aparezca.
  if (keyboardHeight === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.androidContainer, { bottom: keyboardHeight }]}>
      <ToolbarButtons onFormat={onFormat} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 44,
    justifyContent: 'space-around',
    paddingHorizontal: NoteSpacing.sm,
  },
  button: {
    alignItems: 'center',
    borderRadius: Radii.sm,
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  fallback: {
    fontSize: IconSize.md,
    fontWeight: '600',
  },
  androidContainer: {
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: ZIndex.sticky,
  },
});