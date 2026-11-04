package com.aselsan.mcsdk.rn.media.video.codec

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

class H264FrameAssemblerTest {

    private class Frame(val bytes: ByteArray, val timeUs: Long, val key: Boolean)

    private val out = mutableListOf<Frame>()
    private val assembler = H264FrameAssembler { data, len, timeUs, key ->
        out += Frame(data.copyOf(len), timeUs, key)
    }

    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    private val sps = bytes(0, 0, 0, 1, 0x67, 0x42, 0xE0, 0x1F, 0xAA)
    private val pps = bytes(0, 0, 0, 1, 0x68, 0xCE, 0x3C)
    private val sets = sps + pps
    private val idr = bytes(0, 0, 0, 1, 0x65, 1, 2, 3)
    private val slice = bytes(0, 0, 0, 1, 0x41, 4, 5)

    private fun config(b: ByteArray = sets) =
        assembler.onEncoderOutput(ByteBuffer.wrap(b), 0, isConfig = true, isKey = false)

    private fun key(b: ByteArray = idr, t: Long = 1000) =
        assembler.onEncoderOutput(ByteBuffer.wrap(b), t, isConfig = false, isKey = true)

    private fun delta(b: ByteArray = slice, t: Long = 2000) =
        assembler.onEncoderOutput(ByteBuffer.wrap(b), t, isConfig = false, isKey = false)

    @Test
    fun `the parameter sets are kept, not sent on their own`() {
        config()
        assertTrue(out.isEmpty())
        assertEquals(0, assembler.framesDelivered)
    }

    @Test
    fun `every key frame carries the parameter sets`() {
        config()
        key(t = 1000)
        delta()
        key(t = 3000)
        assertArrayEquals(sets + idr, out[0].bytes)
        assertArrayEquals(sets + idr, out[2].bytes)
        assertEquals(2, assembler.keyFrames)
    }

    @Test
    fun `a delta frame goes through untouched`() {
        config()
        delta(t = 2000)
        assertArrayEquals(slice, out[0].bytes)
        assertEquals(2000, out[0].timeUs)
        assertFalse(out[0].key)
    }

    @Test
    fun `a key frame that already has them does not get them twice`() {
        config()
        key(sets + idr)
        assertArrayEquals(sets + idr, out[0].bytes)
        assertEquals(0, assembler.keyFramesWithoutConfig)
    }

    @Test
    fun `a three byte start code is recognised too`() {
        config()
        val short = bytes(0, 0, 1, 0x67, 0x42, 0xE0, 0x1F) + idr
        key(short)
        assertArrayEquals(short, out[0].bytes)
    }

    @Test
    fun `a new configuration replaces the old one`() {
        config()
        val newer = bytes(0, 0, 0, 1, 0x67, 0x42, 0xC0, 0x28)
        config(newer)
        key()
        assertArrayEquals(newer + idr, out[0].bytes)
        assertEquals("42c028", assembler.profileLevelId)
    }

    @Test
    fun `a key frame with nothing to carry is counted`() {
        key()
        assertArrayEquals(idr, out[0].bytes)
        assertEquals(1, assembler.keyFramesWithoutConfig)
    }

    @Test
    fun `reads the profile level id the way SDP writes it`() {
        assertNull(assembler.profileLevelId)
        config()
        assertEquals("42e01f", assembler.profileLevelId)
    }

    @Test
    fun `a closed gate holds frames back and still learns the configuration`() {
        assembler.transmitEnabled = false
        config()
        key()
        delta()
        assertTrue(out.isEmpty())
        assertEquals(2, assembler.framesGated)

        assembler.transmitEnabled = true
        key()
        assertArrayEquals(sets + idr, out[0].bytes)
    }

    @Test
    fun `a frame larger than the buffer makes it grow`() {
        config()
        val huge = bytes(0, 0, 0, 1, 0x65) + ByteArray(300_000) { (it % 251).toByte() }
        key(huge)
        assertArrayEquals(sets + huge, out[0].bytes)
    }

    @Test
    fun `reads only between the position and the limit`() {
        val backing = bytes(9, 9) + slice + bytes(9, 9)
        val buffer = ByteBuffer.wrap(backing)
        buffer.position(2)
        buffer.limit(2 + slice.size)
        assembler.onEncoderOutput(buffer, 5, isConfig = false, isKey = false)
        assertArrayEquals(slice, out[0].bytes)
    }

    @Test
    fun `an empty buffer is not a frame`() {
        assembler.onEncoderOutput(ByteBuffer.allocate(0), 0, isConfig = false, isKey = false)
        assertTrue(out.isEmpty())
    }

    @Test
    fun `the counters add up and the time span follows the frames`() {
        config()
        key(t = 1000)
        delta(t = 2000)
        assertEquals(2, assembler.framesDelivered)
        assertEquals((sets.size + idr.size + slice.size).toLong(), assembler.bytesDelivered)
        assertEquals(1000, assembler.firstTimeUs)
        assertEquals(2000, assembler.lastTimeUs)
    }
}
