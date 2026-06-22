/**
 * features/calls/ActiveCallCard.tsx
 *
 * Compact in-tab view of an active (or connecting) call, rendered inside the
 * Calls tab by CallsTab. Distinct from ActiveCallFullScreen, which shows the
 * same call full-screen via the 'callactive' route.
 *
 * Floor button color/behavior:
 *   idle    → blue   (c.primary)  → tap to request floor
 *   granted → green  (c.success)  → tap to release floor
 *   busy    → red    (c.error)    → disabled (other party speaking)
 *
 * Commencement modes:
 *   auto   → call goes active immediately (state === 'active')
 *   manual → call waits for user to press "Join" (needsManualJoin === true)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import type { FloorState } from './types';
import { makeCallStyles, makeMockActiveCallControlsStyles } from './styles';

export function ActiveCallCard() {
  const { c, tr } = useAppContext();
  const { activeCall, endCall, setFloorState, joinCall,
          simulateFloorBusy, simulateFloorIdle } = useCallContext();
  const s = useMemo(() => makeCallStyles(c), [c]);

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'active' || isClosing) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(Math.round((Date.now() - activeCall.startedAt) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeCall?.state, activeCall?.startedAt, isClosing]);

  if (!activeCall) return null;

  // ── Floor button config ────────────────────────────────────────────────────
  const floorConfig: Record<FloorState, {
    bg: string; icon: string; label: string; onPress: (() => void) | undefined;
  }> = {
    idle:    { bg: c.primary,  icon: '🎙️', label: tr.floorIdle,    onPress: () => setFloorState('granted') },
    granted: { bg: c.success,  icon: '🎙️', label: tr.floorGranted, onPress: () => setFloorState('idle')    },
    busy:    { bg: c.error,    icon: '🔇', label: tr.floorBusy,    onPress: undefined                       },
  };
  const floor = floorConfig[activeCall.floorState];

  const handleEndCall = () => {
    if (isClosing) return;
    setIsClosing(true);
    if (intervalRef.current) clearInterval(intervalRef.current);

    Animated.sequence([
      Animated.delay(500),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      endCall();
    });
  };

  // ── State label ────────────────────────────────────────────────────────────
  const stateLabel =
    isClosing ? 'Closed' :
    activeCall.state === 'connecting' ? tr.callConnecting :
    activeCall.state === 'ending'     ? tr.callEnding     :
    tr.callActive;

  const typeLabel = activeCall.callType === 'half_duplex' ? tr.callTypeHD : tr.callTypeFD;

  const commencementLabel =
    activeCall.commencementMode === 'auto' ? tr.commencementAuto : tr.commencementManual;

  return (
    <Animated.View style={[s.screen, { opacity: blinkAnim }]}>
      {/* ── Call info card ─────────────────────────────────────────────────── */}
      <View style={s.callCard}>
        {/* Commencement badge */}
        <View style={[s.pill, s.commencementPill,
          { backgroundColor: activeCall.commencementMode === 'auto' ? c.primary : c.warn }]}>
          <Text style={s.pillText}>{commencementLabel}</Text>
        </View>

        <Text style={s.contactName}>{activeCall.contactName}</Text>
        <Text style={s.sipUri}>{activeCall.sipUri}</Text>

        <View style={s.callStateBadge}>
          <View style={[s.pill, { backgroundColor: c.border }]}>
            <Text style={[s.pillText, { color: c.textSecondary }]}>{typeLabel}</Text>
          </View>
          <Text style={s.stateText}>{stateLabel}</Text>
          {(activeCall.state === 'active' || isClosing) && (
            <Text style={s.timerText}>{isClosing ? 'Closed' : tr.callDuration(elapsed)}</Text>
          )}
        </View>
      </View>

      {/* ── Manual join banner ─────────────────────────────────────────────── */}
      {activeCall.needsManualJoin && (
        <TouchableOpacity style={s.joinButton} onPress={isClosing ? undefined : joinCall} disabled={isClosing} activeOpacity={0.8}>
          <Text style={s.joinButtonText}>📞  {tr.btnJoinCall}</Text>
        </TouchableOpacity>
      )}

      {/* ── Floor button ───────────────────────────────────────────────────── */}
      {!activeCall.needsManualJoin && (
        <View style={s.floorButtonWrap}>
          <TouchableOpacity
            style={[s.floorButton, { backgroundColor: floor.bg }, isClosing && { opacity: 0.5 }]}
            onPress={isClosing ? undefined : floor.onPress}
            disabled={!floor.onPress || isClosing}
            activeOpacity={floor.onPress && !isClosing ? 0.75 : 1}>
            <Text style={s.floorButtonIcon}>{floor.icon}</Text>
            <Text style={s.floorButtonLabel}>{floor.label}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Mock active-call controls ────────────────────────────────────── */}
      <MockActiveCallControls
        onFloorBusy={simulateFloorBusy}
        onFloorIdle={simulateFloorIdle}
        onRemoteHangup={handleEndCall}
        tr={tr}
        c={c}
      />

      {/* ── End call button ─────────────────────────────────────────────────── */}
      <View style={{ flex: 1 }} />
      <TouchableOpacity 
        style={[s.endCallButton, isClosing && { opacity: 0.5 }]} 
        onPress={handleEndCall} 
        disabled={isClosing}
        activeOpacity={0.8}>
        <Text style={s.endCallText}>📵  {isClosing ? 'Closed' : tr.btnEndCall}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Inline mock controls component ────────────────────────────────────────────

interface MockActiveCallControlsProps {
  onFloorBusy: () => void;
  onFloorIdle: () => void;
  onRemoteHangup: () => void;
  tr: ReturnType<typeof import('../../core/i18n').getTranslation>;
  c: import('../../core/theme').ThemePalette;
}

function MockActiveCallControls({ onFloorBusy, onFloorIdle, onRemoteHangup, tr, c }: MockActiveCallControlsProps) {
  const [expanded, setExpanded] = useState(false);

  const ms = useMemo(() => makeMockActiveCallControlsStyles(c), [c]);

  return (
    <View style={ms.card}>
      <TouchableOpacity
        style={ms.header}
        onPress={() => setExpanded(p => !p)}
        activeOpacity={0.8}>
        <Text style={ms.headerTitle}>{tr.mockPanelTitle}</Text>
        <Text style={ms.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={ms.body}>
          <TouchableOpacity style={[ms.btn, { backgroundColor: c.error }]}   onPress={onFloorBusy}    activeOpacity={0.8}><Text style={ms.btnText}>🔇 {tr.mockFloorBusy}</Text></TouchableOpacity>
          <TouchableOpacity style={[ms.btn, { backgroundColor: c.primary }]} onPress={onFloorIdle}    activeOpacity={0.8}><Text style={ms.btnText}>🎙️ {tr.mockFloorIdle}</Text></TouchableOpacity>
          <TouchableOpacity style={[ms.btn, { backgroundColor: c.textSecondary }]} onPress={onRemoteHangup} activeOpacity={0.8}><Text style={ms.btnText}>📵 {tr.mockRemoteHangup}</Text></TouchableOpacity>
        </View>
      )}
    </View>
  );
}
