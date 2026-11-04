package com.aselsan.mcsdk.rn.media.video.codec

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaFormat
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import com.aselsan.mcsdk.rn.media.video.VideoConfig
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * VideoEncoder — MediaCodec's H.264 encoder, fed from a Surface.
 *
 * The settings are dictated by the one format the SDK offers,
 * `profile-level-id=42e01f;packetization-mode=1`: constrained baseline at level
 * 3.1, which also means no B-frames, so frames leave in capture order.
 *
 * The input is a Surface so the camera's frames reach the encoder through
 * graphics memory: at 640x480 that is ~11 MB/s nothing ever has to copy. The
 * output arrives on this class's own thread and goes straight to [assembler].
 */
class VideoEncoder(
    private val config: VideoConfig,
    private val assembler: H264FrameAssembler,
) {

    private companion object {
        const val TAG = "McSdkVideoEnc"
        const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC
        const val END_OF_STREAM_WAIT_MS = 1000L
    }

    private var codec: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var thread: HandlerThread? = null
    private val endOfStream = CountDownLatch(1)

    @Volatile
    var lastError: String? = null
        private set

    /**
     * Starts the encoder and returns the Surface to draw frames into.
     *
     * @throws Exception if the device has no encoder for these settings
     */
    fun start(): Surface {
        val handlerThread = HandlerThread("McSdkVideoEncoder").apply { start() }
        thread = handlerThread

        val encoder = MediaCodec.createEncoderByType(MIME)
        codec = encoder
        val format = buildFormat(encoder.codecInfo.getCapabilitiesForType(MIME))
        Log.d(TAG, "start: ${encoder.name} $format")

        // Before configure: MediaCodec runs asynchronously only if told first.
        encoder.setCallback(callback, Handler(handlerThread.looper))
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = encoder.createInputSurface()
        inputSurface = surface
        encoder.start()
        return surface
    }

    private fun buildFormat(caps: MediaCodecInfo.CodecCapabilities): MediaFormat =
        MediaFormat.createVideoFormat(MIME, config.width, config.height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, config.bitrateKbps * 1000)
            setInteger(MediaFormat.KEY_FRAME_RATE, config.frameRate)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, config.keyFrameIntervalSeconds)
            // 0 is realtime: the codec should not trade latency for anything.
            setInteger(MediaFormat.KEY_PRIORITY, 0)

            val cbr = MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR
            if (caps.encoderCapabilities.isBitrateModeSupported(cbr)) {
                setInteger(MediaFormat.KEY_BITRATE_MODE, cbr)
            }

            // Constrained baseline only has a constant from API 27, but an
            // encoder that lists it supports it whatever the API level says.
            val offered = caps.profileLevels.map { it.profile }
            val profile = when {
                CodecProfileLevel.AVCProfileConstrainedBaseline in offered ->
                    CodecProfileLevel.AVCProfileConstrainedBaseline
                else -> CodecProfileLevel.AVCProfileBaseline
            }
            setInteger(MediaFormat.KEY_PROFILE, profile)
            setInteger(MediaFormat.KEY_LEVEL, CodecProfileLevel.AVCLevel31)
        }

    private val callback = object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
            // Never called with a Surface as the input.
        }

        override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
            try {
                val buffer = codec.getOutputBuffer(index)
                if (buffer != null && info.size > 0) {
                    buffer.position(info.offset)
                    buffer.limit(info.offset + info.size)
                    assembler.onEncoderOutput(
                        buffer,
                        info.presentationTimeUs,
                        isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0,
                        isKey = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0,
                    )
                }
                codec.releaseOutputBuffer(index, false)
            } catch (e: IllegalStateException) {
                // stop() got there first; the buffer went with the codec.
                Log.d(TAG, "output after stop: ${e.message}")
            }
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) endOfStream.countDown()
        }

        override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
            lastError = "encoder: ${e.diagnosticInfo}"
            Log.e(TAG, "onError: ${e.diagnosticInfo}", e)
            endOfStream.countDown()
        }

        override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
            Log.d(TAG, "output format: $format")
        }
    }

    /** Makes the next frame a key frame. Any thread. */
    fun requestKeyFrame() {
        setParameter(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
    }

    /** Changes the target bitrate on the fly. Any thread. */
    fun setBitrate(kbps: Int) {
        setParameter(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, kbps * 1000)
    }

    private fun setParameter(key: String, value: Int) {
        val encoder = codec ?: return
        try {
            encoder.setParameters(Bundle().apply { putInt(key, value) })
        } catch (e: IllegalStateException) {
            Log.w(TAG, "$key while stopped: ${e.message}")
        }
    }

    /**
     * Drains what is still inside the encoder and releases it, so the last frames
     * reach the sink. Stop the camera first. Safe when never started.
     */
    fun stop() {
        val encoder = codec
        if (encoder != null) {
            try {
                encoder.signalEndOfInputStream()
                if (!endOfStream.await(END_OF_STREAM_WAIT_MS, TimeUnit.MILLISECONDS)) {
                    Log.w(TAG, "no end of stream after ${END_OF_STREAM_WAIT_MS} ms")
                }
                encoder.stop()
            } catch (e: IllegalStateException) {
                Log.w(TAG, "stop: ${e.message}")
            }
            encoder.release()
        }
        codec = null
        inputSurface?.release()
        inputSurface = null
        thread?.quitSafely()
        thread = null
    }
}
