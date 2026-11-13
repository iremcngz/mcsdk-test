package com.aselsan.mcsdk.rn.media.video.transport

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SdkVideoFrameSinkTest {

    private class Sent(val callId: String, val data: ByteArray, val timeUs: Long, val key: Boolean)

    private val sent = mutableListOf<Sent>()

    @Before fun setUp() {
        CallVideoRouter.resetForTest()
        CallVideoRouter.sender = CallVideoRouter.Sender { id, data, t, key -> sent += Sent(id, data, t, key) }
    }

    @After fun tearDown() = CallVideoRouter.resetForTest()

    // The camera comes up before the call has anywhere to send.
    @Test
    fun `nothing goes out until a call is named`() {
        val sink = SdkVideoFrameSink()
        sink.onFrame(ByteArray(10), 10, 1_000, true)
        assertTrue(sent.isEmpty())
        assertEquals(0, sink.sendErrors)
    }

    // sendVideoFrame has no length, and the assembler's array is larger and reused.
    @Test
    fun `a frame goes out at exactly its size, as a copy`() {
        val sink = SdkVideoFrameSink()
        sink.callId = "c1"
        val buffer = byteArrayOf(0, 0, 1, 0x65, 9, 9, 9, 9)

        sink.onFrame(buffer, 5, 2_000, true)
        buffer[4] = 7

        assertEquals(1, sent.size)
        assertEquals("c1", sent[0].callId)
        assertArrayEquals(byteArrayOf(0, 0, 1, 0x65, 9), sent[0].data)
        assertEquals(2_000L, sent[0].timeUs)
        assertTrue(sent[0].key)
        assertEquals(1, sink.framesSent)
    }

    @Test
    fun `clearing the call stops sending`() {
        val sink = SdkVideoFrameSink()
        sink.callId = "c1"
        sink.onFrame(ByteArray(4), 4, 1, false)
        sink.callId = null
        sink.onFrame(ByteArray(4), 4, 2, false)
        assertEquals(1, sent.size)
    }

    @Test
    fun `a frame with no SDK to send through is counted, not lost silently`() {
        CallVideoRouter.sender = null
        val sink = SdkVideoFrameSink()
        sink.callId = "c1"
        sink.onFrame(ByteArray(4), 4, 1, false)
        assertEquals(1, sink.sendErrors)
        assertEquals(1, CallVideoRouter.framesWithoutSender)
    }

    @Test
    fun `received frames are counted, key frames apart`() {
        assertEquals(1, CallVideoRouter.deliver("c1", 1, ByteArray(4), 0, true))
        assertEquals(2, CallVideoRouter.deliver("c1", 1, ByteArray(4), 0, false))
        assertEquals(2, CallVideoRouter.framesReceived)
        assertEquals(1, CallVideoRouter.keyFramesReceived)
        assertFalse(CallVideoRouter.framesSent > 0)
    }
}
