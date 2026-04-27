import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useEffect, useRef } from 'react';
import { colors, radius, spacing, type } from '../theme';

type Tone = 'idle' | 'connecting' | 'live' | 'success' | 'error' | 'warning';

const TONE_COLOR: Record<Tone, string> = {
  idle: colors.textDim,
  connecting: colors.warning,
  live: colors.success,
  success: colors.success,
  error: colors.danger,
  warning: colors.warning,
};

export interface StatusBadgeProps {
  tone: Tone;
  label: string;
  style?: ViewStyle;
}

export default function StatusBadge({ tone, label, style }: StatusBadgeProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const animated = tone === 'live' || tone === 'connecting';

  useEffect(() => {
    if (!animated) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animated, pulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.3],
  });
  const dotColor = TONE_COLOR[tone];

  return (
    <View style={[styles.wrap, style]}>
      <Animated.View
        style={[
          styles.dot,
          // eslint-disable-next-line react-native/no-inline-styles
          { backgroundColor: dotColor, opacity: animated ? opacity : 1 },
        ]}
      />
      <Text style={[styles.label, { color: dotColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
    gap: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    ...type.smallMedium,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
