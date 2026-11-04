package com.aselsan.mcsdk.rn.media.video.transport

/**
 * RtcpPli — the Picture Loss Indication packet (RFC 4585 §6.3.1): "my decoder has
 * nothing to work from, send a key frame".
 *
 * The one piece of RTCP the UDP test needs. The SDK will send and read these
 * itself, behind RequestKeyFrame and onKeyFrameRequested.
 *
 *   0     V=2, P=0, FMT=1      → 0x81
 *   1     PT=206 (PSFB)
 *   2-3   length in words - 1  → 2
 *   4-7   sender SSRC
 *   8-11  media SSRC: whose picture was lost
 */
object RtcpPli {

    const val BYTES = 12

    private const val FIRST_BYTE = 0x81
    private const val PAYLOAD_TYPE = 206
    private const val LENGTH_WORDS = 2

    fun write(senderSsrc: Int, mediaSsrc: Int): ByteArray {
        val out = ByteArray(BYTES)
        out[0] = FIRST_BYTE.toByte()
        out[1] = PAYLOAD_TYPE.toByte()
        out[3] = LENGTH_WORDS.toByte()
        writeU32(out, 4, senderSsrc)
        writeU32(out, 8, mediaSsrc)
        return out
    }

    /** The media SSRC if [buf] holds a PLI, otherwise null. */
    fun parseMediaSsrc(buf: ByteArray, len: Int): Int? {
        if (len < BYTES) return null
        if (buf[0].toInt() and 0xFF != FIRST_BYTE) return null
        if (buf[1].toInt() and 0xFF != PAYLOAD_TYPE) return null
        return ((buf[8].toInt() and 0xFF) shl 24) or
            ((buf[9].toInt() and 0xFF) shl 16) or
            ((buf[10].toInt() and 0xFF) shl 8) or
            (buf[11].toInt() and 0xFF)
    }

    private fun writeU32(buf: ByteArray, at: Int, value: Int) {
        buf[at] = (value ushr 24).toByte()
        buf[at + 1] = (value ushr 16).toByte()
        buf[at + 2] = (value ushr 8).toByte()
        buf[at + 3] = value.toByte()
    }
}
