import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { makeOutgoingCallStyles } from './styles';

/**
 * features/calls/OutgoingCallScreen.tsx
 *
 * Shown while an outgoing call is connecting (state === 'connecting').
 * Displays "Calling…" with a Simulate Answer control. Once the call becomes
 * active it navigates to the full-screen ActiveCallFullScreen ('callactive').
 */
export function OutgoingCallScreen() {
  const { c } = useAppContext();
  const { activeCall, endCall, simulateAnswer } = useCallContext();
  const { setScreen } = useNavigation();
  const insets = useSafeAreaInsets();

  const [isClosing, setIsClosing] = useState(false);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;

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

  const s = useMemo(() => makeOutgoingCallStyles(c, insets), [c, insets]);

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
