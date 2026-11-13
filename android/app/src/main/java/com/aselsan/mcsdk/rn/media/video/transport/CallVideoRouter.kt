package com.aselsan.mcsdk.rn.media.video.transport

import java.util.concurrent.atomic.AtomicInteger

/**
 * CallVideoRouter — where a call's encoded frames cross between the SDK and the
 * video pipelines, without going anywhere near JS.
 *
 * The video counterpart of CallAudioRouter, for the same reason: McSdkModule owns
 * the McSdk (one per process, it outlives the JS bridge), VideoBridgeModule owns the
 * pipelines, and frames are too large and too frequent for the event queue.
 *
 *   uplink:   SdkVideoFrameSink (encoder thread) → send() → [sender] → McSdk.sendVideoFrame
 *   downlink: McSdk → McSdkModule.onVideoFrame (media thread) → deliver() → [receiver]
 *             → SdkVideoFrameSource
 *
 * Process-wide on purpose, like the McSdk it fronts: a JS reload builds new module
 * instances, and they find the same router.
 */
object CallVideoRouter {

    /** Puts one encoded frame on a call's uplink. Set by McSdkModule. */
    fun interface Sender {
        fun send(callId: String, data: ByteArray, captureTimeUs: Long, keyFrame: Boolean)
    }

    /** Takes one received frame of a call. Set by SdkVideoFrameSource while it runs. */
    fun interface Receiver {
        fun onVideoFrame(callId: String, ssrc: Long, data: ByteArray, timestampUs: Long, keyFrame: Boolean)
    }

    /** Asks a transmitter for a key frame. Set by McSdkModule. */
    fun interface KeyFrameRequester {
        fun requestKeyFrame(callId: String, ssrc: Long)
    }

    @Volatile
    var sender: Sender? = null

    @Volatile
    var keyFrameRequester: KeyFrameRequester? = null

    @Volatile
    private var receiver: Receiver? = null

    private val sent = AtomicInteger(0)
    private val noSender = AtomicInteger(0)
    private val received = AtomicInteger(0)
    private val keysReceived = AtomicInteger(0)

    /** Frames handed to the SDK. */
    val framesSent: Int get() = sent.get()

    /** Frames that found no SDK to send through — must stay 0 during a call. */
    val framesWithoutSender: Int get() = noSender.get()

    /** Frames the SDK delivered, of any call. */
    val framesReceived: Int get() = received.get()

    /** The key frames among them. */
    val keyFramesReceived: Int get() = keysReceived.get()

    /** Called on the encoder thread. False when there is no SDK to send through. */
    fun send(callId: String, data: ByteArray, captureTimeUs: Long, keyFrame: Boolean): Boolean {
        val s = sender
        if (s == null) {
            noSender.incrementAndGet()
            return false
        }
        s.send(callId, data, captureTimeUs, keyFrame)
        sent.incrementAndGet()
        return true
    }

    /** Called on the SDK's media thread. Returns how many frames have arrived so far. */
    fun deliver(callId: String, ssrc: Long, data: ByteArray, timestampUs: Long, keyFrame: Boolean): Int {
        if (keyFrame) keysReceived.incrementAndGet()
        val count = received.incrementAndGet()
        receiver?.onVideoFrame(callId, ssrc, data, timestampUs, keyFrame)
        return count
    }

    fun requestKeyFrame(callId: String, ssrc: Long) {
        keyFrameRequester?.requestKeyFrame(callId, ssrc)
    }

    fun setReceiver(r: Receiver) {
        receiver = r
    }

    /**
     * Clears the receiver only if it is still [r]: a source stopping late must
     * not unhook the one that replaced it.
     */
    @Synchronized
    fun clearReceiver(r: Receiver) {
        if (receiver === r) receiver = null
    }

    /** For tests. */
    internal fun resetForTest() {
        sender = null
        keyFrameRequester = null
        receiver = null
        sent.set(0); noSender.set(0); received.set(0); keysReceived.set(0)
    }
}
