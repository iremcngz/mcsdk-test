/**
 * MCSDK Test App — Tests init() and setParams() via TurboModule bridge.
 * @format
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppContextProvider, useAppContext } from './src/contexts/AppContext';
import { LogContextProvider } from './src/contexts/LogContext';
import { SdkContextProvider } from './src/contexts/SdkContext';
import { CallContextProvider } from './src/contexts/CallContext';
import { NavigationContextProvider } from './src/contexts/NavigationContext';
import { TalkContextProvider } from './src/contexts/TalkContext';
import { TabNavigator } from './src/navigation/TabNavigator';
import LoginScreen from './src/features/auth/LoginScreen';

/** Renders the login screen until the user authenticates. Once logged in,
 *  SdkContextProvider mounts (clean state) and the main UI is shown.
 *  SdkContextProvider unmounts on logout, ensuring SDK state is fully reset.
 *  LogContextProvider sits outside it: SdkContext writes its lines there, and
 *  the console is emptied on logout along with everything else. */
function AppGate() {
  const { isLoggedIn } = useAppContext();
  if (!isLoggedIn) {
    return <LoginScreen />;
  }
  return (
    <LogContextProvider>
      <SdkContextProvider>
        <CallContextProvider>
          <TalkContextProvider>
            <NavigationContextProvider>
              <TabNavigator />
            </NavigationContextProvider>
          </TalkContextProvider>
        </CallContextProvider>
      </SdkContextProvider>
    </LogContextProvider>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <AppContextProvider>
        <AppGate />
      </AppContextProvider>
    </SafeAreaProvider>
  );
}

export default App;
