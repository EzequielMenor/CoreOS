/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/theme';

export function useTheme() {
  const scheme = useColorScheme();
  return Colors[scheme === 'unspecified' ? 'light' : scheme ?? 'light'];
}
