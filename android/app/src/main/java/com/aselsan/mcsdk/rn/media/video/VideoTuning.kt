package com.aselsan.mcsdk.rn.media.video

/**
 * VideoTuning — what the settings screen chose for video, read when it is used.
 *
 * Two kinds of setting, read at two different moments:
 *
 *  - bitrate, frame rate, key frame interval: the encoder is configured once, when the
 *    camera starts, so a change takes effect from the next camera start (the next call).
 *  - freeze on loss: read for every frame received, so it takes effect at once.
 *
 * Values are clamped here rather than trusted: they come from JS, and a bitrate of 0 or
 * a key frame interval of 0 (a key frame every frame) would not fail, only misbehave.
 *
 * Process-wide, like the pipelines that read it; written from the JS thread, read on the
 * camera and media threads, hence @Volatile.
 */
object VideoTuning {

    const val MIN_BITRATE_KBPS = 100
    const val MAX_BITRATE_KBPS = 4000
    const val MIN_FRAME_RATE = 5
    const val MAX_FRAME_RATE = 30
    const val MIN_KEY_FRAME_INTERVAL_S = 1
    const val MAX_KEY_FRAME_INTERVAL_S = 10

    private val defaults = VideoConfig()

    @Volatile var bitrateKbps = defaults.bitrateKbps
        private set
    @Volatile var frameRate = defaults.frameRate
        private set
    @Volatile var keyFrameIntervalSeconds = defaults.keyFrameIntervalSeconds
        private set

    /**
     * After a frame is lost, hold the last good picture until the next key frame rather
     * than decode frames that refer to what never arrived (the smearing a loss causes).
     */
    @Volatile var freezeOnLoss = true

    fun set(bitrateKbps: Int, frameRate: Int, keyFrameIntervalSeconds: Int, freezeOnLoss: Boolean) {
        this.bitrateKbps = bitrateKbps.coerceIn(MIN_BITRATE_KBPS, MAX_BITRATE_KBPS)
        this.frameRate = frameRate.coerceIn(MIN_FRAME_RATE, MAX_FRAME_RATE)
        this.keyFrameIntervalSeconds =
            keyFrameIntervalSeconds.coerceIn(MIN_KEY_FRAME_INTERVAL_S, MAX_KEY_FRAME_INTERVAL_S)
        this.freezeOnLoss = freezeOnLoss
    }

    /** What the camera and encoder should start with now. */
    fun config(): VideoConfig = defaults.copy(
        frameRate = frameRate,
        bitrateKbps = bitrateKbps,
        keyFrameIntervalSeconds = keyFrameIntervalSeconds,
    )
}
