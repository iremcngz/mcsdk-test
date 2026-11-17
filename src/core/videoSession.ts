/**
 * videoSession.ts — JS wrapper over the native McSdkVideo module.
 *
 * It carries no video data: frames are tens of kilobytes, 24 times a second, and
 * stay entirely inside the native layer. JS sends commands and polls a few
 * numbers, as mediaSession.ts does for audio.
 *
 * Android only. On iOS every call is a no-op.
 */

import { NativeModules, Platform } from 'react-native';
import { VideoTuningSettings, type VideoTuning } from './settings';

// Read defensively, as in mediaSession.ts: absent when the native module has not
// been rebuilt into the app, and under Jest.
const Native = NativeModules?.McSdkVideo;

const isSupported = Platform?.OS === 'android' && Native != null;

/**
 * Hands the settings screen's video choices to the native side. Called before every
 * start, so a camera always starts with what is saved now, and by the settings screen
 * on each change, so freezeOnLoss reaches a running receiver at once.
 */
function applyTuning(t: VideoTuning = VideoTuningSettings.load()): void {
  if (!isSupported) return;
  Native.setTuning(t.bitrateKbps, t.frameRate, t.keyFrameIntervalSeconds, t.freezeOnLoss);
}

/** The sender's counters. They keep the last run's values after it stops. */
export interface VideoSendStats {
  running: boolean;
  width: number;
  height: number;
  framesEncoded: number;
  keyFrames: number;
  bytes: number;
  /** Key frames with no SPS/PPS to carry, which nobody can decode. Must stay 0. */
  keyFramesWithoutConfig: number;
  /** From the first frame's capture time to the last one's. */
  seconds: number;
  /** The encoder's actual SPS, as SDP writes it. */
  profileLevelId: string | null;
  packetsSent: number;
  /** Packets send() refused. Must stay 0. */
  sendErrors: number;
  target: string | null;
  error: string | null;
}

export type VideoNetworkQuality = 'GOOD' | 'WEAK' | 'LOST';

/** The receiver's counters. They keep the last run's values after it stops. */
export interface VideoReceiveStats {
  running: boolean;
  width: number;
  height: number;
  packetsReceived: number;
  packetsLost: number;
  /**
   * Frames the sender captured that never arrived, told from gaps in capture time.
   * The SDK's frames come with no packets to count, so this is their loss.
   */
  framesMissed: number;
  /** Frames put back together whole. */
  framesReceived: number;
  /** Frames dropped for missing a packet. */
  framesDiscarded: number;
  /** Frames that reached the screen. */
  framesDecoded: number;
  /** Frames that arrived too late for the playout delay to cover. */
  framesLate: number;
  keyFramesRequested: number;
  drawSeconds: number;
  /** What the viewer should be told about the picture. */
  networkQuality: VideoNetworkQuality;
  error: string | null;
}

export interface VideoStats {
  send: VideoSendStats;
  receive: VideoReceiveStats;
}

export const VideoSession = {
  /** False on iOS and wherever the native module is missing. */
  isSupported,

  applyTuning,

  /**
   * Starts sending the camera to a peer as RTP over UDP. CAMERA must already be
   * granted (ensureCameraPermission). Rejects with the reason on failure.
   */
  async startSend(host: string, port: number): Promise<void> {
    if (!isSupported) return;
    applyTuning();
    return Native.startSend(host, port);
  },

  /**
   * Starts the camera for a call. Its picture appears in a mounted LocalVideoView
   * and nothing is sent until setCallTarget. CAMERA must already be granted. Resolves
   * false where there is no pipeline (iOS, tests); rejects with the reason on failure.
   */
  async startCallCamera(): Promise<boolean> {
    if (!isSupported) return false;
    applyTuning();
    await Native.startCallCamera();
    return true;
  },

  /** The call to send the camera to from now on, or null to stop sending. */
  setCallTarget(callId: string | null): void {
    if (!isSupported) return;
    Native.setCallTarget(callId ?? '');
  },

  async stopCallCamera(): Promise<void> {
    if (!isSupported) return;
    return Native.stopCallCamera();
  },

  /**
   * Switches the call camera between back and front, keeping the call it sends to and
   * whether frames were going out — a flip mid-transmission carries on sending.
   *
   * It reopens the camera, so the picture goes for a moment and the receiver gets a
   * key frame after the gap. Resolves false where there is no pipeline (iOS, tests),
   * and rejects when there is no second camera or the new one would not start.
   */
  async flipCallCamera(): Promise<boolean> {
    if (!isSupported) return false;
    await Native.flipCallCamera();
    return true;
  },

  /** True when the device has a camera to flip to, so the button is worth showing. */
  hasMultipleCameras(): boolean {
    if (!isSupported) return false;
    // Synchronous on the native side; a throw here must not stop the view opening.
    try {
      return Native.hasMultipleCameras() === true;
    } catch {
      return false;
    }
  },

  /**
   * Starts showing a call's received video in a mounted RemoteVideoView, from the
   * call setCallReceiveSource names; stopReceive ends it. Resolves false where there
   * is no pipeline (iOS, tests); rejects with the reason on failure.
   */
  async startCallReceive(): Promise<boolean> {
    if (!isSupported) return false;
    applyTuning();
    await Native.startCallReceive();
    return true;
  },

  /** The call to show from now on, or null for none. */
  setCallReceiveSource(callId: string | null): void {
    if (!isSupported) return;
    Native.setCallReceiveSource(callId ?? '');
  },

  async stopSend(): Promise<void> {
    if (!isSupported) return;
    return Native.stopSend();
  },

  /**
   * Starts listening on a port. The picture appears in a mounted RemoteVideoView.
   * Rejects with the reason on failure.
   */
  async startReceive(port: number): Promise<void> {
    if (!isSupported) return;
    applyTuning();
    return Native.startReceive(port);
  },

  async stopReceive(): Promise<void> {
    if (!isSupported) return;
    return Native.stopReceive();
  },

  async getStats(): Promise<VideoStats | null> {
    if (!isSupported) return null;
    return Native.getStats();
  },
};
