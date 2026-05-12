/**
 * MCSDK Test App — Tests init() and setParams() via TurboModule bridge.
 * @format
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppContextProvider, useAppContext } from './src/contexts/AppContext';
import { SdkContextProvider } from './src/contexts/SdkContext';
import { TabNavigator } from './src/navigation/TabNavigator';
import LoginScreen from './src/features/auth/LoginScreen';

/** Renders the login screen until the user authenticates. Once logged in,
 *  SdkContextProvider mounts (clean state) and the main UI is shown.
 *  SdkContextProvider unmounts on logout, ensuring SDK state is fully reset. */
function AppGate() {
  const { isLoggedIn } = useAppContext();
  if (!isLoggedIn) {
    return <LoginScreen />;
  }
  return (
    <SdkContextProvider>
      <TabNavigator />
    </SdkContextProvider>
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
