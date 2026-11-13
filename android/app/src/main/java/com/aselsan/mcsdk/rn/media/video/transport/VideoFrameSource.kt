package com.aselsan.mcsdk.rn.media.video.transport

/**
 * VideoFrameSource — where encoded video frames arrive from, on the downlink.
 *
 * The mirror of [VideoFrameSink]: the decoder is built against this, and the
 * origin is swapped underneath.
 *
 *   UdpVideoFrameSource → RTP over UDP
 *   SdkVideoFrameSource → SdkListener.onVideoFrame
 *
 * Threading: frames are delivered on the source's own thread, which for the SDK
 * is its media thread, so the listener must copy what it keeps and return.
 */
interface VideoFrameSource {

    /** Human-readable name for the diagnostics UI. */
    val name: String

    /** Packets taken in, where the source is the one receiving them. */
    val packetsReceived: Int get() = 0

    /** Packets that never arrived, where the source can tell. */
    val packetsLost: Int get() = 0

    /** Whole frames handed on. */
    val framesDelivered: Int

    /** Frames dropped for missing a packet, where the source is the one that knows. */
    val framesDiscarded: Int get() = 0

    /**
     * Frames the sender captured that never arrived, told from gaps in capture time,
     * where the source sees no packets to count (see CaptureGapCounter).
     */
    val framesMissed: Int get() = 0

    /** Key frames asked of the sender. */
    val keyFramesRequested: Int

    /** Why the source last failed, if it has. */
    val lastError: String?

    interface Listener {
        /**
         * Receives one complete frame.
         *
         * @param ssrc        whose stream it is; a group call can carry several
         * @param data        one H.264 access unit in Annex B; valid only for
         *                    this call
         * @param len         valid bytes in [data]
         * @param timestampUs the sender's capture time in microseconds. Its clock
         *                    is not ours, so only differences mean anything.
         * @param keyFrame    true if the frame can be decoded on its own
         */
        fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean)

        /**
         * A frame of [ssrc] never arrived, so what follows cannot be decoded
         * until the next key frame. Not every source can tell: the decoder must
         * also recover on its own errors and on periodic key frames.
         */
        fun onFrameLost(ssrc: Long)
    }

    /** Begins delivering frames. Returns false if the source could not be opened. */
    fun start(listener: Listener): Boolean

    /** Stops delivery and releases resources. Safe when already stopped. */
    fun stop()

    /** Asks the sender of [ssrc] for a key frame. */
    fun requestKeyFrame(ssrc: Long)
}
