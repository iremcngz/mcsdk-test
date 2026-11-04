package com.aselsan.mcsdk.rn.media.video.codec

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayoutClockTest {

    private val clock = PlayoutClock(delayMs = 300)

    /** Arrives [travel] ms after capture, on a receiver clock 1000 s ahead of the sender's. */
    private fun play(captureMs: Long, travel: Long = 5): Long =
        clock.playAt(1_000_000 + captureMs + travel, captureMs * 1000)

    @Test
    fun `the first frame is held back by the delay`() {
        val arrival = 1_000_000L + 5
        assertEquals(arrival + 300, play(0))
    }

    @Test
    fun `steady frames play at the rate they were captured`() {
        val a = play(0)
        val b = play(42)
        val c = play(84)
        assertEquals(42, b - a)
        assertEquals(42, c - b)
    }

    @Test
    fun `frames from a stall play on time, spread back out`() {
        val first = play(0)
        // Three frames held up 250 ms, arriving together at capture 84 + 250.
        val a = clock.playAt(1_000_000 + 334, 42_000)
        val b = clock.playAt(1_000_000 + 334, 84_000)
        assertEquals(first + 42, a)
        assertEquals(first + 84, b)
        assertTrue("still ahead of its arrival", b > 1_000_000 + 334)
    }

    @Test
    fun `a frame later than the delay comes out in the past`() {
        play(0)
        val t = clock.playAt(1_000_000 + 42 + 402, 42_000)
        assertTrue(t < 1_000_000 + 42 + 402)
    }

    @Test
    fun `a less delayed frame moves the estimate down at once`() {
        play(0, travel = 100)
        val faster = play(42, travel = 5)
        assertEquals(1_000_000 + 42 + 5 + 300, faster)
    }

    @Test
    fun `a path that stays slower is followed after the window`() {
        play(0, travel = 5)
        var capture = 42L
        // 100 ms slower for good. At first every frame loses that much of its delay.
        val early = play(capture, travel = 105)
        assertEquals(1_000_000 + capture + 5 + 300, early)
        while (capture < 21_000) {
            capture += 42
            play(capture, travel = 105)
        }
        capture += 42
        assertEquals(1_000_000 + capture + 105 + 300, play(capture, travel = 105))
    }

    @Test
    fun `a jump in the timestamps starts over instead of holding frames for ever`() {
        play(0)
        val arrival = 1_000_000L + 100
        val afterRestart = clock.playAt(arrival, 90_000_000)
        assertEquals(arrival + 300, afterRestart)
    }
}
