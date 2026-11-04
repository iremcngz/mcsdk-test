package com.aselsan.mcsdk.rn.media.video.transport

import com.aselsan.mcsdk.rn.media.rtp.RtpPacket
import java.util.concurrent.atomic.AtomicInteger

/**
 * H264RtpDepacketizer — RTP packets in, complete access units out.
 *
 * The inverse of [H264RtpPacketizer], and like it only here until the SDK does
 * this work. It reads what that class writes (single NAL units and FU-A); a packet
 * of any other type marks its frame broken rather than being guessed at.
 *
 * It does not reorder. A packet behind the highest sequence number seen is dropped
 * and the gap it left has already been reported, because any loss costs the same
 * here: every later frame depends on the missing one, so the decoder has to wait
 * for a key frame either way. A frame with a hole is never delivered, since
 * decoding one produces garbage rather than an error.
 *
 * Runs on the source's receive thread. The frame is built in one array that grows
 * to the largest seen; the counters are read from the bridge.
 */
class H264RtpDepacketizer(private val out: VideoFrameSource.Listener) {

    private companion object {
        const val NAL_TYPE_IDR = 5
        const val NAL_TYPE_FU_A = 28
        const val FU_HEADER_BYTES = 2
        const val INITIAL_CAPACITY = 64 * 1024
        val START_CODE = byteArrayOf(0, 0, 0, 1)

        /** 90 kHz back to microseconds. Unsigned, since RTP's timestamp is. */
        fun timestampUs(rtp: Int): Long = (rtp.toLong() and 0xFFFFFFFFL) * 100 / 9
    }

    private var frame = ByteArray(INITIAL_CAPACITY)
    private var size = 0
    private var broken = false
    private var keyFrame = false
    private var inFragment = false

    private var hasStream = false
    private var streamSsrc = 0
    private var lastSeq = 0
    private var frameTimestamp = 0
    private var frameOpen = false

    private val delivered = AtomicInteger(0)
    private val discarded = AtomicInteger(0)
    private val lost = AtomicInteger(0)

    /** Complete frames handed on. */
    val framesDelivered: Int get() = delivered.get()

    /** Frames dropped for having a hole. */
    val framesDiscarded: Int get() = discarded.get()

    /** Packets the sequence numbers say never arrived. */
    val packetsLost: Int get() = lost.get()

    /** Takes one parsed packet; [buf] holds what [header] was parsed from. */
    fun onPacket(header: RtpPacket.Header, buf: ByteArray) {
        val ssrc = header.ssrc.toLong() and 0xFFFFFFFFL

        // A new SSRC is a sender that restarted. Its sequence numbers say nothing
        // about the old stream's, and its first frame is a fresh start.
        if (hasStream && header.ssrc != streamSsrc) {
            dropOpenFrame()
            hasStream = false
            out.onFrameLost(ssrc)
        }

        var gap = false
        if (hasStream) {
            val delta = (header.sequenceNumber - lastSeq) and 0xFFFF
            when {
                delta == 1 -> Unit
                delta in 2..0x7FFF -> {
                    lost.addAndGet(delta - 1)
                    gap = true
                }
                else -> return // a duplicate, or later than what we already moved past
            }
        }
        hasStream = true
        streamSsrc = header.ssrc
        lastSeq = header.sequenceNumber

        if (frameOpen && header.timestamp != frameTimestamp) dropOpenFrame()
        frameOpen = true
        frameTimestamp = header.timestamp

        if (gap) {
            broken = true
            out.onFrameLost(ssrc)
        }

        append(header, buf)

        if (header.marker) {
            if (broken || size == 0) {
                discarded.incrementAndGet()
            } else {
                delivered.incrementAndGet()
                out.onFrame(ssrc, frame, size, timestampUs(frameTimestamp), keyFrame)
            }
            resetFrame()
        }
    }

    private fun append(header: RtpPacket.Header, buf: ByteArray) {
        val at = header.payloadOffset
        val len = header.payloadLength
        if (len <= 0) return
        val first = buf[at].toInt() and 0xFF
        when (val type = first and 0x1F) {
            in 1..23 -> {
                inFragment = false
                noteType(type)
                put(START_CODE, 0, START_CODE.size)
                put(buf, at, len)
            }
            NAL_TYPE_FU_A -> appendFragment(buf, at, len, first)
            else -> broken = true
        }
    }

    private fun appendFragment(buf: ByteArray, at: Int, len: Int, indicator: Int) {
        if (len < FU_HEADER_BYTES) {
            broken = true
            return
        }
        val fuHeader = buf[at + 1].toInt() and 0xFF
        val starts = fuHeader and 0x80 != 0
        val ends = fuHeader and 0x40 != 0
        val type = fuHeader and 0x1F

        if (starts) {
            inFragment = true
            noteType(type)
            put(START_CODE, 0, START_CODE.size)
            ensure(1)
            frame[size++] = ((indicator and 0xE0) or type).toByte()
        } else if (!inFragment) {
            // The middle of a NAL unit we never saw the start of: joining mid-stream.
            broken = true
            return
        }
        put(buf, at + FU_HEADER_BYTES, len - FU_HEADER_BYTES)
        if (ends) inFragment = false
    }

    private fun noteType(type: Int) {
        if (type == NAL_TYPE_IDR) keyFrame = true
    }

    private fun put(src: ByteArray, from: Int, n: Int) {
        ensure(n)
        System.arraycopy(src, from, frame, size, n)
        size += n
    }

    private fun ensure(extra: Int) {
        if (size + extra > frame.size) frame = frame.copyOf(maxOf(size + extra, frame.size * 2))
    }

    /** A frame's last packet (the one with the marker) never came. */
    private fun dropOpenFrame() {
        if (size > 0 || broken) discarded.incrementAndGet()
        resetFrame()
    }

    private fun resetFrame() {
        size = 0
        broken = false
        keyFrame = false
        inFragment = false
        frameOpen = false
    }
}
