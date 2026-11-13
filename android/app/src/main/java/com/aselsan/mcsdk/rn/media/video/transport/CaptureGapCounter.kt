package com.aselsan.mcsdk.rn.media.video.transport

/**
 * CaptureGapCounter — how many frames of a stream never arrived, told from the gaps in
 * the sender's capture times, for a source that cannot see packets.
 *
 * The SDK hands over whole frames and says nothing about the ones it lost, so loss has
 * to be read off what did come: a camera captures at a steady rate, and a frame
 * captured three intervals after the last one means two in between were lost. Measured
 * on a congested Wi-Fi, this is the only sign of it: 95 packets a second sent, 6 to 11
 * received, and every counter the source has still read zero.
 *
 * The interval is not configured but learned from the recent gaps: the shortest ones
 * are those with nothing missing, and their mean is the interval. The mean rather than
 * the shortest alone, because capture times jitter by a millisecond or two, and an
 * interval 5% short counts a frame too many in every long gap. The history is long
 * (5 s at 24 fps, far longer when most frames are lost) so that heavy loss cannot push
 * every short gap out of it and make the loss look like the rate. Nothing is counted
 * until enough gaps have been seen to trust it.
 *
 * A gap longer than [PAUSE_US] is not counted. That is the sender stopping (a camera
 * turned off), not loss, and counting it would add thousands of frames at once.
 * The receiver already says "not coming" when frames stop.
 *
 * One thread only. Kept free of Android types so it can be tested on the JVM.
 */
class CaptureGapCounter {

    private companion object {
        /** Gaps the interval is learned from. */
        const val HISTORY = 120

        /** Gaps to see before any is counted. */
        const val MIN_HISTORY = 8

        /** Below this two frames are the same capture, or a clock that stepped. */
        const val MIN_INTERVAL_US = 5_000L

        const val PAUSE_US = 2_000_000L
    }

    private val gaps = LongArray(HISTORY)
    private var gapCount = 0
    private var next = 0
    private var lastUs = NONE

    /** Frames missed so far. */
    var missed = 0
        private set

    /**
     * Takes the capture time of a frame that arrived.
     *
     * @return the frames missed just before it
     */
    fun onFrame(timestampUs: Long): Int {
        val last = lastUs
        // Out of order or repeated: says nothing about what is missing.
        if (last != NONE && timestampUs <= last) return 0
        lastUs = timestampUs
        if (last == NONE) return 0

        val gap = timestampUs - last
        if (gap < MIN_INTERVAL_US || gap > PAUSE_US) return 0

        val interval = interval()
        gaps[next] = gap
        next = (next + 1) % HISTORY
        if (gapCount < HISTORY) gapCount++
        if (interval == NONE || gapCount <= MIN_HISTORY) return 0

        // Rounded: capture times jitter by a millisecond or two around the interval.
        val n = ((gap + interval / 2) / interval - 1).toInt()
        if (n > 0) missed += n
        return maxOf(n, 0)
    }

    /** For a new stream: what was learned of the old one's rate says nothing about it. */
    fun reset() {
        gapCount = 0
        next = 0
        lastUs = NONE
    }

    /** The mean of the gaps within half an interval of the shortest. */
    private fun interval(): Long {
        if (gapCount == 0) return NONE
        var min = Long.MAX_VALUE
        for (i in 0 until gapCount) if (gaps[i] < min) min = gaps[i]
        val limit = min + min / 2
        var sum = 0L
        var n = 0
        for (i in 0 until gapCount) if (gaps[i] <= limit) { sum += gaps[i]; n++ }
        return sum / n
    }
}

private const val NONE = -1L
