import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { VideoSession, type VideoStats } from '../../core/videoSession';
import type { ThemePalette } from '../../core/theme';
import { RemoteVideoView } from '../video/RemoteVideoView';
import { VideoNetworkBanner } from '../video/VideoNetworkBanner';

const POLL_MS = 1000;
const DEFAULT_ASPECT = 3 / 4;

interface ReceiveScreenProps {
  group: string;
  /** The server has said the transmission finished; TalkContext closes this shortly. */
  ended: boolean;
  onStop: () => void;
}

/**
 * features/talk/ReceiveScreen.tsx — a group's received video, full screen.
 *
 * useGroupVideoReceive runs the receiver while this is open; here is only the picture
 * and what to say while there is none. The picture's shape comes from the decoder, which
 * reads it off the stream, and the poll is how it gets here: not one frame passes
 * through JS.
 */
export function ReceiveScreen({ group, ended, onStop }: ReceiveScreenProps) {
  const { c, tr } = useAppContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(c), [c]);
  const [stats, setStats] = useState<VideoStats | null>(null);

  useEffect(() => {
    const refresh = async () => setStats(await VideoSession.getStats());
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const receive = stats?.receive;
  const aspectRatio = receive?.width && receive.height ? receive.width / receive.height : DEFAULT_ASPECT;
  // Nothing has been drawn yet, or the monitor says frames have stopped coming.
  const waiting = !receive?.width || receive.networkQuality === 'LOST';

  return (
    <View style={s.root} testID="talk-receive-screen">
      <RemoteVideoView style={[s.picture, { aspectRatio }]} />

      {ended
        ? <Text style={s.waiting} testID="talk-receive-ended">{tr.talkVideoEnded}</Text>
        : waiting && <Text style={s.waiting} testID="talk-receive-waiting">{tr.talkVideoWaiting}</Text>}

      <View style={[s.top, { top: Math.max(insets.top - 35, 12) }]}>
        <View style={s.topBar}>
          <Text style={s.groupLabel} numberOfLines={1}>{group}</Text>
          <TouchableOpacity style={s.stopButton} onPress={onStop} activeOpacity={0.7} testID="talk-receive-stop">
            <Text style={s.stopIcon}>✕</Text>
          </TouchableOpacity>
        </View>
        {/* Not once the transmission has ended: then nothing coming is expected. */}
        {!ended && <VideoNetworkBanner quality={receive?.networkQuality} style={s.banner} />}
      </View>
    </View>
  );
}

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, justifyContent: 'center' },
    picture: { width: '100%' },
    waiting: {
      ...StyleSheet.absoluteFill,
      textAlign: 'center',
      textAlignVertical: 'center',
      color: c.textPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    top: { position: 'absolute', left: 16, right: 16 },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    banner: { marginTop: 8 },
    groupLabel: {
      flexShrink: 1, marginRight: 8,
      color: c.textPrimary, fontSize: 11, fontWeight: '600',
      backgroundColor: c.surface,
      paddingHorizontal: 14, paddingVertical: 4, borderRadius: 12,
    },
    stopButton: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: c.surface,
      justifyContent: 'center', alignItems: 'center',
    },
    stopIcon: { color: c.textPrimary, fontSize: 15, fontWeight: '700' },
  });
}
