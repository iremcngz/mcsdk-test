package com.aselsan.mcsdk.rn.media.audio

import com.aselsan.mcsdk.rn.media.audio.codec.FakeAmrWb
import com.aselsan.mcsdk.rn.media.audio.codec.storageFrame23k
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The jitter buffer behaviour an SDK stream depends on. */
class JitterBufferTest {

    private val frame = storageFrame23k()
    private val out = ByteArray(128)

    private fun JitterBuffer.putAt(ts: Int) = put(frame, frame.size, ts)

    /** Fills to the target depth (4) starting at [base] and plays one frame. */
    private fun primedAt(base: Int, maxConceal: Int = Int.MAX_VALUE) =
        JitterBuffer(FakeAmrWb(), maxConcealFrames = maxConceal).also { jb ->
            for (i in 0 until 4) jb.putAt(base + i * 320)
            assertTrue(jb.isPrimed)
        }

    // Regression: -1 used to mean "not anchored", so a negative timestamp —
    // half of all SDK streams, whose RTP base is random — re-anchored on every
    // frame and nothing ever played in order.
    @Test
    fun `plays a stream whose timestamps are negative`() {
        val jb = primedAt(-1_280)
        repeat(4) { assertEquals(61, jb.read(out)) }
        assertEquals(4, jb.playedFrames)
        assertEquals(0, jb.lateFrames)
    }

    @Test
    fun `plays across the 32-bit wrap`() {
        val jb = primedAt(Int.MAX_VALUE - 639) // two frames before, two after the wrap
        repeat(4) { assertEquals(61, jb.read(out)) }
        assertEquals(4, jb.playedFrames)
    }

    @Test
    fun `stops concealing after maxConcealFrames and falls silent`() {
        val jb = primedAt(0, maxConceal = 2)
        repeat(4) { jb.read(out) } // play everything
        assertEquals(61, jb.read(out)) // concealed
        assertEquals(61, jb.read(out)) // concealed
        assertEquals(0, jb.read(out))  // silence, not the last frame forever
        assertEquals(2, jb.concealedFrames)
    }

    @Test
    fun `restartBurst re-anchors on the next frame and keeps the counters`() {
        val jb = primedAt(0)
        repeat(4) { jb.read(out) }

        jb.restartBurst()
        assertEquals(0, jb.read(out)) // nothing primed: silence, no stale repeat

        // The new burst sits far from the old play position; it plays anyway.
        for (i in 0 until 4) jb.putAt(1_000_000 + i * 320)
        repeat(4) { assertEquals(61, jb.read(out)) }
        assertEquals(8, jb.playedFrames)
        assertEquals(0, jb.lateFrames)
    }

    // ── rebufferOnStall: a call's buffer ─────────────────────────────────────

    /** A call's buffer: target 10, capacity 64, filled with frames 0..9 and primed. */
    private fun callPrimed() =
        JitterBuffer(FakeAmrWb(), targetFrames = 10, capacityFrames = 64,
                     maxConcealFrames = 5, rebufferOnStall = true).also { jb ->
            for (i in 0 until 10) jb.putAt(i * 320)
            assertTrue(jb.isPrimed)
        }

    // The measured failure: packets held back ~300 ms, then delivered at once.
    // Moving on through the stall made every frame of the clump late.
    @Test
    fun `waits out a stall instead of dropping the clump that follows it`() {
        val jb = callPrimed()
        repeat(10) { assertEquals(61, jb.read(out)) }

        repeat(15) { assertEquals(0, jb.read(out)) } // 300 ms with nothing arriving
        assertEquals(1, jb.rebufferCount)

        for (i in 10 until 25) jb.putAt(i * 320) // the clump
        repeat(15) { assertEquals(61, jb.read(out)) }
        assertEquals(25, jb.playedFrames)
        assertEquals(0, jb.lateFrames)
        assertEquals(0, jb.concealedFrames)
    }

    @Test
    fun `still conceals a lost frame when later ones are already here`() {
        val jb = callPrimed()
        repeat(10) { jb.read(out) }
        jb.putAt(11 * 320) // frame 10 never comes
        for (i in 12 until 20) jb.putAt(i * 320)
        assertEquals(61, jb.read(out)) // 10: concealed, the position moves on
        assertEquals(1, jb.concealedFrames)
        repeat(9) { assertEquals(61, jb.read(out)) }
        assertEquals(19, jb.playedFrames)
        assertEquals(0, jb.rebufferCount)
    }

    @Test
    fun `plays a tail shorter than the target after waiting the target out`() {
        val jb = callPrimed()
        repeat(10) { jb.read(out) }
        jb.read(out) // runs dry: rebuffering
        for (i in 10 until 13) jb.putAt(i * 320) // the burst's last 3 frames

        repeat(9) { assertEquals(0, jb.read(out)) }
        repeat(3) { assertEquals(61, jb.read(out)) }
        assertEquals(13, jb.playedFrames)
    }

    @Test
    fun `restarts the timeline when a stall outlasts the whole buffer`() {
        val jb = callPrimed()
        repeat(10) { jb.read(out) }
        jb.read(out) // rebuffering at frame 10

        // Two seconds later the stream resumes, 100 frames past the position.
        for (i in 110 until 120) jb.putAt(i * 320)
        repeat(10) { assertEquals(61, jb.read(out)) }
        assertEquals(0, jb.overflowFrames)
        assertEquals(20, jb.playedFrames)
    }

    @Test
    fun `without rebufferOnStall an empty buffer still moves the position on`() {
        val jb = primedAt(0, maxConceal = 0)
        repeat(4) { jb.read(out) }
        assertEquals(0, jb.read(out)) // frame 4's slot passes
        jb.putAt(4 * 320)
        assertEquals(1, jb.lateFrames)
        assertEquals(0, jb.rebufferCount)
    }
}
