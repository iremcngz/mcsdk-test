import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { makeCommonStyles } from '../../shared/commonStyles';

// Accepted ranges for the numeric parameter fields. McSdk.setParams() clamps to
// the same bounds before crossing the bridge; refusing the keystroke here just
// means the user never sees a value the SDK would silently rewrite.
/** LogLevel is VERBOSE(0)..FATAL(5) — anything else maps to VERBOSE. */
const LOG_LEVEL_RANGE = { min: 0, max: 5 };
/** TCP/UDP port numbers. */
const PORT_RANGE      = { min: 1, max: 65535 };
/** Thread counts; the bridge also floors these at 1. */
const THREAD_RANGE    = { min: 1, max: 64 };

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
      /** Inclusive bounds for numeric fields; typing outside them is refused. */
      range?: { min: number; max: number },
    ) => {
      const handleChange = (text: string) => {
        if (keyboard !== 'numeric') { onChangeText(text); return; }
        // Keep digits only — `keyboardType` is a hint, not a guarantee, and it
        // does not stop pasting. Letters would otherwise reach the bridge as
        // NaN, where Kotlin quietly substitutes its own default.
        const digits = text.replace(/[^0-9]/g, '');
        // An empty field must stay empty while editing, or the value can never
        // be cleared to retype it.
        if (digits === '') { onChangeText(''); return; }
        if (range && Number(digits) > range.max) return;  // refuse, keep the old value
        onChangeText(digits);
      };

      // Below-range values are allowed to be typed (you have to pass through "0"
      // to reach "5"), so flag them instead of refusing the keystroke. Above the
      // maximum is refused outright, which is why there is no warning for it.
      const tooLow = !!range && value !== '' && Number(value) < range.min;
      const isEmpty = keyboard === 'numeric' && value === '';

      return (
        <View style={s.inputRow}>
          <View style={s.inputLabelBlock}>
            <Text style={s.inputLabelInBlock}>{label}</Text>
            {range && (
              <Text style={[s.inputHint, (tooLow || isEmpty) && s.inputHintError]}>
                {tr.inputRangeHint(range.min, range.max)}
              </Text>
            )}
          </View>
          <TextInput
            style={[s.input, (tooLow || isEmpty) && s.inputError]}
            value={value}
            onChangeText={handleChange}
            keyboardType={keyboard}
            placeholderTextColor={c.textMuted}
          />
        </View>
      );
    },
    [s, c, tr],
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
        {renderInput(tr.inputLevel,        sdk.logLevel,     sdk.setLogLevel,     'numeric', LOG_LEVEL_RANGE)}
        {renderSwitch(tr.switchPjEnabled,  sdk.pjLogEnabled, sdk.setPjLogEnabled)}
        {renderInput(tr.inputPjLevel,      sdk.pjLogLevel,   sdk.setPjLogLevel,   'numeric', LOG_LEVEL_RANGE)}
        {renderSwitch(tr.switchRxTxEnabled, sdk.rxTxEnabled, sdk.setRxTxEnabled)}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardHttp}</Text>
        {renderInput(tr.inputPort, sdk.httpPort, sdk.setHttpPort, 'numeric', PORT_RANGE)}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardSip}</Text>
        {renderInput(tr.inputUdpPort,  sdk.sipUdpPort,    sdk.setSipUdpPort, 'numeric', PORT_RANGE)}
        {renderSwitch(tr.switchTcpEnabled, sdk.sipTcpEnabled, sdk.setSipTcpEnabled)}
        {renderInput(tr.inputTcpPort,  sdk.sipTcpPort,    sdk.setSipTcpPort, 'numeric', PORT_RANGE)}
        {renderSwitch(tr.switchTlsEnabled, sdk.sipTlsEnabled, sdk.setSipTlsEnabled)}
        {renderInput(tr.inputTlsPort,  sdk.sipTlsPort,    sdk.setSipTlsPort, 'numeric', PORT_RANGE)}
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
        {renderInput(tr.inputSipRxThreads,     sdk.sipRxThreads,     sdk.setSipRxThreads,     'numeric', THREAD_RANGE)}
        {renderInput(tr.inputSipWorkerThreads, sdk.sipWorkerThreads, sdk.setSipWorkerThreads, 'numeric', THREAD_RANGE)}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardMcx}</Text>
        {renderInput(tr.inputIdmsUrl, sdk.idmsUrl, sdk.setIdmsUrl, 'default')}
        {renderInput(tr.inputBmsUrl,  sdk.bmsUrl,  sdk.setBmsUrl,  'default')}
        {renderInput(tr.inputCmsUrl,  sdk.cmsUrl,  sdk.setCmsUrl,  'default')}
        {renderInput(tr.inputGmsUrl,  sdk.gmsUrl,  sdk.setGmsUrl,  'default')}
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
