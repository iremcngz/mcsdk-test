package com.aselsan.mcsdk.rn.media

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test

class SdkFrameSinkTest {

    private class Sent(val callId: String, val payload: ByteArray, val bytes: ByteArray, val timeUs: Long)
    private val sent = mutableListOf<Sent>()

    @Before fun setUp() {
        CallAudioRouter.resetForTest()
        CallAudioRouter.sender = CallAudioRouter.Sender { id, p, t -> sent += Sent(id, p, p.copyOf(), t) }
    }
    @After fun tearDown() = CallAudioRouter.resetForTest()

    private fun openSink() = SdkFrameSink("call-1").also { it.open(FakeAmrWb()) }

    @Test
    fun `sends the octet-aligned payload for the call`() {
        val sink = openSink()
        val frame = storageFrame23k()
        sink.onFrame(frame, frame.size, 0, true)

        val s = sent.single()
        assertEquals("call-1", s.callId)
        assertEquals(62, s.bytes.size)
        assertEquals(0xF0.toByte(), s.bytes[0])
        assertArrayEquals(frame, s.bytes.copyOfRange(1, 62))
        assertEquals(1, sink.framesSent)
    }

    @Test
    fun `capture time follows the sample count, 20 ms per frame`() {
        val sink = openSink()
        val frame = storageFrame23k()
        sink.onFrame(frame, frame.size, 0, true)
        sink.onFrame(frame, frame.size, 320, false)
        sink.onFrame(frame, frame.size, 640, false)
        assertEquals(listOf(0L, 20_000L, 40_000L), sent.map { it.timeUs })
    }

    // Monotonic past Int.MAX_VALUE samples: read as unsigned, never negative.
    @Test
    fun `capture time stays positive past the signed range`() {
        // 2^31 samples × 62.5 µs
        assertEquals(134_217_728_000L, SdkFrameSink.captureTimeUs(Int.MIN_VALUE, 16000))
    }

    // No allocation per frame: the same array goes out every time.
    @Test
    fun `reuses one array for every frame of the same size`() {
        val sink = openSink()
        val frame = storageFrame23k()
        repeat(3) { sink.onFrame(frame, frame.size, it * 320, false) }
        assertSame(sent[0].payload, sent[1].payload)
        assertSame(sent[1].payload, sent[2].payload)
    }

    @Test
    fun `a malformed frame is counted and not sent`() {
        val sink = openSink()
        val frame = storageFrame23k()
        sink.onFrame(frame, 40, 0, false)
        assertEquals(0, sent.size)
        assertEquals(1, sink.framesRejected)
        assertEquals(1, sink.droppedFrames)
    }

    @Test
    fun `a frame with no SDK to send through is counted as dropped`() {
        CallAudioRouter.sender = null
        val sink = openSink()
        val frame = storageFrame23k()
        sink.onFrame(frame, frame.size, 0, false)
        assertEquals(1, sink.droppedFrames)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `refuses any codec but AMR-WB`() {
        SdkFrameSink("call-1").open(FakeAmrWb(name = "PCMU"))
    }
}
