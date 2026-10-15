/**
 * Test that McSdk.setParams serialises the Mcx parameter group correctly.
 *
 * The `mock` flag this file was originally written for is gone: SDK 85d75fd
 * ("remove mock register") deleted the server-less registration path, so there
 * is no flag to forward. What remains here covers the Mcx fields that are still
 * read.
 */

import { McSdk } from '../src/mcsdk';
import NativeMcSdk from '../src/mcsdk/NativeMcSdk';

jest.mock('../src/mcsdk/NativeMcSdk', () => ({
  create: jest.fn(),
  destroy: jest.fn(),
  setParams: jest.fn(),
  init: jest.fn().mockResolvedValue(true),
  setListener: jest.fn(),
  setIdentity: jest.fn(),
  setDocuments: jest.fn(),
  register: jest.fn(),
}));

describe('McSdk.setParams — Mcx parameters', () => {
  let sdk: McSdk;

  beforeEach(() => {
    jest.clearAllMocks();
    sdk = new McSdk();
  });

  it('includes all Mcx parameters in single setParams call', () => {
    sdk.setParams({
      Mcx: {
        idmsUrl: 'https://custom-idms.com',
        bmsUrl: 'https://custom-bms.com',
        cmsUrl: 'https://custom-cms.com',
        gmsUrl: 'https://custom-gms.com',
      },
    });

    expect(NativeMcSdk.setParams).toHaveBeenCalledTimes(1);
    const json = NativeMcSdk.setParams.mock.calls[0][0];
    const parsed = JSON.parse(json);

    expect(parsed).toMatchObject({
      idmsUrl: 'https://custom-idms.com',
      bmsUrl: 'https://custom-bms.com',
      cmsUrl: 'https://custom-cms.com',
      gmsUrl: 'https://custom-gms.com',
    });
  });

  // ── Mcx fields added in SDK 072fad0 ──────────────────────────────────────

  it('applies SDK defaults for the new Mcx fields when not supplied', () => {
    sdk.setParams({ Mcx: { bmsUrl: 'http://bms.example.com' } });

    const parsed = JSON.parse(NativeMcSdk.setParams.mock.calls[0][0]);

    expect(parsed.mcdataSds).toBe(1);
    expect(parsed.mcdataFd).toBe(1);
    expect(parsed.mcdataIpconn).toBe(0);
    expect(parsed.authViaPublish).toBe(1);
    expect(parsed.registerExpires).toBe(3600);
    expect(parsed.pocExpires).toBe(4294967295);
    expect(parsed.userAgent).toBe('Mission 809');
    expect(parsed.imei).toBe('0001-0001-000001');
  });

  it('forwards explicit values for the new Mcx fields', () => {
    sdk.setParams({
      Mcx: {
        bmsUrl: 'http://bms.example.com',
        mcdataSds: false,
        mcdataFd: false,
        mcdataIpconn: true,
        authViaPublish: false,
        registerExpires: 600,
        pocExpires: 1200,
        userAgent: 'Test UA',
        imei: '1234-5678-901234',
      },
    });

    const parsed = JSON.parse(NativeMcSdk.setParams.mock.calls[0][0]);

    expect(parsed.mcdataSds).toBe(0);
    expect(parsed.mcdataFd).toBe(0);
    expect(parsed.mcdataIpconn).toBe(1);
    expect(parsed.authViaPublish).toBe(0);
    expect(parsed.registerExpires).toBe(600);
    expect(parsed.pocExpires).toBe(1200);
    expect(parsed.userAgent).toBe('Test UA');
    expect(parsed.imei).toBe('1234-5678-901234');
  });

});
