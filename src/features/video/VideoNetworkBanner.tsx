import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import type { VideoNetworkQuality } from '../../core/videoSession';

interface VideoNetworkBannerProps {
  /** The receiver's verdict (VideoNetworkMonitor); nothing is shown while it is GOOD. */
  quality: VideoNetworkQuality | undefined;
  style?: StyleProp<ViewStyle>;
}

/**
 * features/video/VideoNetworkBanner.tsx — tells the viewer the connection is bad.
 *
 * WEAK: frames are being lost, so the picture breaks up or stutters (with the SDK's
 * frames, the loss is read off the gaps in capture time). LOST: none are coming.
 * The monitor holds a verdict for a few seconds before changing it, so this does not
 * flicker. It speaks for what arrives here only: a phone that is just sending gets no
 * word from the far end (the SDK has no video RTCP) and cannot be warned.
 */
export function VideoNetworkBanner({ quality, style }: VideoNetworkBannerProps) {
  const { c, tr } = useAppContext();
  if (quality !== 'WEAK' && quality !== 'LOST') return null;

  const lost = quality === 'LOST';
  return (
    <View
      testID="video-network-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: lost ? c.error : c.warn }, style]}>
      <Text style={[styles.text, { color: c.textOnAccent }]}>
        {lost ? tr.videoNetworkLost : tr.videoNetworkWeak}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  text: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
