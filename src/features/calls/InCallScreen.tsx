import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';

export function InCallScreen() {
  const { c, theme } = useAppContext();
  const { activeCall, endCall, simulateAnswer } = useCallContext();
  const { setScreen } = useNavigation();
  const insets = useSafeAreaInsets();

  const [isClosing, setIsClosing] = useState(false);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const isDark = theme === 'dark';

  useEffect(() => {
    if (activeCall?.state === 'connecting') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.30, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulse.setValue(1);
    }
  }, [activeCall?.state, pulse]);

  // If call becomes active while on this screen, navigate to callactive
  useEffect(() => {
    if (activeCall?.state === 'active' && !isClosing) {
      setScreen('callactive');
    }
  }, [activeCall?.state, setScreen, isClosing]);

  const handleEndCall = () => {
    if (isClosing) return;
    setIsClosing(true);

    Animated.sequence([
      Animated.delay(500),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      endCall();
      setScreen('contacts');
    });
  };

  const handleAnswer = () => {
    simulateAnswer();
    // Navigation will happen via the effect above when state becomes 'active'
  };

  const s = useMemo(() => StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      paddingTop: insets.top + 60,
      paddingBottom: insets.bottom + 50,
      paddingHorizontal: 32,
      alignItems: 'center',
    },
    avatarRing: {
      width: 110,
      height: 110,
      borderRadius: 55,
      backgroundColor: c.surface,
      borderWidth: 3,
      borderColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    avatarIcon: {
      fontSize: 48,
    },
    contactName: {
      fontSize: 30,
      fontWeight: '700',
      color: c.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
    },
    statusText: {
      fontSize: 18,
      fontWeight: '500',
      color: c.textSecondary,
      marginTop: 16,
      letterSpacing: 1,
    },
    spacer: {
      flex: 1,
    },
    mockAnswerBtn: {
      paddingHorizontal: 32,
      paddingVertical: 14,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 24,
    },
    mockAnswerText: {
      fontSize: 15,
      fontWeight: '600',
      color: c.textSecondary,
    },
    endCallButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: c.error,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.error,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 10,
    },
    endCallIcon: {
      fontSize: 28,
      color: '#fff',
    },
    endCallLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textSecondary,
      marginTop: 8,
    },
  }), [c, insets, isDark]);

  if (!activeCall || activeCall.state !== 'connecting') return null;

  return (
    <Animated.View style={[s.root, { opacity: blinkAnim }]}>
      <Animated.View style={[s.avatarRing, { transform: [{ scale: pulse }] }]}>
        <Text style={s.avatarIcon}>👤</Text>
      </Animated.View>

      <Text style={s.contactName} numberOfLines={1}>
        {activeCall.contactName}
      </Text>

      <Text style={s.statusText}>{isClosing ? 'Closed' : 'Calling…'}</Text>

      <View style={s.spacer} />

      <TouchableOpacity 
        style={[s.mockAnswerBtn, isClosing && { opacity: 0.5 }]} 
        onPress={isClosing ? undefined : handleAnswer} 
        disabled={isClosing}
        activeOpacity={0.6}>
        <Text style={s.mockAnswerText}>Simulate Answer</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[s.endCallButton, isClosing && { opacity: 0.5 }]} 
        onPress={handleEndCall} 
        disabled={isClosing}
        activeOpacity={0.8}>
        <Text style={s.endCallIcon}>📞</Text>
      </TouchableOpacity>
      <Text style={s.endCallLabel}>End Call</Text>
    </Animated.View>
  );
}
