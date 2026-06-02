/**
 * contexts/NavigationContext.tsx
 *
 * Lightweight context so any component (e.g. ContactsScreen) can
 * programmatically switch the active tab without prop-drilling.
 *
 * TabNavigator reads `screen` and `setScreen` from here instead of
 * keeping them in local state.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { Screen } from '../shared/types';

interface NavigationContextValue {
  screen: Screen;
  setScreen: (s: Screen) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationContextProvider({ children }: { children: React.ReactNode }) {
  const [screen, setScreenState] = useState<Screen>('home');

  const setScreen = useCallback((s: Screen) => {
    setScreenState(s);
  }, []);

  const value = useMemo<NavigationContextValue>(
    () => ({ screen, setScreen }),
    [screen, setScreen],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used inside <NavigationContextProvider>');
  }
  return ctx;
}
