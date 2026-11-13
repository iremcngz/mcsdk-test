import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { VideoSession, type VideoStats } from '../../core/videoSession';
import type { ThemePalette } from '../../core/theme';
import type { Translations } from '../../core/i18n';
import { LocalVideoView } from '../video/LocalVideoView';
import { RemoteVideoView } from '../video/RemoteVideoView';
import { VideoNetworkBanner } from '../video/VideoNetworkBanner';
import type { PrivateVideoProblem } from './usePrivateVideoCall';

const POLL_MS = 1000;
const DEFAULT_ASPECT = 3 / 4;
const PIP_WIDTH = 110;

function problemText(tr: Translations, p: PrivateVideoProblem | null): string | null {
  switch (p) {
    case 'CAMERA_DENIED':  return tr.videoCallCameraDenied;
    case 'CAMERA_FAILED':  return tr.videoCallCameraFailed;
    case 'RECEIVE_FAILED': return tr.videoCallReceiveFailed;
    default:               return null;
  }
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * features/calls/VideoCallScreen.tsx — an active private MCVideo call.
 *
 * The other side's picture fills the screen, ours sits in the corner while the
 * camera is on. CallContext runs the video (usePrivateVideoCall), so this is only
 * the pictures and the buttons: not one frame passes through JS. There is no
 * PTT and no audio control: the SDK's MCVideo calls carry video only and have
 * no floor.
 */
export function VideoCallScreen() {
  const { c, tr } = useAppContext();
  const { activeCall, endCall, videoCameraOn, toggleVideoCamera, videoCameraReady, videoProblem } = useCallContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(c), [c]);

  // The picture's shape comes from the decoder, which reads it off the stream.
  const [stats, setStats] = useState<VideoStats | null>(null);
  useEffect(() => {
    const refresh = async () => setStats(await VideoSession.getStats());
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const startedAt = activeCall?.startedAt ?? 0;
  const isActive = activeCall?.state === 'active';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isActive, startedAt]);

  if (!activeCall?.isVideo) return null;

  const receive = stats?.receive;
  const aspectRatio = receive?.width && receive.height ? receive.width / receive.height : DEFAULT_ASPECT;
  // Nothing has been drawn yet, or the monitor says frames have stopped coming.
  const waiting = !receive?.width || receive.networkQuality === 'LOST';
  const problem = problemText(tr, videoProblem);

  return (
    <View style={s.root} testID="video-call-screen">
      <RemoteVideoView style={[s.picture, { aspectRatio }]} />

      {waiting && <Text style={s.waiting} testID="video-call-waiting">{tr.talkVideoWaiting}</Text>}

      <View style={[s.topBar, { top: Math.max(insets.top - 35, 12) }]}>
        <View style={s.titleBox}>
          <Text style={s.name} numberOfLines={1}>{activeCall.contactName}</Text>
          <Text style={s.subtitle} numberOfLines={1}>
            {tr.videoCallLabel} · {isActive ? formatTime(elapsed) : '…'}
          </Text>
          <Text style={s.subtitle} numberOfLines={1}>{tr.videoCallNoAudio}</Text>
        </View>
        <VideoNetworkBanner quality={receive?.networkQuality} style={s.banner} />
      </View>

      {problem && <Text style={s.problem} testID="video-call-problem">{problem}</Text>}

      <View style={[s.pip, { bottom: insets.bottom + 110 }]}>
        {videoCameraOn && videoCameraReady
          ? <LocalVideoView style={StyleSheet.absoluteFill} testID="video-call-local" />
          : <Text style={s.pipText}>{tr.videoCallCameraOff}</Text>}
      </View>

      <View style={[s.bottomBar, { bottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          testID="video-call-camera"
          accessibilityLabel={videoCameraOn ? tr.videoCallTurnCameraOff : tr.videoCallTurnCameraOn}
          style={[s.roundButton, !videoCameraOn && s.roundButtonOff]}
          onPress={toggleVideoCamera}
          activeOpacity={0.7}>
          <Text style={s.roundIcon}>{videoCameraOn ? '📷' : '🚫'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="video-call-end"
          accessibilityLabel={tr.videoCallEnd}
          style={[s.roundButton, s.endButton]}
          onPress={endCall}
          activeOpacity={0.7}>
          <Text style={s.roundIcon}>📞</Text>
        </TouchableOpacity>
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
    topBar: { position: 'absolute', left: 16, right: 16, alignItems: 'flex-start' },
    titleBox: {
      maxWidth: '100%',
      backgroundColor: c.surface,
      paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12,
    },
    name: { color: c.textPrimary, fontSize: 15, fontWeight: '700' },
    subtitle: { color: c.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 },
    banner: { alignSelf: 'stretch', marginTop: 8 },
    problem: {
      position: 'absolute', top: '40%', alignSelf: 'center',
      color: c.textPrimary, fontSize: 14, fontWeight: '600',
      backgroundColor: c.surface,
      paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, overflow: 'hidden',
    },
    pip: {
      position: 'absolute', right: 16,
      width: PIP_WIDTH, aspectRatio: DEFAULT_ASPECT,
      borderRadius: 10, overflow: 'hidden',
      borderWidth: 1, borderColor: c.border,
      backgroundColor: c.surface,
      justifyContent: 'center', alignItems: 'center',
    },
    pipText: { color: c.textSecondary, fontSize: 11, fontWeight: '600', textAlign: 'center', padding: 8 },
    bottomBar: {
      position: 'absolute', left: 0, right: 0,
      flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 40,
    },
    roundButton: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: c.surface,
      borderWidth: 1, borderColor: c.border,
      justifyContent: 'center', alignItems: 'center',
    },
    roundButtonOff: { backgroundColor: c.border },
    endButton: { backgroundColor: c.error, borderColor: c.error },
    roundIcon: { fontSize: 26 },
  });
}
