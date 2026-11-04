package com.aselsan.mcsdk.rn.media.video.codec

import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * H264FrameAssembler — turns the encoder's output buffers into frames a receiver
 * can start from.
 *
 * MediaCodec hands over the SPS and PPS once, in a buffer of their own, before
 * the first frame. The SDK requires every key frame to carry them, and it is
 * right to: someone joining a group call late, or a decoder restarting after a
 * loss, never saw that first buffer and cannot decode anything without it. So
 * they are kept here and put in front of each key frame.
 * KEY_PREPEND_HEADER_TO_SYNC_FRAMES would do this but needs API 29, and minSdk
 * is 24. Some encoders already prepend them on their own, which is detected so
 * they are not sent twice.
 *
 * This lives ahead of the sink rather than in one so that a file, UDP and the
 * SDK all receive identical frames.
 *
 * Kept free of Android types so it can be tested on the JVM, and runs on the
 * encoder's thread. A frame is copied into one array that grows to the largest
 * seen rather than allocated per frame; the counters are read from the bridge.
 */
class H264FrameAssembler(private val deliver: FrameConsumer) {

    /** Takes one finished frame. [data] is reused, so copy what you keep. */
    fun interface FrameConsumer {
        fun onFrame(data: ByteArray, len: Int, captureTimeUs: Long, keyFrame: Boolean)
    }

    private companion object {
        const val NAL_TYPE_SPS = 7
        const val INITIAL_CAPACITY = 64 * 1024
    }

    private var parameterSets = ByteArray(0)
    private var frame = ByteArray(INITIAL_CAPACITY)

    private val frames = AtomicInteger(0)
    private val keys = AtomicInteger(0)
    private val bytes = AtomicLong(0)
    private val gated = AtomicInteger(0)
    private val missingConfig = AtomicInteger(0)

    /**
     * False while the call may not send. The encoder keeps running behind a
     * closed gate so that opening it is instant; the sink just stops seeing
     * frames.
     */
    @Volatile
    var transmitEnabled = true

    /** The SPS's profile-level-id as SDP writes it, e.g. "42e01f". Null until seen. */
    @Volatile
    var profileLevelId: String? = null
        private set

    @Volatile
    var firstTimeUs = -1L
        private set

    @Volatile
    var lastTimeUs = -1L
        private set

    /** Frames handed on. */
    val framesDelivered: Int get() = frames.get()

    /** Key frames handed on. */
    val keyFrames: Int get() = keys.get()

    /** Bytes handed on. */
    val bytesDelivered: Long get() = bytes.get()

    /** Frames held back by a closed gate. */
    val framesGated: Int get() = gated.get()

    /** Key frames sent with no SPS or PPS to give them, which nobody can decode. Must stay 0. */
    val keyFramesWithoutConfig: Int get() = missingConfig.get()

    /**
     * Takes one output buffer, between its position and limit.
     *
     * @param isConfig BUFFER_FLAG_CODEC_CONFIG: the SPS and PPS rather than a frame
     * @param isKey    BUFFER_FLAG_KEY_FRAME
     */
    fun onEncoderOutput(buffer: ByteBuffer, captureTimeUs: Long, isConfig: Boolean, isKey: Boolean) {
        val size = buffer.remaining()
        if (size == 0) return

        if (isConfig) {
            // Replaces the old one: a reconfigured encoder writes new sets, and
            // keeping the first would describe frames that no longer exist.
            val sets = ByteArray(size)
            buffer.get(sets)
            parameterSets = sets
            profileLevelId = readProfileLevelId(sets)
            return
        }

        if (!transmitEnabled) {
            gated.incrementAndGet()
            return
        }

        val needsSets = isKey && !startsWithSps(buffer)
        if (needsSets && parameterSets.isEmpty()) missingConfig.incrementAndGet()
        val prefix = if (needsSets) parameterSets else NO_PREFIX

        val total = prefix.size + size
        if (frame.size < total) frame = ByteArray(maxOf(total, frame.size * 2))
        System.arraycopy(prefix, 0, frame, 0, prefix.size)
        buffer.get(frame, prefix.size, size)

        if (firstTimeUs < 0) firstTimeUs = captureTimeUs
        lastTimeUs = captureTimeUs
        frames.incrementAndGet()
        if (isKey) keys.incrementAndGet()
        bytes.addAndGet(total.toLong())

        deliver.onFrame(frame, total, captureTimeUs, isKey)
    }

    /** Whether the buffer's first NAL unit is an SPS. Leaves its position alone. */
    private fun startsWithSps(buffer: ByteBuffer): Boolean {
        val type = firstNalHeader(buffer) ?: return false
        return type and 0x1F == NAL_TYPE_SPS
    }

    /** The first NAL header byte after a leading start code, or null if there is none. */
    private fun firstNalHeader(buffer: ByteBuffer): Int? {
        val p = buffer.position()
        val n = buffer.remaining()
        if (n >= 4 && buffer.get(p).toInt() == 0 && buffer.get(p + 1).toInt() == 0) {
            if (buffer.get(p + 2).toInt() == 1) return buffer.get(p + 3).toInt() and 0xFF
            if (n >= 5 && buffer.get(p + 2).toInt() == 0 && buffer.get(p + 3).toInt() == 1) {
                return buffer.get(p + 4).toInt() and 0xFF
            }
        }
        return null
    }

    private fun readProfileLevelId(sets: ByteArray): String? {
        val wrapped = ByteBuffer.wrap(sets)
        val header = firstNalHeader(wrapped) ?: return null
        if (header and 0x1F != NAL_TYPE_SPS) return null
        val start = if (sets[2].toInt() == 1) 4 else 5
        if (sets.size < start + 3) return null
        return (start until start + 3).joinToString("") { "%02x".format(sets[it].toInt() and 0xFF) }
    }
}

private val NO_PREFIX = ByteArray(0)
