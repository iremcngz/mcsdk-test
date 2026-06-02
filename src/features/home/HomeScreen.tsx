import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { makeCommonStyles } from '../../shared/commonStyles';

export function HomeScreen() {
  const { c, tr }  = useAppContext();
  const sdk        = useSdkContext();
  const insets     = useSafeAreaInsets();
  const s          = useMemo(() => makeCommonStyles(c), [c]);
  const scrollRef  = useRef<ScrollView>(null);

  // Auto-scroll log console when new entries arrive.
  useEffect(() => {
    const timer = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      100,
    );
    return () => clearTimeout(timer);
  }, [sdk.logs]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderSwitch = useCallback(
    (label: string, value: boolean, onValueChange: (v: boolean) => void) => (
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>{label}</Text>
        <Switch value={value} onValueChange={onValueChange} trackColor={{ true: c.success }} />
      </View>
    ),
    [s, c],
  );

  const renderInput = useCallback(
    (
      label: string,
      value: string,
      onChangeText: (v: string) => void,
      keyboard: 'default' | 'numeric' = 'numeric',
    ) => (
      <View style={s.inputRow}>
        <Text style={s.inputLabel}>{label}</Text>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboard}
          placeholderTextColor={c.textMuted}
        />
      </View>
    ),
    [s, c],
  );

  // ── Status badge values ─────────────────────────────────────────────────────
  const statusColor = sdk.initialized
    ? c.success
    : sdk.paramsSet
      ? c.warn
      : sdk.created
        ? c.primary
        : c.error;

  const statusText = sdk.initialized
    ? tr.statusInitialized
    : sdk.paramsSet
      ? tr.statusParamsSet
      : sdk.created
        ? tr.statusCreated
        : tr.statusNotCreated;

  return (
    <ScrollView
      style={s.body}
      contentContainerStyle={[s.bodyContent, { paddingBottom: insets.bottom + 20 }]}>

      {/* Status badge (visible on Home only — shown inline here) */}
      <View style={{ alignItems: 'flex-start', marginBottom: 8 }}>
        <View style={[s.badge, { backgroundColor: statusColor }]}>
          <Text style={s.badgeText}>{statusText}</Text>
        </View>
      </View>

      {/* ── SDK Lifecycle ──────────────────────────────────────────────────── */}
      <Text style={s.sectionTitle}>{tr.sectionSdkLifecycle}</Text>

      {/* Step indicators */}
      <View style={s.stepRow}>
        {([tr.stepCreate, tr.stepSetParams, tr.stepInit] as const).map((label, i) => {
          const done = i === 0 ? sdk.created : i === 1 ? sdk.paramsSet : sdk.initialized;
          return (
            <View key={label} style={s.stepItem}>
              <View style={[s.stepDot, done && s.stepDotDone]}>
                <Text style={s.stepNum}>{i + 1}</Text>
              </View>
              <Text style={[s.stepLabel, done && s.stepLabelDone]}>{label}</Text>
            </View>
          );
        })}
      </View>

      <View style={s.buttonRow}>
        <TouchableOpacity
          style={[s.btn, s.btnCreate, sdk.created && s.btnDisabled]}
          onPress={sdk.handleCreate}
          disabled={sdk.created}>
          <Text style={s.btnText}>{tr.btnCreate}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, s.btnDestroy, !sdk.created && s.btnDisabled]}
          onPress={sdk.handleDestroy}
          disabled={!sdk.created}>
          <Text style={s.btnText}>{tr.btnDestroy}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Parameters ─────────────────────────────────────────────────────── */}
      <Text style={s.sectionTitle}>{tr.sectionParameters}</Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardLogging}</Text>
        {renderSwitch(tr.switchEnabled,    sdk.logEnabled,   sdk.setLogEnabled)}
        {renderInput(tr.inputLevel,        sdk.logLevel,     sdk.setLogLevel)}
        {renderSwitch(tr.switchPjEnabled,  sdk.pjLogEnabled, sdk.setPjLogEnabled)}
        {renderInput(tr.inputPjLevel,      sdk.pjLogLevel,   sdk.setPjLogLevel)}
        {renderSwitch(tr.switchRxTxEnabled, sdk.rxTxEnabled, sdk.setRxTxEnabled)}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardHttp}</Text>
        {renderInput(tr.inputPort, sdk.httpPort, sdk.setHttpPort)}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardSip}</Text>
        {renderInput(tr.inputUdpPort,  sdk.sipUdpPort,    sdk.setSipUdpPort)}
        {renderSwitch(tr.switchTcpEnabled, sdk.sipTcpEnabled, sdk.setSipTcpEnabled)}
        {renderInput(tr.inputTcpPort,  sdk.sipTcpPort,    sdk.setSipTcpPort)}
        {renderSwitch(tr.switchTlsEnabled, sdk.sipTlsEnabled, sdk.setSipTlsEnabled)}
        {renderInput(tr.inputTlsPort,  sdk.sipTlsPort,    sdk.setSipTlsPort)}
        {renderSwitch(tr.switchIpv6Enabled, sdk.sipIpv6Enabled, sdk.setSipIpv6Enabled)}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardTls}</Text>
        {renderSwitch(tr.switchMtlsEnabled, sdk.mTlsEnabled, sdk.setMTlsEnabled)}
        {renderInput(tr.inputCertPath,    sdk.certPath,   sdk.setCertPath,    'default')}
        {renderInput(tr.inputPrivKeyPath, sdk.privKeyPath, sdk.setPrivKeyPath, 'default')}
        {renderInput(tr.inputCaListPath,  sdk.caListPath, sdk.setCaListPath,  'default')}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardThreading}</Text>
        {renderInput(tr.inputSipRxThreads,     sdk.sipRxThreads,     sdk.setSipRxThreads)}
        {renderInput(tr.inputSipWorkerThreads, sdk.sipWorkerThreads, sdk.setSipWorkerThreads)}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardMcx}</Text>
        {renderInput(tr.inputIdmsUrl, sdk.idmsUrl, sdk.setIdmsUrl, 'default')}
        {renderInput(tr.inputBmsUrl,  sdk.bmsUrl,  sdk.setBmsUrl,  'default')}
        {renderInput(tr.inputCmsUrl,  sdk.cmsUrl,  sdk.setCmsUrl,  'default')}
        {renderInput(tr.inputGmsUrl,  sdk.gmsUrl,  sdk.setGmsUrl,  'default')}
        {renderSwitch(tr.switchMockEnabled, sdk.mcxMock, sdk.setMcxMock)}
      </View>

      {/* ── Action Buttons ─────────────────────────────────────────────────── */}
      <View style={s.buttonRow}>
        <TouchableOpacity
          style={[s.btn, s.btnSetParams, !sdk.created && s.btnDisabled]}
          onPress={sdk.handleSetParams}
          disabled={!sdk.created}>
          <Text style={s.btnText}>{tr.btnSetParams}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            s.btn, s.btnInit,
            (!sdk.created || !sdk.paramsSet || sdk.initialized) && s.btnDisabled,
          ]}
          onPress={sdk.handleInit}
          disabled={!sdk.created || !sdk.paramsSet || sdk.initialized}>
          <Text style={s.btnText}>{tr.btnInitSdk}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Registration Progress ───────────────────────────────────────────── */}
      {sdk.initialized && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Registration</Text>
          <View style={s.progressRow}>
            <Text style={s.progressPhase}>
              {sdk.registrationPhase || 'Waiting for registration...'}
            </Text>
            <Text style={s.progressPct}>{sdk.registrationProgress}%</Text>
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${sdk.registrationProgress}%` }]} />
          </View>
          {!!sdk.registrationState && (
            <Text style={s.progressState}>{sdk.registrationState}</Text>
          )}
        </View>
      )}

      {/* ── Log Console ────────────────────────────────────────────────────── */}
      <View style={s.logHeader}>
        <Text style={s.sectionTitle}>{tr.sectionLogConsole}</Text>
        <TouchableOpacity onPress={sdk.clearLogs}>
          <Text style={s.clearBtn}>{tr.btnClear}</Text>
        </TouchableOpacity>
      </View>
      <View style={[s.logBox, { height: Platform.OS === 'ios' ? 220 : 200 }]}>
        <ScrollView ref={scrollRef} nestedScrollEnabled>
          {sdk.logs.length === 0 ? (
            <Text style={s.logPlaceholder}>{tr.logPlaceholder}</Text>
          ) : (
            sdk.logs.map(entry => (
              <Text
                key={entry.id}
                style={[
                  s.logLine,
                  entry.level === 'error' && s.logError,
                  entry.level === 'warn'  && s.logWarn,
                  entry.level === 'sdk'   && s.logSdk,
                ]}>
                <Text style={s.logTime}>{entry.time} </Text>
                {entry.msg}
              </Text>
            ))
          )}
        </ScrollView>
      </View>
    </ScrollView>
  );
}
