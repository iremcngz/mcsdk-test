import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface ActiveGroupInfo {
  name: string;
  callActive: boolean;
}

interface TalkContextValue {
  activeGroups: ActiveGroupInfo[];
  setActiveGroups: (groups: ActiveGroupInfo[]) => void;
  pendingGroup: string | null;
  setPendingGroup: (group: string | null) => void;
}

const TalkContext = createContext<TalkContextValue | null>(null);

export function TalkContextProvider({ children }: { children: React.ReactNode }) {
  const [activeGroups, setActiveGroups] = useState<ActiveGroupInfo[]>([]);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);

  const value = useMemo<TalkContextValue>(
    () => ({ activeGroups, setActiveGroups, pendingGroup, setPendingGroup }),
    [activeGroups, pendingGroup],
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
