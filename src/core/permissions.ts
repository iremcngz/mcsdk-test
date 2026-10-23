/**
 * permissions.ts — Runtime permission requests, in one place.
 *
 * RECORD_AUDIO used to be requested inline in TalkScreen and
 * ActiveCallFullScreen, both for the VoiceMeter, and both swallowed a denial
 * with a bare `return`. That is tolerable for a decorative level meter but not
 * for call audio: with the permission denied a call sets up over SIP and simply
 * carries no sound, with nothing telling the user why.
 *
 * These helpers return the outcome instead of hiding it, and distinguish a
 * plain denial from "never ask again" — the latter cannot be recovered by
 * asking again and has to be sent to the system settings page.
 */

import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionOutcome =
  /** Granted, either just now or previously. */
  | 'granted'
  /** Denied this time; asking again is allowed. */
  | 'denied'
  /** Denied with "don't ask again" — only the settings app can undo it. */
  | 'blocked';

/**
 * Requests microphone access.
 *
 * iOS resolves 'granted' without asking: the platform prompts on first capture
 * and there is no equivalent pre-flight request here.
 */
export async function ensureMicPermission(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') return 'granted';

  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    switch (result) {
      case PermissionsAndroid.RESULTS.GRANTED:
        return 'granted';
      case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
        return 'blocked';
      default:
        return 'denied';
    }
  } catch {
    // request() throws only when the permission is not in the manifest, which
    // would be a build problem rather than a user decision.
    return 'denied';
  }
}

/** True when microphone access is already held, without prompting. */
export async function hasMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
  } catch {
    return false;
  }
}

/** Requests camera access. Used by the message composer's photo capture. */
export async function ensureCameraPermission(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') return 'granted';

  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    );
    switch (result) {
      case PermissionsAndroid.RESULTS.GRANTED:
        return 'granted';
      case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
        return 'blocked';
      default:
        return 'denied';
    }
  } catch {
    return 'denied';
  }
}
