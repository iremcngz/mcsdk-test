package com.aselsan.mcsdk.rn.media

import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import java.nio.ByteBuffer

/**
 * AmrWbCodec — AMR-WB (G.722.2) via the platform encoder. The MCPTT codec.
 *
 * Structurally different from PcmuCodec, and the differences are what the
 * pipeline had to be built to tolerate:
 *
 *  - It is a real codec with inter-frame state, so frames cannot be encoded
 *    independently and the encoder must not be restarted mid-stream.
 *  - MediaCodec is an asynchronous buffer queue: feeding one frame does not
 *    guarantee one frame out. [encode] therefore returns 0 sometimes, which
 *    AudioCapture already treats as "nothing to send yet" rather than an error.
 *  - Output is variable length (~61 bytes at 23.85 kbps vs PCMU's fixed 320),
 *    so nothing downstream may assume a frame size.
 *
 * Verified present on the test device (`OMX.google.amrwb.encoder`): mono,
 * 16 kHz only, 6600-23850 bps, CBR. Those are exactly the parameters below.
 *
 * Payload format: this emits the raw encoder output, one AMR-WB frame per call.
 * It is NOT the RTP payload format of RFC 4867 — that needs a payload header,
 * and whether it is octet-aligned or bandwidth-efficient is negotiated in SDP
 * via `a=fmtp:… octet-align=1`. Getting that wrong produces audio that plays
 * but is unintelligible to the far end, and the SDK's SdpBuilder cannot emit
 * `a=fmtp` at all yet — so framing belongs with the SDK work, not here. For the
 * file milestone the raw frames are what a decoder wants anyway.
 */
class AmrWbCodec(
    /** 23850 is the top AMR-WB mode and the usual MCPTT choice. */
    private val bitRate: Int = 23850,
) : AudioCodec {

    companion object {
        private const val TAG = "McSdkAmrWb"
        private const val MIME = MediaFormat.MIMETYPE_AUDIO_AMR_WB

        /** Generous: a 23.85 kbps frame is ~61 bytes, but never assume. */
        private const val MAX_FRAME_BYTES = 128

        /**
         * Zero wait on both queues. This runs on the real-time capture thread,
         * so blocking for a buffer would eat into the 20 ms budget; a frame that
         * is not ready yet simply comes out on a later call.
         */
        private const val TIMEOUT_US = 0L
    }

    override val name = "AMR-WB"
    override val sampleRate = 16000
    override val frameSamples = 320        // 20 ms — AMR-WB's native frame size
    override val frameMs = 20
    override val maxEncodedBytes = MAX_FRAME_BYTES

    /**
     * Dynamic payload type. The real value is assigned per call by SDP
     * negotiation (`a=rtpmap:<pt> AMR-WB/16000`); 96 is the conventional first
     * dynamic type and stands in until that negotiation exists.
     */
    override val payloadType = 96

    private var encoder: MediaCodec? = null
    private val encInfo = MediaCodec.BufferInfo()

    private var decoder: MediaCodec? = null
    private val decInfo = MediaCodec.BufferInfo()

    /** Scratch for the PCM-to-bytes conversion. Allocated once, not per frame. */
    private val pcmBytes = ByteArray(frameSamples * 2)

    @Volatile
    var lastError: String? = null
        private set

    /** Opens the encoder. Returns false and sets [lastError] on failure. */
    fun start(): Boolean {
        if (encoder != null) return true
        lastError = null
        try {
            val format = MediaFormat.createAudioFormat(MIME, sampleRate, 1).apply {
                setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
                setInteger(MediaFormat.KEY_CHANNEL_COUNT, 1)
                setInteger(MediaFormat.KEY_SAMPLE_RATE, sampleRate)
            }
            encoder = MediaCodec.createEncoderByType(MIME).apply {
                configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }
            Log.d(TAG, "encoder started: $bitRate bps, ${sampleRate}Hz mono")
            return true
        } catch (e: Exception) {
            lastError = "AMR-WB encoder unavailable: ${e.message}"
            Log.e(TAG, lastError!!, e)
            release()
            return false
        }
    }

    /**
     * Feeds one PCM frame and drains whatever the encoder has ready.
     *
     * Returns 0 when the encoder consumed the input without producing output
     * yet — normal for a codec that buffers, not a failure. Returns the encoded
     * length otherwise.
     *
     * Real-time safe: no allocation, no locks, zero-timeout queue calls only.
     */
    override fun encode(pcm: ShortArray, count: Int, out: ByteArray): Int {
        val mc = encoder ?: return 0

        try {
            // ── Feed ──────────────────────────────────────────────────────────
            val inIdx = mc.dequeueInputBuffer(TIMEOUT_US)
            if (inIdx >= 0) {
                val inBuf: ByteBuffer? = mc.getInputBuffer(inIdx)
                if (inBuf != null) {
                    // Little-endian 16-bit, which is what the encoder expects.
                    var b = 0
                    for (i in 0 until count) {
                        val s = pcm[i].toInt()
                        pcmBytes[b++] = (s and 0xFF).toByte()
                        pcmBytes[b++] = ((s shr 8) and 0xFF).toByte()
                    }
                    inBuf.clear()
                    inBuf.put(pcmBytes, 0, count * 2)
                    // Presentation time is unused downstream — RTP timestamps are
                    // counted by AudioCapture from samples produced — but
                    // MediaCodec wants a monotonic value.
                    mc.queueInputBuffer(inIdx, 0, count * 2, presentationUs, 0)
                    presentationUs += count * 1_000_000L / sampleRate
                }
            }

            // ── Drain ─────────────────────────────────────────────────────────
            val outIdx = mc.dequeueOutputBuffer(encInfo, TIMEOUT_US)
            if (outIdx >= 0) {
                var written = 0
                // CODEC_CONFIG carries no audio; skip it rather than shipping it
                // as a frame.
                if (encInfo.size > 0 &&
                    (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                ) {
                    val outBuf = mc.getOutputBuffer(outIdx)
                    if (outBuf != null) {
                        written = minOf(encInfo.size, out.size)
                        outBuf.position(encInfo.offset)
                        outBuf.get(out, 0, written)
                    }
                }
                mc.releaseOutputBuffer(outIdx, false)
                return written
            }
            // INFO_TRY_AGAIN_LATER / INFO_OUTPUT_FORMAT_CHANGED: nothing yet.
            return 0
        } catch (e: Exception) {
            // Reported once; capture keeps running so the UI can surface it
            // instead of the thread dying silently.
            if (lastError == null) {
                lastError = "encode failed: ${e.message}"
                Log.e(TAG, lastError!!, e)
            }
            return 0
        }
    }

    private var presentationUs = 0L
    private var decodeUs = 0L

    /**
     * Opens the decoder. Separate from [start] because the two directions are
     * independent: playback can run without capture and vice versa, and a
     * device could in principle have one and not the other.
     *
     * Verified present on the test device as `OMX.google.amrwb.decoder`
     * (mono, 16 kHz, 6600-23850 bps) — the same constraints as the encoder.
     */
    fun startDecoder(): Boolean {
        if (decoder != null) return true
        lastError = null
        try {
            val format = MediaFormat.createAudioFormat(MIME, sampleRate, 1).apply {
                setInteger(MediaFormat.KEY_CHANNEL_COUNT, 1)
                setInteger(MediaFormat.KEY_SAMPLE_RATE, sampleRate)
            }
            decoder = MediaCodec.createDecoderByType(MIME).apply {
                // No CONFIGURE_FLAG_ENCODE: that flag is what selects direction.
                configure(format, null, null, 0)
                start()
            }
            Log.d(TAG, "decoder started: ${sampleRate}Hz mono")
            return true
        } catch (e: Exception) {
            lastError = "AMR-WB decoder unavailable: ${e.message}"
            Log.e(TAG, lastError!!, e)
            releaseDecoder()
            return false
        }
    }

    /**
     * Feeds one encoded frame and drains whatever PCM is ready — the exact
     * mirror of [encode], including the asynchronous-queue consequence: a 0
     * return means the decoder has not produced samples for this call yet, not
     * that the frame was bad.
     *
     * Real-time safe: runs on the playback thread, zero-timeout queue calls,
     * no allocation.
     */
    override fun decode(payload: ByteArray, len: Int, out: ShortArray): Int {
        val mc = decoder ?: return 0

        try {
            // ── Feed ──────────────────────────────────────────────────────────
            val inIdx = mc.dequeueInputBuffer(TIMEOUT_US)
            if (inIdx >= 0) {
                val inBuf: ByteBuffer? = mc.getInputBuffer(inIdx)
                if (inBuf != null) {
                    inBuf.clear()
                    inBuf.put(payload, 0, len)
                    mc.queueInputBuffer(inIdx, 0, len, decodeUs, 0)
                    decodeUs += frameSamples * 1_000_000L / sampleRate
                }
            }

            // ── Drain ─────────────────────────────────────────────────────────
            val outIdx = mc.dequeueOutputBuffer(decInfo, TIMEOUT_US)
            if (outIdx >= 0) {
                var samples = 0
                if (decInfo.size > 0 &&
                    (decInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                ) {
                    val outBuf = mc.getOutputBuffer(outIdx)
                    if (outBuf != null) {
                        // Little-endian 16-bit PCM back into shorts, bounded by
                        // the caller's buffer.
                        samples = minOf(decInfo.size / 2, out.size)
                        var pos = decInfo.offset
                        for (i in 0 until samples) {
                            val lo = outBuf.get(pos).toInt() and 0xFF
                            val hi = outBuf.get(pos + 1).toInt()
                            out[i] = ((hi shl 8) or lo).toShort()
                            pos += 2
                        }
                    }
                }
                mc.releaseOutputBuffer(outIdx, false)
                return samples
            }
            return 0
        } catch (e: Exception) {
            if (lastError == null) {
                lastError = "decode failed: ${e.message}"
                Log.e(TAG, lastError!!, e)
            }
            return 0
        }
    }

    private fun releaseDecoder() {
        try {
            decoder?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "decoder stop failed: ${e.message}")
        }
        try {
            decoder?.release()
        } catch (e: Exception) {
            Log.w(TAG, "decoder release failed: ${e.message}")
        }
        decoder = null
        decodeUs = 0L
    }

    /**
     * Releases both directions. Each in its own try so a failure in one cannot
     * strand the other — a leaked MediaCodec stays leaked until the process
     * dies, and the device has a finite number of them.
     */
    override fun release() {
        try {
            encoder?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "encoder stop failed: ${e.message}")
        }
        try {
            encoder?.release()
        } catch (e: Exception) {
            Log.w(TAG, "encoder release failed: ${e.message}")
        }
        encoder = null
        presentationUs = 0L
        releaseDecoder()
    }
}
