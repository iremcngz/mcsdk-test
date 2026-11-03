package com.aselsan.mcsdk.rn.media

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * AmrWbRtpPayload against hand-built frames. A framing bug does not crash —
 * the far end just hears noise — so the byte layout is pinned down here, where
 * a mistake shows as a failing assertion instead of on a call.
 */
class AmrWbRtpPayloadTest {

    /** A storage frame of frame type [ft], Q = 1, speech bytes counting from [seed]. */
    private fun storageFrame(ft: Int, seed: Int = 1): ByteArray {
        val n = AmrWbRtpPayload.speechBytes(ft)
        val f = ByteArray(1 + n)
        f[0] = ((ft shl 3) or 0x04).toByte()
        for (i in 0 until n) f[1 + i] = (seed + i).toByte()
        return f
    }

    /** Collects every frame unpack delivers, copied out of the scratch buffer. */
    private class Collector : AmrWbRtpPayload.FrameConsumer {
        val frames = mutableListOf<ByteArray>()
        override fun onFrame(frame: ByteArray, len: Int) {
            frames += frame.copyOf(len)
        }
    }

    private fun unpack(payload: ByteArray, len: Int = payload.size): Pair<Int, List<ByteArray>> {
        val c = Collector()
        val n = AmrWbRtpPayload.unpack(payload, len, ByteArray(AmrWbRtpPayload.MAX_FRAME_BYTES), c)
        return n to c.frames
    }

    // ── pack ──────────────────────────────────────────────────────────────────

    @Test
    fun `packs a 23_85 kbps frame as CMR + ToC + 60 speech bytes`() {
        val frame = storageFrame(8)
        assertEquals(61, frame.size) // what MediaCodec hands us at 23.85 kbit/s

        val out = ByteArray(64)
        val n = AmrWbRtpPayload.pack(frame, frame.size, out)

        assertEquals(62, n)
        assertEquals(0xF0.toByte(), out[0])            // CMR 15: no request
        assertEquals(0x44.toByte(), out[1])            // F=0, FT=8, Q=1
        assertArrayEquals(frame.copyOfRange(1, 61), out.copyOfRange(2, 62))
    }

    @Test
    fun `packs every speech mode and SID`() {
        for (ft in 0..9) {
            val frame = storageFrame(ft)
            val out = ByteArray(64)
            assertEquals("FT $ft", frame.size + 1, AmrWbRtpPayload.pack(frame, frame.size, out))
        }
    }

    @Test
    fun `refuses a frame whose length does not match its frame type`() {
        val frame = storageFrame(8)
        assertEquals(-1, AmrWbRtpPayload.pack(frame, 60, ByteArray(64)))
    }

    @Test
    fun `refuses a reserved frame type`() {
        val frame = byteArrayOf(((10 shl 3) or 0x04).toByte(), 1, 2, 3)
        assertEquals(-1, AmrWbRtpPayload.pack(frame, frame.size, ByteArray(64)))
    }

    @Test
    fun `refuses an output buffer too small for the payload`() {
        val frame = storageFrame(8)
        assertEquals(-1, AmrWbRtpPayload.pack(frame, frame.size, ByteArray(61)))
    }

    // ── unpack ────────────────────────────────────────────────────────────────

    @Test
    fun `pack then unpack gives the original storage frame back`() {
        for (ft in 0..9) {
            val frame = storageFrame(ft, seed = 7 * ft)
            val payload = ByteArray(64)
            val n = AmrWbRtpPayload.pack(frame, frame.size, payload)

            val (count, frames) = unpack(payload, n)
            assertEquals("FT $ft", 1, count)
            assertArrayEquals("FT $ft", frame, frames.single())
        }
    }

    /** A 40 ms packet: two ToCs (F=1 then F=0), then both speech blocks. */
    @Test
    fun `splits a packet carrying two frames`() {
        val a = storageFrame(8, seed = 10)
        val b = storageFrame(2, seed = 90)
        val payload = byteArrayOf(0xF0.toByte(), (a[0].toInt() or 0x80).toByte(), b[0]) +
            a.copyOfRange(1, a.size) + b.copyOfRange(1, b.size)

        val (count, frames) = unpack(payload)

        assertEquals(2, count)
        assertArrayEquals(a, frames[0]) // F bit cleared back to a storage header
        assertArrayEquals(b, frames[1])
    }

    @Test
    fun `ignores the CMR the peer sends`() {
        val frame = storageFrame(8)
        val payload = ByteArray(64)
        val n = AmrWbRtpPayload.pack(frame, frame.size, payload)
        payload[0] = 0x20 // CMR 2: the peer asks for 12.65 kbit/s

        assertArrayEquals(frame, unpack(payload, n).second.single())
    }

    @Test
    fun `skips no-data and speech-lost slots but keeps the frames around them`() {
        val a = storageFrame(8, seed = 1)
        val noData = (15 shl 3) or 0x04
        val lost = (14 shl 3) or 0x04
        val payload = byteArrayOf(
            0xF0.toByte(),
            (noData or 0x80).toByte(), (lost or 0x80).toByte(), a[0],
        ) + a.copyOfRange(1, a.size)

        val (count, frames) = unpack(payload)

        assertEquals(1, count)
        assertArrayEquals(a, frames.single())
    }

    @Test
    fun `delivers nothing for a payload that is only a no-data frame`() {
        val payload = byteArrayOf(0xF0.toByte(), ((15 shl 3) or 0x04).toByte())
        assertEquals(0 to emptyList<ByteArray>(), unpack(payload).let { it.first to it.second })
    }

    // ── malformed ─────────────────────────────────────────────────────────────

    @Test
    fun `rejects a payload shorter than its frame type says`() {
        val frame = storageFrame(8)
        val payload = ByteArray(64)
        val n = AmrWbRtpPayload.pack(frame, frame.size, payload)
        assertEquals(-1, unpack(payload, n - 1).first)
    }

    @Test
    fun `rejects trailing bytes after the last speech block`() {
        val frame = storageFrame(8)
        val payload = ByteArray(64)
        val n = AmrWbRtpPayload.pack(frame, frame.size, payload)
        assertEquals(-1, unpack(payload, n + 1).first)
    }

    @Test
    fun `rejects a ToC list that never ends`() {
        val payload = byteArrayOf(0xF0.toByte(), 0xC4.toByte(), 0xC4.toByte()) // F=1 throughout
        assertEquals(-1, unpack(payload).first)
    }

    @Test
    fun `rejects a reserved frame type`() {
        val payload = byteArrayOf(0xF0.toByte(), ((11 shl 3) or 0x04).toByte(), 1, 2)
        assertEquals(-1, unpack(payload).first)
    }

    @Test
    fun `delivers nothing at all from a malformed multi-frame packet`() {
        // First frame complete, second one truncated: the good half must not
        // reach the decoder either.
        val a = storageFrame(8)
        val b = storageFrame(8)
        val payload = byteArrayOf(0xF0.toByte(), (a[0].toInt() or 0x80).toByte(), b[0]) +
            a.copyOfRange(1, a.size) + b.copyOfRange(1, b.size - 1)

        val (count, frames) = unpack(payload)
        assertEquals(-1, count)
        assertEquals(0, frames.size)
    }

    @Test
    fun `rejects a payload with nothing after the CMR`() {
        assertEquals(-1, unpack(byteArrayOf(0xF0.toByte())).first)
    }
}
