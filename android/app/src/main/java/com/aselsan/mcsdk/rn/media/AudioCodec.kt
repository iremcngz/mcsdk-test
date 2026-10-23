package com.aselsan.mcsdk.rn.media

/**
 * AudioCodec — turns captured PCM into the payload that goes on the wire.
 *
 * One frame in, one frame out: the capture loop reads exactly [frameSamples]
 * samples every [frameMs] milliseconds and hands them here. That 1:1 shape is
 * what keeps the RTP timestamp honest — it advances by [frameSamples] per frame
 * rather than being derived from the clock.
 *
 * Implementations must be callable from the capture thread, which is real-time:
 * no locks, no allocation, no logging. Hence [encode] writes into a caller-owned
 * buffer instead of returning a fresh array.
 *
 * AMR-WB will arrive as a second implementation (MediaCodec-backed, so it can
 * hold frames back and will need its own queueing); nothing above this interface
 * changes when it does.
 */
interface AudioCodec {
    /** Wire name, as it appears in SDP (`a=rtpmap`). */
    val name: String

    /** Sample rate the capture device must be opened at. */
    val sampleRate: Int

    /** Samples per frame. Also the RTP timestamp increment per frame. */
    val frameSamples: Int

    /** Frame duration in ms — the `a=ptime` value. */
    val frameMs: Int

    /** Worst-case encoded bytes for one frame, so callers can size buffers once. */
    val maxEncodedBytes: Int

    /** RTP payload type. Static for G.711, dynamic (96+) for AMR-WB. */
    val payloadType: Int

    /**
     * Encodes [count] samples from [pcm] into [out], returning the bytes written.
     *
     * A return of 0 is not an error: a codec that buffers internally may consume
     * a frame without producing one yet.
     */
    fun encode(pcm: ShortArray, count: Int, out: ByteArray): Int

    /**
     * Decodes one frame of [len] bytes from [payload] into [out], returning the
     * samples written.
     *
     * The mirror of [encode], and subject to the same real-time rules: it runs
     * on the playback thread, so [out] is caller-owned and nothing here may
     * allocate or block.
     *
     * As with [encode], 0 is not an error — a buffering codec can swallow a
     * frame without producing samples yet. The playback loop treats a 0 as an
     * underrun and emits silence for that slot rather than stalling.
     */
    fun decode(payload: ByteArray, len: Int, out: ShortArray): Int

    /** Releases any native resources. A no-op for table-based codecs. */
    fun release() {}
}

/**
 * PcmuCodec — G.711 µ-law (RFC 3551 payload type 0).
 *
 * Not a codec in the usual sense: it is a per-sample companding table, 16-bit
 * linear PCM to 8 bits, no inter-frame state and no added delay. That is exactly
 * why the pipeline starts here — it proves capture, threading and file output
 * without MediaCodec's asynchronous buffer dance on top.
 *
 * G.711 is defined at 8 kHz. We run it at 16 kHz anyway because the capture
 * chain, the RTP timestamp and (later) AMR-WB are all 16 kHz, and keeping one
 * rate end to end avoids a resampler in the first milestone. The output is still
 * decodable — ffmpeg just has to be told the real rate:
 *
 *   ffmpeg -f mulaw -ar 16000 -ac 1 -i capture.pcmu out.wav
 *
 * A real PCMU call would resample to 8 kHz first; that belongs with the codec
 * negotiation work, not here.
 */
class PcmuCodec : AudioCodec {
    override val name = "PCMU"
    override val sampleRate = 16000
    override val frameSamples = 320          // 20 ms at 16 kHz
    override val frameMs = 20
    override val maxEncodedBytes = 320       // one byte per sample
    override val payloadType = 0

    override fun encode(pcm: ShortArray, count: Int, out: ByteArray): Int {
        for (i in 0 until count) out[i] = linearToMuLaw(pcm[i])
        return count
    }

    /**
     * One byte per sample, so the sample count equals [len] — bounded by [out]
     * in case a malformed frame claims more than the buffer holds.
     *
     * µ-law is lossy by design (16 bits companded into 8), so a round trip does
     * not return the original samples; the error is a fraction of a percent and
     * inaudible, which is the whole point of the companding curve.
     */
    override fun decode(payload: ByteArray, len: Int, out: ShortArray): Int {
        val n = minOf(len, out.size)
        for (i in 0 until n) out[i] = muLawToLinear(payload[i])
        return n
    }

    companion object {
        private const val BIAS = 0x84
        private const val CLIP = 32635

        /**
         * ITU-T G.711 µ-law compression, the standard reference implementation:
         * clamp, add bias, find the exponent (highest set bit), take the four
         * bits below it as the mantissa, then invert.
         */
        fun linearToMuLaw(sample: Short): Byte {
            var pcm = sample.toInt()
            val sign = if (pcm < 0) 0x80 else 0x00
            if (pcm < 0) pcm = -pcm
            if (pcm > CLIP) pcm = CLIP
            pcm += BIAS

            var exponent = 7
            var mask = 0x4000
            while (exponent > 0 && (pcm and mask) == 0) {
                exponent--
                mask = mask shr 1
            }
            val mantissa = (pcm shr (exponent + 3)) and 0x0F
            return ((sign or (exponent shl 4) or mantissa).inv() and 0xFF).toByte()
        }

        /** The inverse, for the playback path and for round-trip tests. */
        fun muLawToLinear(ulaw: Byte): Short {
            val u = ulaw.toInt().inv() and 0xFF
            val sign = u and 0x80
            val exponent = (u shr 4) and 0x07
            val mantissa = u and 0x0F
            var sample = ((mantissa shl 3) + BIAS) shl exponent
            sample -= BIAS
            return (if (sign != 0) -sample else sample).toShort()
        }
    }
}
