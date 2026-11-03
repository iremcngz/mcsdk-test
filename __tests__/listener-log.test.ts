import { formatListenerEvent } from '../src/mcsdk/listenerLog';

describe('formatListenerEvent', () => {
  it('prints the whole payload under the name McSdk subscribes it as', () => {
    const line = formatListenerEvent('McSdkCallUpdated', {
      callId: 'c1', state: 'ACTIVE', sipCode: 200, sipReason: 'OK',
    });
    expect(line).toEqual({
      msg: 'onCallUpdated {"callId":"c1","state":"ACTIVE","sipCode":200,"sipReason":"OK"}',
      level: 'info',
    });
  });

  it('keeps nested contents such as the floor talkers', () => {
    const { msg } = formatListenerEvent('McSdkFloorUpdated', {
      status: 'TAKEN', talkers: [{ id: 'sip:a', ssrc: 7 }],
    });
    expect(msg).toContain('"talkers":[{"id":"sip:a","ssrc":7}]');
  });

  it('shows an event without a payload', () => {
    expect(formatListenerEvent('McSdkReady', {}).msg).toBe('onReady {}');
    expect(formatListenerEvent('McSdkTerminated', undefined).msg).toBe('onTerminated {}');
  });

  it('levels failures above routine events', () => {
    expect(formatListenerEvent('McSdkSdkError', { error: 'X' }).level).toBe('error');
    expect(formatListenerEvent('McSdkAlarm', { alarm: 'X' }).level).toBe('warn');
    expect(formatListenerEvent('McSdkRegistration', { state: 'FAILED' }).level).toBe('error');
    expect(formatListenerEvent('McSdkRegistration', { state: 'REGISTERED' }).level).toBe('info');
  });

  it('keeps document content out of the console but in the file log', () => {
    const docsJson = JSON.stringify([{ uri: 'u', etag: 'e', content: 'abcd' }]);
    const line = formatListenerEvent('McSdkStoreDocuments', { docsJson });
    expect(line.msg).toBe('onStoreDocuments {"docs":[{"uri":"u","etag":"e","contentLength":4}]}');
    expect(line.fileDetail).toContain('abcd');
  });

  it('still logs documents it cannot parse', () => {
    const line = formatListenerEvent('McSdkStoreDocuments', { docsJson: 'not json' });
    expect(line.msg).toContain('8 chars');
    expect(line.fileDetail).toContain('not json');
  });
});
