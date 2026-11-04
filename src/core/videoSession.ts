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

// Read defensively, as in mediaSession.ts: absent when the native module has not
// been rebuilt into the app, and under Jest.
const Native = NativeModules?.McSdkVideo;

const isSupported = Platform?.OS === 'android' && Native != null;

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

  /**
   * Starts sending the camera to a peer as RTP over UDP. CAMERA must already be
   * granted (ensureCameraPermission). Rejects with the reason on failure.
   */
  async startSend(host: string, port: number): Promise<void> {
    if (!isSupported) return;
    return Native.startSend(host, port);
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
