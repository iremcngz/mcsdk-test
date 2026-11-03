package com.aselsan.mcsdk.rn.media.audio.transport

import com.aselsan.mcsdk.rn.media.audio.codec.FakeAmrWb
import com.aselsan.mcsdk.rn.media.audio.codec.storageFrame23k
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SdkFrameSourceTest {

    private data class Got(val bytes: ByteArray, val timestamp: Int, val first: Boolean)
    private val got = mutableListOf<Got>()

    @Before fun setUp() = CallAudioRouter.resetForTest()
    @After fun tearDown() = CallAudioRouter.resetForTest()

    private fun started(callId: String = "call-1") = SdkFrameSource(callId).also {
        it.setListener { p, len, ts, first -> got += Got(p.copyOf(len), ts, first) }
        assertTrue(it.start(FakeAmrWb()))
    }

    private fun payload(frame: ByteArray = storageFrame23k()) = byteArrayOf(0xF0.toByte()) + frame

    /** What the SDK reports for an RTP timestamp: rtp × 1 000 000 / 16 000, unsigned. */
    private fun sdkUs(rtp: Long) = rtp * 1_000_000L / 16_000L

    @Test
    fun `delivers the storage frame with the RTP timestamp in samples`() {
        started()
        val frame = storageFrame23k(seed = 5)
        CallAudioRouter.deliver("call-1", 77, payload(frame), sdkUs(32_000), true)

        val g = got.single()
        assertArrayEquals(frame, g.bytes)
        assertEquals(32_000, g.timestamp)
        assertTrue(g.first)
    }

    // A random RTP base above 2^31 must come back as the same 32 bits, which the
    // jitter buffer reads as a negative Int.
    @Test
    fun `keeps the low 32 bits of a timestamp above the signed range`() {
        assertEquals(0xFFFF_FEC0L.toInt(), SdkFrameSource.rtpTimestamp(sdkUs(0xFFFF_FEC0L)))
        assertEquals(-320, SdkFrameSource.rtpTimestamp(sdkUs(0xFFFF_FEC0L)))
    }

    @Test
    fun `round trips every frame timestamp exactly`() {
        for (rtp in listOf(0L, 320L, 12_345L, 0x7FFF_FFFFL, 0x8000_0000L, 0xFFFF_FFFFL)) {
            assertEquals("rtp $rtp", rtp.toInt(), SdkFrameSource.rtpTimestamp(sdkUs(rtp)))
        }
    }

    @Test
    fun `ignores frames of another call`() {
        val src = started()
        CallAudioRouter.deliver("other", 77, payload(), 0, false)
        assertEquals(0, got.size)
        assertEquals(1, src.otherCallFrames)
    }

    // The floor passed to someone else: their clock, their timeline.
    @Test
    fun `a new talker starts a burst even without the marker bit`() {
        started()
        CallAudioRouter.deliver("call-1", 77, payload(), sdkUs(320), true)
        CallAudioRouter.deliver("call-1", 77, payload(), sdkUs(640), false)
        CallAudioRouter.deliver("call-1", 88, payload(), sdkUs(9_600), false)
        assertEquals(listOf(true, false, true), got.map { it.first })
    }

    @Test
    fun `splits a two-frame packet 320 samples apart, burst flag on the first only`() {
        started()
        val a = storageFrame23k(seed = 1)
        val b = storageFrame23k(seed = 100)
        val p = byteArrayOf(0xF0.toByte(), (0x44 or 0x80).toByte(), 0x44) +
            a.copyOfRange(1, 61) + b.copyOfRange(1, 61)
        CallAudioRouter.deliver("call-1", 77, p, sdkUs(6_400), true)

        assertEquals(listOf(6_400, 6_720), got.map { it.timestamp })
        assertEquals(listOf(true, false), got.map { it.first })
        assertArrayEquals(b, got[1].bytes)
    }

    @Test
    fun `counts a malformed payload and delivers nothing`() {
        val src = started()
        CallAudioRouter.deliver("call-1", 77, byteArrayOf(0xF0.toByte(), 0x44, 1, 2), 0, true)
        assertEquals(0, got.size)
        assertEquals(1, src.malformedPackets)
    }

    @Test
    fun `stops taking frames once stopped`() {
        val src = started()
        src.stop()
        CallAudioRouter.deliver("call-1", 77, payload(), 0, true)
        assertEquals(0, got.size)
        assertEquals(1, CallAudioRouter.framesUnrouted)
    }

    @Test
    fun `refuses any codec but AMR-WB`() {
        val src = SdkFrameSource("call-1")
        src.setListener { _, _, _, _ -> }
        assertFalse(src.start(FakeAmrWb(name = "PCMU")))
    }
}
