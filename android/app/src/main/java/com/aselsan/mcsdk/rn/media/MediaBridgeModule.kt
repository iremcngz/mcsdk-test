package com.aselsan.mcsdk.rn.media

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import android.util.Log

/**
 * MediaBridgeModule — the JS-facing control surface for the audio session.
 *
 * Deliberately carries no audio data. A 20 ms frame means 50 bridge crossings a
 * second, each serialised; the pipeline keeps PCM and encoded frames entirely
 * inside the native layer and JS only sends commands and receives state. That
 * split is what makes the media phases possible at all, so it is enforced here
 * by simply not having a data method.
 *
 * What JS gets: enter/leave call mode, speaker routing, microphone ownership,
 * the foreground service, and device capability reporting.
 */
class MediaBridgeModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {

    companion object {
        private const val TAG = "McSdkMediaBridge"
        private const val EVENT_INTERRUPTION = "McSdkAudioInterruption"
        private const val EVENT_MIC_EVICTED = "McSdkMicEvicted"
    }

    override fun getName() = "McSdkMedia"

    private val session by lazy {
        AudioSessionManager(context).apply {
            onInterruption = { reason ->
                emit(EVENT_INTERRUPTION, Arguments.createMap().apply {
                    putString("reason", reason.name)
                })
            }
        }
    }

    private fun emit(event: String, body: WritableMap) {
        context.emitDeviceEvent(event, body)
    }

    // ── Call mode ─────────────────────────────────────────────────────────────

    /**
     * Enters MODE_IN_COMMUNICATION and takes audio focus. Resolves false when
     * focus was refused, which means another app owns the audio device and
     * capture must not start.
     */
    @ReactMethod
    fun enterCallMode(promise: Promise) {
        try {
            promise.resolve(session.enterCallMode())
        } catch (e: Exception) {
            Log.e(TAG, "enterCallMode failed: ${e.message}", e)
            promise.reject("audio_mode", e)
        }
    }

    /**
     * Leaves call mode. Must be called on every path out of a call, error paths
     * included: MODE_IN_COMMUNICATION is device-global and leaving it set makes
     * the app's other sounds misbehave well after the call ended.
     */
    @ReactMethod
    fun exitCallMode(promise: Promise) {
        try {
            session.exitCallMode()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "exitCallMode failed: ${e.message}", e)
            promise.reject("audio_mode", e)
        }
    }

    @ReactMethod
    fun isInCallMode(promise: Promise) = promise.resolve(session.isInCallMode)

    // ── Routing ───────────────────────────────────────────────────────────────

    /** Speaker (true) or earpiece (false). Kept for callers that predate routes. */
    @ReactMethod
    fun setSpeakerphone(on: Boolean) = pipeline.setRoute(if (on) "SPEAKER" else "EARPIECE")

    /**
     * "EARPIECE" | "SPEAKER" | "BLUETOOTH".
     *
     * BLUETOOTH is separate because call audio goes over SCO/HFP rather than the
     * A2DP link that carries music, and SCO must be started and waited for —
     * getAudioRoute().scoConnected reports when it is actually in use.
     */
    @ReactMethod
    fun setRoute(route: String) = pipeline.setRoute(route)

    @ReactMethod
    fun getAudioRoute(promise: Promise) {
        promise.resolve(Arguments.createMap().apply {
            putBoolean("hasHeadset", session.hasHeadset())
            putBoolean("hasBluetooth", pipeline.hasBluetoothHeadset())
            putBoolean("scoConnected", pipeline.isScoConnected)
            putBoolean("inCallMode", session.isInCallMode)
        })
    }

    // ── Device capability ─────────────────────────────────────────────────────

    /**
     * Whether this device has hardware echo cancellation and noise suppression.
     * Both are genuinely absent on some handsets. Half-duplex PTT survives
     * without AEC; a full-duplex private call will echo, so the app needs to
     * know in advance rather than discovering it mid-call.
     */
    @ReactMethod
    fun getEffectSupport(promise: Promise) {
        val support = session.probeEffectSupport()
        promise.resolve(Arguments.createMap().apply {
            putBoolean("aec", support.aec)
            putBoolean("ns", support.ns)
        })
    }

    // ── Microphone ownership ──────────────────────────────────────────────────

    /**
     * Claims the mic for the VoiceMeter. Resolves false when the media pipeline
     * holds it, in which case the caller must not start sound-level capture —
     * the two cannot both own the one physical microphone.
     */
    @ReactMethod
    fun claimMicForMeter(promise: Promise) {
        MicrophoneOwner.setEvictionHandler(MicrophoneOwner.Claimant.METER) {
            emit(EVENT_MIC_EVICTED, Arguments.createMap().apply {
                putString("claimant", "METER")
            })
        }
        promise.resolve(MicrophoneOwner.claim(MicrophoneOwner.Claimant.METER))
    }

    @ReactMethod
    fun releaseMicForMeter() = MicrophoneOwner.release(MicrophoneOwner.Claimant.METER)

    @ReactMethod
    fun getMicHolder(promise: Promise) =
        promise.resolve(MicrophoneOwner.heldBy()?.name)

    // ── Foreground service ────────────────────────────────────────────────────

    /**
     * Starts the microphone foreground service. Must be called while the app is
     * in the foreground: Android 14+ refuses to start a microphone-typed
     * service from the background. Strings come from the app's i18n.
     */
    @ReactMethod
    fun startMediaService(title: String, text: String, channelName: String) {
        MediaForegroundService.start(context, title, text, channelName)
    }

    @ReactMethod
    fun stopMediaService() = MediaForegroundService.stop(context)

    @ReactMethod
    fun isMediaServiceRunning(promise: Promise) =
        promise.resolve(MediaForegroundService.isRunning)

    // ── Capture (uplink) ──────────────────────────────────────────────────────
    // Commands and counters only. There is deliberately no method that carries
    // audio: a 20 ms frame means 50 bridge crossings a second, each serialised,
    // which the RN bridge is not built for. PCM and encoded frames stay inside
    // the native layer — the pipeline writes them to an AudioFrameSink, and the
    // SDK will become one more sink when it exposes a media API.

    private val pipeline by lazy { MediaPipeline(context) }

    /**
     * Starts capturing to a file under cacheDir/media and resolves its path.
     *
     * RECORD_AUDIO must already be granted: AudioRecord does not report a
     * missing permission, it returns buffers of silence, so the JS side checks
     * first (ensureMicPermission) where it can actually prompt.
     */
    @ReactMethod
    fun startCapture(codecName: String, promise: Promise) {
        try {
            val path = pipeline.startFileCapture(codecName)
            if (path == null) {
                promise.reject("capture_start", pipeline.lastError ?: "could not start capture")
            } else {
                promise.resolve(path)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startCapture failed: ${e.message}", e)
            promise.reject("capture_start", e)
        }
    }

    /** Stops capture, releases the device, and resolves the finished file path. */
    @ReactMethod
    fun stopCapture(promise: Promise) {
        try {
            promise.resolve(pipeline.stop())
        } catch (e: Exception) {
            Log.e(TAG, "stopCapture failed: ${e.message}", e)
            promise.reject("capture_stop", e)
        }
    }

    /**
     * Gates the uplink without tearing capture down, so the meter stays live and
     * PTT re-arms instantly. Floor control and mute both land here.
     */
    @ReactMethod
    fun setTransmitEnabled(enabled: Boolean) = pipeline.setTransmitEnabled(enabled)

    /**
     * One snapshot of the counters. Meant to be polled about once a second —
     * this is the only thing that crosses the bridge while audio runs.
     *
     * `droppedFrames` is the one to watch: anything above 0 means the sink could
     * not keep up with the capture thread.
     */
    @ReactMethod
    fun getCaptureStats(promise: Promise) {
        val s = pipeline.stats()
        promise.resolve(Arguments.createMap().apply {
            putBoolean("running", s.running)
            putBoolean("transmitting", s.transmitting)
            putString("codec", s.codecName)
            putString("sink", s.sinkName)
            putInt("capturedFrames", s.capturedFrames)
            putInt("encodedFrames", s.encodedFrames)
            putInt("droppedFrames", s.droppedFrames)
            putInt("bytesWritten", s.bytesWritten)
            putInt("timestamp", s.timestamp)
            putDouble("mediaSeconds", s.mediaSeconds)
            putBoolean("aec", s.aec)
            putBoolean("ns", s.ns)
            if (s.filePath != null) putString("filePath", s.filePath) else putNull("filePath")
            if (s.error != null) putString("error", s.error) else putNull("error")
        })
    }

    /** Recorded files, newest first, for the diagnostics list. */
    @ReactMethod
    fun listRecordings(promise: Promise) {
        promise.resolve(Arguments.createArray().apply {
            pipeline.listRecordings().forEach { f ->
                pushMap(Arguments.createMap().apply {
                    putString("name", f.name)
                    putString("path", f.absolutePath)
                    putInt("bytes", f.length().toInt())
                    putDouble("modifiedAt", f.lastModified().toDouble())
                })
            }
        })
    }

    // ── Playback (downlink) ───────────────────────────────────────────────────
    // Independent of capture: either can run alone. They share only the audio
    // session, which the pipeline reference-counts.

    /**
     * Replays a recording through decode and out to the speaker. The codec is
     * inferred from the file extension, so it cannot disagree with how the file
     * was written.
     */
    @ReactMethod
    fun startPlayback(path: String, impairment: String, promise: Promise) {
        try {
            if (pipeline.startFilePlayback(path, impairment)) {
                promise.resolve(path)
            } else {
                promise.reject("playback_start", pipeline.lastError ?: "could not start playback")
            }
        } catch (e: Exception) {
            Log.e(TAG, "startPlayback failed: ${e.message}", e)
            promise.reject("playback_start", e)
        }
    }

    @ReactMethod
    fun stopPlayback(promise: Promise) {
        try {
            pipeline.stopPlayback()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "stopPlayback failed: ${e.message}", e)
            promise.reject("playback_stop", e)
        }
    }

    /**
     * Playback counters. `underrunFrames` is the one to watch — above 0 means
     * the jitter buffer had nothing to play and not even a previous frame to
     * repeat.
     */
    @ReactMethod
    fun getPlaybackStats(promise: Promise) {
        val s = pipeline.playbackStats()
        promise.resolve(Arguments.createMap().apply {
            putBoolean("running", s.running)
            putBoolean("finished", s.finished)
            putString("codec", s.codecName)
            putString("source", s.sourceName)
            putInt("receivedFrames", s.receivedFrames)
            putInt("sourceRead", s.sourceRead)
            putInt("sourceDropped", s.sourceDropped)
            putString("impairment", s.impairment)
            putInt("playedFrames", s.playedFrames)
            putInt("writtenFrames", s.writtenFrames)
            putInt("concealedFrames", s.concealedFrames)
            putInt("underrunFrames", s.underrunFrames)
            putInt("lateFrames", s.lateFrames)
            putInt("duplicateFrames", s.duplicateFrames)
            putInt("jitterDepth", s.jitterDepth)
            if (s.filePath != null) putString("filePath", s.filePath) else putNull("filePath")
            if (s.error != null) putString("error", s.error) else putNull("error")
        })
    }

    // RN requires these for addListener/removeListeners on NativeEventEmitter.
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit
}
