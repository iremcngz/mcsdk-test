package com.aselsan.mcsdk.rn.media.video

import android.content.Context
import android.util.Log
import android.view.Surface
import android.view.WindowManager
import com.aselsan.mcsdk.rn.media.video.codec.H264FrameAssembler
import com.aselsan.mcsdk.rn.media.video.codec.KeyFramePacer
import com.aselsan.mcsdk.rn.media.video.codec.VideoEncoder
import com.aselsan.mcsdk.rn.media.video.transport.SdkVideoFrameSink
import com.aselsan.mcsdk.rn.media.video.transport.UdpVideoFrameSink
import com.aselsan.mcsdk.rn.media.video.transport.VideoFrameSink
import com.aselsan.mcsdk.rn.media.video.view.LocalVideoSurface

/**
 * VideoPipeline — the uplink's parts, and the order they start and stop in:
 *
 *   camera → VideoRotator → encoder → H264FrameAssembler → VideoFrameSink
 *                         → the preview's Surface, on a call
 *
 * Startup runs from the destination back to the camera, so nothing is produced
 * before there is somewhere for it to go. Teardown is the exact reverse and runs on
 * every failure path, since holding on to the camera locks every other app out of it.
 *
 * Which sink is used is decided here and nowhere else: the camera, encoder and
 * assembler are the same whatever the frames' destination.
 */
class VideoPipeline(context: Context) {

    private companion object {
        const val TAG = "McSdkVideoPipeline"

        /** A gap this long at 24 fps (42 ms a frame) is visible as a stutter. */
        const val STALL_MS = 120L
    }

    private val capture = VideoCapture(context)
    private val orientation = DeviceOrientation(context)
    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private var rotator: VideoRotator? = null
    private var encoder: VideoEncoder? = null
    private var assembler: H264FrameAssembler? = null
    private var pacer: KeyFramePacer? = null
    private var sink: VideoFrameSink? = null
    private var callSink: SdkVideoFrameSink? = null
    private var active: VideoConfig? = null

    @Volatile
    private var startError: String? = null

    data class Stats(
        val running: Boolean,
        val width: Int,
        val height: Int,
        val framesEncoded: Int,
        val keyFrames: Int,
        val bytes: Long,
        val keyFramesWithoutConfig: Int,
        val seconds: Double,
        val profileLevelId: String?,
        val packetsSent: Int,
        val sendErrors: Int,
        val target: String?,
        val error: String?,
    )

    val isRunning: Boolean @Synchronized get() = encoder != null

    /** Counters stay readable after stop(), so the screen can show the last run. */
    @Synchronized
    fun stats(): Stats {
        val a = assembler
        val span = if (a != null && a.firstTimeUs >= 0) (a.lastTimeUs - a.firstTimeUs) / 1_000_000.0 else 0.0
        val out = sink
        return Stats(
            running = encoder != null,
            width = active?.width ?: 0,
            height = active?.height ?: 0,
            framesEncoded = a?.framesDelivered ?: 0,
            keyFrames = a?.keyFrames ?: 0,
            bytes = a?.bytesDelivered ?: 0L,
            keyFramesWithoutConfig = a?.keyFramesWithoutConfig ?: 0,
            seconds = span,
            profileLevelId = a?.profileLevelId,
            packetsSent = out?.packetsSent ?: 0,
            sendErrors = out?.sendErrors ?: 0,
            target = out?.target,
            error = startError ?: capture.lastError ?: encoder?.lastError ?: out?.lastError,
        )
    }

    /**
     * Starts sending the camera to [host]:[port] as RTP over UDP.
     *
     * @return false on failure, with stats().error set
     */
    @Synchronized
    fun startUdp(host: String, port: Int): Boolean = start(UdpVideoFrameSink(host, port))

    /**
     * Starts the camera for a call, showing its picture in the local view but sending
     * nothing until [setCallTarget] names a call. The encoder runs from here on, so that
     * sending can begin the moment permission comes.
     *
     * LocalVideoSurface is called outside this object's lock, here and in [stopCall],
     * for the reason VideoReceiver gives: it calls back with its own lock held, so the
     * order is always its lock, then this one.
     *
     * @return false on failure, with stats().error set
     */
    fun startCall(): Boolean {
        if (!openCallSink()) return false
        LocalVideoSurface.setListener { surface -> onPreviewSurface(surface) }
        return true
    }

    @Synchronized
    private fun openCallSink(): Boolean {
        val newSink = SdkVideoFrameSink()
        if (!start(newSink, transmitEnabled = false)) return false
        callSink = newSink
        return true
    }

    /** With LocalVideoSurface's lock held. The Surface is usable until this returns. */
    @Synchronized
    private fun onPreviewSurface(surface: Surface?) {
        rotator?.setPreview(surface)
    }

    /** The call to send to from now on, or null to stop sending. The camera stays on. */
    @Synchronized
    fun setCallTarget(callId: String?) {
        val s = callSink ?: return
        s.callId = callId
        setTransmitEnabled(callId != null)
    }

    /**
     * Switches between the back and front camera while a call's camera is running.
     *
     * A CameraDevice is one physical camera, so this is a restart: the encoder, the
     * rotator and the sink all go and come back, because the new camera can offer a
     * different capture size and a different sensor orientation. What it keeps is the
     * call being sent to and whether frames were going out, so a flip mid-transmission
     * carries on sending from the other camera.
     *
     * A receiver sees a brief gap and then a key frame, which [start] asks for.
     *
     * @return false when there is no second camera, or the new one did not start; in
     *         the latter case stats().error says why and the pipeline is left stopped.
     */
    @Synchronized
    fun flipCamera(): Boolean {
        if (encoder == null) {
            startError = "the camera is not running"
            return false
        }
        if (capture.cameraCount() < 2) {
            startError = "this device has only one camera"
            return false
        }
        // Kept across the restart: teardown() clears callSink, and a flip must not
        // silently stop sending.
        val callId = callSink?.callId
        val wasSending = assembler?.transmitEnabled == true

        teardown()
        capture.useFrontCamera = !capture.useFrontCamera
        if (!openCallSink()) {
            // Back to the camera that was working, so a failed flip is not a dead view.
            capture.useFrontCamera = !capture.useFrontCamera
            Log.w(TAG, "flip failed; going back to the other camera")
            if (!openCallSink()) return false
            setCallTarget(callId)
            setTransmitEnabled(wasSending && callId != null)
            rotator?.setPreview(LocalVideoSurface.peek())
            return false
        }
        setCallTarget(callId)
        setTransmitEnabled(wasSending && callId != null)
        // The new rotator draws nothing until it is given the view. Read rather than
        // re-registered: setListener calls back holding LocalVideoSurface's lock, and
        // this method holds ours, so asking for its lock here crosses the two orders.
        rotator?.setPreview(LocalVideoSurface.peek())
        Log.d(TAG, "flipped: front=${capture.useFrontCamera} call=$callId sending=$wasSending")
        return true
    }

    /** True when there is a camera to flip to. */
    fun hasMultipleCameras(): Boolean = capture.cameraCount() >= 2

    /** Safe when not running. */
    fun stopCall() {
        LocalVideoSurface.setListener(null)
        stop()
    }

    /** The display's rotation, as DeviceOrientation's angle for the same way up. */
    @Suppress("DEPRECATION")
    private fun displayAngle(): Int = when (windowManager.defaultDisplay.rotation) {
        Surface.ROTATION_90 -> 270
        Surface.ROTATION_180 -> 180
        Surface.ROTATION_270 -> 90
        else -> 0
    }

    private fun start(
        newSink: VideoFrameSink,
        // Read at each start: the settings screen may have changed it since the last.
        wanted: VideoConfig = VideoTuning.config(),
        transmitEnabled: Boolean = true,
    ): Boolean {
        if (encoder != null) {
            startError = "already sending"
            return false
        }
        startError = null

        val camera = capture.resolve(wanted) ?: return false

        // The frame's shape is fixed for the encoder's life, so it follows how the
        // phone is held now. Turned later, the picture stays upright with bars.
        orientation.start()
        val wide = VideoRotation.isLandscape(orientation.angle)
        val long = maxOf(camera.width, camera.height)
        val short = minOf(camera.width, camera.height)
        val config = camera.copy(width = if (wide) long else short, height = if (wide) short else long)

        // Logged for one reason: telling a stall in the encoder apart from one on the
        // network needs the two phones' lines side by side. Rare by definition.
        val stalls = FrameGapMeter(STALL_MS) { gap, captured, key ->
            Log.d(TAG, "stall: no frame from the encoder for $gap ms, captured $captured ms apart, key=$key")
        }
        // The encoder is built from the assembler, so the pacer reaches it through this.
        var pacedEncoder: VideoEncoder? = null
        val newPacer = KeyFramePacer(
            intervalSeconds = config.keyFrameIntervalSeconds,
            requestKeyFrame = { pacedEncoder?.requestKeyFrame() },
            onFirstForced = { since ->
                Log.d(TAG, "encoder made no key frame in $since ms " +
                           "(interval ${config.keyFrameIntervalSeconds} s): asking for them")
            },
        )
        val newAssembler = H264FrameAssembler { data, len, timeUs, key ->
            stalls.onFrame(System.currentTimeMillis(), timeUs, key)
            newPacer.onFrame(timeUs, key)
            newSink.onFrame(data, len, timeUs, key)
        }
        newAssembler.transmitEnabled = transmitEnabled
        val newEncoder = VideoEncoder(config, newAssembler)
        pacedEncoder = newEncoder
        pacer = newPacer
        val newRotator = VideoRotator(
            cameraWidth = camera.width,
            cameraHeight = camera.height,
            outWidth = config.width,
            outHeight = config.height,
            sensorOrientation = capture.sensorOrientation,
            deviceAngle = { orientation.angle },
            displayAngle = ::displayAngle,
            mirror = capture.isFront,
        )

        try {
            newSink.open(object : VideoFrameSink.Feedback {
                override fun onKeyFrameRequested() = newEncoder.requestKeyFrame()
                override fun onBitrateChanged(kbps: Int) = newEncoder.setBitrate(kbps)
            })
            sink = newSink
            assembler = newAssembler
            active = config

            val encoderSurface = newEncoder.start()
            encoder = newEncoder

            rotator = newRotator
            val cameraSurface = newRotator.start(encoderSurface)

            if (!capture.start(listOf(cameraSurface))) {
                teardown()
                return false
            }
            Log.d(TAG, "started: $config → ${newSink.name}")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "start failed: ${e.message}", e)
            startError = e.message ?: e.toString()
            encoder = newEncoder
            sink = newSink
            teardown()
            return false
        }
    }

    /**
     * Sets whether frames reach the sink. Opening asks for a key frame at once:
     * otherwise a receiver sees nothing it can decode until the next periodic one.
     */
    @Synchronized
    fun setTransmitEnabled(enabled: Boolean) {
        assembler?.transmitEnabled = enabled
        if (enabled) encoder?.requestKeyFrame()
    }

    /** Safe when not running. */
    @Synchronized
    fun stop() {
        if (encoder == null) return
        teardown()
    }

    /** Camera first, so the encoder can drain and the sink gets every last frame. */
    private fun teardown() {
        capture.stop()
        orientation.stop()
        rotator?.stop()
        rotator = null
        try {
            encoder?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "encoder stop: ${e.message}")
        }
        encoder = null
        sink?.close()
        callSink = null
        Log.d(TAG, "stopped: frames=${assembler?.framesDelivered} keys=${assembler?.keyFrames} " +
                   "forcedKeys=${pacer?.forced ?: 0} " +
                   "bytes=${assembler?.bytesDelivered} profile=${assembler?.profileLevelId}")
    }
}
