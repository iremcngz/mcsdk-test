package com.aselsan.mcsdk.rn.media

/** AMR-WB's shape without MediaCodec: what sinks, sources and the jitter buffer read. */
class FakeAmrWb(override val name: String = "AMR-WB") : AudioCodec {
    override val sampleRate = 16000
    override val frameSamples = 320
    override val frameMs = 20
    override val maxEncodedBytes = 128
    override val payloadType = 107
    override fun encode(pcm: ShortArray, count: Int, out: ByteArray) = 0
    override fun decode(payload: ByteArray, len: Int, out: ShortArray) = 0
}

/** A 23.85 kbit/s storage frame (61 bytes) whose speech bytes start at [seed]. */
fun storageFrame23k(seed: Int = 1): ByteArray {
    val f = ByteArray(61)
    f[0] = 0x44 // FT 8, Q 1
    for (i in 1 until 61) f[i] = (seed + i).toByte()
    return f
}
