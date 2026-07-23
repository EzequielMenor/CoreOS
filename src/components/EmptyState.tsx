import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { ButtonBrand } from './ButtonBrand';
import { NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ILLUSTRATION_SIZE = 48;
const SF_PREFIX = 'sf.';

export interface EmptyStateProps {
  illustration?: string;
  title: string;
  subtitle?: string;
  cta?: { label: string; onPress: () => void };
  style?: ViewStyle;
}

export function EmptyState({
  illustration = 'sparkles',
  title,
  subtitle,
  cta,
  style,
}: EmptyStateProps) {
  const theme = useTheme();
  const isSymbol = illustration.startsWith(SF_PREFIX);
  const symbolName = isSymbol ? illustration.slice(SF_PREFIX.length) : illustration;

  return (
    <View style={[styles.container, style]}>
      {isSymbol ? (
        <SymbolView
          name={symbolName as SFSymbol}
          size={ILLUSTRATION_SIZE}
          tintColor={theme.notes.text.primary}
          style={styles.illustration}
        />
      ) : (
        <Text
          style={[
            styles.illustrationText,
            { color: theme.notes.text.primary },
          ]}
        >
          {illustration}
        </Text>
      )}
      <Text
        style={[
          styles.title,
          { color: theme.notes.text.primary },
          !subtitle && styles.titleNoSubtitle,
        ]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={[
            styles.subtitle,
            { color: theme.notes.text.secondary },
            !cta && styles.subtitleNoCta,
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
      {cta ? (
        <ButtonBrand
          title={cta.label}
          onPress={cta.onPress}
          size="sm"
          variant="primary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: NoteSpacing.xl,
  },
  illustration: {
    marginBottom: NoteSpacing.md,
  },
  illustrationText: {
    fontSize: ILLUSTRATION_SIZE,
    marginBottom: NoteSpacing.md,
    textAlign: 'center',
  },
  title: {
    ...Typography.subtitle,
    marginBottom: NoteSpacing.sm,
    textAlign: 'center',
  },
  titleNoSubtitle: {
    marginBottom: 0,
  },
  subtitle: {
    ...Typography.body,
    marginBottom: NoteSpacing.lg,
    textAlign: 'center',
  },
  subtitleNoCta: {
    marginBottom: 0,
  },
});

export default EmptyState;