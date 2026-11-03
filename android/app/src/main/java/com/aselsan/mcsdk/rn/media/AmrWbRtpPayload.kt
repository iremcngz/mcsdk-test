package com.aselsan.mcsdk.rn.media

/**
 * AmrWbRtpPayload — AMR-WB frames to and from the RTP payload of RFC 4867,
 * octet-aligned mode (§4.4), the framing a call declares as
 * `AudioCodec.AMR_WB_OCTET_ALIGNED` (`a=fmtp:<pt> octet-align=1;crc=0`).
 *
 * Needed because the SDK passes payloads through untouched in both directions:
 * `sendAudioFrame`'s bytes go on the wire verbatim and `onAudioFrame` hands the
 * received payload over as it arrived. AmrWbCodec, meanwhile, speaks MediaCodec's
 * storage format (RFC 4867 §5.3) — one header byte, then the speech bits. The
 * two differ by exactly one byte:
 *
 *   storage frame   =        [ 0 | FT | Q | 0 0 ]  speech…
 *   octet-aligned   = [CMR]  [ F | FT | Q | P P ]  speech…   (one frame: F = 0)
 *
 * The storage header and a last-frame ToC have the same bit layout, so packing
 * one frame is prepending a CMR byte, and unpacking one is dropping it. A packet
 * may still carry several frames (a peer on a 40 ms ptime): then the ToCs come
 * first, F = 1 on all but the last, and the speech blocks follow in order —
 * [unpack] puts each back together as a storage frame for the decoder.
 *
 * Kept out of AmrWbCodec on purpose: framing belongs to the transport, and the
 * file and UDP test paths in the Audio tab still carry plain storage frames.
 *
 * Real-time safe, like everything on the capture and receive paths: both
 * directions write into caller-owned buffers and allocate nothing.
 */
object AmrWbRtpPayload {

    /**
     * CMR 15 — "no mode request" (§4.3.1). We never ask the peer to change its
     * bit rate; the low four bits are reserved and must be zero.
     */
    const val CMR_NO_REQUEST: Byte = 0xF0.toByte()

    /** Frame type: speech lost (§4.3.2). Carries no bits. */
    private const val FT_SPEECH_LOST = 14

    /** Frame type: no data — a slot with nothing in it, e.g. DTX. */
    private const val FT_NO_DATA = 15

    /** Largest storage frame: FT 8 (23.85 kbit/s) is 60 speech bytes + header. */
    const val MAX_FRAME_BYTES = 61

    /**
     * Speech bytes after the ToC for each frame type in octet-aligned mode:
     * TS 26.201 bit counts, padded to whole octets. FT 0-8 are the nine speech
     * modes (6.60 to 23.85 kbit/s), FT 9 is SID (comfort noise), 10-13 are
     * reserved, 14 and 15 carry nothing.
     */
    private val SPEECH_BYTES = intArrayOf(
        17, 23, 32, 36, 40, 46, 50, 58, 60, // FT 0-8: 132 … 477 bits
        5,                                  // FT 9:  SID, 40 bits
        -1, -1, -1, -1,                     // FT 10-13: reserved
        0, 0,                               // FT 14, 15
    )

    /** Speech bytes for frame type [ft], or -1 for a reserved one. */
    fun speechBytes(ft: Int): Int = if (ft in SPEECH_BYTES.indices) SPEECH_BYTES[ft] else -1

    private fun frameType(header: Int): Int = (header shr 3) and 0x0F

    /**
     * One storage frame → one octet-aligned payload. Returns the payload
     * length, or -1 if [frame] is not a well-formed storage frame or [out]
     * cannot hold it.
     *
     * The frame is checked rather than trusted: a wrong length here is not a
     * crash but noise at the far end, which is far harder to trace back.
     */
    fun pack(frame: ByteArray, len: Int, out: ByteArray): Int {
        if (len < 1 || len > frame.size) return -1
        val header = frame[0].toInt() and 0xFF
        val bytes = speechBytes(frameType(header))
        if (bytes < 0 || len != 1 + bytes) return -1
        if (out.size < len + 1) return -1

        out[0] = CMR_NO_REQUEST
        // F = 0 (the only frame) and P = 0; the storage header's own padding
        // bits are zero already, but masking makes that not our assumption.
        out[1] = (header and 0x7C).toByte()
        System.arraycopy(frame, 1, out, 2, bytes)
        return len + 1
    }

    /** Receives each frame [unpack] finds, as a storage frame in a reused buffer. */
    fun interface FrameConsumer {
        /** [frame] is valid only during this call; copy what you keep. */
        fun onFrame(frame: ByteArray, len: Int)
    }

    /**
     * One octet-aligned payload → its frames, each rebuilt as a storage frame
     * in [scratch] (at least [MAX_FRAME_BYTES]) and handed to [consumer] in
     * order. Frames with no speech (FT 14, 15) are skipped: the jitter buffer
     * treats the gap as loss and playback conceals it, which is what those
     * types mean.
     *
     * Returns how many frames were delivered, or -1 for a malformed payload —
     * in which case nothing at all was delivered, so a half-parsed packet
     * never reaches the decoder.
     */
    fun unpack(payload: ByteArray, len: Int, scratch: ByteArray, consumer: FrameConsumer): Int {
        if (len < 2 || len > payload.size || scratch.size < MAX_FRAME_BYTES) return -1

        // Pass 1: walk the ToC list and check the speech blocks add up to
        // exactly the rest of the payload, before anything is delivered.
        var tocCount = 0
        var speechTotal = 0
        var pos = 1 // after the CMR byte
        while (true) {
            if (pos >= len) return -1 // ToC list runs off the end
            val toc = payload[pos].toInt() and 0xFF
            val bytes = speechBytes(frameType(toc))
            if (bytes < 0) return -1
            speechTotal += bytes
            tocCount++
            pos++
            if (toc and 0x80 == 0) break // F = 0: last ToC
        }
        if (pos + speechTotal != len) return -1

        // Pass 2: pair each ToC with its speech block.
        var delivered = 0
        var speechPos = pos
        for (i in 0 until tocCount) {
            val toc = payload[1 + i].toInt() and 0xFF
            val ft = frameType(toc)
            val bytes = speechBytes(ft)
            if (ft != FT_SPEECH_LOST && ft != FT_NO_DATA) {
                scratch[0] = (toc and 0x7C).toByte() // clear F → storage header
                System.arraycopy(payload, speechPos, scratch, 1, bytes)
                consumer.onFrame(scratch, 1 + bytes)
                delivered++
            }
            speechPos += bytes
        }
        return delivered
    }
}
