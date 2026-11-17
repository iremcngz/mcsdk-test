/**
 * features/logs/LogConsoleScreen.tsx — the app's log console, as its own screen.
 *
 * This is what you read while diagnosing a malformed request — `adb logcat`
 * truncates PJSIP message bodies, these lines do not — and a 200px box inside
 * Home's shared scroll view is not enough of it. Home has such a box again,
 * under its registration progress, but it holds the last 40 entries only; the
 * whole 5000-entry buffer is here, reached from Tools. Same LogContext buffer
 * behind both, so either Clear empties the other.
 *
 * Two views, as on Home: every entry, or **Listener only** — the SDK callbacks
 * and their payloads (`src/mcsdk/listenerLog.ts`).
 *
 * The list is inverted, like the SDK Logs screen: index 0 is the newest line
 * and sits at scroll offset 0, so the tail is followed with no `scrollToEnd` —
 * which used to run on every content change and dragged a reader back to the
 * bottom at every flush. A reader who has scrolled up now keeps their place
 * (maintainVisibleContentPosition). The buffer is oldest-first, so it is
 * reversed for the list; 5000 entries a few times a second is nothing next to
 * what the scroll-to-end cost. No ListEmptyComponent: an inverted list draws
 * it upside down, so the placeholder is rendered in the list's stead.
 */

import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useLogContext } from '../../contexts/LogContext';
import { makeLogConsoleStyles } from './styles';
import type { LogEntry } from '../../shared/types';

type Styles = ReturnType<typeof makeLogConsoleStyles>;

/** One line. Memoised: each flush hands the list a new array, and only new rows should render. */
const LogRow = memo(function LogRow({ item, s }: { item: LogEntry; s: Styles }) {
  return (
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
  );
});

export function LogConsoleScreen() {
  const { c, tr }  = useAppContext();
  const { logs, listenerLogs, clearLogs } = useLogContext();
  const insets     = useSafeAreaInsets();
  const s          = useMemo(() => makeLogConsoleStyles(c), [c]);

  const [listenerOnly, setListenerOnly] = useState(false);
  const shownLogs = listenerOnly ? listenerLogs : logs;
  // Newest first, for the inverted list.
  const rows = useMemo(() => shownLogs.slice().reverse(), [shownLogs]);

  const renderItem = useCallback(
    ({ item }: { item: LogEntry }) => <LogRow item={item} s={s} />,
    [s],
  );
  const keyExtractor = useCallback((entry: LogEntry) => String(entry.id), []);

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
          onPress={clearLogs}
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
        {rows.length === 0 ? (
          <Text style={s.placeholder}>{tr.logPlaceholder}</Text>
        ) : (
          <FlatList
            testID="log-console-list"
            data={rows}
            inverted
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={s.logContent}
            // A reader who scrolled back stays on the line they were reading as
            // new ones are prepended; one within a few px of the newest end is
            // carried along with it.
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 20 }}
            initialNumToRender={30}
            maxToRenderPerBatch={30}
            windowSize={7}
            removeClippedSubviews
          />
        )}
      </View>
    </View>
  );
}
