package com.aselsan.mcsdk.rn.media

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import android.view.WindowManager
import com.aselsan.mcsdk.rn.media.video.VideoPipeline
import com.aselsan.mcsdk.rn.media.video.VideoReceiver
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * VideoBridgeModule — the JS-facing control surface for video.
 *
 * Like MediaBridgeModule it has no data method, for a stronger version of the same
 * reason: frames are tens of kilobytes, 24 times a second. They stay in the native
 * layer, and JS sends commands and polls a few numbers.
 */
class VideoBridgeModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    private companion object {
        const val TAG = "McSdkVideoBridge"
    }

    override fun getName() = "McSdkVideo"

    private val sender by lazy { VideoPipeline(reactApplicationContext) }
    private val receiver by lazy { VideoReceiver() }

    private var wifiLock: WifiManager.WifiLock? = null

    /** Starts sending the camera to [host]:[port]. Needs CAMERA granted. */
    @ReactMethod
    fun startSend(host: String, port: Double, promise: Promise) {
        try {
            if (sender.startUdp(host, port.toInt())) {
                promise.resolve(null)
            } else {
                promise.reject("video_send", sender.stats().error ?: "could not start sending")
            }
        } catch (e: Exception) {
            Log.e(TAG, "startSend failed: ${e.message}", e)
            promise.reject("video_send", e)
        }
        keepAwake()
    }

    @ReactMethod
    fun stopSend(promise: Promise) {
        try {
            sender.stop()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "stopSend failed: ${e.message}", e)
            promise.reject("video_send", e)
        }
        keepAwake()
    }

    /** Starts listening on [port]. The picture appears in any mounted McSdkVideoView. */
    @ReactMethod
    fun startReceive(port: Double, promise: Promise) {
        try {
            if (receiver.startUdp(port.toInt())) {
                promise.resolve(null)
            } else {
                promise.reject("video_receive", receiver.stats().error ?: "could not start receiving")
            }
        } catch (e: Exception) {
            Log.e(TAG, "startReceive failed: ${e.message}", e)
            promise.reject("video_receive", e)
        }
        keepAwake()
    }

    @ReactMethod
    fun stopReceive(promise: Promise) {
        try {
            receiver.stop()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "stopReceive failed: ${e.message}", e)
            promise.reject("video_receive", e)
        }
        keepAwake()
    }

    @ReactMethod
    fun getStats(promise: Promise) {
        val s = sender.stats()
        val r = receiver.stats()
        promise.resolve(Arguments.createMap().apply {
            putMap("send", Arguments.createMap().apply {
                putBoolean("running", s.running)
                putInt("width", s.width)
                putInt("height", s.height)
                putInt("framesEncoded", s.framesEncoded)
                putInt("keyFrames", s.keyFrames)
                putDouble("bytes", s.bytes.toDouble())
                putInt("keyFramesWithoutConfig", s.keyFramesWithoutConfig)
                putDouble("seconds", s.seconds)
                putString("profileLevelId", s.profileLevelId)
                putInt("packetsSent", s.packetsSent)
                putInt("sendErrors", s.sendErrors)
                putString("target", s.target)
                putString("error", s.error)
            })
            putMap("receive", Arguments.createMap().apply {
                putBoolean("running", r.running)
                putInt("width", r.width)
                putInt("height", r.height)
                putInt("packetsReceived", r.packetsReceived)
                putInt("packetsLost", r.packetsLost)
                putInt("framesReceived", r.framesReceived)
                putInt("framesDiscarded", r.framesDiscarded)
                putInt("framesDecoded", r.framesDecoded)
                putInt("framesLate", r.framesLate)
                putInt("keyFramesRequested", r.keyFramesRequested)
                putDouble("drawSeconds", r.drawSeconds)
                putString("networkQuality", r.networkQuality)
                putString("error", r.error)
            })
        })
    }

    /**
     * While video runs, keeps Wi-Fi out of power save and the screen on.
     *
     * The Wi-Fi lock is for what MediaPipeline measured on audio: a dozing phone
     * collects its packets in clumps ~300 ms apart. The screen matters on the sender:
     * Android takes the camera away from an app the moment the screen turns off, and
     * this test has no foreground service to hold it.
     */
    private fun keepAwake() {
        val on = sender.isRunning || receiver.isRunning
        if (on) acquireWifiLock() else releaseWifiLock()
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            if (on) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    private fun acquireWifiLock() {
        if (wifiLock?.isHeld == true) return
        val wm = reactApplicationContext.applicationContext
            .getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
            WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
        try {
            wifiLock = wm.createWifiLock(mode, "McSdkVideo").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (e: Exception) {
            // Video still works without it, only less evenly.
            Log.w(TAG, "wifi lock failed: ${e.message}")
        }
    }

    private fun releaseWifiLock() {
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
    }

    /** A JS reload must not leave the camera locked by something nobody can stop. */
    override fun invalidate() {
        sender.stop()
        receiver.stop()
        releaseWifiLock()
        super.invalidate()
    }
}
