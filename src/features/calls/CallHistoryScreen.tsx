/**
 * features/calls/CallHistoryScreen.tsx
 *
 * Shows a reverse-chronological list of completed calls.
 * "Geri Ara / Call Back" re-initiates a call using the same type as the
 * historical record and the app's current commencement mode.
 */

import React, { useMemo } from 'react';
import {
  Alert,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { CallRecord } from './types';
import { makeCallStyles } from './styles';
import { MockCallsPanel } from './MockCallsPanel';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  }) + '  ' + d.toLocaleTimeString(undefined, {
    hour:   '2-digit',
    minute: '2-digit',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CallHistoryScreen() {
  const { c, tr } = useAppContext();
  const { callHistory, clearHistory, startCall } = useCallContext();
  const { setScreen } = useNavigation();
  const s = useMemo(() => makeCallStyles(c), [c]);

  function handleCallBack(record: CallRecord) {
    startCall(record.contactName, record.sipUri, record.callType);
    setScreen('calls');
  }

  function handleClear() {
    Alert.alert(
      tr.callHistoryTitle,
      tr.callHistoryEmpty,
      [
        { text: tr.alertCancel, style: 'cancel' },
        { text: tr.btnClearHistory, style: 'destructive', onPress: clearHistory },
      ],
    );
  }

  const renderItem = ({ item }: { item: CallRecord }) => {
    const isOut    = item.direction === 'outgoing';
    const typeLabel = item.callType === 'half_duplex' ? 'HD' : 'FD';

    return (
      <View style={s.historyItem}>
        {/* Direction arrow */}
        <Text style={[s.directionArrow, { color: isOut ? c.primary : c.success }]}>
          {isOut ? '↗' : '↙'}
        </Text>

        {/* Body */}
        <View style={s.historyItemBody}>
          <Text style={s.historyContactName}>{item.contactName}</Text>
          <Text style={s.historySipUri}>{item.sipUri}</Text>
          <View style={s.historyMeta}>
            <View style={[s.pill, { backgroundColor: c.border }]}>
              <Text style={[s.pillText, { color: c.textSecondary }]}>{typeLabel}</Text>
            </View>
            <Text style={s.historyMetaText}>{formatDate(item.startedAt)}</Text>
            <Text style={s.historyMetaText}>· {tr.callDuration(item.duration)}</Text>
          </View>
        </View>

        {/* Call-back button */}
        <TouchableOpacity
          style={s.callBackBtn}
          onPress={() => handleCallBack(item)}
          activeOpacity={0.8}>
          <Text style={s.callBackBtnText}>📞</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={s.screen}>
      {/* Header */}
      <View style={s.historyHeader}>
        <Text style={s.historyTitle}>{tr.callHistoryTitle}</Text>
        {callHistory.length > 0 && (
          <TouchableOpacity style={s.clearBtn} onPress={handleClear} activeOpacity={0.8}>
            <Text style={s.clearBtnText}>{tr.btnClearHistory}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Count */}
      {callHistory.length > 0 && (
        <Text style={s.countText}>{tr.callHistoryCount(callHistory.length)}</Text>
      )}

      {/* Empty state */}
      {callHistory.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyIcon}>📞</Text>
          <Text style={s.emptyText}>{tr.callHistoryEmpty}</Text>
        </View>
      ) : (
        <FlatList
          data={callHistory}
          keyExtractor={item => item.id}
          renderItem={renderItem}
        />
      )}

      {/* Mock control panel — always visible at bottom */}
      <MockCallsPanel />
    </View>
  );
}
