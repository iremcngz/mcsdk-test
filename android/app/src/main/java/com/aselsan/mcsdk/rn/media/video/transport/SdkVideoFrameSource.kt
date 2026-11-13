package com.aselsan.mcsdk.rn.media.video.transport

import com.aselsan.mcsdk.rn.media.video.VideoTuning
import java.util.concurrent.atomic.AtomicInteger

/**
 * SdkVideoFrameSource — a call's received video, as SdkListener.onVideoFrame delivers
 * it, handed on to the decoder.
 *
 * What the SDK does that UdpVideoFrameSource did itself: the socket, the RTP header and
 * joining a frame's packets back together. Hence no packets to count here.
 *
 * It has no thread of its own: frames arrive on the SDK's media thread, through
 * CallVideoRouter, and the listener only copies.
 *
 * The screen opens before there may be a call to watch, so the call is set later,
 * through [callId]; frames of any other call are ignored.
 *
 * One stream at a time. A group call's transmitters all arrive on one port and there is
 * one decoder, so frames of two would paint garbage. It holds to the stream it has until
 * that goes quiet, then moves to the next one that sends a key frame, which is where a
 * decoder can start.
 *
 * Two things the SDK cannot do yet (no video RTCP): requestKeyFrame reaches it and does
 * nothing, so a picture starts or recovers on the sender's periodic key frames. And it
 * does not say when a frame was lost, so [VideoFrameSource.Listener.onFrameLost] is never
 * called: after a loss the frames that follow are decoded anyway, and the picture is
 * damaged until the next key frame. What is lost is still counted, from the gaps in
 * capture time ([framesMissed], CaptureGapCounter), so the viewer can be told the
 * connection is bad, and, when [freezeOnLoss] is on, the gap is reported as a lost
 * frame: the decoder then holds the last good picture until the next key frame
 * instead of drawing frames that refer to the missing one.
 *
 * Kept free of Android types so it can be tested on the JVM.
 */
class SdkVideoFrameSource(
    private val router: CallVideoRouter = CallVideoRouter,
    private val nowMs: () -> Long = { System.nanoTime() / 1_000_000 },
    /** Report a gap as a lost frame, so the decoder holds until a key frame (VideoTuning). */
    private val freezeOnLoss: () -> Boolean = { VideoTuning.freezeOnLoss },
) : VideoFrameSource, CallVideoRouter.Receiver {

    private companion object {
        const val NO_SSRC = -1L

        /** Well past the gap of a stream that is still sending: a frame is 42 ms at 24 fps. */
        const val STREAM_QUIET_MS = 1000L
    }

    override val name = "SDK"

    /** The call to take frames of, or null while there is none. */
    @Volatile
    var callId: String? = null

    @Volatile
    private var listener: VideoFrameSource.Listener? = null

    // Media-thread state, touched by one thread only.
    private var heldCall: String? = null
    private var heldSsrc = NO_SSRC
    private var lastFrameMs = 0L
    private val gaps = CaptureGapCounter()

    private val delivered = AtomicInteger(0)
    private val otherStream = AtomicInteger(0)
    private val keyRequests = AtomicInteger(0)
    private val missed = AtomicInteger(0)

    override val framesDelivered: Int get() = delivered.get()

    /** Frames of a transmitter other than the one being shown. */
    val otherStreamFrames: Int get() = otherStream.get()

    override val keyFramesRequested: Int get() = keyRequests.get()

    override val framesMissed: Int get() = missed.get()

    override val lastError: String? = null

    override fun start(listener: VideoFrameSource.Listener): Boolean {
        this.listener = listener
        router.setReceiver(this)
        return true
    }

    override fun stop() {
        router.clearReceiver(this)
        listener = null
    }

    override fun onVideoFrame(callId: String, ssrc: Long, data: ByteArray, timestampUs: Long, keyFrame: Boolean) {
        if (callId != this.callId) return

        val now = nowMs()
        if (callId != heldCall) {
            heldCall = callId
            heldSsrc = NO_SSRC
            gaps.reset()
        }
        if (ssrc != heldSsrc) {
            val free = heldSsrc == NO_SSRC || (keyFrame && now - lastFrameMs >= STREAM_QUIET_MS)
            if (!free) {
                otherStream.incrementAndGet()
                return
            }
            heldSsrc = ssrc
            gaps.reset()
        }
        lastFrameMs = now
        val n = gaps.onFrame(timestampUs)
        val l = listener
        if (n > 0) {
            missed.addAndGet(n)
            // Before the frame itself: if it is a key frame it ends the hold at once.
            if (freezeOnLoss()) l?.onFrameLost(ssrc)
        }
        delivered.incrementAndGet()
        l?.onFrame(ssrc, data, data.size, timestampUs, keyFrame)
    }

    override fun requestKeyFrame(ssrc: Long) {
        val call = callId ?: return
        keyRequests.incrementAndGet()
        router.requestKeyFrame(call, ssrc)
    }
}
