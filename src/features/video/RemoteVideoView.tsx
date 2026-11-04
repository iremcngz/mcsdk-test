/**
 * features/video/RemoteVideoView.tsx — the native view the decoder draws into.
 *
 * It takes no props beyond layout: the native side joins it to whichever receiver
 * is running, and not one pixel passes through JS.
 */

import { requireNativeComponent, type ViewProps } from 'react-native';

export const RemoteVideoView = requireNativeComponent<ViewProps>('McSdkVideoView');
