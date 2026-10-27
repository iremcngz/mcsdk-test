package com.aselsan.mcsdk.rn.media

/**
 * RtpPacket — RFC 3550 §5.1 fixed header, built and read in place.
 *
 * This is the one piece of the UDP path that exists only until the SDK's media
 * API lands. `RtpRtcpSession::SendRtp(payload, timestamp, marker)` already does
 * exactly this work in C++: it fills in the sequence number, the SSRC and the
 * flag byte itself, and the caller supplies only the three values the app
 * actually knows. Writing the same header here keeps the wire format identical,
 * so a capture taken during this test is the same capture the SDK would produce
 * — Wireshark decodes it as RTP, and the far end can be the SDK rather than
 * another copy of this app.
 *
 * The layout, byte for byte, matching `Rtp.cpp::Serialize()`:
 *
 *   0        [V=2|P|X|CC]   version 2, no padding, no extension, no CSRCs → 0x80
 *   1        [M|PT]         marker in bit 7, payload type in bits 6-0
 *   2-3      sequence number
 *   4-7      timestamp
 *   8-11     SSRC
 *   12...    payload
 *
 * All multi-byte fields are big-endian (network byte order), which is what
 * `Rtp.cpp`'s writeU16/writeU32 produce. Kotlin has no primitive for that, so
 * the shifts are written out.
 *
 * Nothing here allocates. [write] is called from the capture thread, which has
 * a 20 ms budget before AudioRecord overruns, and [parse] from the receive
 * thread; a per-packet allocation on either would invite a GC pause in the
 * middle of a call. Callers own the buffers.
 */
object RtpPacket {

    /** Fixed header size with no CSRC list, which is the only case here. */
    const val HEADER_BYTES = 12

    /** Byte 0 for every packet this app sends: version 2, no P/X/CC. */
    private const val FLAGS_V2 = 0x80

    /**
     * Dynamic payload type, the SDK's default (`RtpRtcpSession::Config`).
     *
     * 96-127 are the dynamic range: the number carries no fixed meaning and is
     * normally agreed per call in the SDP offer/answer. There is no signalling
     * in this test, so both ends are simply configured the same way.
     */
    const val DEFAULT_PAYLOAD_TYPE = 96

    /**
     * Writes one packet into [out] and returns its total length.
     *
     * @param out  destination, at least HEADER_BYTES + len bytes
     * @return     bytes written, or -1 if [out] is too small to hold the packet
     */
    fun write(
        out: ByteArray,
        payload: ByteArray,
        len: Int,
        timestamp: Int,
        sequenceNumber: Int,
        ssrc: Int,
        marker: Boolean,
        payloadType: Int = DEFAULT_PAYLOAD_TYPE,
    ): Int {
        val total = HEADER_BYTES + len
        // Refuse rather than truncate: a short packet would be parsed as a
        // valid frame of the wrong length and corrupt everything after it.
        if (len < 0 || out.size < total) return -1

        out[0] = FLAGS_V2.toByte()
        out[1] = (((if (marker) 0x80 else 0x00)) or (payloadType and 0x7F)).toByte()
        writeU16(out, 2, sequenceNumber)
        writeU32(out, 4, timestamp)
        writeU32(out, 8, ssrc)
        System.arraycopy(payload, 0, out, HEADER_BYTES, len)
        return total
    }

    /**
     * One parsed header. Mutable and reused by the receive thread, for the same
     * no-allocation reason as above — read the fields before the next [parse].
     */
    class Header {
        var marker = false
        var payloadType = 0
        var sequenceNumber = 0
        var timestamp = 0
        var ssrc = 0
        /** Offset of the payload within the parsed buffer. */
        var payloadOffset = 0
        /** Payload length in bytes. */
        var payloadLength = 0
    }

    /**
     * Reads a packet's header into [into], returning false if [buf] is not a
     * valid RTP packet.
     *
     * Rejected, matching `Rtp.cpp::Parse()`: anything shorter than the fixed
     * header, a version other than 2, and a CSRC list that does not fit. A
     * malformed packet is dropped whole; guessing at its contents would feed
     * the jitter buffer a frame with a fabricated timestamp, which is worse
     * than losing it.
     *
     * CSRC entries are skipped rather than returned. They only appear behind a
     * mixer, which a two-device test has none of, and nothing downstream reads
     * them — but the payload offset still has to account for them or the frame
     * would be read 4 bytes short per entry.
     */
    fun parse(buf: ByteArray, len: Int, into: Header): Boolean {
        if (len < HEADER_BYTES) return false

        val b0 = buf[0].toInt() and 0xFF
        if ((b0 shr 6) and 0x03 != 2) return false

        val csrcCount = b0 and 0x0F
        val headerLen = HEADER_BYTES + csrcCount * 4
        if (len < headerLen) return false

        val b1 = buf[1].toInt() and 0xFF
        into.marker = (b1 shr 7) and 0x01 == 1
        into.payloadType = b1 and 0x7F
        into.sequenceNumber = readU16(buf, 2)
        into.timestamp = readU32(buf, 4)
        into.ssrc = readU32(buf, 8)
        into.payloadOffset = headerLen
        into.payloadLength = len - headerLen
        return true
    }

    // ── Big-endian helpers ────────────────────────────────────────────────────
    // Masked to the field width on write: sequence numbers are kept in an Int
    // and wrap past 0xFFFF, where C++'s uint16_t would have wrapped on its own.
    // Read back through Int so the sign bit never turns a large SSRC negative.

    private fun writeU16(buf: ByteArray, at: Int, value: Int) {
        buf[at] = ((value shr 8) and 0xFF).toByte()
        buf[at + 1] = (value and 0xFF).toByte()
    }

    private fun writeU32(buf: ByteArray, at: Int, value: Int) {
        buf[at] = ((value shr 24) and 0xFF).toByte()
        buf[at + 1] = ((value shr 16) and 0xFF).toByte()
        buf[at + 2] = ((value shr 8) and 0xFF).toByte()
        buf[at + 3] = (value and 0xFF).toByte()
    }

    private fun readU16(buf: ByteArray, at: Int): Int =
        ((buf[at].toInt() and 0xFF) shl 8) or (buf[at + 1].toInt() and 0xFF)

    private fun readU32(buf: ByteArray, at: Int): Int =
        ((buf[at].toInt() and 0xFF) shl 24) or
        ((buf[at + 1].toInt() and 0xFF) shl 16) or
        ((buf[at + 2].toInt() and 0xFF) shl 8) or
        (buf[at + 3].toInt() and 0xFF)
}
