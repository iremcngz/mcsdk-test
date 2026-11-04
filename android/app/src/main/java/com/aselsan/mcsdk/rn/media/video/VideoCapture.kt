package com.aselsan.mcsdk.rn.media.video

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.MediaCodec
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Range
import android.view.Surface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * VideoCapture — the camera, drawing into whichever Surfaces it is given.
 *
 * No frame passes through this class: once the repeating request runs, the
 * camera fills the Surfaces directly and all that is left here is its lifecycle.
 *
 * Frames come out at the sensor's fixed orientation; VideoRotator turns them.
 */
class VideoCapture(context: Context) {

    private companion object {
        const val TAG = "McSdkVideoCapture"
        const val OPEN_WAIT_MS = 5000L
        const val CLOSE_WAIT_MS = 1000L
    }

    private val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

    private var thread: HandlerThread? = null
    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var cameraId: String? = null
    private var fpsRange: Pair<Int, Int>? = null
    private var closed: CountDownLatch? = null

    @Volatile
    var lastError: String? = null
        private set

    /** Degrees the sensor is mounted at, valid after [resolve]. */
    var sensorOrientation = 0
        private set

    /**
     * Picks the back camera (or the first there is) and fits [wanted] to what it
     * offers. Call before configuring the encoder, whose size has to match.
     *
     * @return the settings to run at, or null with [lastError] set
     */
    fun resolve(wanted: VideoConfig): VideoConfig? {
        lastError = null
        try {
            val ids = manager.cameraIdList
            val id = ids.firstOrNull {
                manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) ==
                    CameraCharacteristics.LENS_FACING_BACK
            } ?: ids.firstOrNull()
            if (id == null) return fail("this device has no camera")

            val traits = manager.getCameraCharacteristics(id)
            val sizes = traits.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                ?.getOutputSizes(MediaCodec::class.java)
                ?.map { it.width to it.height }
                .orEmpty()
            val size = VideoCaptureChoice.chooseSize(sizes, wanted.width, wanted.height)
                ?: return fail("no usable capture size among $sizes")

            val ranges = traits.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
                ?.map { it.lower to it.upper }
                .orEmpty()
            fpsRange = VideoCaptureChoice.chooseFpsRange(ranges, wanted.frameRate)
            cameraId = id
            sensorOrientation = traits.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
            Log.d(TAG, "resolve: camera=$id size=$size fps=$fpsRange sensor=$sensorOrientation° of $ranges")
            return wanted.copy(width = size.first, height = size.second)
        } catch (e: CameraAccessException) {
            return fail("camera: ${e.message}")
        }
    }

    /**
     * Opens the camera and starts it drawing into [targets]. Blocks until it is
     * running or has failed, so call it off the UI thread.
     *
     * The caller must hold CAMERA, which JS asks for before getting here;
     * without it the SecurityException below is what reports it.
     *
     * @return true when frames are flowing; false with [lastError] set
     */
    @SuppressLint("MissingPermission")
    fun start(targets: List<Surface>): Boolean {
        val id = cameraId ?: run {
            fail("resolve() was not called")
            return false
        }
        val handlerThread = HandlerThread("McSdkVideoCapture").apply { start() }
        thread = handlerThread
        val handler = Handler(handlerThread.looper)

        val started = CountDownLatch(1)
        var running = false
        val deviceClosed = CountDownLatch(1)
        closed = deviceClosed

        val sessionCallback = object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(s: CameraCaptureSession) {
                try {
                    session = s
                    val builder = s.device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
                    targets.forEach { builder.addTarget(it) }
                    fpsRange?.let { (low, high) ->
                        builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(low, high))
                    }
                    s.setRepeatingRequest(builder.build(), null, handler)
                    running = true
                } catch (e: CameraAccessException) {
                    fail("camera: ${e.message}")
                } catch (e: IllegalStateException) {
                    fail("camera: ${e.message}")
                }
                started.countDown()
            }

            override fun onConfigureFailed(s: CameraCaptureSession) {
                fail("the camera refused this capture configuration")
                started.countDown()
            }
        }

        val deviceCallback = object : CameraDevice.StateCallback() {
            override fun onOpened(camera: CameraDevice) {
                device = camera
                try {
                    @Suppress("DEPRECATION") // its replacement needs API 28; minSdk is 24
                    camera.createCaptureSession(targets, sessionCallback, handler)
                } catch (e: CameraAccessException) {
                    fail("camera: ${e.message}")
                    started.countDown()
                }
            }

            override fun onDisconnected(camera: CameraDevice) {
                // Another app took it, or Android did because we left the
                // foreground. The bridge shows lastError on its next poll.
                fail("the camera was taken away")
                camera.close()
                started.countDown()
            }

            override fun onError(camera: CameraDevice, error: Int) {
                fail("camera error $error")
                camera.close()
                started.countDown()
            }

            override fun onClosed(camera: CameraDevice) {
                deviceClosed.countDown()
            }
        }

        try {
            manager.openCamera(id, deviceCallback, handler)
        } catch (e: CameraAccessException) {
            fail("camera: ${e.message}")
            return false
        } catch (e: SecurityException) {
            fail("camera permission is missing")
            return false
        }

        if (!started.await(OPEN_WAIT_MS, TimeUnit.MILLISECONDS)) {
            fail("the camera did not start within $OPEN_WAIT_MS ms")
            return false
        }
        return running
    }

    /** Stops the camera. Safe when never started. */
    fun stop() {
        try {
            session?.close()
        } catch (e: IllegalStateException) {
            Log.w(TAG, "session close: ${e.message}")
        }
        session = null
        device?.close()
        // Waited for: the Surfaces go next, and the camera must be off them first.
        if (device != null) closed?.await(CLOSE_WAIT_MS, TimeUnit.MILLISECONDS)
        device = null
        thread?.quitSafely()
        thread = null
    }

    private fun fail(message: String): VideoConfig? {
        lastError = message
        Log.e(TAG, message)
        return null
    }
}
