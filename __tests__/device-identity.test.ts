/**
 * __tests__/device-identity.test.ts
 *
 * The MC client id identifies this client *instance* to the network. The SDK
 * puts it in the PUBLISH poc-settings body (<mcptt-client-id>, <entity id>),
 * where a malformed or empty value is rejected with 400 "Invalid Info XML" —
 * so both its shape and its stability across launches matter.
 */

import { DeviceIdentity } from '../src/core/settings';

// urn:uuid: + RFC 4122 v4 (version nibble 4, variant nibble 8/9/a/b).
const URN_UUID_V4 =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('DeviceIdentity.getMcClientId', () => {
  beforeEach(() => {
    DeviceIdentity.resetMcClientId();
  });

  it('returns a urn:uuid-prefixed v4 UUID', () => {
    expect(DeviceIdentity.getMcClientId()).toMatch(URN_UUID_V4);
  });

  it('is never empty — an empty client id is what the server rejects', () => {
    expect(DeviceIdentity.getMcClientId().length).toBeGreaterThan('urn:uuid:'.length);
  });

  it('returns the same id on repeated reads', () => {
    const first = DeviceIdentity.getMcClientId();
    expect(DeviceIdentity.getMcClientId()).toBe(first);
    expect(DeviceIdentity.getMcClientId()).toBe(first);
  });

  it('persists across reads rather than regenerating per call', () => {
    // A fresh id on every call would make the server see a new client instance
    // on each PUBLISH, so this is the property that actually matters.
    const ids = new Set([
      DeviceIdentity.getMcClientId(),
      DeviceIdentity.getMcClientId(),
      DeviceIdentity.getMcClientId(),
    ]);
    expect(ids.size).toBe(1);
  });

  it('issues a different id after an explicit reset', () => {
    const first = DeviceIdentity.getMcClientId();
    DeviceIdentity.resetMcClientId();
    expect(DeviceIdentity.getMcClientId()).not.toBe(first);
  });

  it('generates distinct ids rather than a fixed constant', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      DeviceIdentity.resetMcClientId();
      ids.add(DeviceIdentity.getMcClientId());
    }
    expect(ids.size).toBe(50);
  });
});
