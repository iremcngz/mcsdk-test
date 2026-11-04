package com.aselsan.mcsdk.rn

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.aselsan.mcsdk.rn.media.MediaBridgeModule
import com.aselsan.mcsdk.rn.media.VideoBridgeModule
import com.aselsan.mcsdk.rn.media.video.view.RemoteVideoViewManager

class McSdkPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(McSdkModule(context), MediaBridgeModule(context), VideoBridgeModule(context))

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(RemoteVideoViewManager())
}
