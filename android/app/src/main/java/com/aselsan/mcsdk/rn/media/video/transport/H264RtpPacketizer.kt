package com.aselsan.mcsdk.rn.media.video.transport

import com.aselsan.mcsdk.rn.media.rtp.RtpPacket

/**
 * H264RtpPacketizer — one access unit in, RTP packets out (RFC 6184,
 * packetization-mode=1).
 *
 * This is work the SDK will do itself, and it exists only until then. It writes
 * the same wire format so a capture of this test reads the way the SDK's will.
 *
 * A NAL unit that fits a packet goes as a single NAL unit packet, minus its start
 * code. A larger one goes as FU-A fragments, which replace its one header byte
 * with two: the indicator carries the F and NRI bits with type 28, the fragment
 * header the start and end bits with the original type. STAP-A is left out: the
 * format allows sending the SPS and PPS as packets of their own, and it only saves
 * a packet or two per key frame.
 *
 * Every packet of a frame has the same timestamp, and its last has the marker
 * bit, which is how the receiver finds where a frame ends.
 *
 * Runs on the encoder's thread, writing into one buffer it hands to [emit] per
 * packet, so nothing is allocated per frame.
 */
class H264RtpPacketizer(
    private val ssrc: Int,
    firstSequenceNumber: Int,
    private val maxPayload: Int = DEFAULT_MAX_PAYLOAD,
    private val emit: (packet: ByteArray, len: Int) -> Unit,
) {

    companion object {
        /**
         * Below Ethernet's 1460 on purpose: mobile links and tunnels add headers
         * of their own, and a packet past the path's MTU is fragmented by IP, so
         * that losing one piece loses all of it.
         */
        const val DEFAULT_MAX_PAYLOAD = 1200

        private const val NAL_TYPE_FU_A = 28
        private const val FU_HEADER_BYTES = 2

        /** Capture microseconds to RTP's 90 kHz video clock. Wraps at 32 bits, as RTP does. */
        fun rtpTimestamp(captureTimeUs: Long): Int = (captureTimeUs * 9 / 100).toInt()
    }

    private val packet = ByteArray(RtpPacket.HEADER_BYTES + maxPayload)
    private var sequenceNumber = firstSequenceNumber and 0xFFFF

    /** Sends one access unit in Annex B form. */
    fun packetize(data: ByteArray, len: Int, captureTimeUs: Long) {
        val timestamp = rtpTimestamp(captureTimeUs)
        var start = nextNalStart(data, 0, len)
        while (start in 0 until len) {
            val next = nextStartCode(data, start, len)
            var end = if (next < 0) len else next
            // A four-byte start code's leading zero, and any trailing_zero_8bits:
            // a NAL unit never ends in a zero byte.
            while (end > start && data[end - 1].toInt() == 0) end--
            val isLast = next < 0
            if (end > start) sendNal(data, start, end - start, timestamp, isLast)
            start = if (next < 0) -1 else next + START_CODE_BYTES
        }
    }

    private fun sendNal(data: ByteArray, offset: Int, size: Int, timestamp: Int, lastOfFrame: Boolean) {
        if (size <= maxPayload) {
            System.arraycopy(data, offset, packet, RtpPacket.HEADER_BYTES, size)
            send(size, timestamp, lastOfFrame)
            return
        }

        val nalHeader = data[offset].toInt() and 0xFF
        val indicator = (nalHeader and 0xE0) or NAL_TYPE_FU_A
        val type = nalHeader and 0x1F
        val fragmentMax = maxPayload - FU_HEADER_BYTES

        var from = offset + 1 // the header byte is rebuilt by the receiver
        val until = offset + size
        var first = true
        while (from < until) {
            val n = minOf(fragmentMax, until - from)
            val last = from + n == until
            packet[RtpPacket.HEADER_BYTES] = indicator.toByte()
            packet[RtpPacket.HEADER_BYTES + 1] =
                ((if (first) 0x80 else 0) or (if (last) 0x40 else 0) or type).toByte()
            System.arraycopy(data, from, packet, RtpPacket.HEADER_BYTES + FU_HEADER_BYTES, n)
            send(FU_HEADER_BYTES + n, timestamp, last && lastOfFrame)
            from += n
            first = false
        }
    }

    private fun send(payloadSize: Int, timestamp: Int, marker: Boolean) {
        RtpPacket.writeHeader(packet, timestamp, sequenceNumber, ssrc, marker)
        sequenceNumber = (sequenceNumber + 1) and 0xFFFF
        emit(packet, RtpPacket.HEADER_BYTES + payloadSize)
    }

    /** Where the first NAL unit's bytes start, or -1. */
    private fun nextNalStart(data: ByteArray, from: Int, len: Int): Int {
        val code = nextStartCode(data, from, len)
        return if (code < 0) -1 else code + START_CODE_BYTES
    }

    /** The next `00 00 01` at or after [from], or -1. */
    private fun nextStartCode(data: ByteArray, from: Int, len: Int): Int {
        var i = from
        while (i + START_CODE_BYTES <= len) {
            if (data[i].toInt() == 0 && data[i + 1].toInt() == 0 && data[i + 2].toInt() == 1) return i
            i++
        }
        return -1
    }
}

private const val START_CODE_BYTES = 3
