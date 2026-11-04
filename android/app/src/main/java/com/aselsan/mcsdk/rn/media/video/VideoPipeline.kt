package com.aselsan.mcsdk.rn.media.video

import android.content.Context
import android.util.Log
import com.aselsan.mcsdk.rn.media.video.codec.H264FrameAssembler
import com.aselsan.mcsdk.rn.media.video.codec.VideoEncoder
import com.aselsan.mcsdk.rn.media.video.transport.UdpVideoFrameSink
import com.aselsan.mcsdk.rn.media.video.transport.VideoFrameSink

/**
 * VideoPipeline — the uplink's parts, and the order they start and stop in:
 *
 *   camera → VideoRotator → encoder → H264FrameAssembler → VideoFrameSink
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

    private var rotator: VideoRotator? = null
    private var encoder: VideoEncoder? = null
    private var assembler: H264FrameAssembler? = null
    private var sink: VideoFrameSink? = null
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
        val udp = sink as? UdpVideoFrameSink
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
            packetsSent = udp?.packetsSent ?: 0,
            sendErrors = udp?.sendErrors ?: 0,
            target = udp?.target,
            error = startError ?: capture.lastError ?: encoder?.lastError ?: udp?.lastError,
        )
    }

    /**
     * Starts sending the camera to [host]:[port] as RTP over UDP.
     *
     * @return false on failure, with stats().error set
     */
    @Synchronized
    fun startUdp(host: String, port: Int): Boolean = start(UdpVideoFrameSink(host, port))

    private fun start(newSink: VideoFrameSink, wanted: VideoConfig = VideoConfig()): Boolean {
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
        val newAssembler = H264FrameAssembler { data, len, timeUs, key ->
            stalls.onFrame(System.currentTimeMillis(), timeUs, key)
            newSink.onFrame(data, len, timeUs, key)
        }
        val newEncoder = VideoEncoder(config, newAssembler)
        val newRotator = VideoRotator(
            cameraWidth = camera.width,
            cameraHeight = camera.height,
            outWidth = config.width,
            outHeight = config.height,
            sensorOrientation = capture.sensorOrientation,
            deviceAngle = { orientation.angle },
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
        Log.d(TAG, "stopped: frames=${assembler?.framesDelivered} keys=${assembler?.keyFrames} " +
                   "bytes=${assembler?.bytesDelivered} profile=${assembler?.profileLevelId}")
    }
}
