/**
 * __tests__/private-video-call.test.tsx
 *
 * A private MCVideo call: placed from Contacts (Video MC / Video AC), answered
 * like any private call, and its video run by CallContext through
 * usePrivateVideoCall. No transmission control: the camera goes to the call as
 * soon as it is active. The caller's camera starts on, the called party's off.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type Handler<T> = (e: T) => void;

const incoming: Handler<any>[] = [];
const updated: Handler<any>[] = [];
const terminated: Handler<any>[] = [];

const sub = (list: Handler<any>[]) => (h: Handler<any>) => {
  list.push(h);
  return { remove: () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); } };
};
const noSub = () => ({ remove: () => {} });

const mockSdk = {
  answerCall: jest.fn(),
  rejectCall: jest.fn(),
  terminateCall: jest.fn(),
  startPrivateCall: jest.fn(),
  startVideoPrivateCall: jest.fn(),
  requestFloor: jest.fn(),
  releaseFloor: jest.fn(),
  onIncomingCall: sub(incoming),
  onCallUpdated: sub(updated),
  onCallTerminated: sub(terminated),
  onFloorUpdated: noSub,
  onSdkError: noSub,
};

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }),
}));

const mockStartCallAudio = jest.fn((_id: string) => Promise.resolve(true));
jest.mock('../src/core/mediaSession', () => ({
  MediaSession: {
    setRoute: jest.fn(),
    startCallAudio: (id: string) => mockStartCallAudio(id),
    stopCallAudio: () => Promise.resolve(),
    setTransmitEnabled: jest.fn(),
  },
}));

const mockStartCamera = jest.fn(() => Promise.resolve(true));
const mockStopCamera = jest.fn(() => Promise.resolve());
const mockSetTarget = jest.fn();
const mockStartReceive = jest.fn(() => Promise.resolve(true));
const mockStopReceive = jest.fn(() => Promise.resolve());
const mockSetSource = jest.fn();
jest.mock('../src/core/videoSession', () => ({
  VideoSession: {
    startCallCamera: () => mockStartCamera(),
    stopCallCamera: () => mockStopCamera(),
    setCallTarget: (id: string | null) => mockSetTarget(id),
    startCallReceive: () => mockStartReceive(),
    stopReceive: () => mockStopReceive(),
    setCallReceiveSource: (id: string | null) => mockSetSource(id),
    getStats: () => Promise.resolve(null),
  },
}));

let mockCameraPermission = 'granted';
jest.mock('../src/core/permissions', () => ({
  ensureMicPermission: () => Promise.resolve('granted'),
  ensureCameraPermission: () => Promise.resolve(mockCameraPermission),
}));

import { CallContextProvider, useCallContext } from '../src/contexts/CallContext';

let ctx: ReturnType<typeof useCallContext>;

function Probe() {
  ctx = useCallContext();
  return (
    <>
      <mock-text testID="state">{ctx.activeCall?.state ?? 'none'}</mock-text>
      <mock-text testID="camera">{String(ctx.videoCameraOn)}</mock-text>
      <mock-text testID="ready">{String(ctx.videoCameraReady)}</mock-text>
      <mock-text testID="problem">{ctx.videoProblem ?? ''}</mock-text>
    </>
  );
}

const renderProbe = () => render(<CallContextProvider><Probe /></CallContextProvider>);

const videoCall = (over: Partial<any> = {}) => ({
  callId: 'vcall-1',
  type: 'PRIVATE',
  state: 'INCOMING',
  outgoing: false,
  isEmergency: false,
  isImminentPeril: false,
  isVideo: true,
  isFloorControlEnabled: false,
  callerId: 'sip:mcvideo.mcuser-222@example.org',
  calleeId: 'sip:mcvideo.mcuser-111@example.org',
  groupId: '',
  ...over,
});

const fire = (list: Handler<any>[], e: any) => act(() => { list.forEach(h => h(e)); });
const text = (id: string) => screen.getByTestId(id).props.children;

beforeEach(() => {
  incoming.length = 0; updated.length = 0; terminated.length = 0;
  jest.clearAllMocks();
  mockCameraPermission = 'granted';
});

describe('placing a private video call', () => {
  it('asks the SDK for an MCVideo private call, auto-commenced for AC', () => {
    renderProbe();
    act(() => ctx.startVideoCall('Bob', 'sip:bob@example.org', 'auto'));
    expect(mockSdk.startVideoPrivateCall).toHaveBeenCalledWith('sip:bob@example.org', true);
    expect(mockSdk.startPrivateCall).not.toHaveBeenCalled();
    expect(ctx.activeCall).toMatchObject({ isVideo: true, direction: 'outgoing', state: 'connecting' });
  });

  it('addresses the MCVideo ID, not the MCPTT ID the contact is stored under', () => {
    // The MCVideo server refuses sip:mcptt.… with 403 "144 user not authorized".
    renderProbe();
    act(() => ctx.startVideoCall('mcuser-111',
      'sip:mcptt.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org', 'manual'));
    expect(mockSdk.startVideoPrivateCall).toHaveBeenCalledWith(
      'sip:mcvideo.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org', false);
    expect(ctx.activeCall?.sipUri).toBe('sip:mcvideo.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org');
  });

  it('rings the far end for MC', () => {
    renderProbe();
    act(() => ctx.startVideoCall('Bob', 'sip:bob@example.org', 'manual'));
    expect(mockSdk.startVideoPrivateCall).toHaveBeenCalledWith('sip:bob@example.org', false);
  });

  it('shows our camera while it rings and sends it once the call is active', async () => {
    renderProbe();
    act(() => ctx.startVideoCall('Bob', 'sip:bob@example.org', 'auto'));
    expect(text('camera')).toBe('true');
    await waitFor(() => expect(text('ready')).toBe('true'));
    expect(mockStartReceive).toHaveBeenCalledTimes(1);
    // Nothing goes out before the call is up.
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);

    await fire(updated, videoCall({ state: 'ACTIVE', outgoing: true }));
    expect(text('state')).toBe('active');
    expect(mockSetTarget).toHaveBeenLastCalledWith('vcall-1');
    expect(mockSetSource).toHaveBeenLastCalledWith('vcall-1');
    // Video only: the audio pipeline stays out of it.
    expect(mockStartCallAudio).not.toHaveBeenCalled();
  });
});

describe('answering a private video call', () => {
  it('answers without an audio codec and keeps the camera off', async () => {
    renderProbe();
    await fire(incoming, videoCall());
    expect(text('state')).toBe('ringing');
    expect(text('camera')).toBe('false');

    act(() => ctx.acceptCall());
    expect(mockSdk.answerCall).toHaveBeenCalledWith('vcall-1', undefined);

    await fire(updated, videoCall({ state: 'ACTIVE' }));
    await waitFor(() => expect(mockSetSource).toHaveBeenLastCalledWith('vcall-1'));
    expect(mockStartCamera).not.toHaveBeenCalled();
  });

  it('sends the camera once the called party turns it on', async () => {
    renderProbe();
    await fire(incoming, videoCall());
    act(() => ctx.acceptCall());
    await fire(updated, videoCall({ state: 'ACTIVE' }));

    act(() => ctx.toggleVideoCamera());
    await waitFor(() => expect(text('ready')).toBe('true'));
    expect(mockStartCamera).toHaveBeenCalledTimes(1);
    expect(mockSetTarget).toHaveBeenLastCalledWith('vcall-1');
  });

  it('stops the camera but keeps receiving when it is turned off', async () => {
    renderProbe();
    act(() => ctx.startVideoCall('Bob', 'sip:bob@example.org', 'auto'));
    await fire(updated, videoCall({ state: 'ACTIVE', outgoing: true }));
    await waitFor(() => expect(text('ready')).toBe('true'));

    act(() => ctx.toggleVideoCamera());
    await waitFor(() => expect(text('ready')).toBe('false'));
    expect(mockStopCamera).toHaveBeenCalledTimes(1);
    expect(mockStopReceive).not.toHaveBeenCalled();
    expect(text('state')).toBe('active');
  });

  it('says so when the camera permission is refused', async () => {
    mockCameraPermission = 'denied';
    renderProbe();
    act(() => ctx.startVideoCall('Bob', 'sip:bob@example.org', 'auto'));
    await waitFor(() => expect(text('problem')).toBe('CAMERA_DENIED'));
    expect(mockStartCamera).not.toHaveBeenCalled();
  });
});

describe('the end of a private video call', () => {
  it('stops the camera and the receiver when the far end hangs up', async () => {
    renderProbe();
    act(() => ctx.startVideoCall('Bob', 'sip:bob@example.org', 'auto'));
    await fire(updated, videoCall({ state: 'ACTIVE', outgoing: true }));
    await waitFor(() => expect(text('ready')).toBe('true'));

    await fire(terminated, { callId: 'vcall-1', mode: 'CLOSED_REMOTELY', reason: 'NORMAL', sipCode: 0, sipReason: '' });
    expect(text('state')).toBe('none');
    await waitFor(() => expect(mockStopCamera).toHaveBeenCalled());
    expect(mockStopReceive).toHaveBeenCalled();
    expect(text('camera')).toBe('false');
  });

  it('terminates the SDK call when the user ends it', async () => {
    renderProbe();
    act(() => ctx.startVideoCall('Bob', 'sip:bob@example.org', 'auto'));
    await fire(updated, videoCall({ state: 'ACTIVE', outgoing: true }));
    act(() => ctx.endCall());
    expect(mockSdk.terminateCall).toHaveBeenCalledWith('vcall-1');
    await waitFor(() => expect(mockStopReceive).toHaveBeenCalled());
  });
});

// ── Contacts ─────────────────────────────────────────────────────────────────

jest.mock('../src/contexts/AppContext', () => ({
  useAppContext: () => ({
    c: new Proxy({}, { get: () => '#888' }),
    tr: { contactVideoMc: 'Video MC', contactVideoAc: 'Video AC' },
  }),
}));

jest.mock('../src/core/db', () => ({
  initDb: () => Promise.resolve(),
  seedContacts: () => Promise.resolve(),
  getAllContacts: () => Promise.resolve([
    { id: 1, name: 'Bob', sip_uri: 'sip:bob@example.org', notes: '', created_at: 1 },
  ]),
}));

// The group rows now come from the SDK's provisioned list (onGroupsUpdated)
// rather than seven hardcoded names, so ContactsScreen reads TalkContext.
jest.mock('../src/contexts/TalkContext', () => ({
  useTalkContext: () => ({
    groups: [{ groupId: 'group1', name: 'group1', isPtt: true, isVideo: false, isData: false }],
  }),
}));

import { ContactsScreen } from '../src/features/contacts/ContactsScreen';
import { NavigationContextProvider } from '../src/contexts/NavigationContext';

describe('Contacts', () => {
  const renderContacts = async () => {
    render(
      <NavigationContextProvider>
        <CallContextProvider>
          <ContactsScreen />
        </CallContextProvider>
      </NavigationContextProvider>,
    );
    await waitFor(() => expect(screen.getByText('Bob')).toBeTruthy());
    fireEvent.press(screen.getByText('Bob'));
  };

  /** Groups are no longer in the default view: People is. */
  const showGroups = () => fireEvent.press(screen.getByText('Groups'));

  it('places a ringing video call from Video MC', async () => {
    await renderContacts();
    fireEvent.press(screen.getByTestId('contact-video-mc'));
    expect(mockSdk.startVideoPrivateCall).toHaveBeenCalledWith('sip:bob@example.org', false);
  });

  it('places an auto-answered video call from Video AC', async () => {
    await renderContacts();
    fireEvent.press(screen.getByTestId('contact-video-ac'));
    expect(mockSdk.startVideoPrivateCall).toHaveBeenCalledWith('sip:bob@example.org', true);
  });

  it('offers no video call on a group', async () => {
    await renderContacts();
    // Switching to Groups closes Bob's panel along with his detail buttons.
    showGroups();
    fireEvent.press(screen.getByText('group1'));
    expect(screen.queryByTestId('contact-video-mc')).toBeNull();
  });
});
