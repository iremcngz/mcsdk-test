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
  useRef,
  useState,
} from 'react';
import type { Screen } from '../shared/types';

/** The full-screen call views. They hide the tab bar, so leaving them needs care. */
const CALL_SCREENS: Screen[] = ['incall', 'callactive'];

export function isCallScreen(s: Screen): boolean {
  return CALL_SCREENS.includes(s);
}

interface NavigationContextValue {
  screen: Screen;
  setScreen: (s: Screen) => void;
  /**
   * Returns to whatever screen was showing before the call took over. Used when
   * a call ends — including when the *remote* party hangs up, where there is no
   * local action to navigate away. Without it the call screen renders nothing
   * and the tab bar stays hidden, leaving a blank page.
   */
  leaveCallScreen: () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationContextProvider({ children }: { children: React.ReactNode }) {
  const [screen, setScreenState] = useState<Screen>('home');
  // Where to go back to once the call is over. Only tracks non-call screens.
  const preCallScreen = useRef<Screen>('home');

  const setScreen = useCallback((s: Screen) => {
    setScreenState(prev => {
      // Remember the last ordinary screen as we enter a call view.
      if (isCallScreen(s) && !isCallScreen(prev)) preCallScreen.current = prev;
      return s;
    });
  }, []);

  const leaveCallScreen = useCallback(() => {
    setScreenState(prev => (isCallScreen(prev) ? preCallScreen.current : prev));
  }, []);

  const value = useMemo<NavigationContextValue>(
    () => ({ screen, setScreen, leaveCallScreen }),
    [screen, setScreen, leaveCallScreen],
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
