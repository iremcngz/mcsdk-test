/**
 * features/sdklogs/SdkLogsScreen.tsx — the SDK's own log stream.
 *
 * Pull, not push. The SDK writes ~450 lines a second with the default params,
 * and this screen used to be fed one event per line through SdkContext — work
 * on the JS thread whether or not the screen was open, and a 5000-row mapped
 * ScrollView when it was. Now the Android bridge keeps the stream in a
 * process-level ring (SdkLogStore.kt) and this screen asks it, while mounted,
 * for whatever is new: one batch every SDK_LOG_POLL_MS, nothing at all once the
 * screen is left. Every line is still here, VERBOSE included; the level filter
 * is applied in the ring, so a narrowed view never has the lines it hides
 * cross the bridge.
 *
 * The list is inverted: index 0 is the newest line and sits at scroll offset 0,
 * so following the tail needs no scrollToEnd, and a reader who has scrolled
 * back keeps their place (maintainVisibleContentPosition) while new lines land
 * out of sight below. There is no ListEmptyComponent on purpose — an inverted
 * list draws it upside down — so the placeholder is rendered in its stead.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { makeSdkLogStyles } from './styles';
import type { McSdkLogLevel, SdkLogLine } from '../../mcsdk';

const SDK_LEVEL_NAMES = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

/** How often the screen asks the ring for new lines while it is open. */
export const SDK_LOG_POLL_MS = 500;
/** Lines fetched when the screen opens: enough history to read back through. */
const INITIAL_TAIL = 500;
/** The most one poll takes. At 450 lines/s a 500 ms poll brings ~225. */
const BATCH_MAX = 1000;
/** Kept in the list; the same as the native ring, so nothing is lost by scrolling. */
const MAX_SHOWN = 5000;

/** A row: a log line, or a marker where lines left the ring before they were fetched. */
type Row = SdkLogLine | { gap: number; seq: number };

function isGap(r: Row): r is { gap: number; seq: number } {
  return 'gap' in r;
}

/** The filter's steps: everything, or this level and above. */
const LEVEL_STEPS: McSdkLogLevel[] = [0, 1, 2, 3];

type Styles = ReturnType<typeof makeSdkLogStyles>;

function levelStyle(s: Styles, level: number) {
  return level >= 4 ? s.lvlError : level === 3 ? s.lvlWarn : level === 2 ? s.lvlInfo : s.lvlVerbose;
}

/** One line. Memoised: a poll hands the list a new array, and only new rows should render. */
const LogRow = memo(function LogRow({ item, s }: { item: SdkLogLine; s: Styles }) {
  return (
    <Text style={[s.line, levelStyle(s, item.level)]}>
      <Text style={s.time}>{item.time} </Text>
      <Text style={s.lbl}>[{SDK_LEVEL_NAMES[item.level] ?? item.level}] </Text>
      {item.msg}
    </Text>
  );
});

export function SdkLogsScreen() {
  const { c, tr }           = useAppContext();
  const { sdkRef, created } = useSdkContext();
  const s = useMemo(() => makeSdkLogStyles(c), [c]);

  const [minLevel, setMinLevel] = useState<McSdkLogLevel>(0);
  // Newest first, for the inverted list.
  const [rows, setRows]   = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  // The newest seq fetched so far; -1 asks for the tail. A ref: it changes on
  // every poll and nothing renders from it.
  const sinceRef = useRef(-1);

  const sdk = created ? sdkRef.current : null;

  // Poll while mounted. A chained timeout rather than an interval, so a slow
  // answer is never overlapped by the next request. Restarted from the tail
  // when the filter changes or the SDK comes up.
  useEffect(() => {
    if (!sdk) {
      setRows([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    sinceRef.current = -1;
    setRows([]);

    const poll = async () => {
      try {
        const since = sinceRef.current;
        const batch = await sdk.getSdkLogs(since, since < 0 ? INITIAL_TAIL : BATCH_MAX, minLevel);
        if (cancelled) return;
        if (batch.latestSeq >= 0) sinceRef.current = batch.latestSeq;
        setTotal(batch.total);
        // Lines the ring moved past, or more than fit this batch: say so where
        // the hole is, rather than showing two lines as consecutive when they
        // were not. Not on the first fetch, which is a tail by design.
        const missed = since >= 0 ? batch.evicted + batch.skipped : 0;
        if (batch.entries.length || missed) {
          setRows(prev => {
            const fresh: Row[] = batch.entries.slice().reverse();
            if (missed) fresh.push({ gap: missed, seq: batch.entries[0]?.seq ?? since + 1 });
            return fresh.concat(prev).slice(0, MAX_SHOWN);
          });
        }
      } catch (err) {
        if (!cancelled) console.warn('[SdkLogsScreen] getSdkLogs failed:', err);
      }
      if (!cancelled) timer = setTimeout(poll, SDK_LOG_POLL_MS);
    };
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sdk, minLevel]);

  const clear = useCallback(() => {
    sdk?.clearSdkLogs();
    setRows([]);
    setTotal(0);
  }, [sdk]);

  const renderItem = useCallback(({ item }: { item: Row }) => (
    isGap(item)
      ? <Text style={s.gap}>{tr.sdkLogGap(item.gap)}</Text>
      : <LogRow item={item} s={s} />
  ), [s, tr]);

  const keyExtractor = useCallback(
    (r: Row) => (isGap(r) ? `gap-${r.seq}` : String(r.seq)),
    [],
  );

  const levelLabel = (level: McSdkLogLevel) =>
    level === 0 ? tr.sdkLogLevelAll
      : level === 1 ? tr.sdkLogLevelDebug
        : level === 2 ? tr.sdkLogLevelInfo
          : tr.sdkLogLevelWarn;

  return (
    <View style={s.root}>
      <View style={s.toolbar}>
        <Text style={s.hint} testID="sdk-log-hint">{tr.sdkLogHint(total)}</Text>
        <TouchableOpacity testID="sdk-log-clear" onPress={clear} activeOpacity={0.7}>
          <Text style={s.clearBtn}>{tr.btnClear}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.filterRow}>
        {LEVEL_STEPS.map(level => (
          <TouchableOpacity
            key={level}
            testID={`sdk-log-level-${level}`}
            style={[s.filterTab, minLevel === level && s.filterTabActive]}
            onPress={() => setMinLevel(level)}
            activeOpacity={0.7}>
            <Text style={[s.filterTabText, minLevel === level && s.filterTabTextActive]}>
              {levelLabel(level)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.logBox}>
        {!sdk ? (
          <Text style={s.placeholder}>{tr.sdkLogNoSdk}</Text>
        ) : rows.length === 0 ? (
          <Text style={s.placeholder}>{tr.logSdkPlaceholder}</Text>
        ) : (
          <FlatList
            testID="sdk-log-list"
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
