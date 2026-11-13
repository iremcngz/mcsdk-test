package com.aselsan.mcsdk.rn.media.video.codec

import org.junit.Assert.assertEquals
import org.junit.Test

class KeyFramePacerTest {

    private var requests = 0
    private var firstForcedAfterMs = -1L
    private val pacer = KeyFramePacer(
        intervalSeconds = 1,
        requestKeyFrame = { requests++ },
        onFirstForced = { firstForcedAfterMs = it },
    )

    private var t = 0L

    /**
     * Plays [seconds] at [fps] from an encoder that makes a key frame every
     * [gop] frames of its own, and makes the next one a key frame when asked.
     */
    private fun play(seconds: Int, fps: Int, gop: Int): Int {
        var keys = 0
        var sinceKey = 0
        var asked = requests
        repeat(seconds * fps) { i ->
            val key = i == 0 || sinceKey >= gop - 1 || requests > asked
            asked = requests
            sinceKey = if (key) 0 else sinceKey + 1
            if (key) keys++
            pacer.onFrame(t, key)
            t += 1_000_000L / fps
        }
        return keys
    }

    // The S25's encoder: asked for one a second, it makes one a second.
    @Test
    fun `an encoder that keeps the interval is never asked`() {
        play(seconds = 30, fps = 24, gop = 24)
        assertEquals(0, requests)
    }

    // The A20's Exynos: a key frame every 30 frames, 2 s at 15 fps.
    @Test
    fun `an encoder that does not is asked, and keeps the interval`() {
        val keys = play(seconds = 30, fps = 15, gop = 30)
        // 1 s is not a whole number of 67 ms frames, and the encoder acts on the request
        // a frame later: about 1.1 s apart, against the 2 s it made on its own.
        assert(keys in 26..30) { "keys=$keys" }
        assert(requests in 25..29) { "requests=$requests" }
        assert(firstForcedAfterMs in 1000L..1100L) { "first=$firstForcedAfterMs" }
        assertEquals(requests, pacer.forced)
    }

    @Test
    fun `it asks once and waits for the key frame`() {
        pacer.onFrame(0, true)
        // The encoder is slow to act: five more delta frames past the interval.
        for (i in 1..20) pacer.onFrame(i * 66_667L, false)
        assertEquals(1, requests)
        pacer.onFrame(21 * 66_667L, true)
        for (i in 22..30) pacer.onFrame(i * 66_667L, false)
        assertEquals(1, requests)
    }

    @Test
    fun `with no key frame seen it measures from the first frame`() {
        for (i in 0..14) pacer.onFrame(i * 66_667L, false)
        assertEquals(0, requests)
        pacer.onFrame(15 * 66_667L, false)
        assertEquals(1, requests)
    }
}
