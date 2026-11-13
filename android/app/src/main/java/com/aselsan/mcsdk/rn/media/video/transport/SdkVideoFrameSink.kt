package com.aselsan.mcsdk.rn.media.video.transport

import android.util.Log
import java.util.concurrent.atomic.AtomicInteger

/**
 * SdkVideoFrameSink — puts encoded frames on a call's uplink through the SDK.
 *
 * What the SDK does that UdpVideoFrameSink did itself: the RFC 6184 packetization,
 * the RTP header and the socket. Hence no packets to count here.
 *
 * The camera comes up before the call has anywhere to send, since the screen shows
 * its picture from the moment it opens. So the call is set later, through [callId],
 * and until then frames have no destination; the pipeline's transmit gate keeps
 * them from getting here at all.
 *
 * [open]'s feedback is not kept: the SDK sends and reads no video RTCP yet, so
 * onKeyFrameRequested and onVideoBitrateChanged never fire. A receiver recovers on
 * the encoder's periodic key frames.
 *
 * Runs on the encoder's thread. sendVideoFrame takes a whole array with no length,
 * and frames vary in size, so each one is copied to an array of exactly its size.
 * That is ~100 KB/s at 800 kbps, nothing like audio's real-time rules.
 */
class SdkVideoFrameSink(
    private val router: CallVideoRouter = CallVideoRouter,
) : VideoFrameSink {

    private companion object {
        const val TAG = "McSdkVideoSdkSink"
    }

    override val name = "SDK"

    /** The call frames go to, or null while there is none to send to. */
    @Volatile
    var callId: String? = null

    private val sent = AtomicInteger(0)
    private val notSent = AtomicInteger(0)

    /** Frames handed to the SDK. It may still drop them: without permission it does, silently. */
    val framesSent: Int get() = sent.get()

    override val sendErrors: Int get() = notSent.get()

    override val target: String get() = "SDK call ${callId ?: "-"}"

    override val lastError: String? = null

    override fun open(feedback: VideoFrameSink.Feedback) = Unit

    override fun onFrame(data: ByteArray, len: Int, captureTimeUs: Long, keyFrame: Boolean) {
        val call = callId ?: return
        if (router.send(call, data.copyOf(len), captureTimeUs, keyFrame)) {
            sent.incrementAndGet()
        } else {
            notSent.incrementAndGet()
        }
    }

    override fun close() {
        Log.d(TAG, "close: sent=${sent.get()} notSent=${notSent.get()}")
    }
}
