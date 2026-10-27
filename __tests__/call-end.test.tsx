/**
 * __tests__/call-end.test.tsx
 *
 * How a call ended, in words: the text for each SDK termination, and the
 * banner that says it once the call screen has closed on its own.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getTranslation } from '../src/core/i18n';
import { callEndDetail, callEndText, endedRemotely } from '../src/features/calls/callEndText';
import type { CallEnd, CallRecord } from '../src/features/calls/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/contexts/AppContext', () => ({
  useAppContext: () => ({
    c: require('../src/core/theme').getThemePalette('dark'),
    theme: 'dark',
    tr: require('../src/core/i18n').getTranslation('en'),
  }),
}));

const mockCall = { callHistory: [] as CallRecord[] };
jest.mock('../src/contexts/CallContext', () => ({
  useCallContext: () => mockCall,
}));

import { CALL_END_NOTICE_MS, CallEndBanner } from '../src/features/calls/CallEndBanner';

const en = getTranslation('en');
const end = (mode: CallEnd['mode'], reason: CallEnd['reason'], over: Partial<CallEnd> = {}): CallEnd =>
  ({ mode, reason, ...over });

describe('callEndText', () => {
  it.each<[CallEnd, string]>([
    [end('CLOSED_REMOTELY', 'NORMAL'),           en.callEndRemote],
    [end('CLOSED_LOCALLY', 'NORMAL'),            en.callEndLocal],
    [end('CLOSED_REMOTELY', 'CONNECTION_LOST'),  en.callEndConnectionLost],
    [end('TIMEOUT', 'CONNECTION_LOST'),          en.callEndConnectionLost],
    [end('REJECTED_REMOTELY', 'BUSY'),           en.callEndBusy],
    [end('REJECTED_REMOTELY', 'DECLINED'),       en.callEndDeclined],
    [end('REJECTED_REMOTELY', 'UNAVAILABLE'),    en.callEndUnavailable],
    [end('REJECTED_REMOTELY', 'FORBIDDEN'),      en.callEndForbidden],
    [end('TIMEOUT', 'NO_ANSWER'),                en.callEndNoAnswer],
    [end('CLOSED_REMOTELY', 'PREEMPTED'),        en.callEndPreempted],
    [end('CANCELLED_REMOTELY', 'UNKNOWN'),       en.callEndCancelledRemote],
    [end('REJECTED_LOCALLY', 'DECLINED'),        en.callEndRejectedLocal],
    [end('CANCELLED_LOCALLY', 'UNKNOWN'),        en.callEndCancelledLocal],
    [end('UNKNOWN', 'UNKNOWN'),                  en.callEndUnknown],
  ])('reads %j', (e, text) => {
    expect(callEndText(en, e)).toBe(text);
  });
});

describe('callEndDetail', () => {
  // Every BYE is 200 "Normal call clearing"; it adds nothing.
  it('leaves out a 2xx', () => {
    const e = end('CLOSED_REMOTELY', 'NORMAL', { sipCode: 200, sipReason: 'Normal call clearing' });
    expect(callEndDetail(en, e)).toBe(en.callEndRemote);
  });

  it('adds a failure response code and phrase', () => {
    const e = end('REJECTED_REMOTELY', 'UNAVAILABLE', { sipCode: 480, sipReason: 'Temporarily Unavailable' });
    expect(callEndDetail(en, e)).toBe(`${en.callEndUnavailable} (480 Temporarily Unavailable)`);
  });

  it('adds just the code when there is no phrase', () => {
    const e = end('REJECTED_REMOTELY', 'FORBIDDEN', { sipCode: 403, sipReason: '' });
    expect(callEndDetail(en, e)).toBe(`${en.callEndForbidden} (403)`);
  });
});

describe('endedRemotely', () => {
  it('is false for what the user did here', () => {
    expect(endedRemotely(end('CLOSED_LOCALLY', 'NORMAL'))).toBe(false);
    expect(endedRemotely(end('REJECTED_LOCALLY', 'DECLINED'))).toBe(false);
    expect(endedRemotely(end('CANCELLED_LOCALLY', 'UNKNOWN'))).toBe(false);
  });

  it('is true for everything else', () => {
    expect(endedRemotely(end('CLOSED_REMOTELY', 'NORMAL'))).toBe(true);
    expect(endedRemotely(end('TIMEOUT', 'NO_ANSWER'))).toBe(true);
  });
});

describe('CallEndBanner', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCall.callHistory = [];
  });
  afterEach(() => { jest.useRealTimers(); });

  let n = 0;
  const record = (e?: CallEnd): CallRecord => ({
    id: `rec-${++n}`,
    contactName: 'Bob',
    sipUri: 'sip:bob@example.org',
    direction: 'incoming',
    callType: 'half_duplex',
    commencementMode: 'auto',
    startedAt: 0,
    endedAt: 0,
    duration: 0,
    end: e,
  });

  /** Ends a call: the new record goes on top, as CallContext's archive does. */
  const ended = (rerender: (el: React.ReactElement) => void, e?: CallEnd) => {
    mockCall.callHistory = [record(e), ...mockCall.callHistory];
    rerender(<CallEndBanner />);
  };

  it('says how the call ended when the far end ended it, then goes away', () => {
    const { rerender } = render(<CallEndBanner />);
    ended(rerender, end('CLOSED_REMOTELY', 'NORMAL'));
    expect(screen.getByTestId('call-end-banner')).toHaveTextContent(en.callEndRemote);

    act(() => { jest.advanceTimersByTime(CALL_END_NOTICE_MS); });
    expect(screen.queryByTestId('call-end-banner')).toBeNull();
  });

  it('stays quiet when the user ended the call', () => {
    const { rerender } = render(<CallEndBanner />);
    ended(rerender, end('CLOSED_LOCALLY', 'NORMAL'));
    expect(screen.queryByTestId('call-end-banner')).toBeNull();
  });

  it('stays quiet for a call with no end info', () => {
    const { rerender } = render(<CallEndBanner />);
    ended(rerender, undefined);
    expect(screen.queryByTestId('call-end-banner')).toBeNull();
  });

  // Only a call that ends while mounted is news.
  it('does not announce a call that had already ended', () => {
    mockCall.callHistory = [record(end('CLOSED_REMOTELY', 'NORMAL'))];
    render(<CallEndBanner />);
    expect(screen.queryByTestId('call-end-banner')).toBeNull();
  });

  it('announces two calls that end the same way in a row', () => {
    const { rerender } = render(<CallEndBanner />);
    ended(rerender, end('CLOSED_REMOTELY', 'NORMAL'));
    act(() => { jest.advanceTimersByTime(CALL_END_NOTICE_MS); });
    ended(rerender, end('CLOSED_REMOTELY', 'NORMAL'));
    expect(screen.getByTestId('call-end-banner')).toHaveTextContent(en.callEndRemote);
  });
});
