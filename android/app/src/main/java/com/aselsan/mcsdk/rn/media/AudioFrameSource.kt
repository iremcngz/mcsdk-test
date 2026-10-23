package com.aselsan.mcsdk.rn.media

/**
 * AudioFrameSource — where encoded frames arrive from, on the downlink.
 *
 * The mirror of [AudioFrameSink], and it exists for the same reason: the SDK has
 * no media-data API yet, so playback is built against this interface and the
 * origin is swapped underneath.
 *
 *   FileFrameSource → replays a recording      (today: prove decode + playback)
 *   LoopbackSource  → the uplink's own frames  (later: live round trip)
 *   SdkFrameSource  → onEncodedFrame callback  (once the SDK exposes it)
 *
 * Starting from a file matters: a recording is a *known* input. There are
 * already verified ones on the device — 1138 AMR-WB frames of 61 bytes, which
 * an independent decoder read back as 22.76 s of audio. If playback of that is
 * wrong, the fault is in decode or in the playback path, not in the input. A
 * live microphone would leave both ends variable at once.
 *
 * Threading: frames are delivered on the source's own thread, never the caller's.
 * The listener is expected to do nothing slow — in this pipeline it hands the
 * frame to the jitter buffer and returns.
 */
interface AudioFrameSource {

    /** Human-readable name for the diagnostics UI. */
    val name: String

    /**
     * Receives one encoded frame.
     *
     * @param payload   the frame; valid only for this call, so copy what you keep
     * @param len       valid bytes in [payload]
     * @param timestamp RTP timestamp in samples. From the SDK this comes off the
     *                  wire; a file source synthesises it by counting frames,
     *                  which is what lets the jitter buffer order and place them
     *                  identically in both cases.
     */
    fun interface Listener {
        fun onFrame(payload: ByteArray, len: Int, timestamp: Int)
    }

    /** Must be called before [start]. */
    fun setListener(listener: Listener)

    /**
     * Begins delivering frames. Returns false if the source could not be opened
     * (missing file, unreadable, wrong size).
     */
    fun start(codec: AudioCodec): Boolean

    /** Stops delivery and releases resources. Safe when already stopped. */
    fun stop()

    val isRunning: Boolean

    /** Frames handed to the listener so far. */
    val framesDelivered: Int

    /** Why [start] failed, or null. */
    val lastError: String?
}
