/**
 * features/calls/CallsTab.tsx
 *
 * Root of the Calls tab.
 * - When a call is active (or connecting/ending) → shows ActiveCallScreen.
 * - Otherwise → shows CallHistoryScreen.
 *
 * A small "Connecting…" banner appears at the top while state === 'connecting'.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { ActiveCallScreen } from './ActiveCallScreen';
import { IncomingCallScreen } from './IncomingCallScreen';
import { CallHistoryScreen } from './CallHistoryScreen';

export function CallsTab() {
  const { c, tr } = useAppContext();
  const { activeCall } = useCallContext();

  const bannerStyles = useMemo(() => StyleSheet.create({
    banner: {
      backgroundColor: c.warn,
      paddingVertical: 6,
      alignItems: 'center',
    },
    bannerText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#fff',
    },
  }), [c]);

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
          ? <ActiveCallScreen />
          : <CallHistoryScreen />
      }
    </View>
  );
}
