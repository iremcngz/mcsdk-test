/**
 * Test that McSdk.setParams correctly includes mock parameter in JSON serialization
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

describe('McSdk.setParams — mock parameter', () => {
  let sdk: McSdk;

  beforeEach(() => {
    jest.clearAllMocks();
    sdk = new McSdk();
  });

  it('includes mock=true (1) when Mcx.mock=true', () => {
    sdk.setParams({
      Mcx: {
        idmsUrl: 'http://idms.example.com',
        bmsUrl: 'http://bms.example.com',
        cmsUrl: 'http://cms.example.com',
        gmsUrl: 'http://gms.example.com',
        mock: true,
      },
    });

    expect(NativeMcSdk.setParams).toHaveBeenCalledTimes(1);
    const json = NativeMcSdk.setParams.mock.calls[0][0];
    const parsed = JSON.parse(json);

    expect(parsed.mock).toBe(1);
    expect(parsed.idmsUrl).toBe('http://idms.example.com');
    expect(parsed.bmsUrl).toBe('http://bms.example.com');
    expect(parsed.cmsUrl).toBe('http://cms.example.com');
    expect(parsed.gmsUrl).toBe('http://gms.example.com');
  });

  it('includes mock=false (0) when Mcx.mock=false', () => {
    sdk.setParams({
      Mcx: {
        idmsUrl: 'http://idms.example.com',
        bmsUrl: 'http://bms.example.com',
        cmsUrl: 'http://cms.example.com',
        gmsUrl: 'http://gms.example.com',
        mock: false,
      },
    });

    expect(NativeMcSdk.setParams).toHaveBeenCalledTimes(1);
    const json = NativeMcSdk.setParams.mock.calls[0][0];
    const parsed = JSON.parse(json);

    expect(parsed.mock).toBe(0);
  });

  it('defaults to mock=0 when Mcx.mock is undefined', () => {
    sdk.setParams({
      Mcx: {
        idmsUrl: 'http://idms.example.com',
        bmsUrl: 'http://bms.example.com',
        cmsUrl: 'http://cms.example.com',
        gmsUrl: 'http://gms.example.com',
      },
    });

    expect(NativeMcSdk.setParams).toHaveBeenCalledTimes(1);
    const json = NativeMcSdk.setParams.mock.calls[0][0];
    const parsed = JSON.parse(json);

    expect(parsed.mock).toBe(0);
  });

  it('includes all Mcx parameters in single setParams call', () => {
    sdk.setParams({
      Mcx: {
        idmsUrl: 'https://custom-idms.com',
        bmsUrl: 'https://custom-bms.com',
        cmsUrl: 'https://custom-cms.com',
        gmsUrl: 'https://custom-gms.com',
        mock: true,
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
      mock: 1,
    });
  });

  it('serializes mock correctly in mixed params (with non-Mcx settings)', () => {
    sdk.setParams({
      Logging: {
        enabled: true,
        level: 'DEBUG',
      },
      Mcx: {
        idmsUrl: 'http://idms.example.com',
        bmsUrl: 'http://bms.example.com',
        cmsUrl: 'http://cms.example.com',
        gmsUrl: 'http://gms.example.com',
        mock: true,
      },
    });

    expect(NativeMcSdk.setParams).toHaveBeenCalledTimes(1);
    const json = NativeMcSdk.setParams.mock.calls[0][0];
    const parsed = JSON.parse(json);

    // Verify both logging and mock are present
    expect(parsed.logEnabled).toBe(1);
    expect(parsed.mock).toBe(1);
    expect(parsed.idmsUrl).toBe('http://idms.example.com');
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

  it('defaults mock to 0 when omitted, despite the native default being true', () => {
    sdk.setParams({ Mcx: { bmsUrl: 'http://bms.example.com' } });

    const parsed = JSON.parse(NativeMcSdk.setParams.mock.calls[0][0]);

    expect(parsed.mock).toBe(0);
  });
});
