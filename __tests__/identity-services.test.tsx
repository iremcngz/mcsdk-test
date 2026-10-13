/**
 * __tests__/identity-services.test.tsx
 *
 * The MC services the *user* is registered for, from
 * SdkListener::onIdentityUpdated. Shown as badges in the header, so what
 * matters is that the flags survive the trip and start out empty.
 *
 * Note this is the user's authorisation — distinct from what a group supports
 * (onGroupsUpdated) and from what an affiliation covers (onAffiliationsUpdated).
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

const identityListeners: Array<(e: any) => void> = [];

const mockSdk = {
  affiliate: jest.fn(),
  deaffiliate: jest.fn(),
  onGroupsUpdated: () => ({ remove: () => {} }),
  onAffiliationsUpdated: () => ({ remove: () => {} }),
  onIdentityUpdated: (h: (e: any) => void) => {
    identityListeners.push(h);
    return {
      remove: () => {
        const i = identityListeners.indexOf(h);
        if (i >= 0) identityListeners.splice(i, 1);
      },
    };
  },
};

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }),
}));

import { TalkContextProvider, useTalkContext } from '../src/contexts/TalkContext';

let ctx: ReturnType<typeof useTalkContext>;

function Probe() {
  ctx = useTalkContext();
  const s = ctx.identityServices;
  return (
    <mock-text testID="svc">
      {[s.ptt && 'ptt', s.video && 'video', s.data && 'data'].filter(Boolean).join(',') || 'none'}
    </mock-text>
  );
}

const emitIdentity = (isPtt: boolean, isVideo: boolean, isData: boolean) =>
  act(() => { identityListeners.forEach(h => h({ isPtt, isVideo, isData })); });

beforeEach(() => { identityListeners.length = 0; });

describe('TalkContext — identity services', () => {
  it('starts with no services before registration completes', () => {
    render(<TalkContextProvider><Probe /></TalkContextProvider>);
    expect(screen.getByTestId('svc')).toHaveTextContent('none');
  });

  it('reflects every service the user is registered for', () => {
    render(<TalkContextProvider><Probe /></TalkContextProvider>);
    emitIdentity(true, true, true);
    expect(screen.getByTestId('svc')).toHaveTextContent('ptt,video,data');
  });

  it('reports a partial authorisation exactly', () => {
    render(<TalkContextProvider><Probe /></TalkContextProvider>);
    emitIdentity(true, false, true);
    expect(screen.getByTestId('svc')).toHaveTextContent('ptt,data');
  });

  it('reports a PTT-only user', () => {
    render(<TalkContextProvider><Probe /></TalkContextProvider>);
    emitIdentity(true, false, false);
    expect(screen.getByTestId('svc')).toHaveTextContent('ptt');
  });

  it('updates when the SDK re-issues the identity', () => {
    render(<TalkContextProvider><Probe /></TalkContextProvider>);
    emitIdentity(true, true, true);
    emitIdentity(true, false, false);
    // Latest wins — the flags are a snapshot, not accumulated.
    expect(screen.getByTestId('svc')).toHaveTextContent('ptt');
  });
});
