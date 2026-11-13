package com.aselsan.mcsdk.rn.media.video.transport

import org.junit.Assert.assertEquals
import org.junit.Test

class CaptureGapCounterTest {

    private val counter = CaptureGapCounter()

    /** 24 fps, with a capture clock that jitters by a millisecond either way. */
    private val frameUs = 41_667L
    private var t = 1_000_000L

    private fun frames(n: Int, everyNth: Int = 1) {
        repeat(n) { i ->
            t += frameUs
            val jitter = if (i % 2 == 0) 1_000L else -1_000L
            if (i % everyNth == 0) counter.onFrame(t + jitter)
        }
    }

    @Test
    fun `a clean stream misses nothing`() {
        frames(240)
        assertEquals(0, counter.missed)
    }

    @Test
    fun `nothing is counted before the interval is learned`() {
        counter.onFrame(0)
        counter.onFrame(3 * frameUs)
        assertEquals(0, counter.missed)
    }

    @Test
    fun `a gap of three intervals is two frames missed`() {
        frames(30)
        t += 3 * frameUs
        assertEquals(2, counter.onFrame(t))
        assertEquals(2, counter.missed)
    }

    // What the congested Wi-Fi did: about one frame in ten arriving.
    @Test
    fun `heavy loss is counted as such`() {
        frames(30)
        frames(240, everyNth = 10)
        // 216 of the 240 never came; the 9 after the last delivered frame are not
        // known yet, since nothing has arrived to show the gap.
        assertEquals(207, counter.missed)
    }

    @Test
    fun `a long pause is the sender stopping, not loss`() {
        frames(30)
        t += 5_000_000L
        assertEquals(0, counter.onFrame(t))
        frames(30)
        assertEquals(0, counter.missed)
    }

    @Test
    fun `frames out of order say nothing`() {
        frames(30)
        assertEquals(0, counter.onFrame(t - 2 * frameUs))
        assertEquals(0, counter.missed)
    }

    @Test
    fun `a new stream learns its own rate`() {
        frames(30)
        counter.reset()
        // 12 fps: every gap is two of the old intervals, and none of them is loss.
        repeat(200) { t += 2 * frameUs; counter.onFrame(t) }
        assertEquals(0, counter.missed)
    }
}
