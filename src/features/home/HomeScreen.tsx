import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { useLogContext } from '../../contexts/LogContext';
import { useNavigation } from '../../contexts/NavigationContext';
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
/** How many entries Home's own console keeps — see `homeLogs` for why. */
const HOME_LOG_TAIL   = 40;

export function HomeScreen() {
  const { c, tr }  = useAppContext();
  const sdk        = useSdkContext();
  const { logs, listenerLogs, clearLogs } = useLogContext();
  const { setScreen } = useNavigation();
  const insets     = useSafeAreaInsets();
  const s          = useMemo(() => makeCommonStyles(c), [c]);
  // Which parameter cards are open. All closed on mount: the defaults are the
  // ones the test server wants, so the common path is to press Set Params
  // without touching them, and six expanded cards push the log console off the
  // first screenful.
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const toggleCard = useCallback(
    (key: string) => setOpenCards(prev => ({ ...prev, [key]: !prev[key] })),
    [],
  );
  const logRef = useRef<ScrollView>(null);
  // Whether the console is parked at the tail. Following the tail and reading
  // back through it are exclusive: at ~450 SDK lines/s an unconditional
  // scrollToEnd drags you back down the moment you scroll up, which makes the
  // box feel stuck. A ref rather than state — it is read inside the scroll
  // handler and must not re-render the page on every frame of a drag.
  const logAtBottom = useRef(true);
  // Which of the two streams the console shows, as on the Tools screen. The
  // filter earns its place here for the same reason it does there: the app's
  // own lines and the listener events share one buffer, and at ~450 SDK
  // lines/s an event is evicted from it in about 11 s.
  const [listenerOnly, setListenerOnly] = useState(false);
  // The tail only. Home's console is a ScrollView inside the page's own
  // ScrollView, so every entry it is given is a mounted <Text> — the reason the
  // console left Home in the first place was 5000 of them. The screen under
  // Tools is a FlatList and shows the whole buffer; this is the recent end of
  // it, which is what a glance after pressing Start All is looking for.
  // Sliced after the filter, so Listener only yields 40 events rather than
  // whatever few survive in the last 40 entries of the mixed stream.
  const homeLogs = useMemo(
    () => (listenerOnly ? listenerLogs : logs).slice(-HOME_LOG_TAIL),
    [listenerOnly, listenerLogs, logs],
  );

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

  /**
   * A parameter card whose body is hidden until its header is pressed. The body
   * is a function so the inputs are not built while the card is closed.
   */
  const renderCard = useCallback(
    (key: string, title: string, body: () => React.ReactNode) => {
      const open = !!openCards[key];
      return (
        <View style={s.card}>
          <TouchableOpacity
            testID={`card-${key}`}
            style={s.cardHeader}
            onPress={() => toggleCard(key)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}>
            <Text style={[s.cardTitle, s.cardHeaderTitle]}>{title}</Text>
            <View style={s.cardHeaderToggle}>
              <Text style={s.cardHeaderHint}>
                {open ? tr.paramsCollapseHint : tr.paramsExpandHint}
              </Text>
              <Text style={s.cardHeaderChevron}>{open ? '▲' : '▼'}</Text>
            </View>
          </TouchableOpacity>
          {open && <View style={s.cardBody}>{body()}</View>}
        </View>
      );
    },
    [s, tr, openCards, toggleCard],
  );

  // ── Status badge values ─────────────────────────────────────────────────────
  // Registered sits above initialized: init() only returned, while registration
  // runs for ~35 s after it and can still fail. Both are green — the SDK is
  // usable either way — so the word is what distinguishes them.
  const statusColor = sdk.registered
    ? c.success
    : sdk.initialized
      ? c.success
      : sdk.paramsSet
        ? c.warn
        : sdk.created
          ? c.primary
          : c.error;

  const statusText = sdk.registered
    ? tr.statusRegistered
    : sdk.initialized
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

      {/* The three steps in one press. A shortcut over the buttons below, which
          stay exactly as they were for driving the bring-up a step at a time. */}
      <View style={s.buttonRow}>
        <TouchableOpacity
          testID="btn-start-all"
          style={[s.btn, s.btnStartAll, sdk.initialized && s.btnDisabled]}
          onPress={() => { sdk.handleStartAll(); }}
          disabled={sdk.initialized}>
          <Text style={s.btnText}>{tr.btnStartAll}</Text>
        </TouchableOpacity>
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

      {/* ── Log Console ─────────────────────────────────────────────────────
          Back on Home, where it is read while watching the registration bar
          right above it. It is the last ~40 entries only: the full buffer is
          5000 and the SDK emits ~450 lines/s, which a plain mapped ScrollView
          cannot hold — that is the screen under Tools, one tap below, with the
          Listener-only filter. Here it answers "is anything happening", there
          you read a SIP body. */}
      <View style={s.logHeader}>
        <Text style={s.sectionTitle}>{tr.sectionLogConsole}</Text>
        <TouchableOpacity
          testID="home-log-clear"
          onPress={clearLogs}
          activeOpacity={0.7}>
          <Text style={s.clearBtn}>{tr.btnClear}</Text>
        </TouchableOpacity>
      </View>

      {/* All logs / Listener only — the same two views as the Tools screen, so
          a glance at Home can be narrowed to the SDK callbacks without
          leaving it. */}
      <View style={s.segRow}>
        {([
          { key: false, label: tr.btnLogsAll,      testID: 'home-log-all' },
          { key: true,  label: tr.btnLogsListener, testID: 'home-log-listener-only' },
        ] as const).map(f => (
          <TouchableOpacity
            key={String(f.key)}
            testID={f.testID}
            style={[s.seg, s.segFill, listenerOnly === f.key && s.segActive]}
            onPress={() => setListenerOnly(f.key)}
            activeOpacity={0.7}>
            <Text style={[s.segText, listenerOnly === f.key && s.segTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.logBox}>
        <ScrollView
          ref={logRef}
          testID="home-log-scroll"
          // This is a ScrollView inside the page's own ScrollView, on the same
          // axis. On Android the outer one swallows the drag unless the inner
          // one opts in, which is why the box looked frozen; `true` is not the
          // default. `onStartShouldSetResponder` then keeps a touch that began
          // inside the box from being handed up to the page, so a drag that
          // starts here scrolls the log rather than Home.
          nestedScrollEnabled
          onStartShouldSetResponder={() => true}
          scrollEventThrottle={16}
          onScroll={e => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            // Within a line's height of the end counts as parked, so letting go
            // of a flick that lands just short still resumes following.
            logAtBottom.current =
              contentOffset.y + layoutMeasurement.height >= contentSize.height - 16;
          }}
          // Follow the tail on a content-size change rather than on `sdk.logs`:
          // the batched flush hands over a new array reference every 250 ms
          // even when nothing was appended.
          onContentSizeChange={() => {
            if (logAtBottom.current) logRef.current?.scrollToEnd({ animated: false });
          }}>
          {homeLogs.length === 0 ? (
            <Text style={s.logPlaceholder}>{tr.logPlaceholder}</Text>
          ) : (
            homeLogs.map(entry => (
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

      <TouchableOpacity
        testID="home-log-console-link"
        style={s.logMovedRow}
        onPress={() => setScreen('logs')}
        activeOpacity={0.7}>
        <Text style={s.logMovedText}>{tr.logConsoleMoved}</Text>
      </TouchableOpacity>

      {/* ── Parameters ─────────────────────────────────────────────────────── */}
      {/* Last on the screen, below the progress bar: the
          params are normally left at their defaults, while the registration
          progress is what you watch after pressing Start All. The
          two buttons that consume this form stay directly under it. */}
      <Text style={s.sectionTitle}>{tr.sectionParameters}</Text>

      {renderCard('logging', tr.cardLogging, () => (
        <>
          {renderSwitch(tr.switchEnabled,    sdk.logEnabled,   sdk.setLogEnabled)}
          {renderInput(tr.inputLevel,        sdk.logLevel,     sdk.setLogLevel,     'numeric', LOG_LEVEL_RANGE)}
          {renderSwitch(tr.switchPjEnabled,  sdk.pjLogEnabled, sdk.setPjLogEnabled)}
          {renderInput(tr.inputPjLevel,      sdk.pjLogLevel,   sdk.setPjLogLevel,   'numeric', LOG_LEVEL_RANGE)}
          {renderSwitch(tr.switchRxTxEnabled, sdk.rxTxEnabled, sdk.setRxTxEnabled)}
        </>
      ))}

      {renderCard('http', tr.cardHttp, () => (
        renderInput(tr.inputPort, sdk.httpPort, sdk.setHttpPort, 'numeric', PORT_RANGE)
      ))}

      {renderCard('sip', tr.cardSip, () => (
        <>
          {renderInput(tr.inputUdpPort,  sdk.sipUdpPort,    sdk.setSipUdpPort, 'numeric', PORT_RANGE)}
          {renderSwitch(tr.switchTcpEnabled, sdk.sipTcpEnabled, sdk.setSipTcpEnabled)}
          {renderInput(tr.inputTcpPort,  sdk.sipTcpPort,    sdk.setSipTcpPort, 'numeric', PORT_RANGE)}
          {renderSwitch(tr.switchTlsEnabled, sdk.sipTlsEnabled, sdk.setSipTlsEnabled)}
          {renderInput(tr.inputTlsPort,  sdk.sipTlsPort,    sdk.setSipTlsPort, 'numeric', PORT_RANGE)}
          {renderSwitch(tr.switchIpv6Enabled, sdk.sipIpv6Enabled, sdk.setSipIpv6Enabled)}
        </>
      ))}

      {renderCard('tls', tr.cardTls, () => (
        <>
          {renderSwitch(tr.switchMtlsEnabled, sdk.mTlsEnabled, sdk.setMTlsEnabled)}
          {renderInput(tr.inputCertPath,    sdk.certPath,   sdk.setCertPath,    'default')}
          {renderInput(tr.inputPrivKeyPath, sdk.privKeyPath, sdk.setPrivKeyPath, 'default')}
          {renderInput(tr.inputCaListPath,  sdk.caListPath, sdk.setCaListPath,  'default')}
        </>
      ))}

      {renderCard('threading', tr.cardThreading, () => (
        <>
          {renderInput(tr.inputSipRxThreads,     sdk.sipRxThreads,     sdk.setSipRxThreads,     'numeric', THREAD_RANGE)}
          {renderInput(tr.inputSipWorkerThreads, sdk.sipWorkerThreads, sdk.setSipWorkerThreads, 'numeric', THREAD_RANGE)}
        </>
      ))}

      {renderCard('mcx', tr.cardMcx, () => (
        <>
          {renderInput(tr.inputIdmsUrl, sdk.idmsUrl, sdk.setIdmsUrl, 'default')}
          {renderInput(tr.inputBmsUrl,  sdk.bmsUrl,  sdk.setBmsUrl,  'default')}
          {renderInput(tr.inputCmsUrl,  sdk.cmsUrl,  sdk.setCmsUrl,  'default')}
          {renderInput(tr.inputGmsUrl,  sdk.gmsUrl,  sdk.setGmsUrl,  'default')}
        </>
      ))}

      {/* ── Action Buttons ─────────────────────────────────────────────────── */}
      <View style={s.buttonRow}>
        {/* Once Init has run the params are the ones the live SDK was built
            with; setParams after that would only desync the form from it, since
            the C++ side owns process-level singletons that cannot be
            re-initialised. So it is closed off with Init. */}
        <TouchableOpacity
          style={[
            s.btn, s.btnSetParams,
            (!sdk.created || sdk.initialized) && s.btnDisabled,
          ]}
          onPress={sdk.handleSetParams}
          disabled={!sdk.created || sdk.initialized}>
          <Text style={s.btnText}>{tr.btnSetParams}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            s.btn, s.btnInit,
            (!sdk.created || !sdk.paramsSet || sdk.initialized) && s.btnDisabled,
          ]}
          onPress={() => { sdk.handleInit(); }}
          disabled={!sdk.created || !sdk.paramsSet || sdk.initialized}>
          <Text style={s.btnText}>{tr.btnInitSdk}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
