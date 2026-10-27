/**
 * __tests__/mc-id.test.ts
 *
 * displayMcId: the MC ID out of whatever URI form the SDK hands over.
 */

import { displayMcId } from '../src/features/calls/mcId';

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
