/**
 * mediaSession.ts — JS wrapper over the native McSdkMedia module.
 *
 * Controls the device audio session: communication mode, audio focus, speaker
 * routing, microphone ownership and the foreground service that keeps the mic
 * grant alive off screen.
 *
 * It deliberately carries no audio data. A 20 ms frame is 50 bridge crossings a
 * second, each serialised, which the RN bridge is not built for — PCM and
 * encoded frames stay entirely inside the native layer. JS sends commands and
 * receives state, nothing else.
 *
 * Android only. On iOS every call is a no-op: the iOS xcframework has no call
 * or floor API yet, so there is nothing to drive a session for.
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

// Read defensively: NativeModules is absent when the native module has not been
// rebuilt into the app, and under Jest where react-native is stubbed. Every
// method below degrades to a no-op in that case rather than throwing at import.
const Native = NativeModules?.McSdkMedia;

const isSupported = Platform?.OS === 'android' && Native != null;

/** What took the audio device away from us. */
export type AudioInterruption =
  /** A cellular call started ringing or went off-hook. */
  | 'PHONE_CALL'
  /** The headset was unplugged or Bluetooth disconnected. */
  | 'ROUTE_LOST'
  /** Another app took audio focus. */
  | 'FOCUS_LOST';

export interface AudioRoute {
  /** Wired or USB headset connected. */
  hasHeadset: boolean;
  /** A Bluetooth headset is connected for calls (SCO-capable). */
  hasBluetooth: boolean;
  /** SCO is actually up, so call audio really is on the Bluetooth headset. */
  scoConnected: boolean;
  inCallMode: boolean;
}

/**
 * Output route for call audio.
 *
 * BLUETOOTH is its own case rather than a kind of headset: Bluetooth call audio
 * runs over SCO/HFP, a different profile from the A2DP link that carries music,
 * and SCO has to be started explicitly and then waited for. Selecting it is
 * asynchronous — poll getAudioRoute().scoConnected to know when audio has
 * actually moved to the headset.
 */
export type AudioRouteName = 'EARPIECE' | 'SPEAKER' | 'BLUETOOTH';

/** Whether the device has hardware echo cancellation / noise suppression. */
export interface EffectSupport {
  aec: boolean;
  ns: boolean;
}

/**
 * Codecs the capture path can encode with.
 *
 * PCMU exists to prove the pipeline on its own: G.711 µ-law is a per-sample
 * table, so there is no MediaCodec, no internal buffering and nothing to
 * misconfigure. AMR-WB is the real MCPTT codec and behaves differently — it
 * holds inter-frame state, buffers (so a frame in is not always a frame out),
 * and emits variable-length frames (~61 bytes at 23.85 kbps vs PCMU's 320).
 */
export type CaptureCodec = 'PCMU' | 'AMR-WB';

/** Counters from the native capture pipeline. */
export interface CaptureStats {
  running: boolean;
  /** False while the uplink gate is closed (muted / no floor). */
  transmitting: boolean;
  codec: string;
  sink: string;
  /** Frames read off the device. */
  capturedFrames: number;
  /** Frames encoded and handed to the sink — trails captured while muted. */
  encodedFrames: number;
  /**
   * Frames the sink could not accept. Must stay 0: anything else means the
   * writer thread is not keeping up with the real-time capture thread.
   */
  droppedFrames: number;
  bytesWritten: number;
  /** RTP timestamp in samples — counted from audio produced, not the clock. */
  timestamp: number;
  /** Media seconds captured, derived from the timestamp. */
  mediaSeconds: number;
  /** Hardware effects actually attached to this capture session. */
  aec: boolean;
  ns: boolean;
  filePath: string | null;
  error: string | null;
}

/**
 * Deliberate stream impairment, applied on the way from the file to the jitter
 * buffer. The file on disk is never modified — only the delivery is degraded,
 * because a perfectly replayed recording cannot exercise loss, reordering or
 * starvation. `sourceRead` vs `receivedFrames` is the evidence it happened.
 */
export type Impairment =
  | 'NORMAL'
  /** Drops ~1 frame in 10 → drives concealment. */
  | 'LOSS'
  /** Swaps adjacent frames → the buffer must reorder by timestamp. */
  | 'REORDER'
  /** Up to ~150 ms of extra delay → late frames once past the buffer depth. */
  | 'JITTER'
  /** 500 ms of silence every ~5 s → starves the buffer. */
  | 'FREEZE'
  /** Sends some frames twice → duplicate detection. */
  | 'DUPLICATE';

/** Counters from the native playback pipeline. */
export interface PlaybackStats {
  running: boolean;
  /** True when the stream ran out and playback stopped by itself. */
  finished: boolean;
  codec: string;
  source: string;
  /** Frames the jitter buffer accepted from the source. */
  receivedFrames: number;
  /** Frames the source parsed out of the file. */
  sourceRead: number;
  /** Frames the source withheld on purpose — proves the impairment ran. */
  sourceDropped: number;
  impairment: string;
  /** Frames handed to the decoder in order. */
  playedFrames: number;
  /** Frames written to the device, silence included. */
  writtenFrames: number;
  /** Gaps filled by repeating the previous frame — audible as a stutter. */
  concealedFrames: number;
  /**
   * Nothing to play and nothing to repeat. Must stay 0: anything else means
   * the source is not keeping the jitter buffer fed.
   */
  underrunFrames: number;
  /** Arrived after their play position had passed, so unusable. */
  lateFrames: number;
  duplicateFrames: number;
  /** Frames currently buffered and not yet played. */
  jitterDepth: number;
  filePath: string | null;
  error: string | null;
}

const IDLE_PLAYBACK: PlaybackStats = {
  running: false, finished: false, codec: '-', source: '-',
  receivedFrames: 0, sourceRead: 0, sourceDropped: 0, impairment: '-',
  playedFrames: 0, writtenFrames: 0,
  concealedFrames: 0, underrunFrames: 0, lateFrames: 0, duplicateFrames: 0,
  jitterDepth: 0, filePath: null, error: null,
};

export interface Recording {
  name: string;
  path: string;
  bytes: number;
  modifiedAt: number;
}

/** Returned off Android so callers can render without null checks. */
const IDLE_STATS: CaptureStats = {
  running: false, transmitting: false, codec: '-', sink: '-',
  capturedFrames: 0, encodedFrames: 0, droppedFrames: 0, bytesWritten: 0,
  timestamp: 0, mediaSeconds: 0, aec: false, ns: false,
  filePath: null, error: null,
};

let emitter: NativeEventEmitter | null = null;
function events(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter(Native);
  return emitter;
}

export const MediaSession = {
  /** False on iOS and wherever the native module is missing. */
  isSupported,

  // ── Call mode ───────────────────────────────────────────────────────────────

  /**
   * Enters MODE_IN_COMMUNICATION and takes transient audio focus. This is what
   * opens the telephony audio path and arms the hardware echo canceller.
   *
   * Resolves false when focus was refused — another app owns the audio device
   * and capture must not start.
   */
  async enterCallMode(): Promise<boolean> {
    if (!isSupported) return false;
    return Native.enterCallMode();
  },

  /**
   * Leaves call mode and drops focus.
   *
   * Call this on every path out of a call, error paths included:
   * MODE_IN_COMMUNICATION is a device-global setting, and leaving it set makes
   * the app's other sounds behave oddly long after the call is gone.
   */
  async exitCallMode(): Promise<void> {
    if (!isSupported) return;
    return Native.exitCallMode();
  },

  async isInCallMode(): Promise<boolean> {
    if (!isSupported) return false;
    return Native.isInCallMode();
  },

  // ── Routing ─────────────────────────────────────────────────────────────────

  /** Speaker (true) or earpiece (false). Prefer [setRoute]. */
  setSpeakerphone(on: boolean): void {
    if (!isSupported) return;
    Native.setSpeakerphone(on);
  },

  /**
   * Selects the output route. BLUETOOTH takes effect asynchronously — watch
   * getAudioRoute().scoConnected rather than assuming it is immediate.
   */
  setRoute(route: AudioRouteName): void {
    if (!isSupported) return;
    Native.setRoute(route);
  },

  async getAudioRoute(): Promise<AudioRoute> {
    if (!isSupported) {
      return { hasHeadset: false, hasBluetooth: false, scoConnected: false, inCallMode: false };
    }
    return Native.getAudioRoute();
  },

  // ── Device capability ───────────────────────────────────────────────────────

  /**
   * Hardware AEC/NS availability. Both are genuinely absent on some handsets:
   * half-duplex PTT survives without AEC, a full-duplex private call will echo.
   * Worth logging at startup so a field report can be read against it.
   */
  async getEffectSupport(): Promise<EffectSupport> {
    if (!isSupported) return { aec: false, ns: false };
    return Native.getEffectSupport();
  },

  // ── Microphone ownership ────────────────────────────────────────────────────

  /**
   * Claims the microphone for the VoiceMeter's sound-level capture.
   *
   * Resolves false when the media pipeline holds it. There is one physical
   * microphone and sound-level and AudioRecord cannot both own it — whichever
   * loses fails in a device-dependent way, so the caller must respect a false
   * here and not capture anyway.
   */
  async claimMicForMeter(): Promise<boolean> {
    if (!isSupported) return true; // No arbitration needed off Android.
    return Native.claimMicForMeter();
  },

  releaseMicForMeter(): void {
    if (!isSupported) return;
    Native.releaseMicForMeter();
  },

  async getMicHolder(): Promise<string | null> {
    if (!isSupported) return null;
    return Native.getMicHolder();
  },

  // ── Foreground service ──────────────────────────────────────────────────────

  /**
   * Starts the microphone foreground service.
   *
   * Must be called while the app is in the foreground: Android 14+ refuses to
   * start a microphone-typed service from the background. Hence it is tied to
   * registration rather than to call setup — a lazy start on an incoming call
   * would happen exactly when it is not permitted.
   */
  startService(title: string, text: string, channelName: string): void {
    if (!isSupported) return;
    Native.startMediaService(title, text, channelName);
  },

  stopService(): void {
    if (!isSupported) return;
    Native.stopMediaService();
  },

  async isServiceRunning(): Promise<boolean> {
    if (!isSupported) return false;
    return Native.isMediaServiceRunning();
  },

  // ── Capture (uplink) ────────────────────────────────────────────────────────

  /**
   * Starts capturing the microphone to a file and resolves its path.
   *
   * Call ensureMicPermission() first: AudioRecord does not report a missing
   * RECORD_AUDIO, it just yields silence, which is far harder to diagnose than
   * a refusal. Rejects with the native reason when the device cannot be opened
   * (mic already held, audio focus refused, codec unknown).
   */
  async startCapture(codec: CaptureCodec = 'PCMU'): Promise<string> {
    if (!isSupported) throw new Error('audio capture is Android-only');
    return Native.startCapture(codec);
  },

  /** Stops capture and resolves the finished file's path (null if none). */
  async stopCapture(): Promise<string | null> {
    if (!isSupported) return null;
    return Native.stopCapture();
  },

  /**
   * Gates the uplink without stopping capture, so the level meter stays live
   * and PTT re-arms instantly. Floor control and mute both come through here.
   */
  setTransmitEnabled(enabled: boolean): void {
    if (!isSupported) return;
    Native.setTransmitEnabled(enabled);
  },

  /**
   * One snapshot of the capture counters. Poll about once a second — this is
   * the only thing crossing the bridge while audio runs, by design.
   */
  async getCaptureStats(): Promise<CaptureStats> {
    if (!isSupported) return IDLE_STATS;
    return Native.getCaptureStats();
  },

  /** Recorded files, newest first. */
  async listRecordings(): Promise<Recording[]> {
    if (!isSupported) return [];
    return Native.listRecordings();
  },

  // ── Playback (downlink) ─────────────────────────────────────────────────────

  /**
   * Replays a recording through the decode path and out to the speaker.
   *
   * The codec is inferred natively from the file extension, so it cannot
   * disagree with how the file was written. Rejects with the native reason when
   * the decoder or the output device cannot be opened.
   */
  async startPlayback(path: string, impairment: Impairment = 'NORMAL'): Promise<string> {
    if (!isSupported) throw new Error('playback is Android-only');
    return Native.startPlayback(path, impairment);
  },

  async stopPlayback(): Promise<void> {
    if (!isSupported) return;
    return Native.stopPlayback();
  },

  /** Playback counters. Poll about once a second while playing. */
  async getPlaybackStats(): Promise<PlaybackStats> {
    if (!isSupported) return IDLE_PLAYBACK;
    return Native.getPlaybackStats();
  },

  // ── Events ──────────────────────────────────────────────────────────────────

  /**
   * Fires when something takes the audio device. The handler should drop the
   * floor and stop capture — the audio path is gone either way.
   */
  onInterruption(handler: (reason: AudioInterruption) => void) {
    if (!isSupported) return { remove: () => {} };
    return events().addListener(
      'McSdkAudioInterruption',
      (e: { reason: AudioInterruption }) => handler(e.reason),
    );
  },

  /** Fires when this claimant lost the microphone to a higher-priority one. */
  onMicEvicted(handler: (claimant: string) => void) {
    if (!isSupported) return { remove: () => {} };
    return events().addListener(
      'McSdkMicEvicted',
      (e: { claimant: string }) => handler(e.claimant),
    );
  },
};
