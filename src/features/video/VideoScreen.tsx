/**
 * features/video/VideoScreen.tsx — video between two phones over UDP.
 *
 * Its own tab for the reason the Audio tab is: the path has to be observable in
 * isolation before a call depends on it. One phone films and sends, the other shows
 * the picture, and either can do both. There is no signalling, so the far end's
 * address is typed in.
 *
 * No video data crosses the bridge. This screen sends commands and polls a handful
 * of numbers once a second; the picture goes from the decoder straight to the view.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { ensureCameraPermission } from '../../core/permissions';
import { VideoSession, type VideoStats } from '../../core/videoSession';
import { makeCommonStyles } from '../../shared/commonStyles';
import { makeAudioStyles } from '../audio/styles';
import { RemoteVideoView } from './RemoteVideoView';

/** How often the counters are refreshed while video runs. */
const POLL_MS = 1000;

/** Next to the audio test's 5004. RTCP uses the port above this on both phones. */
const DEFAULT_PORT = '5006';

/** The sender's own default, shown until the first decoded frame gives the real shape. */
const DEFAULT_ASPECT = 4 / 3;

/**
 * Whether an encoder's profile-level-id fits the SDK's 42e01f. It need not match:
 * encoders pick their own level from the frame size, and the level in SDP is a
 * ceiling. What has to hold is baseline (0x42), the constraint that makes it
 * constrained baseline (0x40 of the second byte), and level 3.1 (0x1f) at most.
 */
function fitsSdkFormat(id: string): boolean {
  const profile = parseInt(id.slice(0, 2), 16);
  const constraints = parseInt(id.slice(2, 4), 16);
  const level = parseInt(id.slice(4, 6), 16);
  // eslint-disable-next-line no-bitwise
  return profile === 0x42 && (constraints & 0x40) !== 0 && level <= 0x1f;
}

export function VideoScreen() {
  const { c, tr } = useAppContext();
  // The peer has to be told this device's address by hand.
  const { ipInfo } = useSdkContext();
  const s = useMemo(() => makeCommonStyles(c), [c]);
  const a = useMemo(() => makeAudioStyles(c), [c]);

  const [stats, setStats] = useState<VideoStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [peer, setPeer] = useState('');
  const [port, setPort] = useState(DEFAULT_PORT);

  const send = stats?.send ?? null;
  const receive = stats?.receive ?? null;
  const sending = send?.running ?? false;
  const receiving = receive?.running ?? false;

  const refresh = useCallback(async () => {
    setStats(await VideoSession.getStats());
  }, []);

  // Video outlives this screen, so coming back has to pick it up again.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sending && !receiving) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [sending, receiving, refresh]);

  /** Runs one command with the busy flag held, and shows why it failed if it did. */
  const run = useCallback(
    async (command: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await command();
        await refresh();
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh],
  );

  const toggleSend = useCallback(
    () =>
      run(async () => {
        if (sending) {
          await VideoSession.stopSend();
          return;
        }
        const outcome = await ensureCameraPermission();
        if (outcome !== 'granted') {
          throw new Error(
            outcome === 'blocked' ? tr.videoPermissionBlocked : tr.videoPermissionDenied,
          );
        }
        await VideoSession.startSend(peer.trim(), Number(port));
      }),
    [run, sending, peer, port, tr],
  );

  const toggleReceive = useCallback(
    () =>
      run(() => (receiving ? VideoSession.stopReceive() : VideoSession.startReceive(Number(port)))),
    [run, receiving, port],
  );

  const row = (label: string, value: string, warn = false) => (
    <View style={a.row} key={label}>
      <Text style={a.rowLabel}>{label}</Text>
      <Text style={[a.rowValue, warn && a.rowValueWarn]}>{value}</Text>
    </View>
  );

  const seconds = send?.seconds ?? 0;
  const frames = send?.framesEncoded ?? 0;
  const sendFps = seconds > 0 ? (frames - 1) / seconds : 0;
  const kbps = seconds > 0 ? ((send?.bytes ?? 0) * 8) / seconds / 1000 : 0;
  const profile = send?.profileLevelId ?? null;
  const drawn = receive?.framesDecoded ?? 0;
  const drawSeconds = receive?.drawSeconds ?? 0;
  const drawFps = drawSeconds > 0 ? (drawn - 1) / drawSeconds : 0;
  const shownError = error ?? send?.error ?? receive?.error ?? null;

  const status = [sending && tr.videoStatusSending, receiving && tr.videoStatusReceiving]
    .filter(Boolean)
    .join(' + ');

  const quality = receive?.networkQuality ?? 'GOOD';
  const networkBad = quality === 'LOST';
  const networkWarning =
    quality === 'WEAK' ? tr.videoNetworkWeak : quality === 'LOST' ? tr.videoNetworkLost : null;

  const portValid = Number(port) > 0 && Number(port) < 65535;
  const canSend = portValid && (sending || peer.trim().length > 0);
  const aspectRatio = receive?.width && receive.height ? receive.width / receive.height : DEFAULT_ASPECT;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{tr.videoTitle}</Text>
        <View style={[s.badge, { backgroundColor: sending || receiving ? c.error : c.border }]}>
          <Text style={s.badgeText}>{status || tr.videoStatusIdle}</Text>
        </View>
      </View>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
        {/* No backgroundColor: a SurfaceView's picture is a layer behind the window,
            and a background is painted into the window, on top of it. Frames are
            then drawn at full rate with nothing to see. */}
        {receiving && (
          <View style={styles.pictureBox}>
            <RemoteVideoView style={[styles.picture, { aspectRatio }]} />
            {networkWarning !== null && (
              // Over the picture rather than above it, so it does not push the picture
              // down each time it appears. The window draws over a SurfaceView's layer.
              <View style={[styles.warning, { backgroundColor: networkBad ? c.error : c.warn }]}>
                <Text style={s.badgeText}>{networkWarning}</Text>
              </View>
            )}
          </View>
        )}

        {shownError !== null && (
          <View style={a.errorBox}>
            <Text style={a.errorText}>{shownError}</Text>
          </View>
        )}

        <Text style={a.section}>{tr.videoPeerSection}</Text>
        <View style={a.card}>
          {row(tr.audioMyIp, ipInfo.ip ?? tr.audioNone)}
          <View style={a.row}>
            <Text style={a.rowLabel}>{tr.videoPeerIp}</Text>
            <TextInput
              style={a.input}
              value={peer}
              onChangeText={setPeer}
              placeholder="192.168.1.20"
              placeholderTextColor={c.textMuted}
              keyboardType="numeric"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!sending}
            />
          </View>
          <View style={a.row}>
            <Text style={a.rowLabel}>{tr.videoPort}</Text>
            <TextInput
              style={a.input}
              value={port}
              onChangeText={setPort}
              keyboardType="numeric"
              editable={!sending && !receiving}
            />
          </View>
        </View>

        <Pressable
          onPress={toggleSend}
          disabled={busy || !canSend}
          style={[
            a.actionButton,
            { backgroundColor: sending ? c.error : c.primary },
            (busy || !canSend) && a.actionButtonDisabled,
          ]}>
          <Text style={a.actionButtonText}>{sending ? tr.videoStopSend : tr.videoSend}</Text>
        </Pressable>

        <Pressable
          onPress={toggleReceive}
          disabled={busy || !portValid}
          style={[
            a.actionButton,
            { backgroundColor: receiving ? c.error : c.primary },
            (busy || !portValid) && a.actionButtonDisabled,
          ]}>
          <Text style={a.actionButtonText}>{receiving ? tr.videoStopReceive : tr.videoReceive}</Text>
        </Pressable>

        <Text style={a.hint}>{tr.videoHint}</Text>

        {receive !== null && (receiving || receive.packetsReceived > 0) && (
          <>
            <Text style={a.section}>{tr.videoReceiveSection}</Text>
            <View style={a.card}>
              {row(tr.videoSize, receive.width ? `${receive.width}×${receive.height}` : '—')}
              {row(tr.videoFramesDecoded, String(drawn))}
              {row(tr.videoFps, drawFps.toFixed(1))}
              {row(tr.videoFramesLate, String(receive.framesLate))}
              {row(tr.videoPacketsReceived, String(receive.packetsReceived))}
              {row(tr.videoPacketsLost, String(receive.packetsLost), receive.packetsLost > 0)}
              {row(tr.videoFramesReceived, String(receive.framesReceived))}
              {row(tr.videoFramesDiscarded, String(receive.framesDiscarded), receive.framesDiscarded > 0)}
              {row(tr.videoKeyRequests, String(receive.keyFramesRequested))}
            </View>
          </>
        )}

        {send !== null && (sending || frames > 0) && (
          <>
            <Text style={a.section}>{tr.videoSendSection}</Text>
            <View style={a.card}>
              {row(tr.videoTarget, send.target ?? '—')}
              {row(tr.videoSize, send.width ? `${send.width}×${send.height}` : '—')}
              {row(tr.videoProfile, profile ?? '—', profile !== null && !fitsSdkFormat(profile))}
              {row(tr.videoFrames, String(frames))}
              {row(tr.videoKeyFrames, String(send.keyFrames))}
              {row(tr.videoFps, sendFps.toFixed(1))}
              {row(tr.videoBitrate, `${kbps.toFixed(0)} kbps`)}
              {row(tr.videoPacketsSent, String(send.packetsSent))}
              {row(tr.videoSendErrors, String(send.sendErrors), send.sendErrors > 0)}
              {row(tr.videoNoConfig, String(send.keyFramesWithoutConfig), send.keyFramesWithoutConfig > 0)}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pictureBox: {
    marginBottom: 12,
  },
  picture: {
    width: '100%',
  },
  warning: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
});
