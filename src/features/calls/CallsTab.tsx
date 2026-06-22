/**
 * features/calls/CallsTab.tsx
 *
 * Root of the Calls tab.
 * - When a call is active (or connecting/ending) → shows ActiveCallCard.
 * - Otherwise → shows CallHistoryScreen.
 *
 * A small "Connecting…" banner appears at the top while state === 'connecting'.
 */

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { ActiveCallCard } from './ActiveCallCard';
import { IncomingCallScreen } from './IncomingCallScreen';
import { CallHistoryScreen } from './CallHistoryScreen';
import { makeCallsTabStyles } from './styles';

export function CallsTab() {
  const { c, tr } = useAppContext();
  const { activeCall } = useCallContext();

  const bannerStyles = useMemo(() => makeCallsTabStyles(c), [c]);

  return (
    <View style={{ flex: 1 }}>
      {/* Connecting banner */}
      {activeCall?.state === 'connecting' && (
        <View style={bannerStyles.banner}>
          <Text style={bannerStyles.bannerText}>{tr.callConnecting}</Text>
        </View>
      )}

      {activeCall?.state === 'ringing'
        ? <IncomingCallScreen />
        : activeCall
          ? <ActiveCallCard />
          : <CallHistoryScreen />
      }
    </View>
  );
}
