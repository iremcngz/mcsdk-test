/**
 * shared/VoiceMeter.tsx — Shared push-to-talk voice level meter.
 *
 * Extracted from TalkScreen and ActiveCallFullScreen, which both rendered an
 * identical 7-bar meter driven by react-native-sound-level. The bar geometry,
 * the sound-level → 0..5 mapping, and the per-bar animation are shared here;
 * each screen still owns its own SoundLevel start/stop lifecycle (they trigger
 * on different conditions) and passes presentation tweaks (bar height, colors)
 * as props.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

export const BAR_COUNT = 7;
export const BAR_HEIGHTS = [0.25, 0.4, 0.55, 0.7, 0.85, 1.0, 1.0];
export const BAR_COLORS = ['#4ade80', '#4ade80', '#facc15', '#facc15', '#fb923c', '#ef4444', '#ef4444'];

/** Maps a raw react-native-sound-level dB value to a 0..5 bar level. */
export function mapSoundLevel(value: number): number {
  return Math.max(0, Math.min(5, Math.round((value + 100) / 20)));
}

/**
 * Drives BAR_COUNT animated values from a 0..5 voice level. Returns the array
 * of Animated.Values to feed into <VoiceMeterBars>.
 */
export function useVoiceBars(voiceLevel: number): Animated.Value[] {
  const barAnims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    const activeCount = Math.floor((voiceLevel / 5) * BAR_COUNT);
    barAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: i < activeCount ? 1 : 0,
        duration: 120,
        useNativeDriver: false,
      }).start();
    });
  }, [voiceLevel, barAnims]);

  return barAnims;
}

interface VoiceMeterBarsProps {
  barAnims: Animated.Value[];
  /** Style for each bar (width/border/min-height). Provided per screen. */
  barStyle: StyleProp<ViewStyle>;
  /** Multiplier applied to each BAR_HEIGHTS fraction (e.g. 24 or 36). */
  heightScale: number;
  /** Color shown when a bar is inactive (level 0). */
  inactiveColor: string;
  /** Opacity shown when a bar is inactive (level 0). */
  inactiveOpacity: number;
}

/** Renders the BAR_COUNT animated bars. Wrap it in the screen's own container. */
export function VoiceMeterBars({
  barAnims,
  barStyle,
  heightScale,
  inactiveColor,
  inactiveOpacity,
}: VoiceMeterBarsProps) {
  return (
    <>
      {BAR_HEIGHTS.map((height, i) => (
        <Animated.View
          key={i}
          style={[
            barStyle,
            {
              height: height * heightScale,
              backgroundColor: barAnims[i].interpolate({
                inputRange: [0, 1],
                outputRange: [inactiveColor, BAR_COLORS[i]],
              }),
              opacity: barAnims[i].interpolate({
                inputRange: [0, 1],
                outputRange: [inactiveOpacity, 1],
              }),
            },
          ]}
        />
      ))}
    </>
  );
}
