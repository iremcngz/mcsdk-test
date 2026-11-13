/**
 * features/logs/LogConsoleScreen.tsx — the app's log console, as its own screen.
 *
 * This is what you read while diagnosing a malformed request — `adb logcat`
 * truncates PJSIP message bodies, these lines do not — and a 200px box inside
 * Home's shared scroll view is not enough of it. Home has such a box again,
 * under its registration progress, but it holds the last 40 entries only; the
 * whole 5000-entry buffer is here, reached from Tools. Same `sdk.logs` buffer
 * behind both, so either Clear empties the other.
 *
 * Two views, as on Home: every entry, or **Listener only** — the SDK callbacks
 * and their payloads (`src/mcsdk/listenerLog.ts`). The filter matters because
 * the two share one 5000-entry buffer and the SDK emits ~450 lines/s, which
 * evicts a listener event in about 11 s.
 *
 * The list is a `FlatList`, not the plain `ScrollView` Home used: at 5000
 * entries that mapped every one of them to its own mounted `<Text>`.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { makeLogConsoleStyles } from './styles';
import type { LogEntry } from '../../shared/types';

export function LogConsoleScreen() {
  const { c, tr }  = useAppContext();
  const sdk        = useSdkContext();
  const insets     = useSafeAreaInsets();
  const s          = useMemo(() => makeLogConsoleStyles(c), [c]);
  const listRef    = useRef<FlatList<LogEntry>>(null);

  const [listenerOnly, setListenerOnly] = useState(false);
  const shownLogs = listenerOnly ? sdk.listenerLogs : sdk.logs;

  const renderItem = useCallback(({ item }: { item: LogEntry }) => (
    <Text
      style={[
        s.line,
        item.level === 'error' && s.error,
        item.level === 'warn'  && s.warn,
        item.level === 'sdk'   && s.sdk,
      ]}>
      <Text style={s.time}>{item.time} </Text>
      {item.msg}
    </Text>
  ), [s]);

  const filters: { key: boolean; label: string }[] = [
    { key: false, label: tr.btnLogsAll },
    { key: true,  label: tr.btnLogsListener },
  ];

  return (
    <View style={[s.root, { paddingBottom: insets.bottom + 12 }]}>
      <View style={s.toolbar}>
        <Text style={s.hint}>{tr.sdkLogHint(shownLogs.length)}</Text>
        <TouchableOpacity
          testID="log-console-clear"
          onPress={sdk.clearLogs}
          activeOpacity={0.7}>
          <Text style={s.clearBtn}>{tr.btnClear}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.filterRow}>
        {filters.map(f => (
          <TouchableOpacity
            key={String(f.key)}
            testID={f.key ? 'log-console-listener-only' : 'log-console-all'}
            style={[s.filterTab, listenerOnly === f.key && s.filterTabActive]}
            onPress={() => setListenerOnly(f.key)}
            activeOpacity={0.7}>
            <Text style={[s.filterTabText, listenerOnly === f.key && s.filterTabTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.logBox}>
        <FlatList
          ref={listRef}
          data={shownLogs}
          keyExtractor={entry => String(entry.id)}
          renderItem={renderItem}
          contentContainerStyle={s.logContent}
          // The newest line is what you are watching, so follow the tail. Only
          // on a content-size change, not on every `logs` flush: the batched
          // state update hands over a new array reference every 250 ms even
          // when nothing was appended.
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text style={s.placeholder}>{tr.logPlaceholder}</Text>
          }
        />
      </View>
    </View>
  );
}
