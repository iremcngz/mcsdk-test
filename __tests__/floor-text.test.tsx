/**
 * __tests__/floor-text.test.tsx
 *
 * The floor's user-facing text: what each CallContext floorNotice reads as,
 * and how long a notice stays on screen.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getTranslation } from '../src/core/i18n';
import {
  FLOOR_NOTICE_MS,
  floorNoticeText,
  floorTalkerText,
  useTransientText,
} from '../src/features/calls/floorText';
import type { ActiveCall } from '../src/features/calls/types';

const en = getTranslation('en');
const tr = getTranslation('tr');

describe('floorNoticeText', () => {
  it.each([
    ['DENIED:ANOTHER_CLIENT_HAS_PERMISSION', en.floorDeniedOtherTalker],
    ['DENIED:RECEIVE_ONLY',                  en.floorDeniedReceiveOnly],
    ['DENIED:QUEUE_FULL',                    en.floorDeniedQueueFull],
    ['DENIED:RETRY_AFTER_NOT_EXPIRED',       en.floorDeniedRetryLater],
    ['REVOKED:MEDIA_BURST_TOO_LONG',         en.floorRevokedTooLong],
    ['REVOKED:MEDIA_BURST_PREEMPTED',        en.floorRevokedPreempted],
    ['REQUEST_TIMEOUT',                      en.floorRequestTimeout],
    ['QUEUE_TIMEOUT',                        en.floorQueueTimeout],
    ['GRANT_EXPIRED',                        en.floorGrantExpired],
    ['ERROR:FLOOR_SEND_FAILED',              en.floorErrorUnreachable],
  ])('reads %s as its own text', (notice, text) => {
    expect(floorNoticeText(en, notice)).toBe(text);
  });

  // A reason the app has no text for still says what happened.
  it('falls back to the generic line for other deny and revoke reasons', () => {
    expect(floorNoticeText(en, 'DENIED:INTERNAL_ERROR')).toBe(en.floorDenied);
    expect(floorNoticeText(en, 'REVOKED:SOMETHING_NEW')).toBe(en.floorRevoked);
  });

  it('has nothing to say without a notice, or for one it does not know', () => {
    expect(floorNoticeText(en, undefined)).toBeUndefined();
    expect(floorNoticeText(en, 'NOT_A_NOTICE')).toBeUndefined();
  });

  it('uses the active language', () => {
    expect(floorNoticeText(tr, 'REQUEST_TIMEOUT')).toBe('Sunucu cevap vermedi');
  });
});

describe('floorTalkerText', () => {
  const call = (floorOwner?: string) => ({ floorState: 'busy', floorOwner } as ActiveCall);

  it('names the talker when the server said who it is', () => {
    expect(floorTalkerText(en, call('mcuser-222'))).toBe('Talking: mcuser-222');
  });

  it('says the channel is in use when it did not', () => {
    expect(floorTalkerText(en, call())).toBe(en.floorChannelBusy);
  });
});

describe('useTransientText', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  function Probe({ text }: { text?: string }) {
    return <mock-text testID="shown">{useTransientText(text) ?? ''}</mock-text>;
  }

  it('shows a text and hides it after FLOOR_NOTICE_MS', () => {
    const { rerender } = render(<Probe />);
    rerender(<Probe text="Denied" />);
    expect(screen.getByTestId('shown')).toHaveTextContent('Denied');

    act(() => { jest.advanceTimersByTime(FLOOR_NOTICE_MS - 1); });
    expect(screen.getByTestId('shown')).toHaveTextContent('Denied');
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.getByTestId('shown')).toHaveTextContent('');
  });

  it('restarts the timer when the text changes', () => {
    const { rerender } = render(<Probe text="Denied" />);
    act(() => { jest.advanceTimersByTime(FLOOR_NOTICE_MS - 1000); });
    rerender(<Probe text="Timed out" />);
    act(() => { jest.advanceTimersByTime(FLOOR_NOTICE_MS - 1); });
    expect(screen.getByTestId('shown')).toHaveTextContent('Timed out');
  });

  it('hides at once when the text is cleared', () => {
    const { rerender } = render(<Probe text="Denied" />);
    rerender(<Probe />);
    expect(screen.getByTestId('shown')).toHaveTextContent('');
  });
});
