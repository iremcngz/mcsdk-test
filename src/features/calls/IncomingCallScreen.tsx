/**
 * features/calls/IncomingCallScreen.tsx
 *
 * Shown when activeCall.state === 'ringing'.
 * Accept (green) → moves to active / join-banner flow.
 * Reject (red)   → dismisses and saves a 0-duration record.
 *
 * The pulsing ring is a pure-RN Animated.loop — no third-party libs needed.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { makeCallStyles, makeIncomingCallScreenStyles } from './styles';

export function IncomingCallScreen() {
  const { c, tr } = useAppContext();
  const { activeCall, acceptCall, rejectCall } = useCallContext();
  const s = useMemo(() => makeCallStyles(c), [c]);
  const ls = useMemo(() => makeIncomingCallScreenStyles(c), [c]);

  // ── Pulsing ring animation ─────────────────────────────────────────────────
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.18, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (!activeCall) return null;

  const typeLabel = activeCall.callType === 'half_duplex' ? tr.callTypeHD : tr.callTypeFD;

  return (
    <View style={ls.screen}>
      <Text style={ls.callLabel}>{tr.callIncoming}</Text>

      {/* Pulsing ring */}
      <Animated.View style={[ls.ringWrap, { transform: [{ scale: pulse }] }]}>
        <Text style={ls.ringIcon}>📞</Text>
      </Animated.View>

      <Text style={ls.name}>{activeCall.contactName}</Text>
      <Text style={ls.uri}>{activeCall.sipUri}</Text>

      <View style={[s.pill, { backgroundColor: c.border }]}>
        <Text style={[s.pillText, { color: c.textSecondary }]}>{typeLabel}</Text>
      </View>

      {/* Accept / Reject row */}
      <View style={ls.actions}>
        {/* Reject */}
        <View style={ls.actionWrap}>
          <TouchableOpacity
            style={[ls.actionBtn, { backgroundColor: c.error }]}
            onPress={rejectCall}
            activeOpacity={0.8}>
            <Text style={ls.actionIcon}>📵</Text>
          </TouchableOpacity>
          <Text style={ls.actionLabel}>{tr.btnRejectCall}</Text>
        </View>

        {/* Accept */}
        <View style={ls.actionWrap}>
          <TouchableOpacity
            style={[ls.actionBtn, { backgroundColor: c.success }]}
            onPress={acceptCall}
            activeOpacity={0.8}>
            <Text style={ls.actionIcon}>📞</Text>
          </TouchableOpacity>
          <Text style={ls.actionLabel}>{tr.btnAcceptCall}</Text>
        </View>
      </View>
    </View>
  );
}
