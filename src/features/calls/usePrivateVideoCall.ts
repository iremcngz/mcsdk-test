/**
 * features/calls/usePrivateVideoCall.ts — a private MCVideo call's video, both ways.
 *
 * Simpler than the group's (useGroupVideoSend): a private MCVideo call has no
 * transmission control (TS 24.281 §10.2.3), so there is nothing to request and
 * no transmitter to ask for. Both sides send while the call is up, and the
 * other side's frames arrive by themselves.
 *
 *   call connecting → receiver ready; camera on if wanted (picture, nothing sent)
 *   call active     → the camera goes to the call, its frames are shown
 *   camera off      → the camera stops, the call and the received picture carry on
 *   call gone       → both stop
 *
 * The SDK's MCVideo calls carry no audio, so there is no audio here either.
 * Frames never pass through JS: as for the group, CallVideoRouter joins the SDK
 * and the native pipelines.
 */

import { useEffect, useState } from 'react';
import { VideoSession } from '../../core/videoSession';
import { ensureCameraPermission } from '../../core/permissions';

/** Why part of a private video call's picture is missing. */
export type PrivateVideoProblem = 'CAMERA_DENIED' | 'CAMERA_FAILED' | 'RECEIVE_FAILED';

export interface PrivateVideoCallOptions {
  /** A private video call is connecting or up: its video should run. */
  live: boolean;
  /** The SDK's id for it once it is active, else null: frames go to and come from this. */
  callId: string | null;
  /** The user wants to send their camera. */
  cameraOn: boolean;
}

export interface PrivateVideoCall {
  /** The camera is running: the local picture shows, and goes out once the call is active. */
  cameraReady: boolean;
  problem: PrivateVideoProblem | null;
}

export function usePrivateVideoCall({ live, callId, cameraOn }: PrivateVideoCallOptions): PrivateVideoCall {
  const [receiverReady, setReceiverReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [problem, setProblem] = useState<PrivateVideoProblem | null>(null);

  // A new call starts with nothing to report.
  useEffect(() => {
    if (!live) setProblem(null);
  }, [live]);

  // ── The other side's picture ───────────────────────────────────────────────
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await VideoSession.startCallReceive())) return; // no pipeline here
      } catch (err) {
        console.warn('[usePrivateVideoCall] the receiver did not start:', err);
        if (!cancelled) setProblem('RECEIVE_FAILED');
        return;
      }
      if (!cancelled) setReceiverReady(true);
    })();
    return () => {
      cancelled = true;
      setReceiverReady(false);
      VideoSession.stopReceive().catch(() => {});
    };
  }, [live]);

  useEffect(() => {
    if (receiverReady) VideoSession.setCallReceiveSource(callId);
  }, [receiverReady, callId]);

  // ── Our camera ─────────────────────────────────────────────────────────────
  // Runs only while wanted: a camera turned off is closed, not merely kept from
  // the call, so it is off in every sense the user can see.
  const cameraWanted = live && cameraOn;
  useEffect(() => {
    if (!cameraWanted) return;
    let cancelled = false;
    (async () => {
      if ((await ensureCameraPermission()) !== 'granted') {
        if (!cancelled) setProblem('CAMERA_DENIED');
        return;
      }
      if (cancelled) return;
      try {
        if (!(await VideoSession.startCallCamera())) return; // no pipeline here
      } catch (err) {
        console.warn('[usePrivateVideoCall] the camera did not start:', err);
        if (!cancelled) setProblem('CAMERA_FAILED');
        return;
      }
      // Gone while starting: the cleanup's stop, queued behind this start, closes it.
      if (cancelled) return;
      setProblem(p => (p === 'CAMERA_DENIED' || p === 'CAMERA_FAILED' ? null : p));
      setCameraReady(true);
    })();
    return () => {
      cancelled = true;
      setCameraReady(false);
      VideoSession.stopCallCamera().catch(() => {});
    };
  }, [cameraWanted]);

  // Nothing to request: the call's being up is the permission to send.
  useEffect(() => {
    if (cameraReady) VideoSession.setCallTarget(callId);
  }, [cameraReady, callId]);

  return { cameraReady, problem };
}
