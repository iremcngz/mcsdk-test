package com.aselsan.mcsdk.rn.media.video.transport

/**
 * VideoFrameSink — where an encoded video frame goes once the encoder is done
 * with it.
 *
 * The video counterpart of AudioFrameSink, and the seam for the same reason: the
 * SDK has no video frame API yet, so the pipeline is built against this and the
 * destination is swapped underneath.
 *
 *   UdpVideoFrameSink  → RTP over UDP to another phone  (today)
 *   SdkVideoFrameSink  → sdk.sendVideoFrame             (once the SDK exposes it)
 *
 * [onFrame]'s parameters are the ones `Sdk::SendVideoFrame` takes, so nothing
 * upstream changes when the SDK lands. It differs from the audio seam on
 * purpose: a timestamp here is capture time in microseconds, as the SDK wants,
 * and turning that into a 90 kHz RTP clock belongs to whichever sink builds RTP.
 *
 * Threading: [onFrame] runs on the encoder's thread. Returning late does not
 * lose data the way it does on the audio path, but the encoder's output buffers
 * stay held meanwhile, and once they run out the camera starts skipping frames.
 *
 * [open] and [close] are called from the controlling thread, where blocking is
 * fine.
 */
interface VideoFrameSink {

    /** Human-readable name for the diagnostics UI. */
    val name: String

    /** What the far end asks of the encoder. */
    interface Feedback {
        /** A receiver lost its picture: the next frame should be a key frame. */
        fun onKeyFrameRequested()

        /** The bitrate the encoder should aim for from now on. */
        fun onBitrateChanged(kbps: Int)
    }

    /** Prepares the destination. Throws if it cannot be opened. */
    fun open(feedback: Feedback)

    /**
     * Takes one encoded frame.
     *
     * @param data          one H.264 access unit in Annex B. A key frame carries
     *                      its SPS and PPS. Reused by the caller afterwards, so
     *                      copy what you keep.
     * @param len           valid bytes in [data]
     * @param captureTimeUs monotonic capture time in microseconds
     * @param keyFrame      true if the frame can be decoded on its own
     */
    fun onFrame(data: ByteArray, len: Int, captureTimeUs: Long, keyFrame: Boolean)

    /** Flushes and releases. Safe to call when already closed. */
    fun close()
}
