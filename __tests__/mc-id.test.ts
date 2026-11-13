/**
 * __tests__/mc-id.test.ts
 *
 * displayMcId: the MC ID out of whatever URI form the SDK hands over.
 * toMcpttUri: the URI a contact is called at, from what someone typed.
 */

import { displayMcId, toMcpttUri, toMcvideoUri } from '../src/features/calls/mcId';

describe('displayMcId', () => {
  it.each([
    ['sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org', 'mcuser-222'],
    ['sip:mcuser-222@ims.mnc001.mcc001.3gppnetwork.org',       'mcuser-222'],
    ['<sip:mcptt.mcuser-222@ims.example.org>',                 'mcuser-222'],
    ['sips:mcvideo.mcuser-9@example.org;transport=tcp',        'mcuser-9'],
    ['sip:mcdata.alice@example.org',                           'alice'],
    ['sip:group.prearranged@ims.example.org',                  'group.prearranged'],
    ['mcuser-111',                                             'mcuser-111'],
  ])('%s → %s', (uri, id) => {
    expect(displayMcId(uri)).toBe(id);
  });

  it('falls back to the input when nothing is left', () => {
    expect(displayMcId('sip:')).toBe('sip:');
  });
});

describe('toMcpttUri', () => {
  it.each([
    ['mcuser-222',          'sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org'],
    ['  mcuser-222 ',       'sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org'],
    ['mcptt.mcuser-222',    'sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org'],
    ['mcuser-222@ims.example.org', 'sip:mcuser-222@ims.example.org'],
    ['sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org',
     'sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org'],
    ['SIPS:bob@example.org', 'SIPS:bob@example.org'],
  ])('%s → %s', (input, uri) => {
    expect(toMcpttUri(input)).toBe(uri);
  });

  it('is empty for empty input', () => {
    expect(toMcpttUri('   ')).toBe('');
  });

  it('round-trips through displayMcId', () => {
    expect(displayMcId(toMcpttUri('mcuser-222'))).toBe('mcuser-222');
  });
});

describe('toMcvideoUri', () => {
  it.each([
    // The contact's stored MCPTT ID → the MCVideo ID the server knows the user by.
    ['sip:mcptt.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org',
     'sip:mcvideo.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org'],
    ['sip:mcdata.mcuser-111@ims.example.org', 'sip:mcvideo.mcuser-111@ims.example.org'],
    ['<SIP:MCPTT.mcuser-111@ims.example.org>', '<SIP:mcvideo.mcuser-111@ims.example.org>'],
    ['sip:mcvideo.mcuser-111@ims.example.org', 'sip:mcvideo.mcuser-111@ims.example.org'],
    ['mcuser-111',       'sip:mcvideo.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org'],
    ['mcptt.mcuser-111', 'sip:mcvideo.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org'],
    // No service prefix: nothing says the server names users this way.
    ['sip:bob@example.org', 'sip:bob@example.org'],
    ['sip:mcpttx.bob@example.org', 'sip:mcpttx.bob@example.org'],
  ])('%s → %s', (input, uri) => {
    expect(toMcvideoUri(input)).toBe(uri);
  });

  it('is empty for empty input', () => {
    expect(toMcvideoUri('  ')).toBe('');
  });
});
