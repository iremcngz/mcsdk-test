/**
 * netMonitor — monitors the device's local IP address and fires a callback
 * whenever it changes (e.g. WiFi reconnect, network switch, VPN toggle).
 */

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useRef, useState } from 'react';

export interface IpInfo {
  /** Current local IP address, or null when there is no network. */
  ip: string | null;
  /** Network type: 'wifi' | 'cellular' | 'none' | 'unknown' | … */
  type: string;
}

/**
 * React hook that subscribes to network changes and calls `onChanged`
 * whenever the device IP address changes.
 *
 * The callback is stored in a ref so callers do not need to memoize it —
 * the NetInfo subscription is only created once on mount.
 *
 * @returns The latest `IpInfo` (updates on every NetInfo event).
 */
export function useIpMonitor(
  onChanged: (prev: IpInfo, curr: IpInfo) => void,
): IpInfo {
  const [info, setInfo] = useState<IpInfo>({ ip: null, type: 'unknown' });
  const prevRef = useRef<IpInfo>({ ip: null, type: 'unknown' });
  // Keep a stable ref so we never need to re-subscribe when the callback changes.
  const cbRef = useRef(onChanged);
  cbRef.current = onChanged;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      // ipAddress is available on WiFi and some cellular details objects.
      const ip: string | null = (state.details as any)?.ipAddress ?? null;
      const curr: IpInfo = { ip, type: state.type };

      if (curr.ip !== prevRef.current.ip) {
        cbRef.current(prevRef.current, curr);
      }
      prevRef.current = curr;
      setInfo(curr);
    });

    return unsubscribe;
  }, []);

  return info;
}
