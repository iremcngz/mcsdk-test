/**
 * features/talk/useGroupVideoSend.ts — sends the camera to a group while the
 * transmit view is open.
 *
 * The group's call on the Talk screen is MCPTT, and the SDK's calls carry one media
 * plane each: video needs an MCVideo call of its own, alongside it. These calls are
 * kept here, apart from TalkContext's, which holds one call per group.
 *
 *   view opens → camera on, nothing sent and nothing asked of the server
 *   startSending → MCVideo call placed (or the group's existing one used)
 *   call active → requestTransmission
 *   GRANTED → frames go out, until stopSending, the view closes or permission goes
 *
 * A group call with no transmission control has nothing to ask for, and sends as
 * soon as it is up. Closing the view leaves a call we placed; one somebody else
 * started only has our transmission ended, and carries on. Between transmissions a
 * call stays up, so sending again needs only another request.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoSession } from '../../core/videoSession';
import { ensureCameraPermission } from '../../core/permissions';
import { isGroupCall, mapCallState } from '../calls/sdkCall';
import type {
  CallInfoEvent,
  McSdkTransmissionStatus,
  ReceptionUpdatedEvent,
  TransmissionUpdatedEvent,
} from '../../mcsdk/types';
import type { McSdk } from '../../mcsdk';

/** One group's MCVideo call. */
export interface GroupVideoCall {
  callId: string;
  active: boolean;
  outgoing: boolean;
  /** False for a call that needs no permission to send. */
  transmissionControl: boolean;
  transmission: McSdkTransmissionStatus | null;
}

export interface GroupVideoSendOptions {
  sdkRef: { current: McSdk | null };
  created: boolean;
  /** The group to send to, or null while the transmit view is closed. */
  groupId: string | null;
}

/** Why a transmission we wanted is over: the server's limit, its decision, or never begun. */
export type VideoSendNotice = 'TIME_UP' | 'ENDED' | 'FAILED';

/**
 * One remote phone sending video to a group, as the Receive picker lists it.
 *
 * `id` is the SDK's transmitterId, which is what receiveMedia takes; `alias` is the
 * functional alias the server sent with it, which may be empty — the picker falls
 * back to the id then, since an unnamed row is still one the user can choose.
 */
export interface VideoTransmitter {
  id:    string;
  alias: string;
}

export interface GroupVideoSend {
  calls: Record<string, GroupVideoCall>;
  /** The user has asked to send, whether or not the server has allowed it yet. */
  requested: boolean;
  /** Frames are going out. */
  sending: boolean;
  /** Set for a moment after a transmission ends without the user stopping it. */
  notice: VideoSendNotice | null;
  startSending: () => void;
  stopSending: () => void;
}

/** How long the transmit view says why a transmission ended. */
export const SEND_NOTICE_MS = 3_000;

/** What this says to someone still wanting to send, or null if it does not end that. */
function noticeFor(e: TransmissionUpdatedEvent): VideoSendNotice | null {
  switch (e.status) {
    case 'REVOKED':
      if (e.revokeReason === 'QUEUE_TRANSMISSION') return null; // waits in the queue instead
      return e.revokeReason === 'MEDIA_BURST_TOO_LONG' ? 'TIME_UP' : 'ENDED';
    case 'ENDED_BY_SERVER':
      return e.revokeReason === 'MEDIA_BURST_TOO_LONG' ? 'TIME_UP' : 'ENDED';
    case 'REJECTED':
    case 'QUEUE_CANCELLED':
    case 'REQUEST_TIMEOUT':
    case 'QUEUE_TIMEOUT':
      return 'FAILED';
    default:
      return null;
  }
}

/** The reception statuses of a transmitter that is still sending. */
const RECEPTION_LIVE: ReadonlySet<ReceptionUpdatedEvent['status']> = new Set([
  'AVAILABLE',
  'REQUESTED',
  'RECEIVING',
] as const);

/** An MCVideo call to a group, which is the one kind this hook looks after. */
export function isGroupVideoCall(e: CallInfoEvent): boolean {
  return isGroupCall(e) && e.isVideo === true;
}

export function useGroupVideoSend({
  sdkRef,
  created,
  groupId,
}: GroupVideoSendOptions): GroupVideoSend {
  const [calls, setCalls] = useState<Record<string, GroupVideoCall>>({});
  const [cameraReady, setCameraReady] = useState(false);
  const [requested, setRequested] = useState(false);
  const [notice, setNotice] = useState<VideoSendNotice | null>(null);

  // Read by the effects, which must see the calls as they are now.
  const callsRef = useRef(calls);
  callsRef.current = calls;
  // Read by the SDK's callbacks and the buttons, which outlive any one render.
  const sendRef = useRef({ groupId, requested, cameraReady });
  sendRef.current = { groupId, requested, cameraReady };

  /** The call we are trying to send on, if [callId] is that call. */
  const isCallBeingSent = (callId: string) => {
    const { groupId: group, requested: wanted } = sendRef.current;
    return wanted && !!group && callsRef.current[group]?.callId === callId;
  };

  const startSending = useCallback(() => {
    const { groupId: group, cameraReady: ready } = sendRef.current;
    // The SDK ignores a request while the last transmission is still ending.
    if (!group || !ready || callsRef.current[group]?.transmission === 'ENDING') return;
    setNotice(null);
    setRequested(true);
  }, []);

  const stopSending = useCallback(() => setRequested(false), []);

  useEffect(() => {
    const sdk = sdkRef.current;
    if (!created || !sdk) {
      setCalls({});
      return;
    }
    const onCall = (e: CallInfoEvent) => {
      if (!isGroupVideoCall(e)) return;
      const state = mapCallState(e.state);
      // What is ending says nothing new: onCallTerminated takes it out.
      if (state !== 'ringing' && state !== 'connecting' && state !== 'active') return;
      setCalls(prev => {
        // The SDK names the group on an incoming call too (<mcptt-calling-group-id>),
        // so a call we did not place still lands under the right one.
        const group = Object.keys(prev).find(g => prev[g].callId === e.callId) ?? e.groupId;
        // An invite whose body carried no <calling-group-id>: the SDK logs that its
        // group is unknown and leaves it empty. Keyed on '' it would sit under a group
        // that does not exist, so it is left out rather than shown in the wrong place.
        if (!group) return prev;
        const known = prev[group]?.callId === e.callId ? prev[group] : undefined;
        return {
          ...prev,
          [group]: {
            callId: e.callId,
            active: state === 'active',
            outgoing: e.outgoing,
            transmissionControl: e.isFloorControlEnabled !== false,
            transmission: known?.transmission ?? null,
          },
        };
      });
    };
    const subs = [
      sdk.onIncomingCall(onCall),
      sdk.onCallUpdated(onCall),
      sdk.onCallTerminated(e => {
        if (isCallBeingSent(e.callId)) {
          const wasUp = Object.values(callsRef.current).some(c => c.callId === e.callId && c.active);
          setRequested(false);
          setNotice(wasUp ? 'ENDED' : 'FAILED');
        }
        setCalls(prev => {
          const group = Object.keys(prev).find(g => prev[g].callId === e.callId);
          if (!group) return prev;
          const next = { ...prev };
          delete next[group];
          return next;
        });
      }),
      sdk.onTransmissionUpdated(e => {
        const ended = isCallBeingSent(e.callId) ? noticeFor(e) : null;
        if (ended) {
          setRequested(false);
          setNotice(ended);
        }
        setCalls(prev => {
          const group = Object.keys(prev).find(g => prev[g].callId === e.callId);
          return group ? { ...prev, [group]: { ...prev[group], transmission: e.status } } : prev;
        });
      }),
      // The server sends us a transmitter's video only once we ask, unless it says
      // the stream is automatic. Nothing shows it yet: McSdkBridge's log counts the
      // frames, which is how the sending phone's video is seen to arrive.
      sdk.onReceptionUpdated(e => {
        if (e.status === 'AVAILABLE' && !e.automatic) sdk.receiveMedia(e.callId, e.transmitterId);
      }),
    ];
    return () => subs.forEach(s => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  // A closed view wants nothing and has nothing to say.
  useEffect(() => {
    if (groupId) return;
    setRequested(false);
    setNotice(null);
  }, [groupId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), SEND_NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // ── The camera follows the view ────────────────────────────────────────────
  const viewOpen = groupId !== null;
  useEffect(() => {
    if (!viewOpen) return;
    let cancelled = false;
    (async () => {
      const permission = await ensureCameraPermission();
      if (permission !== 'granted') {
        console.warn('[useGroupVideoSend] no camera permission:', permission);
        return;
      }
      if (cancelled) return;
      try {
        if (!(await VideoSession.startCallCamera())) return; // no pipeline here
      } catch (err) {
        console.warn('[useGroupVideoSend] the camera did not start:', err);
        return;
      }
      if (!cancelled) setCameraReady(true);
    })();
    return () => {
      cancelled = true;
      setCameraReady(false);
      VideoSession.stopCallCamera().catch(() => {});
    };
  }, [viewOpen]);

  // ── The call ───────────────────────────────────────────────────────────────
  // Once per press: a call that fails is not placed again by itself.
  useEffect(() => {
    const sdk = sdkRef.current;
    if (!groupId || !requested || !created || !sdk) return;
    if (!callsRef.current[groupId]) sdk.startVideoGroupCall(groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, requested, created]);

  const call = groupId ? calls[groupId] : undefined;
  const activeCallId = call?.active ? call.callId : null;
  const needsPermission = call?.transmissionControl ?? false;

  useEffect(() => {
    const sdk = sdkRef.current;
    if (!requested || !activeCallId || !needsPermission || !sdk) return;
    sdk.requestTransmission(activeCallId);
    return () => {
      // A call that has gone took its transmission with it. One the server has
      // already ended is ignored by the SDK.
      if (Object.values(callsRef.current).some(c => c.callId === activeCallId)) {
        sdk.endTransmission(activeCallId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, activeCallId, needsPermission]);

  // The calls we placed for a view that has since closed, or for a press taken back
  // before they came up. Here rather than where that happens because the call's id
  // may arrive only after it has.
  useEffect(() => {
    const leaving = Object.keys(calls).filter(g => calls[g].outgoing
      && (g !== groupId || (!requested && !calls[g].active)));
    if (!leaving.length) return;
    leaving.forEach(g => sdkRef.current?.terminateCall(calls[g].callId));
    setCalls(prev => {
      const next = { ...prev };
      leaving.forEach(g => delete next[g]);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, groupId, requested]);

  // ── Whether frames leave ───────────────────────────────────────────────────
  const target = requested && activeCallId && (!needsPermission || call?.transmission === 'GRANTED')
    ? activeCallId
    : null;

  useEffect(() => {
    if (cameraReady) VideoSession.setCallTarget(target);
  }, [cameraReady, target]);

  return {
    calls,
    requested,
    sending: cameraReady && target !== null,
    notice,
    startSending,
    stopSending,
  };
}

/**
 * A stable empty list: a new [] each render would make every consumer's memo and
 * effect see a changed value on every render of the provider.
 */
const EMPTY_TRANSMITTERS: readonly VideoTransmitter[] = [];

export interface GroupVideoReceive {
  /** The server has said the last transmitter finished while the view was open. */
  ended: boolean;
  /** Who is sending video to the watched call now. */
  transmitters: readonly VideoTransmitter[];
}

export interface GroupVideoReceiveOptions {
  sdkRef: { current: McSdk | null };
  created: boolean;
  /** True while the receive view is open. */
  watching: boolean;
  /** The MCVideo call to show, or null while the group has none up. */
  callId: string | null;
}

/**
 * Shows a group's received video while the receive view is open. It places no call:
 * the SDK answers an incoming group call by itself, so one appears as soon as somebody
 * transmits, and until then the view waits.
 *
 * `ended` goes true once the server has said the last transmitter of that call
 * finished while the view was open, and false again if another one starts.
 *
 * `transmitters` is who is sending to the call now, for the Receive picker and for
 * disabling Receive while the list is empty. It is kept whether the view is open or
 * not, because the button outside the view is what the list has to answer for.
 */
export function useGroupVideoReceive({
  sdkRef,
  created,
  watching,
  callId,
}: GroupVideoReceiveOptions): GroupVideoReceive {
  const [ready, setReady] = useState(false);
  const [ended, setEnded] = useState(false);
  // Per call, so the picker shows the watched call's senders and nobody else's.
  const [byCall, setByCall] = useState<Record<string, VideoTransmitter[]>>({});

  // Read when an event arrives. Who is transmitting is followed with the view closed
  // too: a transmitter that started before it opened ends like any other.
  const watchRef = useRef({ watching, callId });
  watchRef.current = { watching, callId };
  const transmittersRef = useRef(new Map<string, Set<string>>());

  useEffect(() => {
    const sdk = sdkRef.current;
    if (!created || !sdk) return;
    const sub = sdk.onReceptionUpdated(e => {
      const transmitters = transmittersRef.current.get(e.callId) ?? new Set<string>();
      transmittersRef.current.set(e.callId, transmitters);
      const isWatched = watchRef.current.watching && watchRef.current.callId === e.callId;

      if (RECEPTION_LIVE.has(e.status)) {
        transmitters.add(e.transmitterId);
        // The alias can arrive on a later event than the one that added the id, so
        // a row already listed is updated rather than skipped.
        setByCall(prev => {
          const list = prev[e.callId] ?? [];
          const at = list.findIndex(t => t.id === e.transmitterId);
          if (at >= 0 && list[at].alias === e.functionalAlias) return prev;
          const next = at >= 0
            ? list.map((t, i) => (i === at ? { ...t, alias: e.functionalAlias } : t))
            : [...list, { id: e.transmitterId, alias: e.functionalAlias }];
          return { ...prev, [e.callId]: next };
        });
        if (isWatched) setEnded(false);
        return;
      }
      transmitters.delete(e.transmitterId);
      setByCall(prev => {
        const list = prev[e.callId];
        if (!list?.some(t => t.id === e.transmitterId)) return prev;
        return { ...prev, [e.callId]: list.filter(t => t.id !== e.transmitterId) };
      });
      if (e.status === 'TRANSMISSION_ENDED' && transmitters.size === 0 && isWatched) setEnded(true);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  useEffect(() => {
    if (!watching) setEnded(false);
  }, [watching]);

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await VideoSession.startCallReceive())) return; // no pipeline here
      } catch (err) {
        console.warn('[useGroupVideoReceive] the receiver did not start:', err);
        return;
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      setReady(false);
      VideoSession.stopReceive().catch(() => {});
    };
  }, [watching]);

  useEffect(() => {
    if (ready) VideoSession.setCallReceiveSource(callId);
  }, [ready, callId]);

  // A call that has gone leaves no senders behind to offer.
  const transmitters = callId ? byCall[callId] ?? EMPTY_TRANSMITTERS : EMPTY_TRANSMITTERS;

  return { ended, transmitters };
}
