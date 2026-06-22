import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
  const [activeGroups, setActiveGroups] = useState<ActiveGroupInfo[]>([]);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [groupCalls, setGroupCalls] = useState<Record<string, GroupCallState>>({});
  const [activationOrder, setActivationOrder] = useState<string[]>([]);
  const [lastClosedAt, setLastClosedAt] = useState<Record<string, number>>({});
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const recordActivation = useCallback((group: string) => {
    setActivationOrder(prev => prev.includes(group) ? prev : [...prev, group]);
  }, []);

  const recordClose = useCallback((group: string) => {
    setLastClosedAt(prev => ({ ...prev, [group]: Date.now() }));
  }, []);

  const value = useMemo<TalkContextValue>(
    () => ({ activeGroups, setActiveGroups, pendingGroup, setPendingGroup, groupCalls, setGroupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, isBroadcasting, setIsBroadcasting }),
    [activeGroups, pendingGroup, groupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, isBroadcasting],
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
