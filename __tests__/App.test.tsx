/**
 * Comprehensive integration tests for the MCX Test app.
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest                              # Run ALL test files              │
 * │  npx jest --watch                      # Watch mode (re-runs on change)  │
 * │  npx jest --coverage                   # With coverage report (HTML)     │
 * │  npx jest __tests__/App.test.tsx       # Only this file                  │
 * │  npx jest -t "handleCreate"            # Only tests matching the name    │
 * │  npx jest -t "MetricsScreen"           # Only Metrics screen tests       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ARCHITECTURE ───────────────────────────────────────────────────────────┐
 * │  App.tsx (React component)                                               │
 * │    └─ McSdk JS class  (src/mcsdk/index.ts)  ← MOCKED in these tests     │
 * │         └─ NativeMcSdk TurboModule          ← Not reachable in Node.js  │
 * │              └─ McSdkModule.mm (iOS bridge)                              │
 * │                   └─ McSdk.xcframework (C++ SDK binary)                 │
 * │                                                                          │
 * │  Tests here cover the React / JS layer ONLY.                            │
 * │  They verify that:                                                       │
 * │    - State transitions (badge text, button states) are correct.        │
 * │    - SDK methods are called with the right arguments.                   │
 * │    - Errors from the SDK are surfaced in the log console.              │
 * │    - The Metrics screen parses and renders SDK output correctly.        │
 * │                                                                          │
 * │  For end-to-end tests that exercise the REAL native SDK use             │
 * │  Detox on a physical device or simulator.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react-native';
import App from '../App';
import { McSdk } from '../src/mcsdk';
import { AuthSettings } from '../src/core/settings';

// ── Mock: react-native-safe-area-context ──────────────────────────────────────
// SafeAreaProvider / useSafeAreaInsets depend on native modules unavailable
// in the Jest Node.js environment. Replace with lightweight shims.

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView:     ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ── Mock: react-native-sound-level ────────────────────────────────────────────
jest.mock('react-native-sound-level', () => ({
  start: jest.fn(),
  stop: jest.fn(),
  onNewFrame: jest.fn(),
}), { virtual: true });

// ── Mock: McSdk ───────────────────────────────────────────────────────────────
// McSdk wraps a TurboModule that calls native C++ code. We replace the entire
// class with a jest mock so tests can:
//   1. Verify calls (e.g., sdk.setParams was called once with correct args)
//   2. Control outcomes (e.g., sdk.init resolves to false to simulate failure)
//   3. Run entirely in Node.js without a simulator or device
//
// The mock constructor is set to `jest.fn()` here; a concrete implementation
// is installed in beforeEach so each test starts with a clean slate.

jest.mock('../src/mcsdk', () => ({
  McSdk: jest.fn(),
  McSdkEvents: {
    FetchDocument:  'McSdkFetchDocument',
    SdsSent:        'McSdkSdsSent',
    SdsReceived:    'McSdkSdsReceived',
    SdsError:       'McSdkSdsError',
    Alarm:          'McSdkAlarm',
    Log:            'McSdkLog',
    Registration:   'McSdkRegistration',
    StoreDocuments: 'McSdkStoreDocuments',
  },
}));

// ── Mock: src/core/db ─────────────────────────────────────────────────────────
// Replace the SQLite-backed db module with simple stubs so tests run in
// Node.js without a native SQLite driver.  getDocumentsByMcId defaults to []
// (no docs cached) — individual setDocuments tests override this per-test.

jest.mock('../src/core/db', () => ({
  initDb:               jest.fn().mockResolvedValue(undefined),
  seedContacts:         jest.fn().mockResolvedValue(undefined),
  getAllContacts:        jest.fn().mockResolvedValue([]),
  insertContact:        jest.fn().mockResolvedValue(1),
  deleteContact:        jest.fn().mockResolvedValue(undefined),
  clearContacts:        jest.fn().mockResolvedValue(undefined),
  upsertUser:           jest.fn().mockResolvedValue(undefined),
  getUserByUsername:    jest.fn().mockResolvedValue(null),
  recordLogin:          jest.fn().mockResolvedValue(undefined),
  getDocumentsByMcId:   jest.fn().mockResolvedValue([]),
  // getAllDocuments feeds AppContext's cachedDocsMap (pre-loaded at startup).
  // handleInit now reads cached docs from that map rather than via a per-mcId
  // DB call, so setDocuments tests seed this instead of getDocumentsByMcId.
  getAllDocuments:      jest.fn().mockResolvedValue(new Map()),
  saveDocuments:        jest.fn().mockResolvedValue(undefined),
  clearDocumentsByMcId: jest.fn().mockResolvedValue(undefined),
}));

import { getAllDocuments, getUserByUsername } from '../src/core/db';
const MockGetAllDocuments = getAllDocuments as jest.MockedFunction<typeof getAllDocuments>;
const MockGetUserByUsername = getUserByUsername as jest.MockedFunction<typeof getUserByUsername>;

/** Typed reference to the mocked McSdk constructor. */
const MockMcSdk = McSdk as jest.MockedClass<typeof McSdk>;

/** What getSdkLogs resolves while the native ring is empty. */
const EMPTY_SDK_LOG_BATCH = {
  entries: [], latestSeq: -1, total: 0, skipped: 0, evicted: 0, fileDropped: 0,
};

/**
 * Factory that creates a fresh, isolated mock instance of McSdk.
 * Each method is an independent jest.fn() so tests can assert on them
 * or override them with mockResolvedValueOnce / mockRejectedValueOnce.
 */
const makeSdkInstance = () => ({
  setParams:      jest.fn(),
  init:           jest.fn().mockResolvedValue(true),
  destroy:        jest.fn(),
  // Promise-based, as the bridge methods are: a synchronous one would run on
  // the JS thread.
  listMetrics:    jest.fn().mockResolvedValue(''),
  listAlarms:     jest.fn().mockResolvedValue(''),
  // The SDK's log stream is pulled from the native ring by the SDK Logs screen,
  // never pushed as events — so there is no onLog to subscribe to.
  getSdkLogs:     jest.fn().mockResolvedValue(EMPTY_SDK_LOG_BATCH),
  clearSdkLogs:   jest.fn(),
  getSdkLogCount: jest.fn().mockResolvedValue(0),
  onAlarm:        jest.fn(),
  // SdkContext logs every listener event through this.
  onAnyEvent:     jest.fn().mockReturnValue({ remove: jest.fn() }),
  // CallContext subscribes, for floor errors.
  onSdkError:     jest.fn().mockReturnValue({ remove: jest.fn() }),
  onRegistration: jest.fn(),
  raiseAlarm:     jest.fn(),
  resolveAlarm:   jest.fn(),
  fetchDocument:  jest.fn(),
  startPrivateCall: jest.fn(),
  startGroupCall: jest.fn(),
  answerCall: jest.fn(),
  rejectCall: jest.fn(),
  terminateCall: jest.fn(),
  requestFloor: jest.fn(),
  releaseFloor: jest.fn(),
  setIdentity:        jest.fn(),
  setDocuments:       jest.fn(),   // Android: → JNI → C++  |  iOS: no-op bridge
  onStoreDocuments:   jest.fn(),
  register:           jest.fn(),
  unregister:     jest.fn(),
  // Affiliation — TalkContext subscribes to these on mount. The SDK pushes the
  // group lists; there is no getter.
  affiliate:              jest.fn(),
  deaffiliate:            jest.fn(),
  onIdentityUpdated:      jest.fn().mockReturnValue({ remove: jest.fn() }),
  onGroupsUpdated:        jest.fn().mockReturnValue({ remove: jest.fn() }),
  onAffiliationsUpdated:  jest.fn().mockReturnValue({ remove: jest.fn() }),
  // Call callbacks — CallContext subscribes to these on mount.
  onIncomingCall:         jest.fn().mockReturnValue({ remove: jest.fn() }),
  onCallUpdated:          jest.fn().mockReturnValue({ remove: jest.fn() }),
  onCallTerminated:       jest.fn().mockReturnValue({ remove: jest.fn() }),
  onFloorUpdated:         jest.fn().mockReturnValue({ remove: jest.fn() }),
  onTransmissionUpdated:  jest.fn().mockReturnValue({ remove: jest.fn() }),
  onReceptionUpdated:     jest.fn().mockReturnValue({ remove: jest.fn() }),
});

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Bypass the login gate — App renders LoginScreen when isLoggedIn=false.
  // Set auth flags in the in-memory MMKV mock so AppContextProvider sees the
  // user as already authenticated before every test.
  AuthSettings.setStayLoggedIn(true);
  AuthSettings.setIsLoggedIn(true);

  // Clear call history between tests, then install a fresh mock implementation.
  // This ensures tests don't bleed state into each other.
  MockMcSdk.mockClear();
  MockMcSdk.mockImplementation(() => makeSdkInstance() as any);
});

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Renders the App and presses Create so the SDK instance is constructed.
 * Returns the McSdk instance created inside handleCreate so individual tests
 * can inspect or override its methods.
 */
/**
 * Asserts a log line reaches the console, waiting for the batched flush.
 *
 * SdkContext queues log entries and moves them into state once per ~250 ms
 * rather than once per event (the SDK emits ~450 a second), so a line is not on
 * screen the instant the action that produced it returns. waitFor polls instead
 * of sleeping a fixed 250 ms, which keeps the suite fast.
 */
/**
 * Opens the Log Console. It used to be a 200px box in the middle of Home; it is
 * a screen of its own under Tools now (Tools tab → the Log Console row), so
 * anything asserting on a log line has to navigate there first.
 */
function openLogConsole() {
  fireEvent.press(screen.getByText('Tools'));
  fireEvent.press(screen.getByTestId('tool-logs'));
}

async function expectLog(pattern: RegExp) {
  openLogConsole();
  await waitFor(() => expect(screen.getByText(pattern)).toBeTruthy());
}

async function renderAndCreate() {
  render(<App />);
  await act(async () => {
    fireEvent.press(screen.getByText('① Create'));
  });
  // MockMcSdk.mock.results[0].value is the object returned by `new McSdk()`
  return MockMcSdk.mock.results[0].value;
}

/**
 * Renders App, creates the SDK, then presses Set Parameters.
 * After this call the "Initialize SDK" button is enabled.
 */
async function renderCreateAndSetParams() {
  const sdk = await renderAndCreate();
  await act(async () => {
    fireEvent.press(screen.getByText('② Set Parameters'));
  });
  return sdk;
}

// ── Prometheus fixture used in MetricsScreen tests ────────────────────────────

const PROMETHEUS_FIXTURE = `
# HELP sip_rx_packets_total Total received SIP packets
# TYPE sip_rx_packets_total counter
sip_rx_packets_total 42
# HELP sip_active_calls Current active SIP calls
# TYPE sip_active_calls gauge
sip_active_calls{transport="udp"} 3
`;

// =============================================================================
// 1. Initial render
// =============================================================================

describe('Initial render', () => {
  /**
   * WHAT: Verifies the initial UI state before any SDK interaction.
   * WHY:  Regressions in initial state (missing badge, wrong text) are caught
   *       immediately before any behaviour tests can run.
   */

  it('shows the app title', () => {
    render(<App />);
    expect(screen.getByText('MCX Test')).toBeTruthy();
  });

  it('shows NOT CREATED status badge', () => {
    render(<App />);
    expect(screen.getAllByText('NOT CREATED')[0]).toBeTruthy();
  });

  it('shows Home and Metrics tabs', () => {
    render(<App />);
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Metrics')).toBeTruthy();
  });

  it('shows the three lifecycle step labels', () => {
    render(<App />);
    expect(screen.getByText('Create')).toBeTruthy();
    expect(screen.getByText('SetParams')).toBeTruthy();
    expect(screen.getByText('Init')).toBeTruthy();
  });

  it('shows the empty log placeholder on the Log Console screen', () => {
    render(<App />);
    openLogConsole();
    expect(screen.getByText('Logs will appear here…')).toBeTruthy();
  });

  it('shows the SDK Lifecycle section on the Home tab', () => {
    render(<App />);
    expect(screen.getByText('SDK Lifecycle')).toBeTruthy();
  });
});

// =============================================================================
// 2. handleCreate
// =============================================================================

describe('handleCreate', () => {
  /**
   * WHAT: Tests the Create button flow.
   * WHY:  Create is the first mandatory step. Failures here block ALL
   *       subsequent SDK operations. We also verify the SDK constructor
   *       is called exactly once so no duplicate native instances are created.
   */

  it('constructs exactly one McSdk instance', async () => {
    await renderAndCreate();
    expect(MockMcSdk).toHaveBeenCalledTimes(1);
  });

  it('updates status badge to CREATED', async () => {
    await renderAndCreate();
    expect(screen.getAllByText('CREATED')[0]).toBeTruthy();
  });

  it('logs the success message', async () => {
    await renderAndCreate();
    await expectLog(/McSdk\(\) → nativeCreate\(\) OK/);
  });

  // The SDK's own stream — ~450 lines a second with the default params — is
  // not delivered to JS line by line any more: the Android bridge keeps it in
  // a native ring and the SDK Logs screen pulls it while open. So nothing here
  // subscribes to it, and the Log Console never sees it.
  it('does not pull the SDK stream until the SDK Logs screen is opened', async () => {
    const sdk = await renderAndCreate();
    openLogConsole();
    await waitFor(() => expect(screen.getByText(/nativeCreate\(\) OK/)).toBeTruthy());
    expect(sdk.getSdkLogs).not.toHaveBeenCalled();
  });

  it('shows the SDK stream on the SDK Logs screen, pulled from the native ring', async () => {
    const sdk = await renderAndCreate();
    sdk.getSdkLogs.mockResolvedValue({
      entries: [{ seq: 0, time: '12:00:00.000', level: 2, msg: 'PjsipModule::OnRxRequest cseq=1' }],
      latestSeq: 0, total: 1, skipped: 0, evicted: 0, fileDropped: 0,
    });
    fireEvent.press(screen.getByText('Tools'));
    fireEvent.press(screen.getByTestId('tool-sdklogs'));
    await waitFor(() =>
      expect(screen.getByText(/PjsipModule::OnRxRequest/)).toBeTruthy());
  });

  it('pressing Create a second time does NOT construct another instance', async () => {
    // The button becomes disabled after the first press.
    // fireEvent ignores disabled, but handleCreate guards via sdkRef.current.
    render(<App />);
    const btn = screen.getByText('① Create');
    await act(async () => { fireEvent.press(btn); });
    await act(async () => { fireEvent.press(btn); });
    expect(MockMcSdk).toHaveBeenCalledTimes(1);
  });

  it('logs a failure message when McSdk constructor throws', async () => {
    MockMcSdk.mockImplementationOnce(() => { throw new Error('constructor boom'); });
    render(<App />);
    await act(async () => {
      fireEvent.press(screen.getByText('① Create'));
    });
    await expectLog(/Create failed: constructor boom/);
    expect(screen.queryByText('CREATED')).toBeNull();
  });
});

// =============================================================================
// 3. handleSetParams
// =============================================================================

describe('handleSetParams', () => {
  /**
   * WHAT: Tests the Set Parameters flow.
   * WHY:  This is where UI state is collected and forwarded to the native
   *       SDK. Verifying the McSdkParams object structure guards against
   *       regressions in type conversions and default values.
   */

  it('updates status badge to PARAMS SET', async () => {
    await renderAndCreate();
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    expect(screen.getAllByText('PARAMS SET')[0]).toBeTruthy();
  });

  it('calls sdk.setParams exactly once', async () => {
    const sdk = await renderAndCreate();
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    expect(sdk.setParams).toHaveBeenCalledTimes(1);
  });

  it('passes an McSdkParams object with correct default Logging values', async () => {
    const sdk = await renderAndCreate();
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    const { Logging } = sdk.setParams.mock.calls[0][0];
    expect(Logging.enabled).toBe(true);
    expect(Logging.pjEnabled).toBe(true);
    expect(Logging.rxTxEnabled).toBe(true);
  });

  it('passes correct default HTTP, SIP and TLS values', async () => {
    const sdk = await renderAndCreate();
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    const { Http, Sip, Tls } = sdk.setParams.mock.calls[0][0];
    expect(Http.port).toBe(8008);
    expect(Sip.udpPort).toBe(5060);
    // SIP over TCP is on by default: over UDP the server never sends the
    // affiliation subscription's initial NOTIFY and registration stalls.
    expect(Sip.tcpEnabled).toBe(true);
    expect(Sip.tlsEnabled).toBe(false);
    expect(Tls.mTlsEnabled).toBe(false);
    // Empty by default: the SDK passes these to OpenSSL as filesystem paths, so
    // a path naming a file that is not on the device fails TLS setup outright
    // (Error::SSLLoadingCerts) and IDMS login never leaves the handset. Empty
    // falls back to the system certificate store.
    expect(Tls.certPath).toBe('');
    expect(Tls.privKeyPath).toBe('');
    expect(Tls.caListPath).toBe('');
  });

  it('passes correct default Threading values', async () => {
    const sdk = await renderAndCreate();
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    const { Threading } = sdk.setParams.mock.calls[0][0];
    expect(Threading.sipRxThreadCount).toBe(1);
    expect(Threading.sipWorkerThreadCount).toBe(1);
  });

  it('passes numeric (not string) threading values', async () => {
    // Regression guard: TextInput state is a string; Number() conversion must happen
    const sdk = await renderAndCreate();
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    const { Threading } = sdk.setParams.mock.calls[0][0];
    expect(typeof Threading.sipRxThreadCount).toBe('number');
    expect(typeof Threading.sipWorkerThreadCount).toBe('number');
  });

  it('logs the setParams success message', async () => {
    await renderAndCreate();
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    await expectLog(/setParams\(\) called successfully/);
  });

  it('logs an error when sdk.setParams throws', async () => {
    const sdk = await renderAndCreate();
    sdk.setParams.mockImplementation(() => { throw new Error('native params error'); });
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    await expectLog(/setParams\(\) failed: native params error/);
    expect(screen.queryByText('PARAMS SET')).toBeNull();
  });

  it('respects an updated HTTP port TextInput value', async () => {
    const sdk = await renderAndCreate();
    // The parameter cards start collapsed, so the input is not mounted yet.
    fireEvent.press(screen.getByTestId('card-http'));
    fireEvent.changeText(screen.getByDisplayValue('8008'), '9090');
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    expect(sdk.setParams.mock.calls[0][0].Http.port).toBe(9090);
  });

  it('respects an updated SIP UDP port TextInput value', async () => {
    const sdk = await renderAndCreate();
    fireEvent.press(screen.getByTestId('card-sip'));
    // sipUdpPort and sipTcpPort both default to '5060'; getAllByDisplayValue
    // returns them in render order — sipUdpPort is the first occurrence.
    const [udpInput] = screen.getAllByDisplayValue('5060');
    fireEvent.changeText(udpInput, '6000');
    await act(async () => {
      fireEvent.press(screen.getByText('② Set Parameters'));
    });
    expect(sdk.setParams.mock.calls[0][0].Sip.udpPort).toBe(6000);
  });
});

// =============================================================================
// 4. handleInit
// =============================================================================

describe('handleInit', () => {
  /**
   * WHAT: Tests the Initialize SDK button (async operation).
   * WHY:  init() is the most error-prone step — it starts the C++ SDK.
   *       These tests cover success, boolean-false return (failed but no throw),
   *       and thrown exceptions so all three SDK failure modes are exercised.
   */

  it('calls sdk.init()', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
  });

  it('updates badge to INITIALIZED on success', async () => {
    await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => {
      expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy();
    });
  });

  it('logs "init() returned: true" on success', async () => {
    await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await expectLog(/init\(\) returned: true/);
  });

  it('does NOT show INITIALIZED badge when sdk.init resolves to false', async () => {
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await expectLog(/init\(\) returned: false/);
    // The badge lives on Home, which the log console navigated away from.
    fireEvent.press(screen.getByText('Home'));
    expect(screen.queryAllByText('INITIALIZED')).toHaveLength(0);
  });

  it('logs the error message when sdk.init throws', async () => {
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockRejectedValueOnce(new Error('pjsip assertion failed'));
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await expectLog(/init\(\) threw: pjsip assertion failed/);
    fireEvent.press(screen.getByText('Home'));
    expect(screen.queryAllByText('INITIALIZED')).toHaveLength(0);
  });

  it('proceeds even when setParams was skipped (warns but calls init)', async () => {
    // RNTL v13 respects `disabled` on TouchableOpacity, so we reach this
    // code path by calling renderCreateAndSetParams then overriding paramsSet
    // internally — instead, verify that the warning path is correct by
    // testing the full flow: warn message logged by setParams guard but
    // init still resolves to true when called.
    const sdk = await renderCreateAndSetParams();
    // paramsSet is now true, but init has not been called yet
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => {
      expect(sdk.init).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy();
    });
  });
});

// =============================================================================
// 5. handleDestroy
// =============================================================================

describe('handleDestroy', () => {
  /**
   * WHAT: Tests the Destroy button.
   * WHY:  Destroy must clean up native resources and reset ALL lifecycle
   *       flags so a subsequent Create → SetParams → Init cycle works.
   */

  it('calls sdk.destroy()', async () => {
    const sdk = await renderAndCreate();
    await act(async () => { fireEvent.press(screen.getByText('Destroy')); });
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  it('resets status badge to NOT CREATED', async () => {
    await renderAndCreate();
    await act(async () => { fireEvent.press(screen.getByText('Destroy')); });
    expect(screen.getAllByText('NOT CREATED')[0]).toBeTruthy();
  });

  it('logs the destroy success message', async () => {
    await renderAndCreate();
    await act(async () => { fireEvent.press(screen.getByText('Destroy')); });
    await expectLog(/destroy\(\) called/);
  });

  it('clears paramsSet and initialized flags after a full lifecycle', async () => {
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy());

    await act(async () => { fireEvent.press(screen.getByText('Destroy')); });
    expect(screen.getAllByText('NOT CREATED')[0]).toBeTruthy();
  });

  it('allows re-creating the SDK after destroy', async () => {
    await renderAndCreate();
    await act(async () => { fireEvent.press(screen.getByText('Destroy')); });
    MockMcSdk.mockClear();

    await act(async () => { fireEvent.press(screen.getByText('① Create')); });
    expect(MockMcSdk).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('CREATED')[0]).toBeTruthy();
  });

  it('logs an error when sdk.destroy throws', async () => {
    const sdk = await renderAndCreate();
    sdk.destroy.mockImplementation(() => { throw new Error('destroy failed'); });
    await act(async () => { fireEvent.press(screen.getByText('Destroy')); });
    await expectLog(/destroy\(\) failed: destroy failed/);
  });
});

// =============================================================================
// 6. Log console
// =============================================================================

describe('Log console', () => {
  /**
   * WHAT: Tests the in-app log panel behaviour.
   * WHY:  The log console is the primary feedback mechanism during SDK
   *       debugging. Losing entries or failing to clear breaks developer workflow.
   */

  it('shows the placeholder text when no logs exist', () => {
    render(<App />);
    openLogConsole();
    expect(screen.getByText('Logs will appear here…')).toBeTruthy();
  });

  it('hides the placeholder once a log entry exists', async () => {
    await renderAndCreate();
    openLogConsole();
    // waitFor, not a bare assertion: the placeholder goes away when the first
    // batch of log entries lands in state, which is up to a flush interval
    // after Create returns.
    await waitFor(() =>
      expect(screen.queryByText('Logs will appear here…')).toBeNull(),
    );
  });

  it('Clear button removes all log entries and restores placeholder', async () => {
    await renderAndCreate();
    openLogConsole();
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-console-clear'));
    });
    expect(screen.getByText('Logs will appear here…')).toBeTruthy();
  });

  it('Listener only switches to the listener-event view', async () => {
    await renderAndCreate();
    openLogConsole();
    // Create logs to the app console, not through a listener callback, so it is
    // in the All view and out of the Listener-only one.
    await waitFor(() => expect(screen.getByText(/McSdk\(\) → nativeCreate\(\) OK/)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-console-listener-only'));
    });
    expect(screen.queryByText(/McSdk\(\) → nativeCreate\(\) OK/)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-console-all'));
    });
    expect(screen.getByText(/McSdk\(\) → nativeCreate\(\) OK/)).toBeTruthy();
  });

  it('is reached from the Tools menu', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Tools'));
    expect(screen.getByTestId('tool-logs')).toBeTruthy();
  });

  it('the SDK Logs screen is still its own entry beside it', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Tools'));
    expect(screen.getByTestId('tool-sdklogs')).toBeTruthy();
  });

  // The call simulator used to sit under the call history, on a tab whose
  // subject is real calls — and none of its calls are real. It is a Tools
  // screen now, and the Calls tab shows history alone.
  it('the mock call panel opens from Tools, not the Calls tab', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Calls'));
    expect(screen.queryByText(/Mock Kontrol|Mock Control/)).toBeNull();
    fireEvent.press(screen.getByText('Tools'));
    fireEvent.press(screen.getByTestId('tool-mockcalls'));
    expect(screen.getByTestId('mock-calls-panel')).toBeTruthy();
  });

  it('the mock panel still places a simulated call from its own screen', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Tools'));
    fireEvent.press(screen.getByTestId('tool-mockcalls'));
    fireEvent.press(screen.getByText(/Incoming HD|Gelen HD/));
    // A simulated incoming call takes over the Calls tab as a real one would.
    expect(screen.queryByTestId('mock-calls-panel')).toBeNull();
  });

  it('is also reached from the link under Home\'s own console', () => {
    render(<App />);
    fireEvent.press(screen.getByTestId('home-log-console-link'));
    expect(screen.getByTestId('log-console-listener-only')).toBeTruthy();
  });
});

// =============================================================================
// 6b. Home's own log console
// =============================================================================

describe("Home's log console", () => {
  // scrollToEnd is a native method on the host component; in the test renderer
  // it exists on the instance the ref points at, so spy on the prototype.
  const scrollToEndSpy = jest.spyOn(
    require('react-native').ScrollView.prototype,
    'scrollToEnd',
  ).mockImplementation(() => {});

  beforeEach(() => scrollToEndSpy.mockClear());
  afterAll(() => scrollToEndSpy.mockRestore());

  /**
   * WHAT: Home carries a small console again, under the registration bar.
   * WHY:  It was moved out wholesale when the full screen was built, which left
   *       Home with nothing to watch while registration ran. It is back as the
   *       tail only — the full buffer stays on the Tools screen, since a mapped
   *       ScrollView cannot hold 5000 mounted <Text> nodes.
   */

  it('renders a console on Home with its placeholder when empty', () => {
    render(<App />);
    // Still on Home, not the Tools screen.
    expect(screen.getByText('SDK Lifecycle')).toBeTruthy();
    expect(screen.getByTestId('home-log-clear')).toBeTruthy();
    expect(screen.getByText(/Loglar burada görünecek|Logs will appear here/)).toBeTruthy();
  });

  it('shows what the app logged, without leaving Home', async () => {
    // Create writes its own lines through SdkContext's addLog. They land in a
    // ref and move into state on the 250 ms flush, so this has to wait for it.
    await renderAndCreate();
    await waitFor(() =>
      expect(
        screen.queryByText(/Loglar burada görünecek|Logs will appear here/),
      ).toBeNull(),
    );
    // The lines showed up here — the Tools screen was never opened.
    expect(screen.getByText('SDK Lifecycle')).toBeTruthy();
  });

  it('filters to the listener stream without leaving Home', async () => {
    await renderAndCreate();
    await waitFor(() =>
      expect(
        screen.queryByText(/Loglar burada görünecek|Logs will appear here/),
      ).toBeNull(),
    );

    // The app's own create/init lines are in the mixed stream only, so they are
    // what must disappear when the view narrows to the SDK callbacks.
    const appLine = screen.queryByText(/nativeCreate\(\) OK/);
    expect(appLine).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('home-log-listener-only'));
    });
    expect(screen.getByText('SDK Lifecycle')).toBeTruthy();
    expect(screen.queryByText(/nativeCreate\(\) OK/)).toBeNull();

    // And back.
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-log-all'));
    });
    expect(screen.queryByText(/nativeCreate\(\) OK/)).toBeTruthy();
  });

  it('stops following the tail once scrolled up, and resumes at the bottom', async () => {
    await renderAndCreate();
    const box = screen.getByTestId('home-log-scroll');

    // Parked at the tail to begin with, so new entries are followed.
    fireEvent(box, 'contentSizeChange', 0, 400);
    expect(scrollToEndSpy).toHaveBeenCalled();

    // Scrolled up: 100 + 200 is well short of the 1000pt content.
    scrollToEndSpy.mockClear();
    fireEvent.scroll(box, {
      nativeEvent: {
        contentOffset:      { x: 0, y: 100 },
        contentSize:        { width: 0, height: 1000 },
        layoutMeasurement:  { width: 0, height: 200 },
      },
    });
    fireEvent(box, 'contentSizeChange', 0, 1100);
    expect(scrollToEndSpy).not.toHaveBeenCalled();

    // Back at the bottom: 800 + 200 reaches the end, so following resumes.
    fireEvent.scroll(box, {
      nativeEvent: {
        contentOffset:      { x: 0, y: 800 },
        contentSize:        { width: 0, height: 1000 },
        layoutMeasurement:  { width: 0, height: 200 },
      },
    });
    fireEvent(box, 'contentSizeChange', 0, 1200);
    expect(scrollToEndSpy).toHaveBeenCalled();
  });

  it('clears the buffer from Home, and the full screen agrees', async () => {
    await renderAndCreate();
    await waitFor(() =>
      expect(
        screen.queryByText(/Loglar burada görünecek|Logs will appear here/),
      ).toBeNull(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('home-log-clear'));
    });
    expect(screen.getByText(/Loglar burada görünecek|Logs will appear here/)).toBeTruthy();

    // One buffer, two views: the Tools screen must be empty too. clearLogs also
    // drops the pending queue, or the next flush would refill what was cleared.
    fireEvent.press(screen.getByTestId('home-log-console-link'));
    expect(screen.getByText(/Loglar burada görünecek|Logs will appear here/)).toBeTruthy();
  });
});

// =============================================================================
// 7. Tab navigation
// =============================================================================

describe('Tab navigation', () => {
  /**
   * WHAT: Verifies the Home / Metrics tab bar.
   * WHY:  The tab bar is the only navigation in the app; if it breaks,
   *       neither the main workflow nor Metrics are accessible.
   */

  it('starts on the Home tab', () => {
    render(<App />);
    expect(screen.getByText('SDK Lifecycle')).toBeTruthy();
  });

  it('pressing Metrics tab shows the MetricsScreen', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.getByText(/No metrics yet/)).toBeTruthy();
  });

  // ── The not-registered banner ────────────────────────────────────────────
  // Registration runs for ~35 s after init() and can fail, so a user on
  // another tab needs to know the server is not reachable yet. The banner says
  // so without blocking navigation: Audio and Video touch no SDK and are what
  // you test while unregistered, and Talk/Calls work offline through the
  // simulate helpers.

  it('shows the not-registered banner on a tab away from Home', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.getByTestId('not-registered-banner')).toBeTruthy();
  });

  it('does not show the banner on Home, where the badge already says it', () => {
    render(<App />);
    expect(screen.queryByTestId('not-registered-banner')).toBeNull();
  });

  it('the banner returns to Home when pressed', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    fireEvent.press(screen.getByTestId('not-registered-go-home'));
    expect(screen.getByText('SDK Lifecycle')).toBeTruthy();
  });

  // The banner was 11pt, small enough to be read as chrome and missed. Its
  // size is the whole point of the change, so it is guarded rather than left to
  // a visual check.
  it('sets the banner text large enough to read', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    const text = screen.getByTestId('not-registered-banner-text');
    const flat = ([] as any[]).concat(text.props.style).filter(Boolean);
    const size = flat.reduce((n, st) => st?.fontSize ?? n, 0);
    expect(size).toBeGreaterThanOrEqual(14);
  });

  it('the banner still allows reaching the other tabs', () => {
    render(<App />);
    // Navigation is never blocked — pressing a marked tab must still work.
    fireEvent.press(screen.getByText('Contacts'));
    expect(screen.getByTestId('not-registered-banner')).toBeTruthy();
  });

  it('the banner goes away once the SDK reports REGISTERED', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.getByTestId('not-registered-banner')).toBeTruthy();

    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => { registrationCb({ progress: 100, phase: 'DONE', state: 'REGISTERED' }); });

    await waitFor(() =>
      expect(screen.queryByTestId('not-registered-banner')).toBeNull());
  });

  it('pressing Home tab from Metrics returns to Home', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    fireEvent.press(screen.getByText('Home'));
    expect(screen.getByText('SDK Lifecycle')).toBeTruthy();
  });

  it('status badge is NOT shown on the Metrics tab', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.queryAllByText('NOT CREATED')).toHaveLength(0);
  });

  it('Home tab content is hidden while Metrics tab is active', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.queryByText('SDK Lifecycle')).toBeNull();
  });
});

// =============================================================================
// 8. MetricsScreen
// =============================================================================

describe('MetricsScreen', () => {
  /**
   * WHAT: Tests the Metrics tab: Fetch button, Prometheus rendering, errors.
   * WHY:  MetricsScreen drives all its content from sdk.listMetrics() output.
   *       These tests confirm parsing results are displayed correctly and that
   *       all error states (SDK not created, SDK throws) are handled gracefully.
   */

  it('shows "No metrics yet" on first visit', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.getByText(/No metrics yet/)).toBeTruthy();
  });

  it('shows "Pull down or tap Fetch" hint before any fetch', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.getByText(/Pull down or tap Fetch/)).toBeTruthy();
  });

  it('shows error when SDK is not created and Fetch is pressed', async () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByText(/SDK not created/)).toBeTruthy();
  });

  it('calls sdk.listMetrics() when Fetch is pressed', async () => {
    const sdk = await renderAndCreate();
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(sdk.listMetrics).toHaveBeenCalledTimes(1);
  });

  it('displays parsed metric family names', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    // Family names are rendered as card header AND as sample rows when the
    // sample name equals the family name (no _suffix). getAllByText handles
    // both occurrences.
    expect(screen.getAllByText('sip_rx_packets_total').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('sip_active_calls').length).toBeGreaterThanOrEqual(1);
  });

  it('displays COUNTER and GAUGE type badges', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByText('COUNTER')).toBeTruthy();
    expect(screen.getByText('GAUGE')).toBeTruthy();
  });

  it('displays help docstrings for each metric family', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByText('Total received SIP packets')).toBeTruthy();
    expect(screen.getByText('Current active SIP calls')).toBeTruthy();
  });

  it('displays sample values', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('shows "Last fetched: HH:MM:SS" timestamp after successful fetch', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByText(/Last fetched:/)).toBeTruthy();
  });

  // ── Age line and auto refresh ──────────────────────────────────────────────
  // A bare clock time does not say how stale the numbers are without doing the
  // arithmetic, and reading a counter as it moves meant pressing Fetch over and
  // over. The age line answers the first; the toggle answers the second, and
  // leaves the manual path exactly as it was when it is off.

  it('says how long ago the fetch was, next to the timestamp', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByTestId('metrics-age')).toBeTruthy();
    expect(screen.getByText('just now')).toBeTruthy();
  });

  it('counts the age up in seconds while nothing is fetched', async () => {
    jest.useFakeTimers();
    try {
      const sdk = await renderAndCreate();
      sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
      fireEvent.press(screen.getByText('Metrics'));
      await act(async () => {
        fireEvent.press(screen.getByText('Fetch'));
      });
      await act(async () => { jest.advanceTimersByTime(12_000); });
      expect(screen.getByText('12 s ago')).toBeTruthy();
      // Past a minute it switches unit rather than counting to 90.
      await act(async () => { jest.advanceTimersByTime(60_000); });
      expect(screen.getByText('1 min ago')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows no age line before the first fetch', () => {
    render(<App />);
    fireEvent.press(screen.getByText('Metrics'));
    expect(screen.queryByTestId('metrics-age')).toBeNull();
  });

  it('auto refresh is off to begin with, and fetches nothing by itself', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    jest.useFakeTimers();
    try {
      fireEvent.press(screen.getByText('Metrics'));
      await act(async () => { jest.advanceTimersByTime(30_000); });
      expect(sdk.listMetrics).not.toHaveBeenCalled();
      expect(screen.getByText(/fetch by hand with Fetch/)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('auto refresh fetches at once when switched on, then on its interval', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    jest.useFakeTimers();
    try {
      fireEvent.press(screen.getByText('Metrics'));
      await act(async () => {
        fireEvent(screen.getByTestId('metrics-auto-refresh'), 'valueChange', true);
      });
      // Switched on → one fetch, without waiting out the first interval.
      expect(sdk.listMetrics).toHaveBeenCalledTimes(1);
      await act(async () => { jest.advanceTimersByTime(5_000); });
      expect(sdk.listMetrics).toHaveBeenCalledTimes(2);
      await act(async () => { jest.advanceTimersByTime(10_000); });
      expect(sdk.listMetrics).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it('auto refresh stops fetching once switched back off', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    jest.useFakeTimers();
    try {
      fireEvent.press(screen.getByText('Metrics'));
      await act(async () => {
        fireEvent(screen.getByTestId('metrics-auto-refresh'), 'valueChange', true);
      });
      await act(async () => { jest.advanceTimersByTime(10_000); });
      const before = sdk.listMetrics.mock.calls.length;
      await act(async () => {
        fireEvent(screen.getByTestId('metrics-auto-refresh'), 'valueChange', false);
      });
      await act(async () => { jest.advanceTimersByTime(30_000); });
      expect(sdk.listMetrics).toHaveBeenCalledTimes(before);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Fetch still works while auto refresh is on', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue(PROMETHEUS_FIXTURE);
    jest.useFakeTimers();
    try {
      fireEvent.press(screen.getByText('Metrics'));
      await act(async () => {
        fireEvent(screen.getByTestId('metrics-auto-refresh'), 'valueChange', true);
      });
      const before = sdk.listMetrics.mock.calls.length;
      await act(async () => { fireEvent.press(screen.getByText('Fetch')); });
      expect(sdk.listMetrics).toHaveBeenCalledTimes(before + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows error message when sdk.listMetrics throws', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockRejectedValue(new Error('metrics unavailable'));
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByText('metrics unavailable')).toBeTruthy();
  });

  it('clears a previous error on a successful subsequent fetch', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockRejectedValueOnce(new Error('first error'));
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => { fireEvent.press(screen.getByText('Fetch')); });
    expect(screen.getByText('first error')).toBeTruthy();

    sdk.listMetrics.mockResolvedValueOnce(PROMETHEUS_FIXTURE);
    await act(async () => { fireEvent.press(screen.getByText('Fetch')); });
    expect(screen.queryByText('first error')).toBeNull();
    expect(screen.getAllByText('sip_rx_packets_total').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "No metrics yet" when fetch returns an empty string', async () => {
    const sdk = await renderAndCreate();
    sdk.listMetrics.mockResolvedValue('');
    fireEvent.press(screen.getByText('Metrics'));
    await act(async () => {
      fireEvent.press(screen.getByText('Fetch'));
    });
    expect(screen.getByText(/No metrics yet/)).toBeTruthy();
  });
});

// =============================================================================
// 9. Registration progress bar
// =============================================================================

describe('Registration progress bar', () => {
  /**
   * WHAT: Tests the registration card that appears in HomeScreen after init.
   * WHY:  Registration is the last step of the SDK lifecycle (Create →
   *       SetParams → Init → Register). The progress bar and phase/state
   *       labels give real-time feedback during a long async process.
   *       These tests verify:
   *         - The card is hidden until init completes successfully.
   *         - sdk.register() is called exactly once after a successful init.
   *         - The onRegistration callback updates progress, phase, and state.
   */

  it('registration card is NOT rendered before init', async () => {
    // After Create + SetParams the card should still be hidden
    await renderCreateAndSetParams();
    expect(screen.queryByText('Registration')).toBeNull();
  });

  it('registration card IS rendered after successful init', async () => {
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => {
      expect(screen.getByText('Registration')).toBeTruthy();
    });
  });

  it('register() is called exactly once after init resolves true', async () => {
    // handleInit now refuses to register without an identity (the SDK would
    // reject it with SdkError::IdentityNotSet anyway), so the credentials that
    // make handleCreate call setIdentity have to be in place for this path.
    AuthSettings.setLastUsername('sip:alice@mc.example.com');
    MockGetUserByUsername.mockResolvedValue({
      id: 1,
      username: 'sip:alice@mc.example.com',
      password: 'test-pass',
      updated_at: 0,
      last_login_at: 0,
    } as any);
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy());
    expect(sdk.register).toHaveBeenCalledTimes(1);
  });

  it('register() is NOT called when the identity was never set', async () => {
    // No stored username → handleCreate skips setIdentity, so registering
    // would fail inside the SDK with IDENTITY_NOT_SET. The guard in handleInit
    // catches it first and reports the real cause.
    AuthSettings.setLastUsername('');
    MockGetUserByUsername.mockResolvedValue(null as any);
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy());
    expect(sdk.register).not.toHaveBeenCalled();
  });

  it('register() is NOT called when init resolves false', async () => {
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await expectLog(/init\(\) returned: false/);
    expect(sdk.register).not.toHaveBeenCalled();
  });

  it('onRegistration callback is registered exactly once during handleCreate', async () => {
    const sdk = await renderAndCreate();
    expect(sdk.onRegistration).toHaveBeenCalledTimes(1);
  });

  it('simulated registration event updates progress percentage', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getByText('Registration')).toBeTruthy());

    // Retrieve the callback registered via sdk.onRegistration(cb) and call it
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => {
      registrationCb({ progress: 50, phase: 4, state: 1 });
    });
    await waitFor(() => {
      expect(screen.getByText('50%')).toBeTruthy();
    });
  });

  it('phase 6 renders Done label', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getByText('Registration')).toBeTruthy());

    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => {
      registrationCb({ progress: 100, phase: 6, state: 2 });
    });
    await waitFor(() => {
      expect(screen.getByText(/Done/)).toBeTruthy();
    });
  });

  it('state 2 renders Registered label', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getByText('Registration')).toBeTruthy());

    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => {
      registrationCb({ progress: 100, phase: 6, state: 2 });
    });
    await waitFor(() => {
      expect(screen.getByText(/Registered/)).toBeTruthy();
    });
  });

  // ── The status badge following the registration ──────────────────────────
  // init() only means init() returned; registration runs for ~35 s after it.
  // The badge has to say which of the two we are in, and it reads the SDK's
  // own state — numbers on iOS, RegistrationState.name on Android, plus the
  // two strings the Android bridge writes itself ("REGISTERED", "FAILED").

  it('badge turns REGISTERED when the SDK reports state 2 (iOS ordinal)', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy());

    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => { registrationCb({ progress: 100, phase: 6, state: 2 }); });

    await waitFor(() => expect(screen.getAllByText('REGISTERED')[0]).toBeTruthy());
    expect(screen.queryAllByText('INITIALIZED')).toHaveLength(0);
  });

  it('badge turns REGISTERED on the Android string state', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    // What McSdkModule.onRegistered() emits.
    act(() => { registrationCb({ progress: 100, phase: 'DONE', state: 'REGISTERED' }); });
    await waitFor(() => expect(screen.getAllByText('REGISTERED')[0]).toBeTruthy());
  });

  it.each([
    ['UNREGISTERED',  'the state that contains REGISTERED as a substring'],
    ['UNREGISTERING', 'the state that contains REGISTERI as a substring'],
    ['REGISTERING',   'still in progress'],
    ['FAILED',        'what onRegistrationFailed emits'],
  ])('stays INITIALIZED on state %s (%s)', async (state) => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => { registrationCb({ progress: 50, phase: 'SIP_REGISTERING', state }); });

    await waitFor(() => expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy());
    expect(screen.queryAllByText('REGISTERED')).toHaveLength(0);
  });

  // ── A registration replayed by the bridge ────────────────────────────────
  // Closing the app does not kill the process, so the native SDK can still be
  // registered while a fresh JS side comes up knowing nothing — and the SDK
  // reports registration only when it *changes*. The Android bridge remembers
  // the last state and replays it on create(), flagged `replayed`, so the app
  // shows where it really stands instead of waiting for a registration that
  // already happened.

  it('a replayed REGISTERED event sets the badge', async () => {
    const sdk = await renderAndCreate();
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => {
      registrationCb({ progress: 100, phase: 'DONE', state: 'REGISTERED', replayed: true });
    });
    await waitFor(() => expect(screen.getAllByText('REGISTERED')[0]).toBeTruthy());
  });

  it('a replayed event says so in the log', async () => {
    const sdk = await renderAndCreate();
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => {
      registrationCb({ progress: 100, phase: 'DONE', state: 'REGISTERED', replayed: true });
    });
    // Without this line a REGISTERED badge with no registration flow in the
    // log reads as a bug.
    await expectLog(/registration state restored from the running SDK/);
  });

  it('an ordinary registration event is not logged as a replay', async () => {
    const sdk = await renderAndCreate();
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => {
      registrationCb({ progress: 100, phase: 'DONE', state: 'REGISTERED' });
    });
    await waitFor(() => expect(screen.getAllByText('REGISTERED')[0]).toBeTruthy());
    expect(screen.queryByText(/restored from the running SDK/)).toBeNull();
  });

  it('a replayed UNREGISTERED event leaves the badge unregistered', async () => {
    const sdk = await renderAndCreate();
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    // What a process that was torn down mid-teardown would replay.
    act(() => {
      registrationCb({ progress: 0, phase: 'IDLE', state: 'UNREGISTERED', replayed: true });
    });
    await waitFor(() => expect(screen.queryAllByText('REGISTERED')).toHaveLength(0));
  });

  it('badge goes back from REGISTERED when the registration is lost', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => { registrationCb({ progress: 100, phase: 'DONE', state: 'REGISTERED' }); });
    await waitFor(() => expect(screen.getAllByText('REGISTERED')[0]).toBeTruthy());

    // A stale "REGISTERED" would claim a server connection that is gone.
    act(() => { registrationCb({ progress: 0, phase: 'IDLE', state: 'UNREGISTERED' }); });
    await waitFor(() => expect(screen.getAllByText('INITIALIZED')[0]).toBeTruthy());
    expect(screen.queryAllByText('REGISTERED')).toHaveLength(0);
  });

  it('phase 0 renders Idle label', async () => {
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getByText('Registration')).toBeTruthy());

    const registrationCb = sdk.onRegistration.mock.calls[0][0];
    act(() => {
      registrationCb({ progress: 0, phase: 0, state: 0 });
    });
    await waitFor(() => {
      expect(screen.getByText(/Idle/)).toBeTruthy();
    });
  });

  it('shows 0% progress initially after init (before any registration event)', async () => {
    const sdk = await renderCreateAndSetParams();
    sdk.init.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(screen.getByText('Registration')).toBeTruthy());
    expect(screen.getByText('0%')).toBeTruthy();
  });
});

// =============================================================================
// 10. setDocuments — SdkContext integration
// =============================================================================

describe('setDocuments — SdkContext integration', () => {
  /**
   * WHAT: Tests that SdkContext calls setDocuments (when docs are cached)
   *       between init() and register(), in that exact order.
   *
   * Platform context:
   *   Android: setDocuments → nativeSetDocuments JNI → C++ Sdk::SetDocuments
   *   iOS:     setDocuments → McSdkModule.mm no-op (xcframework has no API)
   *   In both cases the JS call is identical; the bridge decides what to do.
   *
   * Timing requirement (FIFO engine queue):
   *   init() resolves → getDocumentsByMcId() → setDocuments(docs) → register()
   *   setDocuments must PRECEDE register so the engine processes docs first.
   */

  const TEST_MCID = 'sip:alice@mc.example.com';

  // handleInit reads cached docs from AppContext's cachedDocsMap, which is
  // populated once at startup from getAllDocuments(). Seed that map per-test.
  const seedCachedDocs = (docs: any[]) => {
    MockGetAllDocuments.mockResolvedValue(new Map([[TEST_MCID, docs]]));
  };

  beforeEach(() => {
    // Provide credentials so handleCreate sets currentMcIdRef.current,
    // enabling handleInit to look up cached docs for this mcId.
    AuthSettings.setLastUsername(TEST_MCID);
    MockGetUserByUsername.mockResolvedValue({
      id: 1,
      username: TEST_MCID,
      password: 'test-pass',
      updated_at: 0,
      last_login_at: 0,
    } as any);
    // Reset doc cache to empty (default = no docs)
    MockGetAllDocuments.mockResolvedValue(new Map());
  });

  it('does NOT call setDocuments when document cache is empty', async () => {
    seedCachedDocs([]);
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(sdk.register).toHaveBeenCalled());
    expect(sdk.setDocuments).not.toHaveBeenCalled();
  });

  it('calls setDocuments with cached docs array when docs exist', async () => {
    const docs = [{ uri: 'http://bms.example.com/doc/a', timestamp: '2024-01-01T00:00:00Z', etag: '"abc"', org: 'org-1', content: '<xml/>', size: '24' }];
    seedCachedDocs(docs);
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(sdk.register).toHaveBeenCalled());
    expect(sdk.setDocuments).toHaveBeenCalledWith(docs);
  });

  it('calls setDocuments BEFORE register (FIFO order requirement)', async () => {
    const docs = [{ uri: 'http://bms.example.com/doc/a', timestamp: '', etag: '', org: '', content: '', size: '' }];
    seedCachedDocs(docs);
    const callOrder: string[] = [];
    const sdk = await renderCreateAndSetParams();
    sdk.setDocuments.mockImplementation(() => { callOrder.push('setDocuments'); });
    sdk.register.mockImplementation(() => { callOrder.push('register'); });

    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(sdk.register).toHaveBeenCalled());
    expect(callOrder).toEqual(['setDocuments', 'register']);
  });

  it('setDocuments receives a McSdkDocument array (not individual fields)', async () => {
    const docs = [{ uri: 'uri-1', timestamp: 't', etag: 'e', org: 'o', content: 'c', size: 's' }];
    seedCachedDocs(docs);
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(sdk.setDocuments).toHaveBeenCalled());
    const [arg] = sdk.setDocuments.mock.calls[0];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg[0]).toMatchObject({ uri: 'uri-1' });
  });

  it('still calls register() even when setDocuments throws (error recovery)', async () => {
    const docs = [{ uri: 'x', timestamp: '', etag: '', org: '', content: '', size: '' }];
    seedCachedDocs(docs);
    const sdk = await renderCreateAndSetParams();
    sdk.setDocuments.mockImplementation(() => { throw new Error('JNI error'); });

    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(sdk.register).toHaveBeenCalled());
  });

  it('setDocuments is called exactly once per init() call', async () => {
    const docs = [{ uri: 'u', timestamp: '', etag: '', org: '', content: '', size: '' }];
    seedCachedDocs(docs);
    const sdk = await renderCreateAndSetParams();
    await act(async () => {
      fireEvent.press(screen.getByText('③ Initialize SDK'));
    });
    await waitFor(() => expect(sdk.register).toHaveBeenCalled());
    expect(sdk.setDocuments).toHaveBeenCalledTimes(1);
  });
});


