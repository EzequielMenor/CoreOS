import type { ReactNode, RefObject } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import {
  Gesture,
  GestureDetector,
  type GestureType,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { IconSize, NoteSpacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { animations, haptic } from '@/lib/animations';

type ExternalGesture = GestureType | RefObject<GestureType | undefined>;

export interface SwipeableRowProps {
  leftAction?: () => void;
  rightAction?: () => void;
  leftReveal?: ReactNode;
  rightReveal?: ReactNode;
  leftHaptic?: () => void;
  rightHaptic?: () => void;
  threshold?: number;
  simultaneousWithExternalGesture?: ExternalGesture;
  children: ReactNode;
}

function RevealIcon({ side, color }: { side: 'pin' | 'delete'; color: string }) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={side === 'pin' ? 'pin.fill' : 'trash.fill'}
        size={IconSize.md}
        tintColor={color}
      />
    );
  }

  return <Text style={[styles.fallbackIcon, { color }]}>{side === 'pin' ? '📌' : '🗑️'}</Text>;
}

export function SwipeableRow({
  leftAction,
  rightAction,
  leftReveal,
  rightReveal,
  leftHaptic = haptic.tap.medium,
  rightHaptic = haptic.tap.medium,
  threshold = 0.3,
  simultaneousWithExternalGesture,
  children,
}: SwipeableRowProps) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const rowWidth = useSharedValue(0);
  const thresholdReached = useSharedValue(false);

  let pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      let next = Math.max(-rowWidth.value, Math.min(rowWidth.value, event.translationX));
      if ((next > 0 && !leftAction) || (next < 0 && !rightAction)) {
        next = 0;
      }
      translateX.value = next;

      const canAct = next > 0 ? !!leftAction : !!rightAction;
      if (
        canAct &&
        !thresholdReached.value &&
        rowWidth.value > 0 &&
        Math.abs(next) >= rowWidth.value * threshold
      ) {
        thresholdReached.value = true;
        scheduleOnRN(next > 0 ? leftHaptic : rightHaptic);
      }
    })
    .onEnd(() => {
      const action = translateX.value > 0 ? leftAction : rightAction;
      const passed =
        !!action &&
        rowWidth.value > 0 &&
        Math.abs(translateX.value) >= rowWidth.value * threshold;

      if (!passed) {
        translateX.value = animations.swipe.return.spring.apply(translateX);
        thresholdReached.value = false;
        return;
      }

      const target = translateX.value > 0 ? rowWidth.value : -rowWidth.value;
      translateX.value = withSequence(
        animations.swipe.threshold.timing.apply(translateX, target),
        withDelay(150, animations.swipe.threshold.timing.apply(translateX, 0)),
      );
      scheduleOnRN(action);
      thresholdReached.value = false;
    });

  if (simultaneousWithExternalGesture) {
    pan = pan.simultaneousWithExternalGesture(simultaneousWithExternalGesture);
  }

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const leftStyle = useAnimatedStyle(() => ({
    opacity: translateX.value > 0 ? 1 : 0,
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: translateX.value < 0 ? 1 : 0,
  }));

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        rowWidth.value = event.nativeEvent.layout.width;
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.reveal, styles.leftReveal, { backgroundColor: theme.notes.swipe.pin }, leftStyle]}
      >
        {leftReveal ?? <RevealIcon side="pin" color={theme.notes.text.primary} />}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.reveal,
          styles.rightReveal,
          { backgroundColor: theme.notes.swipe.delete },
          rightStyle,
        ]}
      >
        {rightReveal ?? <RevealIcon side="delete" color={theme.notes.text.primary} />}
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  reveal: {
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: NoteSpacing.md,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  leftReveal: {
    alignItems: 'flex-start',
  },
  rightReveal: {
    alignItems: 'flex-end',
  },
  fallbackIcon: {
    fontSize: IconSize.md,
  },
});
