package com.aselsan.mcsdk.rn.media.video.transport

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.DatagramSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The sink and source over a real socket on this machine, including the PLI back. */
class UdpVideoLoopbackTest {

    private val port = freePortPair()
    private val sink = UdpVideoFrameSink("127.0.0.1", port)
    private val source = UdpVideoFrameSource(port)

    @After
    fun tearDown() {
        sink.close()
        source.stop()
    }

    private fun freePortPair(): Int {
        repeat(50) {
            val p = DatagramSocket(0).use { it.localPort }
            val free = try {
                DatagramSocket(p).close()
                DatagramSocket(p + 1).close()
                true
            } catch (e: Exception) {
                false
            }
            if (free && p < 65534) return p
        }
        error("no free port pair")
    }

    private fun frame(size: Int, type: Int) =
        byteArrayOf(0, 0, 0, 1) + ByteArray(size) { i -> if (i == 0) type.toByte() else ((i % 250) + 1).toByte() }

    private val noFeedback = object : VideoFrameSink.Feedback {
        override fun onKeyFrameRequested() = Unit
        override fun onBitrateChanged(kbps: Int) = Unit
    }

    @Test
    fun `a large frame crosses the socket whole`() {
        val got = CountDownLatch(1)
        var bytes = ByteArray(0)
        var key = false
        assertTrue(source.start(object : VideoFrameSource.Listener {
            override fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) {
                bytes = data.copyOf(len)
                key = keyFrame
                got.countDown()
            }

            override fun onFrameLost(ssrc: Long) = Unit
        }))
        sink.open(noFeedback)

        val sent = frame(40_000, 0x65)
        sink.onFrame(sent, sent.size, 1000, true)

        assertTrue("the frame never arrived", got.await(3, TimeUnit.SECONDS))
        assertArrayEquals(sent, bytes)
        assertTrue(key)
        assertEquals(sink.packetsSent, source.packetsReceived)
        assertEquals(0, sink.sendErrors)
    }

    @Test
    fun `a PLI reaches the sender and asks for a key frame`() {
        val requested = CountDownLatch(1)
        val delivered = CountDownLatch(1)
        var ssrc = 0L
        assertTrue(source.start(object : VideoFrameSource.Listener {
            override fun onFrame(s: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) {
                ssrc = s
                delivered.countDown()
            }

            override fun onFrameLost(ssrc: Long) = Unit
        }))
        sink.open(object : VideoFrameSink.Feedback {
            override fun onKeyFrameRequested() = requested.countDown()
            override fun onBitrateChanged(kbps: Int) = Unit
        })

        val f = frame(100, 0x41)
        sink.onFrame(f, f.size, 0, false)
        assertTrue(delivered.await(3, TimeUnit.SECONDS))

        source.requestKeyFrame(ssrc)
        assertTrue("the PLI never arrived", requested.await(3, TimeUnit.SECONDS))
        assertEquals(1, sink.keyFramesRequested)
        assertEquals(1, source.keyFramesRequested)
    }

    @Test
    fun `a PLI for another stream is not this sender's business`() {
        val latch = CountDownLatch(1)
        val other = CountDownLatch(1)
        assertTrue(source.start(object : VideoFrameSource.Listener {
            override fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) {
                latch.countDown()
            }

            override fun onFrameLost(ssrc: Long) = Unit
        }))
        sink.open(object : VideoFrameSink.Feedback {
            override fun onKeyFrameRequested() = other.countDown()
            override fun onBitrateChanged(kbps: Int) = Unit
        })
        val f = frame(100, 0x41)
        sink.onFrame(f, f.size, 0, false)
        assertTrue(latch.await(3, TimeUnit.SECONDS))

        source.requestKeyFrame(123_456L)
        assertFalse(other.await(300, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `a port in use is reported, not thrown`() {
        val taken = DatagramSocket(port)
        try {
            val noListener = object : VideoFrameSource.Listener {
                override fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) = Unit
                override fun onFrameLost(ssrc: Long) = Unit
            }
            assertFalse(source.start(noListener))
            assertTrue(source.lastError!!.contains("$port"))
        } finally {
            taken.close()
        }
    }

    @Test
    fun `a frame after close goes nowhere`() {
        sink.open(noFeedback)
        sink.close()
        val f = frame(100, 0x41)
        sink.onFrame(f, f.size, 0, false)
        assertEquals(0, sink.packetsSent)
    }

    @Test
    fun `closing twice is harmless`() {
        sink.open(noFeedback)
        sink.close()
        sink.close()
    }
}
