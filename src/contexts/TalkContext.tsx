import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { McSdkAffiliateRequest, McSdkGroupInfo } from '../mcsdk';
import { useSdkContext } from './SdkContext';

/** The MC services a group can be affiliated to. */
export type McService = 'ptt' | 'video' | 'data';

/** Services of one group, in the flag shape the SDK uses. */
export interface ServiceFlags {
  ptt:   boolean;
  video: boolean;
  data:  boolean;
}

export function serviceFlagsOf(g: McSdkGroupInfo): ServiceFlags {
  return { ptt: g.isPtt, video: g.isVideo, data: g.isData };
}

export function hasAnyService(f: ServiceFlags): boolean {
  return f.ptt || f.video || f.data;
}

export interface ActiveGroupInfo {
  name: string;
  callActive: boolean;
}

export type PushState = 'idle' | 'accepted' | 'occupied';

export interface GroupCallState {
  callActive: boolean;
  pushState: PushState;
  isHolding: boolean;
}

interface TalkContextValue {
  /**
   * Groups the user MAY affiliate to (SdkListener::onGroupsUpdated). The service
   * flags here mean "this service supports the group".
   */
  groups: McSdkGroupInfo[];
  /**
   * Groups currently affiliated (SdkListener::onAffiliationsUpdated). The service
   * flags here mean "the affiliation covers this service".
   */
  affiliatedGroups: McSdkGroupInfo[];
  /** Affiliated services per group id — the editor's starting state. */
  affiliationByGroup: Record<string, ServiceFlags>;
  /**
   * Publishes the complete desired affiliation set. Mirrors Sdk::Affiliate, which
   * is state-REPLACING: pass every group that should end up affiliated, not a
   * delta. A request with no services selected is dropped; an empty result
   * de-affiliates everything via deaffiliate().
   */
  applyAffiliation: (requests: McSdkAffiliateRequest[]) => void;
  /** True once the SDK has delivered a group list (i.e. registration completed). */
  groupsLoaded: boolean;
  /** MC services the user is registered for (SdkListener::onIdentityUpdated). */
  identityServices: ServiceFlags;
  activeGroups: ActiveGroupInfo[];
  setActiveGroups: (groups: ActiveGroupInfo[]) => void;
  pendingGroup: string | null;
  setPendingGroup: (group: string | null) => void;
  groupCalls: Record<string, GroupCallState>;
  setGroupCalls: React.Dispatch<React.SetStateAction<Record<string, GroupCallState>>>;
  /** Append-only list of groups that ever became active (activation order). */
  activationOrder: string[];
  /** Timestamp of when each group was last closed. */
  lastClosedAt: Record<string, number>;
  recordActivation: (group: string) => void;
  recordClose: (group: string) => void;
  /** True while the full-screen transmit (BroadcastScreen) view is open. */
  isBroadcasting: boolean;
  setIsBroadcasting: (v: boolean) => void;
}

const TalkContext = createContext<TalkContextValue | null>(null);

export function TalkContextProvider({ children }: { children: React.ReactNode }) {
  const { sdkRef, created } = useSdkContext();
  const [groups, setGroups] = useState<McSdkGroupInfo[]>([]);
  const [affiliatedGroups, setAffiliatedGroups] = useState<McSdkGroupInfo[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [identityServices, setIdentityServices] = useState<ServiceFlags>(
    { ptt: false, video: false, data: false },
  );
  const [activeGroups, setActiveGroups] = useState<ActiveGroupInfo[]>([]);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [groupCalls, setGroupCalls] = useState<Record<string, GroupCallState>>({});
  const [activationOrder, setActivationOrder] = useState<string[]>([]);
  const [lastClosedAt, setLastClosedAt] = useState<Record<string, number>>({});
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // The SDK pushes both lists — there is no getter. They arrive once registration
  // completes, so before that the Talk screen legitimately has no groups to show.
  //
  // `sdkRef` is deliberately not a dependency: it is a ref, so its `.current` is
  // read at effect time and its identity must not retrigger this effect.
  useEffect(() => {
    const sdk = sdkRef.current;
    if (!created || !sdk) {
      setGroups([]);
      setAffiliatedGroups([]);
      setGroupsLoaded(false);
      return;
    }
    const subs = [
      sdk.onGroupsUpdated(e => { setGroups(e.groups); setGroupsLoaded(true); }),
      sdk.onAffiliationsUpdated(e => setAffiliatedGroups(e.groups)),
      sdk.onIdentityUpdated(e => setIdentityServices({
        ptt: e.isPtt, video: e.isVideo, data: e.isData,
      })),
    ];
    return () => subs.forEach(s => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  const affiliationByGroup = useMemo(() => {
    const map: Record<string, ServiceFlags> = {};
    affiliatedGroups.forEach(g => { map[g.groupId] = serviceFlagsOf(g); });
    return map;
  }, [affiliatedGroups]);

  const applyAffiliation = useCallback((requests: McSdkAffiliateRequest[]) => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    // A request with no service selected means "not affiliated" — the SDK would
    // reject it, so express that by leaving the group out of the desired set.
    const desired = requests.filter(r => r.ptt || r.video || r.data);
    if (desired.length === 0) sdk.deaffiliate();
    else sdk.affiliate(desired);
  }, [sdkRef]);

  const recordActivation = useCallback((group: string) => {
    setActivationOrder(prev => prev.includes(group) ? prev : [...prev, group]);
  }, []);

  const recordClose = useCallback((group: string) => {
    setLastClosedAt(prev => ({ ...prev, [group]: Date.now() }));
  }, []);

  const value = useMemo<TalkContextValue>(
    () => ({ groups, affiliatedGroups, affiliationByGroup, applyAffiliation, groupsLoaded, identityServices, activeGroups, setActiveGroups, pendingGroup, setPendingGroup, groupCalls, setGroupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, isBroadcasting, setIsBroadcasting }),
    [groups, affiliatedGroups, affiliationByGroup, applyAffiliation, groupsLoaded, identityServices, activeGroups, pendingGroup, groupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, isBroadcasting],
  );

  return <TalkContext.Provider value={value}>{children}</TalkContext.Provider>;
}

export function useTalkContext(): TalkContextValue {
  const ctx = useContext(TalkContext);
  if (!ctx) {
    throw new Error('useTalkContext must be used inside <TalkContextProvider>');
  }
  return ctx;
}
