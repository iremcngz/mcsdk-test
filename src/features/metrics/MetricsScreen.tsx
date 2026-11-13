import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { parsePrometheus, type MetricFamily } from '../../utils/parsePrometheus';
import { makeMetricsStyles } from './styles';

// Fixed semantic colours, not theme-dependent.
const TYPE_COLOR: Record<string, string> = {
  counter:   '#4fc3f7',
  gauge:     '#81c784',
  histogram: '#ffb74d',
  summary:   '#f48fb1',
};

/** How often auto-refresh fetches, while it is on. */
const AUTO_REFRESH_MS = 5000;

function stamp(): string {
  const d = new Date();
  return (
    d.getHours().toString().padStart(2, '0') + ':' +
    d.getMinutes().toString().padStart(2, '0') + ':' +
    d.getSeconds().toString().padStart(2, '0')
  );
}

export function MetricsScreen() {
  const { c, tr }     = useAppContext();
  const { sdkRef }    = useSdkContext();
  const ms = useMemo(() => makeMetricsStyles(c), [c]);

  const [rawText,     setRawText]     = useState('');
  const [families,    setFamilies]    = useState<MetricFamily[]>([]);
  const [refreshing,  setRefreshing]  = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [fetchedAt,   setFetchedAt]   = useState<number | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [auto,        setAuto]        = useState(false);
  /** Ticked once a second so the age line counts up between fetches. */
  const [now,         setNow]         = useState(Date.now());

  const fetchMetrics = useCallback(() => {
    if (!sdkRef.current) {
      setError(tr.metricsNoSdk);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const raw = sdkRef.current.listMetrics();
      setRawText(raw);
      setFamilies(parsePrometheus(raw));
      setLastFetched(stamp());
      setFetchedAt(Date.now());
      setNow(Date.now());
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  }, [sdkRef, tr]);

  // The latest fetchMetrics, so the auto-refresh interval is not torn down and
  // rebuilt every time the callback's identity changes — the timer would then
  // restart from zero and the cadence would drift.
  const fetchRef = useRef(fetchMetrics);
  fetchRef.current = fetchMetrics;

  // Auto refresh. Fetches at once when switched on, so the toggle has a visible
  // effect without waiting out the first interval.
  useEffect(() => {
    if (!auto) return;
    fetchRef.current();
    const id = setInterval(() => fetchRef.current(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [auto]);

  // Keeps the "x s ago" line honest while nothing is being fetched. Keyed on
  // *whether* there is something to age rather than on fetchedAt itself, so a
  // fetch does not tear the interval down and start it again — with auto
  // refresh on that would be every 5 s.
  const hasFetched = fetchedAt !== null;
  useEffect(() => {
    if (!hasFetched) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasFetched]);

  /** "just now" / "12 s ago" / "3 min ago", recomputed on each `now` tick. */
  const ageText = useMemo(() => {
    if (fetchedAt === null) return null;
    const sec = Math.max(0, Math.round((now - fetchedAt) / 1000));
    if (sec < 2)  return tr.metricsAgeJustNow;
    if (sec < 60) return tr.metricsAgeSeconds(sec);
    return tr.metricsAgeMinutes(Math.floor(sec / 60));
  }, [fetchedAt, now, tr]);

  return (
    <ScrollView
      style={ms.root}
      contentContainerStyle={ms.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={fetchMetrics} tintColor={c.accent} />
      }>
      <View style={ms.toolbar}>
        <View style={ms.hintBlock}>
          <Text style={ms.hint} testID="metrics-hint">
            {lastFetched ? tr.metricsLastFetched(lastFetched) : tr.metricsHintInitial}
          </Text>
          {!!ageText && (
            <Text style={ms.hintAge} testID="metrics-age">{ageText}</Text>
          )}
        </View>
        <TouchableOpacity style={ms.fetchBtn} onPress={fetchMetrics}>
          <Text style={ms.fetchBtnText}>{tr.btnFetch}</Text>
        </TouchableOpacity>
      </View>

      {/* Auto refresh. On, the screen fetches by itself every AUTO_REFRESH_MS
          and the Fetch button still works for an immediate one; off, it behaves
          exactly as before — nothing is read until Fetch or a pull-down. */}
      <View style={ms.autoRow}>
        <View style={ms.autoTextBlock}>
          <Text style={ms.autoLabel}>{tr.metricsAutoRefresh}</Text>
          <Text style={ms.autoNote}>
            {auto
              ? tr.metricsAutoRefreshOn(Math.round(AUTO_REFRESH_MS / 1000))
              : tr.metricsAutoRefreshOff}
          </Text>
        </View>
        <Switch
          testID="metrics-auto-refresh"
          value={auto}
          onValueChange={setAuto}
          trackColor={{ true: c.accent }}
        />
      </View>

      {error ? (
        <View style={ms.errorBox}>
          <Text style={ms.errorText}>{error}</Text>
        </View>
      ) : families.length === 0 ? (
        <Text style={ms.empty}>{tr.metricsEmpty}</Text>
      ) : (
        families.map(fam => (
          <View key={fam.name} style={ms.card}>
            <View style={ms.cardHeader}>
              <Text style={ms.famName} numberOfLines={1}>{fam.name}</Text>
              <View style={[ms.typeBadge, { backgroundColor: TYPE_COLOR[fam.type] ?? c.presenceOffline }]}>
                <Text style={ms.typeBadgeText}>{fam.type.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={ms.famHelp}>{fam.help}</Text>

            <View style={ms.table}>
              <View style={[ms.tableRow, ms.tableHead]}>
                <Text style={[ms.tableCellText, ms.tableHeadText, { flex: 3 }]}>Sample</Text>
                <Text style={[ms.tableCellText, ms.tableHeadText, { flex: 2, textAlign: 'right' }]}>Value</Text>
              </View>
              {fam.samples.map((sample, i) => (
                <View key={i} style={[ms.tableRow, i % 2 === 1 && ms.tableRowAlt]}>
                  <View style={{ flex: 3 }}>
                    <Text style={ms.tableCellText}>
                      {sample.name.replace(fam.name, '').replace(/^_/, '') || fam.name}
                    </Text>
                    {sample.labels ? (
                      <Text style={ms.labelText}>{sample.labels}</Text>
                    ) : null}
                  </View>
                  <Text style={[ms.tableCellText, ms.valueText]}>{sample.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ))
      )}

      {rawText.length > 0 && (
        <View style={ms.rawSection}>
          <Text style={ms.rawTitle}>{tr.metricsRawTitle}</Text>
          <ScrollView horizontal nestedScrollEnabled style={ms.rawBox}>
            <Text style={ms.rawText}>{rawText}</Text>
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}
