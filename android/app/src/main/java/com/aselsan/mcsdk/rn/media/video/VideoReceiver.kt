package com.aselsan.mcsdk.rn.media.video

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import com.aselsan.mcsdk.rn.media.video.codec.KeyFrameGate
import com.aselsan.mcsdk.rn.media.video.codec.PlayoutClock
import com.aselsan.mcsdk.rn.media.video.codec.VideoDecoder
import com.aselsan.mcsdk.rn.media.video.transport.UdpVideoFrameSource
import com.aselsan.mcsdk.rn.media.video.transport.VideoFrameSource
import com.aselsan.mcsdk.rn.media.video.view.RemoteVideoSurface

/**
 * VideoReceiver — the downlink:
 *
 *   VideoFrameSource → KeyFrameGate → VideoDecoder (held to PlayoutClock's time) → the view's Surface
 *
 * The source and the decoder have separate lives. The source runs from start to
 * stop. The decoder exists only while there is a Surface to draw on, which comes and
 * goes as the user leaves and returns to the screen; each time it comes back the
 * decoder starts from nothing and needs a key frame.
 *
 * Which source is used is decided here and nowhere else.
 */
class VideoReceiver {

    private companion object {
        const val TAG = "McSdkVideoReceiver"

        /** A gap this long at 24 fps (42 ms a frame) is visible as a stutter. */
        const val STALL_MS = 120L

        const val NETWORK_CHECK_MS = 1000L
    }

    data class Stats(
        val running: Boolean,
        val width: Int,
        val height: Int,
        val packetsReceived: Int,
        val packetsLost: Int,
        val framesReceived: Int,
        val framesDiscarded: Int,
        val framesDecoded: Int,
        val framesLate: Int,
        val keyFramesRequested: Int,
        val drawSeconds: Double,
        val networkQuality: String,
        val error: String?,
    )

    private val mainThread = Handler(Looper.getMainLooper())

    private var monitor = VideoNetworkMonitor()

    @Volatile
    private var quality = VideoNetworkMonitor.Quality.GOOD

    private val networkCheck = object : Runnable {
        override fun run() {
            checkNetwork()
            mainThread.postDelayed(this, NETWORK_CHECK_MS)
        }
    }

    private var source: UdpVideoFrameSource? = null
    private var gate: KeyFrameGate? = null

    @Volatile
    private var decoder: VideoDecoder? = null
    private var surface: Surface? = null

    @Volatile
    private var width = 0

    @Volatile
    private var height = 0

    /** Survives a decoder's restart, so the screen's counter does not jump back. */
    private var decodedBefore = 0
    private var lateBefore = 0
    private var secondsBefore = 0.0

    @Volatile
    private var error: String? = null

    val isRunning: Boolean @Synchronized get() = source != null

    @Synchronized
    fun stats(): Stats {
        val s = source ?: lastSource
        return Stats(
            running = source != null,
            width = width,
            height = height,
            packetsReceived = s?.packetsReceived ?: 0,
            packetsLost = s?.packetsLost ?: 0,
            framesReceived = s?.framesDelivered ?: 0,
            framesDiscarded = s?.framesDiscarded ?: 0,
            framesDecoded = decodedBefore + (decoder?.framesDecoded ?: 0),
            framesLate = lateBefore + (decoder?.framesLate ?: 0),
            keyFramesRequested = s?.keyFramesRequested ?: 0,
            drawSeconds = secondsBefore + (decoder?.drawSeconds ?: 0.0),
            networkQuality = quality.name,
            error = error ?: decoder?.lastError ?: s?.lastError,
        )
    }

    /** Kept after stop() so the screen can still show the last run's counters. */
    private var lastSource: UdpVideoFrameSource? = null

    /**
     * Starts listening on [port]. False on failure, with stats().error set.
     *
     * RemoteVideoSurface is called outside this object's lock, here and in stop(),
     * because it calls back with its own lock held: the order is always its lock,
     * then this one, and taking them the other way round could deadlock against a
     * view appearing on the main thread.
     */
    fun startUdp(port: Int): Boolean {
        if (!openSource(port)) return false
        RemoteVideoSurface.setListener { s -> onSurface(s) }
        return true
    }

    @Synchronized
    private fun openSource(port: Int): Boolean {
        if (source != null) {
            error = "already receiving"
            return false
        }
        error = null
        width = 0
        height = 0
        decodedBefore = 0
        lateBefore = 0
        secondsBefore = 0.0

        val newSource = UdpVideoFrameSource(port)
        val newGate = KeyFrameGate({ ssrc -> newSource.requestKeyFrame(ssrc) })
        // A long gap in arrival with a short one in capture time means the frames were
        // held up on the way here. Rare by definition, so logging it costs nothing.
        val stalls = FrameGapMeter(STALL_MS) { gap, captured, key ->
            Log.d(TAG, "stall: no frame for $gap ms, captured $captured ms apart, key=$key")
        }
        val clock = PlayoutClock()
        val listener = object : VideoFrameSource.Listener {
            override fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) {
                val now = SystemClock.elapsedRealtime()
                stalls.onFrame(now, timestampUs, keyFrame)
                // Before the gate: every arrival says something about the network.
                val playAt = clock.playAt(now, timestampUs)
                val d = decoder ?: return
                if (newGate.accept(ssrc, keyFrame) && !d.offer(data, len, timestampUs, playAt)) {
                    newGate.onLost(ssrc)
                }
            }

            override fun onFrameLost(ssrc: Long) = newGate.onLost(ssrc)
        }

        if (!newSource.start(listener)) {
            error = newSource.lastError
            return false
        }
        source = newSource
        lastSource = newSource
        gate = newGate
        monitor = VideoNetworkMonitor()
        quality = VideoNetworkMonitor.Quality.GOOD
        mainThread.postDelayed(networkCheck, NETWORK_CHECK_MS)
        Log.d(TAG, "started on :$port")
        return true
    }

    /** Safe when not running. */
    fun stop() {
        RemoteVideoSurface.setListener(null)
        closeSource()
    }

    @Synchronized
    private fun closeSource() {
        val s = source ?: return
        mainThread.removeCallbacks(networkCheck)
        quality = VideoNetworkMonitor.Quality.GOOD
        // Source first: stop the inflow before the consumer goes away.
        s.stop()
        source = null
        gate = null
        stopDecoder()
        surface = null
        Log.d(TAG, "stopped")
    }

    @Synchronized
    private fun checkNetwork() {
        val s = source ?: return
        val next = monitor.onSample(
            nowMs = SystemClock.elapsedRealtime(),
            packets = s.packetsReceived,
            lost = s.packetsLost,
            frames = s.framesDelivered,
            discarded = s.framesDiscarded,
            late = lateBefore + (decoder?.framesLate ?: 0),
        )
        if (next != quality) Log.d(TAG, "network: $quality → $next")
        quality = next
    }

    /** With RemoteVideoSurface's lock held. The Surface is usable until this returns. */
    @Synchronized
    private fun onSurface(newSurface: Surface?) {
        stopDecoder()
        surface = newSurface
        if (newSurface != null && source != null) startDecoder(newSurface)
    }

    private fun startDecoder(target: Surface) {
        val d = VideoDecoder(
            surface = target,
            onSize = { w, h ->
                width = w
                height = h
            },
            // Off the codec's own thread, which stop() would otherwise be quitting
            // from inside.
            onFailed = { mainThread.post { restartDecoder() } },
        )
        try {
            d.start()
            decoder = d
            gate?.restart()
        } catch (e: Exception) {
            Log.e(TAG, "decoder start failed: ${e.message}", e)
            error = "decoder: ${e.message}"
            d.stop()
        }
    }

    private fun stopDecoder() {
        val d = decoder ?: return
        decoder = null
        decodedBefore += d.framesDecoded
        lateBefore += d.framesLate
        secondsBefore += d.drawSeconds
        d.stop()
    }

    @Synchronized
    private fun restartDecoder() {
        val target = surface ?: return
        if (source == null) return
        Log.w(TAG, "restarting the decoder: ${decoder?.lastError}")
        stopDecoder()
        startDecoder(target)
    }
}
