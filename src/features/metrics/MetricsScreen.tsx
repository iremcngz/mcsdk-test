import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
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
  const [error,       setError]       = useState<string | null>(null);

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
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  }, [sdkRef, tr]);

  return (
    <ScrollView
      style={ms.root}
      contentContainerStyle={ms.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={fetchMetrics} tintColor={c.accent} />
      }>
      <View style={ms.toolbar}>
        <Text style={ms.hint}>
          {lastFetched ? tr.metricsLastFetched(lastFetched) : tr.metricsHintInitial}
        </Text>
        <TouchableOpacity style={ms.fetchBtn} onPress={fetchMetrics}>
          <Text style={ms.fetchBtnText}>{tr.btnFetch}</Text>
        </TouchableOpacity>
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
