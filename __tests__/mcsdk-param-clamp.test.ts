/**
 * __tests__/mcsdk-param-clamp.test.ts
 *
 * McSdk.setParams() is the single point where parameters cross to native code,
 * so it is where invalid input has to be stopped.
 *
 * The settings screen takes free text. Without clamping, three things go wrong
 * quietly rather than loudly:
 *   - a non-numeric entry becomes NaN, which JSON.stringify writes as null, and
 *     Kotlin's optInt() then replaces with its own default;
 *   - LogLevel.fromValue maps anything outside 0..5 to VERBOSE, so asking for
 *     level 9 (the most verbose the user could imagine) selects the least;
 *   - a fractional value is truncated somewhere down the line with no notice.
 */

import { McSdk } from '../src/mcsdk';
import NativeMcSdk from '../src/mcsdk/NativeMcSdk';

jest.mock('../src/mcsdk/NativeMcSdk', () => ({
  create: jest.fn(),
  destroy: jest.fn(),
  setParams: jest.fn(),
  init: jest.fn().mockResolvedValue(true),
  setIdentity: jest.fn(),
  setDocuments: jest.fn(),
  register: jest.fn(),
}));

/** The flattened payload the bridge actually receives. */
function sentParams(): any {
  const json = (NativeMcSdk.setParams as jest.Mock).mock.calls[0][0];
  return JSON.parse(json);
}

describe('McSdk.setParams — numeric clamping', () => {
  let sdk: McSdk;

  beforeEach(() => {
    jest.clearAllMocks();
    sdk = new McSdk();
  });

  // ── Log levels ──────────────────────────────────────────────────────────────

  it('passes a valid log level through untouched', () => {
    sdk.setParams({ Logging: { level: 3, pjLevel: 5 } as any });
    expect(sentParams().logLevel).toBe(3);
    expect(sentParams().pjLogLevel).toBe(5);
  });

  it('accepts both ends of the LogLevel range', () => {
    sdk.setParams({ Logging: { level: 0 } as any });
    expect(sentParams().logLevel).toBe(0);

    jest.clearAllMocks();
    sdk.setParams({ Logging: { level: 5 } as any });
    expect(sentParams().logLevel).toBe(5);
  });

  it('clamps an above-range log level to FATAL instead of falling back to VERBOSE', () => {
    // The bug this guards: LogLevel.fromValue(9) returns VERBOSE, the opposite
    // of what someone typing 9 wants.
    sdk.setParams({ Logging: { level: 9 } as any });
    expect(sentParams().logLevel).toBe(5);
  });

  it('clamps a negative log level to VERBOSE', () => {
    sdk.setParams({ Logging: { level: -2 } as any });
    expect(sentParams().logLevel).toBe(0);
  });

  it('replaces a non-numeric log level with a usable default', () => {
    sdk.setParams({ Logging: { level: 'abc' } as any });
    const sent = sentParams();
    expect(sent.logLevel).toBe(1);
    // Never null — that is what makes Kotlin silently substitute its own value.
    expect(sent.logLevel).not.toBeNull();
  });

  it('truncates a fractional log level', () => {
    sdk.setParams({ Logging: { level: 2.7 } as any });
    expect(sentParams().logLevel).toBe(2);
  });

  // ── Ports ───────────────────────────────────────────────────────────────────

  it('passes valid ports through untouched', () => {
    sdk.setParams({
      Http: { port: 8008 },
      Sip: { udpPort: 5060, tcpPort: 5062, tlsPort: 5061 },
    });
    const sent = sentParams();
    expect(sent.httpPort).toBe(8008);
    expect(sent.sipUdpPort).toBe(5060);
    expect(sent.sipTcpPort).toBe(5062);
    expect(sent.sipTlsPort).toBe(5061);
  });

  it('clamps a port above 65535', () => {
    sdk.setParams({ Sip: { udpPort: 99999 } });
    expect(sentParams().sipUdpPort).toBe(65535);
  });

  it('rejects port 0, which would mean "any port" to the OS', () => {
    sdk.setParams({ Http: { port: 0 } });
    expect(sentParams().httpPort).toBe(1);
  });

  it('replaces a non-numeric port with its documented default', () => {
    sdk.setParams({ Http: { port: '' } as any });
    expect(sentParams().httpPort).toBe(8008);
  });

  // ── Thread counts ───────────────────────────────────────────────────────────

  it('keeps thread counts at or above one', () => {
    sdk.setParams({ Threading: { sipRxThreadCount: 0, sipWorkerThreadCount: -5 } });
    const sent = sentParams();
    expect(sent.sipRxThreads).toBe(1);
    expect(sent.sipWorkerThreads).toBe(1);
  });

  it('passes a valid thread count through', () => {
    sdk.setParams({ Threading: { sipRxThreadCount: 4, sipWorkerThreadCount: 2 } });
    const sent = sentParams();
    expect(sent.sipRxThreads).toBe(4);
    expect(sent.sipWorkerThreads).toBe(2);
  });

  // ── Expiry values ───────────────────────────────────────────────────────────

  it('keeps SIP expiry values inside the unsigned 32-bit range', () => {
    sdk.setParams({ Mcx: { registerExpires: -1, pocExpires: 8589934592 } });
    const sent = sentParams();
    expect(sent.registerExpires).toBe(1);
    expect(sent.pocExpires).toBe(4294967295);
  });

  // ── Whole-payload guarantee ─────────────────────────────────────────────────

  it('never sends null or NaN for any numeric field', () => {
    // A single bad field must not be able to poison the payload.
    sdk.setParams({
      Logging: { level: 'x', pjLevel: undefined } as any,
      Http: { port: NaN } as any,
      Sip: { udpPort: 'abc', tcpPort: null, tlsPort: Infinity } as any,
      Threading: { sipRxThreadCount: NaN, sipWorkerThreadCount: 'two' } as any,
    });
    const sent = sentParams();
    for (const [key, value] of Object.entries(sent)) {
      if (typeof value === 'number' || value === null) {
        expect(value).not.toBeNull();
        expect(Number.isFinite(value as number)).toBe(true);
      }
    }
  });
});
