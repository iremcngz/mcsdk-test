/**
 * features/video/LocalVideoView.tsx — the camera's picture while it is being sent.
 *
 * The native sender draws it, because an app can open a camera only once and the
 * sender has it. It takes no props beyond layout and not one pixel passes through JS.
 */

import { requireNativeComponent, type ViewProps } from 'react-native';

export const LocalVideoView = requireNativeComponent<ViewProps>('McSdkLocalVideoView');
