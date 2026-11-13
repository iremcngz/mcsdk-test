import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { LocalVideoView } from '../video/LocalVideoView';
import type { VideoSendNotice } from './useGroupVideoSend';

interface BroadcastScreenProps {
  group: string;
  /** The user has pressed the record button; the server may not have allowed it yet. */
  requested: boolean;
  /** Frames are going out: this, not the press, is what REC and its timer show. */
  isTransmitting: boolean;
  notice: VideoSendNotice | null;
  onToggleTransmit: () => void;
  onStop: () => void;
}

export function BroadcastScreen({ group, requested, isTransmitting, notice, onToggleTransmit, onStop }: BroadcastScreenProps) {
  const { c, tr } = useAppContext();
  const insets = useSafeAreaInsets();

  const noticeText = notice === 'TIME_UP' ? tr.talkVideoTimeUp
    : notice === 'FAILED' ? tr.talkVideoFailed
    : notice === 'ENDED' ? tr.talkVideoEnded
    : null;

  const [isPttPressed, setIsPttPressed] = useState(false);
  // The video sender has the back camera; it cannot switch yet, so this changes nothing.
  const [, setIsFrontCamera] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pttElapsed, setPttElapsed] = useState(0);
  const [isSomeoneElseTalking, setIsSomeoneElseTalking] = useState(false); // gerçek uygulamada socket/context'ten gelecek
  const pttScale = useRef(new Animated.Value(1)).current;
  const recPulse = useRef(new Animated.Value(1)).current;

  // Timer only runs while transmitting; resets when recording starts
  useEffect(() => {
    if (!isTransmitting) { return; }
    setElapsed(0);
    const tick = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(tick);
  }, [isTransmitting]);

  useEffect(() => {
    if (!isTransmitting) { recPulse.setValue(1); return; }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(recPulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(recPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isTransmitting, recPulse]);

  useEffect(() => {
    if (!isPttPressed) { setPttElapsed(0); return; }
    const tick = setInterval(() => setPttElapsed(s => s + 1), 1000);
    return () => clearInterval(tick);
  }, [isPttPressed]);

  const handlePttIn = () => {
    if (isSomeoneElseTalking) return;
    setIsPttPressed(true);
    Animated.spring(pttScale, { toValue: 0.92, friction: 6, useNativeDriver: true }).start();
  };

  const handlePttOut = () => {
    setIsPttPressed(false);
    Animated.spring(pttScale, { toValue: 1, friction: 6, useNativeDriver: true }).start();
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    camera: {
      ...StyleSheet.absoluteFill,
    },
    topBar: {
      // Never above the screen: with no inset that would take the ✕ out of reach.
      position: 'absolute', top: Math.max(insets.top - 35, 12), left: 16, right: 16,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    recBadge: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, gap: 6,
    },
    recDot: {
      width: 9, height: 9, borderRadius: 5,
      backgroundColor: c.error,
    },
    recText: {
      color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1,
    },
    timer: {
      color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', marginLeft: 4,
      fontVariant: ['tabular-nums'] as any,
    },
    groupLabel: {
      // A group's URI is long: it gives way, or it pushes the ✕ off the screen.
      flexShrink: 1, marginHorizontal: 8,
      color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600',
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 14, paddingVertical: 4, borderRadius: 12,
      letterSpacing: 0.5,
    },
    bottomBar: {
      position: 'absolute', bottom: insets.bottom, left: 0, right: 0,
      flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
      paddingHorizontal: 30,
    },
    sideButton: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: 'rgba(255,255,255,0.15)',
      justifyContent: 'center', alignItems: 'center',
    },
    sideButtonActive: {
      backgroundColor: c.error,
    },
    sideButtonIcon: {
      fontSize: 22,
    },
    pttWrapper: {
      marginHorizontal: 30,
    },
    pttButton: {
      width: 76, height: 76, borderRadius: 38,
      backgroundColor: isSomeoneElseTalking
        ? 'rgba(211, 47, 47, 0.85)'
        : isPttPressed
          ? 'rgba(76, 175, 80, 0.85)'
          : 'rgba(255,255,255,0.2)',
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 2,
      borderColor: isSomeoneElseTalking
        ? 'rgba(255,100,100,0.5)'
        : 'rgba(255,255,255,0.3)',
    },
    pttIcon: {
      fontSize: 28,
    },
    pttLabel: {
      color: isSomeoneElseTalking ? 'rgba(255,120,120,0.8)' : 'rgba(255,255,255,0.4)',
      fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: 4,
      fontVariant: ['tabular-nums'] as any,
    },
    stopButton: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center', alignItems: 'center',
    },
    stopIcon: {
      color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '700',
    },
    notice: {
      position: 'absolute', top: '45%', alignSelf: 'center',
      color: c.textPrimary, fontSize: 15, fontWeight: '600',
      backgroundColor: c.surface,
      paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, overflow: 'hidden',
    },
  } as Record<string, any>);

  return (
    <View style={s.root}>
      {/* The picture being sent: useGroupVideoSend runs the camera while this view is open. */}
      <LocalVideoView style={StyleSheet.absoluteFill} />

      <View style={s.topBar}>
        <View style={s.recBadge}>
          <Animated.View style={[s.recDot, { opacity: isTransmitting ? recPulse : 0.3 }]} />
          <Text style={s.recText}>{isTransmitting ? 'REC' : 'STANDBY'}</Text>
          {isTransmitting && <Text style={s.timer}>{formatTime(elapsed)}</Text>}
        </View>
        <Text style={s.groupLabel} numberOfLines={1}>{group}</Text>
        <TouchableOpacity style={s.stopButton} onPress={onStop} activeOpacity={0.7}>
          <Text style={s.stopIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      {noticeText && <Text style={s.notice} testID="talk-broadcast-notice">{noticeText}</Text>}

      <View style={s.bottomBar}>
        <TouchableOpacity
          style={[s.sideButton, requested && s.sideButtonActive]}
          onPress={onToggleTransmit}
          activeOpacity={0.7}
          testID="talk-broadcast-record">
          <Text style={s.sideButtonIcon}>{requested ? '⏹️' : '🔴'}</Text>
        </TouchableOpacity>

        <View style={s.pttWrapper}>
          <Animated.View style={{ transform: [{ scale: pttScale }] }}>
            <Pressable
              onPressIn={handlePttIn}
              onPressOut={handlePttOut}
              style={s.pttButton}>
              <Text style={s.pttIcon}>🎙️</Text>
            </Pressable>
          </Animated.View>
          <Text style={s.pttLabel}>
            {isSomeoneElseTalking
              ? 'Busy...'
              : isPttPressed
                ? formatTime(pttElapsed)
                : 'Hold to talk'}
          </Text>
        </View>

        <TouchableOpacity
          style={s.sideButton}
          onPress={() => setIsFrontCamera(prev => !prev)}
          onLongPress={() => setIsSomeoneElseTalking(prev => !prev)}
          activeOpacity={0.7}>
          <Text style={s.sideButtonIcon}>↺</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

