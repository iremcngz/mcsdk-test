package com.aselsan.mcsdk.rn.media.video.transport

import com.aselsan.mcsdk.rn.media.rtp.RtpPacket
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The packetizer and depacketizer, on their own and as a round trip. */
class H264RtpTest {

    private class Frame(val ssrc: Long, val bytes: ByteArray, val timeUs: Long, val key: Boolean)

    private val frames = mutableListOf<Frame>()
    private var losses = 0
    private val listener = object : VideoFrameSource.Listener {
        override fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) {
            frames += Frame(ssrc, data.copyOf(len), timestampUs, keyFrame)
        }

        override fun onFrameLost(ssrc: Long) {
            losses++
        }
    }
    private val depacketizer = H264RtpDepacketizer(listener)
    private val packets = mutableListOf<ByteArray>()

    private fun packetizer(ssrc: Int = 0x1234, firstSeq: Int = 100, maxPayload: Int = 1200) =
        H264RtpPacketizer(ssrc, firstSeq, maxPayload) { p, len -> packets += p.copyOf(len) }

    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }
    private val start = bytes(0, 0, 0, 1)
    private val sps = bytes(0x67, 0x42, 0xC0, 0x16, 0xDA)
    private val pps = bytes(0x68, 0xCE, 0x0D)
    private fun idr(size: Int) = ByteArray(size) { i -> if (i == 0) 0x65 else ((i % 250) + 1).toByte() }
    private fun slice(size: Int) = ByteArray(size) { i -> if (i == 0) 0x41 else ((i % 250) + 1).toByte() }
    private fun keyFrame(idrSize: Int) = start + sps + start + pps + start + idr(idrSize)
    private fun delta(size: Int) = start + slice(size)

    private fun header(p: ByteArray) = RtpPacket.Header().also { assertTrue(RtpPacket.parse(p, p.size, it)) }

    private fun feed(p: ByteArray) = depacketizer.onPacket(header(p), p)
    private fun feedAll() = packets.forEach { feed(it) }

    // ── Packetizer ───────────────────────────────────────────────────────────

    @Test
    fun `a small frame is one packet with the marker, minus its start code`() {
        val f = delta(100)
        packetizer().packetize(f, f.size, 1000)
        assertEquals(1, packets.size)
        val h = header(packets[0])
        assertTrue(h.marker)
        assertArrayEquals(slice(100), packets[0].copyOfRange(h.payloadOffset, packets[0].size))
    }

    @Test
    fun `a key frame's SPS and PPS go first in packets of their own, unmarked`() {
        val f = keyFrame(500)
        packetizer().packetize(f, f.size, 1000)
        assertEquals(3, packets.size)
        assertFalse(header(packets[0]).marker)
        assertFalse(header(packets[1]).marker)
        assertTrue(header(packets[2]).marker)
        assertEquals(0x67, packets[0][RtpPacket.HEADER_BYTES].toInt() and 0xFF)
        assertEquals(0x68, packets[1][RtpPacket.HEADER_BYTES].toInt() and 0xFF)
    }

    @Test
    fun `a large NAL unit becomes FU-A fragments that fit the limit`() {
        val f = delta(40_000)
        packetizer().packetize(f, f.size, 1000)
        assertEquals(34, packets.size)
        packets.forEach { assertTrue(it.size <= RtpPacket.HEADER_BYTES + 1200) }
        val at = RtpPacket.HEADER_BYTES
        assertEquals(0x5C, packets[0][at].toInt() and 0xFF) // NRI of 0x41, type 28
        assertEquals(0x81, packets[0][at + 1].toInt() and 0xFF) // start, type 1
        assertEquals(0x01, packets[5][at + 1].toInt() and 0xFF) // middle
        assertEquals(0x41, packets.last()[at + 1].toInt() and 0xFF) // end
        assertTrue(header(packets.last()).marker)
        assertFalse(header(packets[0]).marker)
    }

    @Test
    fun `every packet of a frame shares a timestamp and the sequence numbers run on`() {
        val f = delta(5000)
        packetizer(firstSeq = 0xFFFE).packetize(f, f.size, 1_000_000)
        val headers = packets.map { header(it) }
        headers.forEach { assertEquals(90_000, it.timestamp) }
        assertEquals(listOf(0xFFFE, 0xFFFF, 0, 1, 2), headers.map { it.sequenceNumber })
    }

    @Test
    fun `three byte start codes and trailing zeros are handled`() {
        val f = bytes(0, 0, 1) + sps + bytes(0, 0, 0, 0, 1) + pps
        packetizer().packetize(f, f.size, 0)
        assertEquals(2, packets.size)
        assertArrayEquals(sps, packets[0].copyOfRange(RtpPacket.HEADER_BYTES, packets[0].size))
        assertArrayEquals(pps, packets[1].copyOfRange(RtpPacket.HEADER_BYTES, packets[1].size))
    }

    @Test
    fun `only the valid part of the array is read`() {
        val f = delta(50) + start + slice(50)
        packetizer().packetize(f, delta(50).size, 0)
        assertEquals(1, packets.size)
    }

    // ── Round trip ───────────────────────────────────────────────────────────

    @Test
    fun `a key frame comes back byte for byte, marked as key`() {
        val f = keyFrame(40_000)
        packetizer().packetize(f, f.size, 2_000_000)
        feedAll()
        assertEquals(1, frames.size)
        assertArrayEquals(f, frames[0].bytes)
        assertTrue(frames[0].key)
        assertEquals(2_000_000, frames[0].timeUs)
        assertEquals(0x1234L, frames[0].ssrc)
        assertEquals(0, losses)
    }

    @Test
    fun `a delta frame comes back and is not marked as key`() {
        val f = delta(3000)
        packetizer().packetize(f, f.size, 0)
        feedAll()
        assertArrayEquals(f, frames[0].bytes)
        assertFalse(frames[0].key)
    }

    @Test
    fun `a run of frames across the sequence wrap all arrive`() {
        val p = packetizer(firstSeq = 0xFFF0)
        val sent = List(10) { i -> if (i == 0) keyFrame(5000) else delta(2000 + i) }
        sent.forEachIndexed { i, f -> p.packetize(f, f.size, i * 40_000L) }
        feedAll()
        assertEquals(10, frames.size)
        sent.forEachIndexed { i, f -> assertArrayEquals(f, frames[i].bytes) }
        assertEquals(0, depacketizer.packetsLost)
    }

    @Test
    fun `a high SSRC stays positive`() {
        val f = delta(10)
        packetizer(ssrc = -1).packetize(f, f.size, 0)
        feedAll()
        assertEquals(0xFFFFFFFFL, frames[0].ssrc)
    }

    // ── Loss ─────────────────────────────────────────────────────────────────

    @Test
    fun `a fragment lost from the middle discards the frame and reports it`() {
        val p = packetizer()
        val f = delta(5000)
        p.packetize(f, f.size, 0)
        packets.removeAt(2)
        feedAll()
        assertTrue(frames.isEmpty())
        assertEquals(1, losses)
        assertEquals(1, depacketizer.packetsLost)
        assertEquals(1, depacketizer.framesDiscarded)
    }

    @Test
    fun `the next whole frame after a loss comes through`() {
        val p = packetizer()
        p.packetize(delta(5000), delta(5000).size, 0)
        packets.removeAt(2)
        val next = keyFrame(800)
        p.packetize(next, next.size, 40_000)
        feedAll()
        assertEquals(1, frames.size)
        assertArrayEquals(next, frames[0].bytes)
    }

    @Test
    fun `a frame whose last packet was lost is dropped when the next one starts`() {
        val p = packetizer()
        p.packetize(delta(5000), delta(5000).size, 0)
        packets.removeAt(packets.lastIndex)
        val next = delta(200)
        p.packetize(next, next.size, 40_000)
        feedAll()
        // Both go: the gap could have swallowed the start of the second frame too.
        assertTrue(frames.isEmpty())
        assertEquals(2, depacketizer.framesDiscarded)
        assertEquals(1, losses)
    }

    @Test
    fun `joining in the middle of a fragmented NAL unit delivers nothing broken`() {
        val p = packetizer()
        p.packetize(delta(5000), delta(5000).size, 0)
        packets.removeAt(0)
        packets.removeAt(0)
        feedAll()
        assertTrue(frames.isEmpty())
        assertEquals(1, depacketizer.framesDiscarded)
    }

    @Test
    fun `a duplicate is ignored`() {
        val p = packetizer()
        val f = delta(5000)
        p.packetize(f, f.size, 0)
        packets.add(2, packets[1])
        feedAll()
        assertArrayEquals(f, frames[0].bytes)
        assertEquals(0, losses)
    }

    @Test
    fun `a packet arriving late is dropped after its gap was already reported`() {
        val p = packetizer()
        val f = delta(5000)
        p.packetize(f, f.size, 0)
        val late = packets.removeAt(1)
        packets.add(2, late)
        feedAll()
        assertTrue(frames.isEmpty())
        assertEquals(1, losses)
    }

    @Test
    fun `a restarted sender starts clean and is reported`() {
        val first = delta(100)
        packetizer(ssrc = 1, firstSeq = 500).packetize(first, first.size, 0)
        feedAll()
        packets.clear()
        val second = keyFrame(100)
        packetizer(ssrc = 2, firstSeq = 9).packetize(second, second.size, 0)
        feedAll()
        assertEquals(2, frames.size)
        assertEquals(2L, frames[1].ssrc)
        assertEquals(1, losses)
        assertEquals(0, depacketizer.packetsLost)
    }

    @Test
    fun `a packet type it does not know breaks the frame`() {
        val p = ByteArray(RtpPacket.HEADER_BYTES + 3)
        RtpPacket.writeHeader(p, 0, 1, 7, marker = true)
        p[RtpPacket.HEADER_BYTES] = 24 // STAP-A
        feed(p)
        assertTrue(frames.isEmpty())
        assertEquals(1, depacketizer.framesDiscarded)
    }

    // ── RTCP ─────────────────────────────────────────────────────────────────

    @Test
    fun `a PLI reads back the SSRC it names`() {
        val pli = RtcpPli.write(senderSsrc = 11, mediaSsrc = -5)
        assertEquals(12, pli.size)
        assertEquals(0x81, pli[0].toInt() and 0xFF)
        assertEquals(206, pli[1].toInt() and 0xFF)
        assertEquals(-5, RtcpPli.parseMediaSsrc(pli, pli.size))
    }

    @Test
    fun `anything else is not a PLI`() {
        assertEquals(null, RtcpPli.parseMediaSsrc(ByteArray(4), 4))
        assertEquals(null, RtcpPli.parseMediaSsrc(ByteArray(12), 12))
        val sr = RtcpPli.write(1, 2).also { it[1] = 200.toByte() }
        assertEquals(null, RtcpPli.parseMediaSsrc(sr, sr.size))
    }
}
