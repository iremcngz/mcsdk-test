package com.aselsan.mcsdk.rn.media

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * SdkFrameSource — a call's received audio, as SdkListener.onAudioFrame
 * delivers it, handed on to the jitter buffer.
 *
 * The counterpart of SdkFrameSink, and the third origin AudioFrameSource was
 * built for, after the file and the UDP socket. It has no thread of its own:
 * frames arrive on the SDK's media thread (through CallAudioRouter), and this
 * does the little the UDP source did after its receive() — turn the payload
 * back into storage frames (AmrWbRtpPayload.unpack) and pass them on. No decode
 * here, for the same reason as there: while this runs the SDK is not reading
 * its socket.
 *
 * Three things the wire hands us that the jitter buffer needs differently:
 *  - Time. The SDK gives the sender's RTP timestamp scaled to microseconds
 *    (rtp × 1 000 000 / 16 000); the jitter buffer counts samples. Scaling back
 *    is exact with rounding, and the result wraps like the RTP timestamp it was.
 *  - Bursts. The marker bit starts a talk burst, and so does a new SSRC — the
 *    floor passed to another talker, with their own clock. Both are reported as
 *    firstOfBurst so the jitter buffer restarts its timeline.
 *  - Packing. A packet may carry several frames (a 40 ms ptime); they follow
 *    one another, 320 samples apart.
 *
 * One stream at a time: a private call has one far end. A multi-talker group
 * would need a decoder per SSRC, as the SDK's AudioFrame notes, and is not what
 * this serves.
 */
class SdkFrameSource(
    private val callId: String,
    private val router: CallAudioRouter = CallAudioRouter,
) : AudioFrameSource, CallAudioRouter.Receiver {

    override val name = "SDK"

    private var listener: AudioFrameSource.Listener? = null
    private val running = AtomicBoolean(false)
    private var frameSamples = 320

    // Media-thread state, touched by one thread only.
    private var currentSsrc = NO_SSRC
    private var packetTimestamp = 0
    private var packetFirst = false
    private var frameInPacket = 0
    private val scratch = ByteArray(AmrWbRtpPayload.MAX_FRAME_BYTES)
    private var lastArrivalNs = 0L
    private var lastTimestampUs = 0L
    private var lastFrames = 1

    private val packets = AtomicInteger(0)
    private val delivered = AtomicInteger(0)
    private val malformed = AtomicInteger(0)
    private val otherCall = AtomicInteger(0)
    private val talkers = AtomicInteger(0)
    private val bursts = AtomicInteger(0)
    private val gapFrames = AtomicInteger(0)
    private val maxGapUs = AtomicLong(0)

    @Volatile
    private var jitterUs = 0L

    @Volatile
    private var ssrcSeen = NO_SSRC

    @Volatile
    override var lastError: String? = null
        private set

    override val isRunning: Boolean get() = running.get()
    override val framesDelivered: Int get() = delivered.get()

    /** Payloads taken for this call. */
    val packetsReceived: Int get() = packets.get()
    /** Payloads AmrWbRtpPayload refused — must stay 0. */
    val malformedPackets: Int get() = malformed.get()
    /** Frames for some other call, ignored. */
    val otherCallFrames: Int get() = otherCall.get()
    /** How many times the talker (SSRC) changed, the first one included. */
    val talkerChanges: Int get() = talkers.get()
    /** Packets that started a talk burst (marker bit or new talker). */
    val burstStarts: Int get() = bursts.get()
    /**
     * Frames missing inside a burst, from gaps in the sender's timestamp. The
     * SDK does not hand over the sequence number, so this is the nearest thing
     * to packet loss — it also counts slots the sender itself skipped, which
     * its own uplink gap counter tells apart.
     */
    val timestampGapFrames: Int get() = gapFrames.get()
    /** RFC 3550 §6.4.1 interarrival jitter, in microseconds. */
    val interarrivalJitterUs: Long get() = jitterUs
    /** Longest wait between two packets of a burst since the last call. */
    fun takeMaxArrivalGapUs(): Long = maxGapUs.getAndSet(0)

    /** The SSRC being received, as RTP's unsigned 32 bits in an Int. */
    val remoteSsrcValue: Int get() = if (ssrcSeen == NO_SSRC) 0 else ssrcSeen.toInt()

    override fun setListener(listener: AudioFrameSource.Listener) {
        this.listener = listener
    }

    override fun start(codec: AudioCodec): Boolean {
        if (listener == null) {
            lastError = "no listener set"
            return false
        }
        if (codec.name != "AMR-WB") {
            lastError = "the SDK carries AMR-WB only, not ${codec.name}"
            return false
        }
        frameSamples = codec.frameSamples
        currentSsrc = NO_SSRC
        lastError = null
        running.set(true)
        router.setReceiver(this)
        return true
    }

    override fun stop() {
        running.set(false)
        router.clearReceiver(this)
    }

    private val consumer = AmrWbRtpPayload.FrameConsumer { frame, len ->
        val ts = packetTimestamp + frameInPacket * frameSamples
        val first = packetFirst && frameInPacket == 0
        frameInPacket++
        listener?.onFrame(frame, len, ts, first)
        delivered.incrementAndGet()
    }

    override fun onAudioFrame(callId: String, ssrc: Long, payload: ByteArray, timestampUs: Long,
                              firstOfBurst: Boolean) {
        if (!running.get()) return
        if (callId != this.callId) {
            otherCall.incrementAndGet()
            return
        }
        packets.incrementAndGet()

        val newTalker = ssrc != currentSsrc
        if (newTalker) {
            currentSsrc = ssrc
            ssrcSeen = ssrc
            talkers.incrementAndGet()
        }
        packetTimestamp = rtpTimestamp(timestampUs)
        packetFirst = firstOfBurst || newTalker
        frameInPacket = 0

        val now = System.nanoTime()
        if (packetFirst || lastArrivalNs == 0L) {
            bursts.incrementAndGet()
        } else {
            val arrivalUs = (now - lastArrivalNs) / 1000
            val spanUs = timestampUs - lastTimestampUs
            val skipped = (spanUs / FRAME_US - lastFrames).toInt()
            if (skipped > 0) gapFrames.addAndGet(skipped)
            if (arrivalUs > maxGapUs.get()) maxGapUs.set(arrivalUs)
            val d = Math.abs(arrivalUs - spanUs)
            jitterUs += (d - jitterUs) / 16
        }
        lastArrivalNs = now
        lastTimestampUs = timestampUs

        val frames = AmrWbRtpPayload.unpack(payload, payload.size, scratch, consumer)
        if (frames < 0) {
            malformed.incrementAndGet()
        } else {
            lastFrames = maxOf(frames, 1)
        }
    }

    companion object {
        private const val NO_SSRC = -1L
        private const val FRAME_US = 20_000L

        /**
         * The RTP timestamp, in samples, back from the SDK's microseconds: the
         * inverse of `rtp * 1_000_000 / 16_000`, rounded so a timestamp the SDK
         * floored comes back exact. Truncating to Int keeps the low 32 bits —
         * the RTP timestamp's own wrap — and the jitter buffer's Int arithmetic
         * handles both its sign and its wrap.
         */
        fun rtpTimestamp(timestampUs: Long, clockRate: Int = 16000): Int =
            ((timestampUs * clockRate + 500_000L) / 1_000_000L).toInt()
    }
}
