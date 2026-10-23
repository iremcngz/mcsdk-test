package com.aselsan.mcsdk.rn.media

/**
 * AudioFrameSink — where an encoded frame goes once capture is done with it.
 *
 * This is the seam that keeps the capture path independent of the SDK. The SDK
 * has no media-data API yet (no sendEncodedFrame, nothing on SdkListener), so
 * the pipeline is built against this interface instead and the destination is
 * swapped underneath:
 *
 *   FileFrameSink  → writes to disk            (today: prove capture + encode)
 *   UdpFrameSink   → own RTP header over UDP   (later: prove timestamps)
 *   SdkFrameSink   → sdk.sendEncodedFrame(...) (once the SDK exposes it)
 *
 * AudioCapture only ever calls onFrame(); none of the above changes a line of
 * it. When the SDK lands, the third implementation is about ten lines.
 *
 * Threading contract, and it is strict: [onFrame] is called from the capture
 * thread, which has a 20 ms budget before AudioRecord's own buffer overflows
 * and loses samples for good. Implementations must therefore return
 * immediately — hand the bytes to another thread and get out. No file I/O, no
 * sockets, no locks, no allocation, no logging on that path.
 *
 * [open] and [close] are called from the controlling thread (JS/bridge), where
 * blocking is fine.
 */
interface AudioFrameSink {

    /** Human-readable name for the diagnostics UI. */
    val name: String

    /** Prepares the destination. Throws if it cannot be opened. */
    fun open(codec: AudioCodec)

    /**
     * Takes one encoded frame. Called on the capture thread — must not block.
     *
     * @param payload   buffer holding the frame; valid only for this call, and
     *                  reused by the caller afterwards, so copy what you keep
     * @param len       valid bytes in [payload]
     * @param timestamp RTP timestamp for this frame — counted in samples, not
     *                  wall-clock, so it stays exact over long sessions
     * @param marker    true on the first frame of a talk spurt
     */
    fun onFrame(payload: ByteArray, len: Int, timestamp: Int, marker: Boolean)

    /** Flushes and releases. Safe to call when already closed. */
    fun close()

    /** Frames dropped because the sink could not keep up. */
    val droppedFrames: Int
}
