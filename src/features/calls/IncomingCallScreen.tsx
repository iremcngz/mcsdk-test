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
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { makeCallStyles } from './styles';

export function IncomingCallScreen() {
  const { c, tr } = useAppContext();
  const { activeCall, acceptCall, rejectCall } = useCallContext();
  const s = useMemo(() => makeCallStyles(c), [c]);

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

  const ls = StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      paddingHorizontal: 32,
    },
    callLabel: {
      fontSize: 14,
      color: c.textSecondary,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    ringWrap: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: c.primary + '22',
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringIcon: {
      fontSize: 52,
    },
    name: {
      fontSize: 26,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
    },
    uri: {
      fontSize: 13,
      color: c.textSecondary,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      gap: 40,
      marginTop: 24,
    },
    actionBtn: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 5,
    },
    actionIcon: {
      fontSize: 28,
    },
    actionLabel: {
      fontSize: 12,
      fontWeight: '600',
      marginTop: 6,
      color: c.textSecondary,
    },
    actionWrap: {
      alignItems: 'center',
    },
  });

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
