/**
 * features/talk/components/TalkMockPanel.tsx
 *
 * Dev/test overlay for TalkScreen — lets you drive floor state, toggle
 * incoming calls per group, and start/end a call without the real SDK.
 * Pure scaffolding: remove once the SDK provides real call/floor callbacks.
 */

import React from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import type { makeTalkStyles } from '../styles';
import type { Translations } from '../../../core/i18n';
import type { PushState } from '../../../contexts/TalkContext';

type TalkStyles = ReturnType<typeof makeTalkStyles>;

interface TalkMockPanelProps {
  styles: TalkStyles;
  tr: Translations;
  orderedGroups: string[];
  incomingCalls: Set<string>;
  onClose: () => void;
  setPushState: (s: PushState) => void;
  setOccupiedSpeaker: (name: string) => void;
  setIncomingCalls: (next: Set<string>) => void;
  setCallActive: (active: boolean) => void;
  setIsHolding: (holding: boolean) => void;
}

export function TalkMockPanel({
  styles,
  tr,
  orderedGroups,
  incomingCalls,
  onClose,
  setPushState,
  setOccupiedSpeaker,
  setIncomingCalls,
  setCallActive,
  setIsHolding,
}: TalkMockPanelProps) {
  return (
    <View style={styles.mockOverlay}>
      <Pressable style={styles.mockBackdrop} onPress={onClose} />
      <View style={styles.mockCard}>
        <View style={styles.mockHeader}>
          <Text style={styles.mockTitle}>{tr.talkMockPanelTitle}</Text>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.8}
            style={styles.mockCloseButton}
            testID="talk-mock-close">
            <Text style={styles.mockCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.mockSectionLabel}>Floor</Text>
        <View style={styles.mockRow}>
          <TouchableOpacity
            testID="talk-mock-accept"
            onPress={() => setPushState('accepted')}
            activeOpacity={0.8}
            style={[styles.mockButton, styles.mockButtonPrimary]}>
            <Text style={styles.mockButtonText}>{tr.talkMockAccept}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="talk-mock-occupy"
            onPress={() => { setPushState('occupied'); setOccupiedSpeaker('Alice'); }}
            activeOpacity={0.8}
            style={[styles.mockButton, styles.mockButtonDanger]}>
            <Text style={styles.mockButtonText}>{tr.talkMockOccupy}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="talk-mock-reset"
            onPress={() => setPushState('idle')}
            activeOpacity={0.8}
            style={[styles.mockButton, styles.mockButtonReset]}>
            <Text style={[styles.mockButtonText, styles.mockButtonTextReset]}>{tr.talkMockReset}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.mockSectionLabel}>Incoming Calls</Text>
        <View style={styles.mockRow}>
          {orderedGroups.map(g => {
            const hasCall = incomingCalls.has(g);
            return (
              <TouchableOpacity
                key={g}
                testID={`talk-mock-incoming-${g}`}
                onPress={() => {
                  const next = new Set(incomingCalls);
                  if (hasCall) next.delete(g); else next.add(g);
                  setIncomingCalls(next);
                }}
                activeOpacity={0.8}
                style={[styles.mockButton, hasCall ? styles.mockButtonPrimary : styles.mockButtonReset]}>
                <Text style={[styles.mockButtonText, !hasCall && styles.mockButtonTextReset]}>{g}{hasCall ? ' 🔔' : ''}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.mockSectionLabel}>Call</Text>
        <View style={styles.mockRow}>
          <TouchableOpacity
            onPress={() => { setCallActive(true); setPushState('idle'); }}
            activeOpacity={0.8}
            style={[styles.mockButton, styles.mockButtonPrimary]}>
            <Text style={styles.mockButtonText}>Start</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setCallActive(false); setPushState('idle'); setIsHolding(false); }}
            activeOpacity={0.8}
            style={[styles.mockButton, styles.mockButtonDanger]}>
            <Text style={styles.mockButtonText}>End</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setOccupiedSpeaker('Bob'); setPushState('occupied'); }}
            activeOpacity={0.8}
            style={[styles.mockButton, styles.mockButtonReset]}>
            <Text style={[styles.mockButtonText, styles.mockButtonTextReset]}>Bob</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
