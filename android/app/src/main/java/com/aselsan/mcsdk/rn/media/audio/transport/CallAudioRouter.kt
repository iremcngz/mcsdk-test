package com.aselsan.mcsdk.rn.media.audio.transport

import java.util.concurrent.atomic.AtomicInteger

/**
 * CallAudioRouter — where a call's audio frames cross between the SDK and the
 * audio pipeline, without going anywhere near JS.
 *
 * The two ends live in different React Native modules: McSdkModule owns the
 * McSdk (one per process, it outlives the JS bridge), MediaBridgeModule owns the
 * MediaPipeline. Frames run at 50 a second per direction on real-time threads,
 * so they cannot take the event queue to JS and back; this object is the
 * native-side meeting point instead.
 *
 *   uplink:   SdkFrameSink (capture thread) → send() → [sender] → McSdk.sendAudioFrame
 *   downlink: McSdk → McSdkModule.onAudioFrame (media thread) → deliver() → [receiver] → SdkFrameSource
 *
 * Both hops are a volatile read and a call — nothing here blocks, locks or
 * allocates, because both threads are the ones that must not stall.
 *
 * Process-wide on purpose, like the McSdk it fronts: a JS reload builds new
 * module instances, and they find the same router.
 */
object CallAudioRouter {

    /** Puts one encoded frame on a call's uplink. Set by McSdkModule. */
    fun interface Sender {
        fun send(callId: String, payload: ByteArray, captureTimeUs: Long)
    }

    /** Takes one received frame of a call. Set by SdkFrameSource while it runs. */
    fun interface Receiver {
        fun onAudioFrame(callId: String, ssrc: Long, payload: ByteArray, timestampUs: Long,
                         firstOfBurst: Boolean)
    }

    @Volatile
    var sender: Sender? = null

    @Volatile
    private var receiver: Receiver? = null

    private val sent = AtomicInteger(0)
    private val noSender = AtomicInteger(0)
    private val received = AtomicInteger(0)
    private val unrouted = AtomicInteger(0)

    /** Frames handed to the SDK. */
    val framesSent: Int get() = sent.get()
    /** Frames that found no SDK to send through — must stay 0 during a call. */
    val framesWithoutSender: Int get() = noSender.get()
    /** Frames the SDK delivered, whoever took them. */
    val framesReceived: Int get() = received.get()
    /** Frames that arrived with no SdkFrameSource running: audio nobody plays. */
    val framesUnrouted: Int get() = unrouted.get()

    /** Called on the capture thread. False when there is no SDK to send through. */
    fun send(callId: String, payload: ByteArray, captureTimeUs: Long): Boolean {
        val s = sender
        if (s == null) {
            noSender.incrementAndGet()
            return false
        }
        s.send(callId, payload, captureTimeUs)
        sent.incrementAndGet()
        return true
    }

    /** Called on the SDK's media thread. */
    fun deliver(callId: String, ssrc: Long, payload: ByteArray, timestampUs: Long,
                firstOfBurst: Boolean) {
        received.incrementAndGet()
        val r = receiver
        if (r == null) {
            unrouted.incrementAndGet()
            return
        }
        r.onAudioFrame(callId, ssrc, payload, timestampUs, firstOfBurst)
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
        receiver = null
        sent.set(0); noSender.set(0); received.set(0); unrouted.set(0)
    }
}
