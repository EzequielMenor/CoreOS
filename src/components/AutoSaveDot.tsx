import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { IconSize } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { animations } from '@/lib/animations';

export interface AutoSaveDotProps {
  dirty: boolean;
  lastSavedAt: number | null;
}

const SAVED_WINDOW_SECONDS = 2;
const SAVED_FLASH_DURATION_MS = 200;
const SAVED_FADE_MS = 300;

type VisualState = 'idle' | 'dirty' | 'saved-flash' | 'saved-static';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function deriveState(dirty: boolean, lastSavedAt: number | null): VisualState {
  if (dirty) {
    return 'dirty';
  }
  if (lastSavedAt == null) {
    return 'idle';
  }
  if (lastSavedAt > nowSeconds() - SAVED_WINDOW_SECONDS) {
    return 'saved-flash';
  }
  return 'idle';
}

export function AutoSaveDot({ dirty, lastSavedAt }: AutoSaveDotProps) {
  const theme = useTheme();
  const opacity = useSharedValue(0);
  const [savedFlashDone, setSavedFlashDone] = useState(false);

  const baseState = deriveState(dirty, lastSavedAt);
  const visualState: VisualState =
    baseState === 'saved-flash' && savedFlashDone ? 'saved-static' : baseState;

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  useEffect(() => {
    if (baseState === 'saved-flash') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedFlashDone(false);
    }
  }, [baseState]);

  useEffect(() => {
    if (baseState === 'dirty') {
      cancelAnimation(opacity);
      opacity.set(animations.dot.pulse.apply(opacity));
      return;
    }

    if (baseState === 'saved-flash') {
      cancelAnimation(opacity);
      opacity.set(
        withTiming(1, { duration: SAVED_FLASH_DURATION_MS }, (finished) => {
          if (finished) {
            runOnJS(setSavedFlashDone)(true);
          }
        }),
      );
      return;
    }

    cancelAnimation(opacity);
    opacity.set(withTiming(0, { duration: SAVED_FADE_MS }));
  }, [baseState, opacity]);

  const dotColor =
    visualState === 'saved-flash'
      ? theme.notes.semantic.success
      : theme.notes.text.muted;

  if (visualState === 'idle') {
    return <View style={styles.spacer} pointerEvents="none" />;
  }

  return (
    <Animated.View
      accessibilityLabel={visualState === 'dirty' ? 'Cambios sin guardar' : 'Guardado'}
      style={[styles.dot, { backgroundColor: dotColor }, animatedStyle]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: IconSize.sm / 2,
    height: IconSize.sm,
    width: IconSize.sm,
  },
  spacer: {
    height: IconSize.sm,
    width: IconSize.sm,
  },
});