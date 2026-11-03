package com.aselsan.mcsdk.rn.media

import java.util.concurrent.atomic.AtomicInteger

/**
 * SdkFrameSink — puts a call's encoded frames on its uplink through the SDK.
 *
 * The third destination AudioFrameSink was built for, after the file and the
 * UDP socket: capture and the codec are the same, only the last hop changes.
 * Each frame is turned from AmrWbCodec's storage frame into the octet-aligned
 * RTP payload (AmrWbRtpPayload.pack) the call declared, and handed to
 * McSdk.sendAudioFrame via CallAudioRouter. The SDK sends it verbatim.
 *
 * Runs on the capture thread, under AudioFrameSink's rules — no blocking, no
 * locks, no allocation per frame. sendAudioFrame "never blocks and never
 * queues", so it can be called inline, the way UdpFrameSink sends inline.
 *
 * The one wrinkle is that sendAudioFrame takes a whole byte[], with no offset
 * or length, so the payload needs an array of exactly its size. AMR-WB here is
 * constant bit rate, so that size is the same for every frame of a call: the
 * array is allocated once, on the first frame, and only again if the size ever
 * changes. The SDK copies the bytes before returning, so reusing it is safe.
 *
 * What the SDK does that the UDP sink did itself: the RTP header, the sequence
 * number, the SSRC and the marker bit. Hence [onFrame]'s marker is unused, and
 * the frame is sent whatever the floor says — the SDK drops it silently when the
 * call may not send. The pipeline's transmit gate is what keeps the encoder
 * from running for nothing.
 */
class SdkFrameSink(
    private val callId: String,
    private val router: CallAudioRouter = CallAudioRouter,
) : AudioFrameSink {

    override val name = "SDK"

    private var wire = ByteArray(0)
    private var sampleRate = 16000
    private var frameSamples = 320
    private var lastTimestamp = 0
    private var haveLast = false

    private val sent = AtomicInteger(0)
    private val rejected = AtomicInteger(0)
    private val notSent = AtomicInteger(0)
    private val gapFrames = AtomicInteger(0)

    /** Frames handed to the SDK. */
    val framesSent: Int get() = sent.get()
    /** Frames AmrWbRtpPayload refused as malformed — must stay 0. */
    val framesRejected: Int get() = rejected.get()

    override val droppedFrames: Int get() = rejected.get() + notSent.get()

    /**
     * Frame slots skipped inside a talk spurt: the timestamp moved on by more
     * than one frame although transmission never paused. Each one is a hole at
     * the far end, made here rather than by the network — and two in a row
     * read to the SDK as a new spurt, which marks the packet and has the far
     * end's jitter buffer start over.
     */
    val timestampGapFrames: Int get() = gapFrames.get()

    val target: String get() = "SDK call $callId"

    /** The SDK carries AMR-WB only; anything else would be noise at the far end. */
    override fun open(codec: AudioCodec) {
        require(codec.name == "AMR-WB") { "the SDK carries AMR-WB only, not ${codec.name}" }
        sampleRate = codec.sampleRate
        frameSamples = codec.frameSamples
        haveLast = false
    }

    override fun onFrame(payload: ByteArray, len: Int, timestamp: Int, marker: Boolean) {
        if (haveLast && !marker) {
            val skipped = (timestamp - lastTimestamp) / frameSamples - 1
            if (skipped > 0) gapFrames.addAndGet(skipped)
        }
        lastTimestamp = timestamp
        haveLast = true
        if (wire.size != len + 1) wire = ByteArray(len + 1)
        if (AmrWbRtpPayload.pack(payload, len, wire) < 0) {
            rejected.incrementAndGet()
            return
        }
        if (router.send(callId, wire, captureTimeUs(timestamp, sampleRate))) {
            sent.incrementAndGet()
        } else {
            notSent.incrementAndGet()
        }
    }

    override fun close() = Unit

    companion object {
        /**
         * The capture instant of a frame, from its RTP timestamp in samples.
         * From the sample count, not the clock, for the reason AudioCapture
         * counts samples at all: the device and the system clock drift apart.
         * Monotonic as the SDK requires — the timestamp is read as unsigned, so
         * it only wraps after 2^32 samples (74 hours at 16 kHz).
         */
        fun captureTimeUs(timestamp: Int, sampleRate: Int): Long =
            (timestamp.toLong() and 0xFFFFFFFFL) * 1_000_000L / sampleRate
    }
}
