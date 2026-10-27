/**
 * features/audio/AudioScreen.tsx — diagnostics for the capture pipeline.
 *
 * Its own tab on purpose. The capture path has to be observable in isolation:
 * Home is already crowded (SDK lifecycle, ~25 parameters, the log console) and
 * Talk is the real PTT screen, so neither is a place to judge whether audio
 * threading holds up.
 *
 * Two things are being watched here. The device section surfaces the Phase 0
 * groundwork — hardware AEC/NS, the microphone owner, the foreground service —
 * which until now ran without anything showing it. The counters answer the
 * question the pipeline was designed around: `framesDropped` above 0 means the
 * sink's writer thread cannot keep up with the real-time capture thread.
 *
 * No audio data crosses the bridge. Frames live entirely in the native layer;
 * this screen polls a handful of integers once a second.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { makeCommonStyles } from '../../shared/commonStyles';
import { ensureMicPermission, hasMicPermission } from '../../core/permissions';
import {
  MediaSession,
  type CaptureCodec,
  type CaptureStats,
  type AudioRouteName,
  type Impairment,
  type PlaybackStats,
  type Recording,
} from '../../core/mediaSession';
import { makeAudioStyles } from './styles';

/** How often the counters are refreshed while recording. */
const POLL_MS = 1000;

const CODECS: CaptureCodec[] = ['PCMU', 'AMR-WB'];

/** Network conditions to replay a recording under. */
const IMPAIRMENTS: Impairment[] = ['NORMAL', 'LOSS', 'REORDER', 'JITTER', 'FREEZE', 'DUPLICATE'];

export function AudioScreen() {
  const { c, tr } = useAppContext();
  // The peer has to be told this device's address by hand, so it is shown here
  // rather than leaving it to be hunted for in the system settings.
  const { ipInfo } = useSdkContext();
  const s = useMemo(() => makeCommonStyles(c), [c]);
  const a = useMemo(() => makeAudioStyles(c), [c]);

  const [codec, setCodec] = useState<CaptureCodec>('PCMU');
  const [stats, setStats] = useState<CaptureStats | null>(null);
  const [effects, setEffects] = useState({ aec: false, ns: false });
  const [micGranted, setMicGranted] = useState(false);
  const [micHolder, setMicHolder] = useState<string | null>(null);
  const [serviceOn, setServiceOn] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [play, setPlay] = useState<PlaybackStats | null>(null);
  const [route, setRoute] = useState<AudioRouteName>('EARPIECE');
  const [scoConnected, setScoConnected] = useState(false);
  const [hasBluetooth, setHasBluetooth] = useState(false);
  const [impairment, setImpairment] = useState<Impairment>('NORMAL');
  // UDP peer, entered by hand — there is no signalling in this test, so nothing
  // discovers the far end. 5004 is the conventional RTP audio port; both
  // devices can listen on it since only the peer address differs.
  const [remoteHost, setRemoteHost] = useState('');
  const [remotePort, setRemotePort] = useState('5004');
  const [localPort, setLocalPort] = useState('5004');

  const recording = stats?.running === true;
  const playing = play?.running === true;

  /** Device capabilities and ownership — cheap, so refreshed on every poll. */
  const refreshDevice = useCallback(async () => {
    const [sup, granted, holder, svc, rt] = await Promise.all([
      MediaSession.getEffectSupport(),
      hasMicPermission(),
      MediaSession.getMicHolder(),
      MediaSession.isServiceRunning(),
      MediaSession.getAudioRoute(),
    ]);
    setEffects(sup);
    setMicGranted(granted);
    setMicHolder(holder);
    setServiceOn(svc);
    setScoConnected(rt.scoConnected);
    setHasBluetooth(rt.hasBluetooth);
  }, []);

  const refreshRecordings = useCallback(async () => {
    setRecordings(await MediaSession.listRecordings());
  }, []);

  useEffect(() => {
    // Push the default route down as well: otherwise the UI shows EARPIECE
    // while the device has never been told anything, and the first playback
    // comes out wherever the platform happened to default to.
    MediaSession.setRoute('EARPIECE');
    refreshDevice();
    refreshRecordings();
  }, [refreshDevice, refreshRecordings]);

  // Poll only while recording: the counters are static otherwise, and an idle
  // timer would add bridge traffic for nothing.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!recording) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(async () => {
      setStats(await MediaSession.getCaptureStats());
      await refreshDevice();
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [recording, refreshDevice]);

  // Playback has its own poll: the two directions are independent, so one must
  // not keep the other's timer alive.
  const playPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) {
      if (playPollRef.current) clearInterval(playPollRef.current);
      playPollRef.current = null;
      return;
    }
    playPollRef.current = setInterval(async () => {
      const next = await MediaSession.getPlaybackStats();
      setPlay(next);
      // Also refresh the device state every tick: SCO comes up a few hundred ms
      // after being requested, and without this the "connecting" line would
      // never clear.
      await refreshDevice();
      // Playback stops itself at end of stream; release the device and refresh
      // the list so the UI does not keep showing a player that has finished.
      if (next.finished && !next.running) {
        await MediaSession.stopPlayback();
        setPlay(await MediaSession.getPlaybackStats());
        await refreshRecordings();
      }
    }, POLL_MS);
    return () => {
      if (playPollRef.current) clearInterval(playPollRef.current);
      playPollRef.current = null;
    };
  }, [playing, refreshDevice, refreshRecordings]);

  const startPlayback = useCallback(async (path: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await MediaSession.startPlayback(path, impairment);
      setPlay(await MediaSession.getPlaybackStats());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, impairment]);

  const stopPlayback = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await MediaSession.stopPlayback();
      setPlay(await MediaSession.getPlaybackStats());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Checked here rather than natively: AudioRecord does not report a
      // missing RECORD_AUDIO, it returns silence — and only JS can prompt.
      const outcome = await ensureMicPermission();
      if (outcome !== 'granted') {
        setError(outcome === 'blocked' ? tr.micPermissionBlocked : tr.micPermissionDenied);
        return;
      }
      await MediaSession.startCapture(codec);
      setStats(await MediaSession.getCaptureStats());
      await refreshDevice();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, codec, tr, refreshDevice]);

  const stop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await MediaSession.stopCapture();
      setStats(await MediaSession.getCaptureStats());
      await Promise.all([refreshDevice(), refreshRecordings()]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, refreshDevice, refreshRecordings]);

  const startUdpSend = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Same reason as capture to a file: AudioRecord yields silence rather
      // than reporting a missing RECORD_AUDIO, and only JS can prompt.
      const outcome = await ensureMicPermission();
      if (outcome !== 'granted') {
        setError(outcome === 'blocked' ? tr.micPermissionBlocked : tr.micPermissionDenied);
        return;
      }
      await MediaSession.startUdpCapture(codec, remoteHost.trim(), Number(remotePort));
      setStats(await MediaSession.getCaptureStats());
      await refreshDevice();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, codec, remoteHost, remotePort, tr, refreshDevice]);

  const startUdpReceive = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await MediaSession.startUdpPlayback(codec, Number(localPort));
      setPlay(await MediaSession.getPlaybackStats());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, codec, localPort]);

  const row = (label: string, value: string, warn = false) => (
    <View style={a.row} key={label}>
      <Text style={a.rowLabel}>{label}</Text>
      <Text style={[a.rowValue, warn && a.rowValueWarn]}>{value}</Text>
    </View>
  );

  const yesNo = (v: boolean) => (v ? tr.audioPresent : tr.audioAbsent);

  /** Compact metric tile — a counter that must stay 0 turns red. */
  const tile = (label: string, value: number, warn: boolean) => (
    <View style={a.tile} key={label}>
      <Text style={[a.tileValue, warn && a.tileValueWarn]}>{value}</Text>
      <Text style={a.tileLabel} numberOfLines={1}>{label}</Text>
    </View>
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{tr.audioTitle}</Text>
        <View
          style={[
            s.badge,
            { backgroundColor: recording ? c.error : playing ? c.primary : c.border },
          ]}>
          <Text style={s.badgeText}>
            {recording
              ? tr.audioStatusRecording
              : playing
                ? tr.audioStatusPlaying
                : tr.audioStatusIdle}
          </Text>
        </View>
      </View>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
        {/* Phase 0 groundwork, visible for the first time. */}
        <Text style={a.section}>{tr.audioDeviceSection}</Text>
        <View style={a.card}>
          {row(tr.audioHwAec, yesNo(effects.aec))}
          {row(tr.audioHwNs, yesNo(effects.ns))}
          {row(tr.audioMicPermission, yesNo(micGranted), !micGranted)}
          {row(tr.audioMicHolder, micHolder ?? tr.audioNone)}
          {row(tr.audioService, serviceOn ? tr.audioRunning : tr.audioStopped)}
        </View>

        <Text style={a.section}>{tr.audioCodec}</Text>
        <View style={a.chipRow}>
          {CODECS.map(name => (
            <Pressable
              key={name}
              onPress={() => setCodec(name)}
              disabled={recording}
              style={[
                a.chip,
                codec === name && a.chipActive,
                recording && a.chipDisabled,
              ]}>
              <Text style={[a.chipText, codec === name && a.chipTextActive]}>{name}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={recording ? stop : start}
          disabled={busy}
          style={[
            a.actionButton,
            { backgroundColor: recording ? c.error : c.primary },
            busy && a.actionButtonDisabled,
          ]}>
          <Text style={a.actionButtonText}>
            {recording ? tr.audioStop : tr.audioStart}
          </Text>
        </Pressable>

        {error !== null && (
          <View style={a.errorBox}>
            <Text style={a.errorText}>{error}</Text>
          </View>
        )}

        <Text style={a.section}>{tr.audioCountersSection}</Text>
        <View style={a.card}>
          {row(tr.audioElapsed, `${(stats?.mediaSeconds ?? 0).toFixed(1)} s`)}
          {row(tr.audioFramesCaptured, String(stats?.capturedFrames ?? 0))}
          {row(tr.audioFramesEncoded, String(stats?.encodedFrames ?? 0))}
          {/* The one number that matters: anything but 0 means the writer
              thread fell behind the real-time capture thread. */}
          {row(
            tr.audioFramesDropped,
            String(stats?.droppedFrames ?? 0),
            (stats?.droppedFrames ?? 0) > 0,
          )}
          {row(tr.audioBytes, String(stats?.bytesWritten ?? 0))}
          {row(tr.audioTransmitting, stats?.transmitting ? tr.audioPresent : tr.audioAbsent)}
          {row(tr.audioSink, stats?.sink ?? tr.audioNone)}
        </View>
        <Text style={a.hint}>{tr.audioPullHint}</Text>

        <Text style={a.section}>{tr.audioPlaybackSection}</Text>

        {/* Replay condition. Degrades only the delivery into the jitter
            buffer; the recording itself is untouched and plays cleanly again
            under NORMAL. */}
        <Text style={a.subLabel}>{tr.audioImpairment}</Text>
        <View style={a.chipRow}>
          {IMPAIRMENTS.map(id => (
            <Pressable
              key={id}
              onPress={() => setImpairment(id)}
              disabled={playing}
              style={[
                a.chipSmall,
                impairment === id && a.chipActive,
                playing && a.chipDisabled,
              ]}>
              <Text style={[a.chipTextSmall, impairment === id && a.chipTextActive]}>
                {id}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={a.hint}>{tr.audioImpairHint}</Text>

        {/* Output route. Kept outside the playing branch so it can be chosen
            before starting — the native side remembers it and re-applies it
            once the audio mode is up. */}
        <View style={a.chipRow}>
          {([
            ['EARPIECE', tr.audioEarpiece],
            ['SPEAKER', tr.audioSpeaker],
            ['BLUETOOTH', tr.audioBluetooth],
          ] as [AudioRouteName, string][]).map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => { setRoute(id); MediaSession.setRoute(id); }}
              // Offering Bluetooth with no headset paired would just fail
              // silently, so the option is disabled until one is connected.
              disabled={id === 'BLUETOOTH' && !hasBluetooth}
              style={[
                a.chip,
                route === id && a.chipActive,
                id === 'BLUETOOTH' && !hasBluetooth && a.chipDisabled,
              ]}>
              <Text style={[a.chipText, route === id && a.chipTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {/* SCO comes up a few hundred ms after it is requested, and audio stays
            on the old route until it does — so the wait is shown rather than
            leaving the first moments unexplained. */}
        {route === 'BLUETOOTH' && !scoConnected && (
          <Text style={a.hint}>{tr.audioScoConnecting}</Text>
        )}

        {playing ? (
          <View style={a.playerCard}>
            {/* Which file, and a stop control on the same line: while playing,
                those are the only two things worth a glance. */}
            <View style={a.playerHeader}>
              <Text style={a.playerFile} numberOfLines={1}>
                {play?.filePath?.split('/').pop() ?? ''}
              </Text>
              <Pressable
                onPress={stopPlayback}
                disabled={busy}
                style={[a.stopButton, busy && a.chipDisabled]}>
                <Text style={a.stopButtonText}>{tr.audioStopPlay}</Text>
              </Pressable>
            </View>

            {/* Progress against the source, so a stall is visible at a glance
                rather than inferred from two frame counts. */}
            <View style={a.progressTrack}>
              <View
                style={[
                  a.progressFill,
                  {
                    width: `${Math.min(
                      100,
                      ((play?.writtenFrames ?? 0) /
                        Math.max(1, play?.receivedFrames ?? 1)) * 100,
                    )}%`,
                  },
                ]}
              />
            </View>
            <Text style={a.playerElapsed}>
              {(((play?.writtenFrames ?? 0) * 20) / 1000).toFixed(1)} s
              {'  ·  '}
              {play?.codec ?? ''}
              {'  ·  '}
              {tr.audioJitterDepth}: {play?.jitterDepth ?? 0}
            </Text>

            {/* Health as compact tiles. Three numbers that must stay 0 beside
                the one that counts up — a list of seven rows buried that. */}
            {/* The source's own account: read vs received diverge by exactly
                the number it withheld, which is what proves the impairment
                actually ran rather than being merely claimed. */}
            <View style={a.evidenceRow}>
              <Text style={a.evidenceText}>
                {tr.audioSourceRead}: {play?.sourceRead ?? 0}
                {'   ·   '}
                {tr.audioReceived}: {play?.receivedFrames ?? 0}
                {(play?.sourceDropped ?? 0) > 0
                  ? `   ·   ${tr.audioSourceDropped}: ${play?.sourceDropped}`
                  : ''}
              </Text>
            </View>

            <View style={a.tileRow}>
              {tile(tr.audioDecoded, play?.playedFrames ?? 0, false)}
              {tile(tr.audioUnderrun, play?.underrunFrames ?? 0, (play?.underrunFrames ?? 0) > 0)}
              {tile(tr.audioConcealed, play?.concealedFrames ?? 0, (play?.concealedFrames ?? 0) > 0)}
              {tile(tr.audioLate, play?.lateFrames ?? 0, (play?.lateFrames ?? 0) > 0)}
            </View>
          </View>
        ) : null}
        <Text style={a.hint}>{tr.audioPlaybackHint}</Text>

        <Text style={a.section}>{tr.audioUdpSection}</Text>
        <View style={a.card}>
          {row(tr.audioMyIp, ipInfo.ip ?? tr.audioNone)}
          <View style={a.row}>
            <Text style={a.rowLabel}>{tr.audioRemoteHost}</Text>
            <TextInput
              style={a.input}
              value={remoteHost}
              onChangeText={setRemoteHost}
              placeholder="192.168.1.20"
              placeholderTextColor={c.textMuted}
              keyboardType="numeric"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!recording}
            />
          </View>
          <View style={a.row}>
            <Text style={a.rowLabel}>{tr.audioRemotePort}</Text>
            <TextInput
              style={a.input}
              value={remotePort}
              onChangeText={setRemotePort}
              keyboardType="numeric"
              editable={!recording}
            />
          </View>
          <View style={a.row}>
            <Text style={a.rowLabel}>{tr.audioLocalPort}</Text>
            <TextInput
              style={a.input}
              value={localPort}
              onChangeText={setLocalPort}
              keyboardType="numeric"
              editable={!playing}
            />
          </View>

          {/* Disabled without a peer address: the sink would fail to resolve it
              and the error would arrive as a rejected promise instead of being
              obvious before the press. */}
          <Pressable
            onPress={recording ? stop : startUdpSend}
            disabled={busy || (!recording && !remoteHost.trim())}
            style={[
              a.actionButton,
              { backgroundColor: recording ? c.error : c.primary },
              (busy || (!recording && !remoteHost.trim())) && a.actionButtonDisabled,
            ]}>
            <Text style={a.actionButtonText}>
              {recording ? tr.audioUdpStopSend : tr.audioUdpSend}
            </Text>
          </Pressable>
          <Pressable
            onPress={playing ? stopPlayback : startUdpReceive}
            disabled={busy}
            style={[
              a.actionButton,
              { backgroundColor: playing ? c.error : c.primary },
              busy && a.actionButtonDisabled,
            ]}>
            <Text style={a.actionButtonText}>
              {playing ? tr.audioUdpStopReceive : tr.audioUdpReceive}
            </Text>
          </Pressable>

          {/* Shown only while a UDP stream is actually up: these counters read 0
              for a file capture or a file replay, where they would mislead. */}
          {stats?.target ? (
            <>
              {row(tr.audioUdpTarget, stats.target)}
              {row(tr.audioPacketsSent, String(stats.packetsSent))}
              {row(tr.audioSendErrors, String(stats.sendErrors), stats.sendErrors > 0)}
            </>
          ) : null}
          {play?.source === 'UDP' ? (
            <>
              {row(tr.audioPacketsReceived, String(play.packetsReceived))}
              {row(tr.audioPacketsLost, String(play.lostPackets), play.lostPackets > 0)}
              {row(tr.audioMalformed, String(play.malformedPackets), play.malformedPackets > 0)}
              {row(tr.audioRemoteSsrc, play.remoteSsrc ? play.remoteSsrc.toString(16) : tr.audioNone)}
            </>
          ) : null}
        </View>
        <Text style={a.hint}>{tr.audioUdpHint}</Text>

        <Text style={a.section}>{tr.audioRecordingsSection}</Text>
        <View style={a.card}>
          {recordings.length === 0 ? (
            <Text style={a.empty}>{tr.audioNoRecordings}</Text>
          ) : (
            recordings.map(r => (
              <View style={a.row} key={r.path}>
                <Text style={a.fileName} numberOfLines={1}>{r.name}</Text>
                <Text style={a.rowValue}>{(r.bytes / 1024).toFixed(0)} KB</Text>
                <Pressable
                  onPress={() => startPlayback(r.path)}
                  disabled={busy || recording || playing}
                  style={[
                    a.playButton,
                    (busy || recording || playing) && a.chipDisabled,
                  ]}>
                  <Text style={a.playButtonText}>{tr.audioPlay}</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
