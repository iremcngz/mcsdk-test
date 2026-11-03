/**
 * features/calls/useCallAudio.ts — a call's audio through the native pipeline.
 *
 * Shared by the private call (CallContext) and the group call (TalkContext).
 * There is one microphone and one pipeline, so at most one of them passes a
 * call id at a time; which one is decided by the callers, not here.
 */

import { useEffect, useRef } from 'react';
import { MediaSession, type AudioRouteName } from '../../core/mediaSession';
import { ensureMicPermission } from '../../core/permissions';

/** Why a call's audio did not start, as the `AUDIO:<reason>` notice names it. */
export type CallAudioProblem = 'MIC_DENIED' | 'START_FAILED';

export interface CallAudioOptions {
  /** The call whose audio should run now, or null for none. */
  callId: string | null;
  /** Whether the uplink gate is open: the floor is ours (or there is none), and not muted. */
  transmit: boolean;
  /** Silences what is received, the call and the uplink carrying on. */
  playbackMuted?: boolean;
  /**
   * Where the audio plays while it runs, put back on the earpiece once it
   * stops. Undefined leaves the route to the caller.
   */
  route?: AudioRouteName;
  onProblem: (callId: string, problem: CallAudioProblem) => void;
}

/**
 * Runs [callId]'s audio from the moment it is named until it is not. Keyed on
 * the call id (and route) alone, so floor and mute changes reach the running
 * pipeline instead of restarting it.
 */
export function useCallAudio({ callId, transmit, playbackMuted = false, route, onProblem }: CallAudioOptions): void {
  const transmitRef = useRef(transmit);
  const mutedRef = useRef(playbackMuted);
  const onProblemRef = useRef(onProblem);
  onProblemRef.current = onProblem;
  // Only while this call's audio runs: the Audio tab's test sessions share the
  // pipeline, and a call that is not up must not gate them.
  const runningRef = useRef(false);

  useEffect(() => {
    transmitRef.current = transmit;
    if (runningRef.current) MediaSession.setTransmitEnabled(transmit);
  }, [transmit]);

  useEffect(() => {
    mutedRef.current = playbackMuted;
    if (runningRef.current) MediaSession.setPlaybackMuted(playbackMuted);
  }, [playbackMuted]);

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    (async () => {
      // AudioRecord does not report a missing permission — it records silence.
      if ((await ensureMicPermission()) !== 'granted') {
        if (!cancelled) onProblemRef.current(callId, 'MIC_DENIED');
        return;
      }
      if (cancelled) return;
      try {
        if (!(await MediaSession.startCallAudio(callId))) return; // no pipeline here
      } catch (err) {
        console.warn('[useCallAudio] call audio did not start:', err);
        if (!cancelled) onProblemRef.current(callId, 'START_FAILED');
        return;
      }
      if (cancelled) {
        // Gone while the pipeline was starting. By call id: another call may
        // have taken the pipeline meanwhile, and this stop must spare it.
        MediaSession.stopCallAudio(callId).catch(() => {});
        return;
      }
      runningRef.current = true;
      // The floor may have been granted while we were starting.
      MediaSession.setTransmitEnabled(transmitRef.current);
      if (mutedRef.current) MediaSession.setPlaybackMuted(true);
      if (route) MediaSession.setRoute(route);
    })();
    return () => {
      cancelled = true;
      const wasRunning = runningRef.current;
      runningRef.current = false;
      MediaSession.stopCallAudio(callId).catch(() => {});
      // The route is device-wide: whatever plays next starts from the earpiece.
      if (route && wasRunning) MediaSession.setRoute('EARPIECE');
    };
  }, [callId, route]);
}
