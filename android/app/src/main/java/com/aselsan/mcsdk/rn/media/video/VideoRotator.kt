package com.aselsan.mcsdk.rn.media.video

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * VideoRotator — sits between the camera and the encoder and turns the picture upright.
 *
 *   camera → SurfaceTexture → (one textured quad) → the encoder's input Surface
 *                                                 → the preview's Surface, if any
 *
 * The camera can no longer draw straight into the encoder, since nothing there can
 * rotate. The frames stay in graphics memory: this is one draw call per frame on the
 * GPU, with no copy through the CPU. The capture time is carried across with
 * eglPresentationTimeANDROID, because the encoder's timestamps come from it.
 *
 * The preview is here and not a second camera output because an app can open a camera
 * only once, and because it comes and goes with its view: adding a camera output would
 * mean rebuilding the capture session, and a gap in what is being sent, each time. It
 * is drawn for the screen, not the far end: upright by the display's rotation rather
 * than the device's, and filling the view.
 *
 * Everything GL runs on this class's own thread, where its context is current.
 */
class VideoRotator(
    private val cameraWidth: Int,
    private val cameraHeight: Int,
    private val outWidth: Int,
    private val outHeight: Int,
    private val sensorOrientation: Int,
    private val deviceAngle: () -> Int,
    private val displayAngle: () -> Int = { 0 },
) {

    private companion object {
        const val TAG = "McSdkVideoRotator"
        const val EGL_RECORDABLE_ANDROID = 0x3142
        const val SETUP_WAIT_MS = 3000L
        const val STOP_WAIT_MS = 1000L

        const val VERTEX_SHADER = """
            attribute vec2 aPos;
            uniform mat2 uQuad;
            uniform mat4 uTexture;
            varying vec2 vTexture;
            void main() {
                gl_Position = vec4(uQuad * aPos, 0.0, 1.0);
                vTexture = (uTexture * vec4(aPos * 0.5 + 0.5, 0.0, 1.0)).xy;
            }"""

        const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            varying vec2 vTexture;
            uniform samplerExternalOES uCamera;
            void main() {
                gl_FragColor = texture2D(uCamera, vTexture);
            }"""
    }

    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var previewSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var config: EGLConfig? = null

    private var texture: SurfaceTexture? = null
    private var cameraSurface: Surface? = null
    private var program = 0

    // Held for as long as GL draws from it: glVertexAttribPointer keeps only the
    // address, so once this is collected every frame comes out as a broken triangle.
    private var quad: FloatBuffer? = null
    private var uQuad = 0
    private var uTexture = 0

    private val textureMatrix = FloatArray(16)
    private val quadMatrix = FloatArray(4)

    /** @return the Surface for the camera to draw into; @throws on any GL failure */
    fun start(encoderSurface: Surface): Surface {
        val handlerThread = HandlerThread("McSdkVideoRotator").apply { start() }
        thread = handlerThread
        val h = Handler(handlerThread.looper)
        handler = h

        val ready = CountDownLatch(1)
        var failure: Exception? = null
        h.post {
            try {
                setUp(encoderSurface, h)
            } catch (e: Exception) {
                failure = e
            }
            ready.countDown()
        }
        if (!ready.await(SETUP_WAIT_MS, TimeUnit.MILLISECONDS)) {
            throw IllegalStateException("the video rotator did not start")
        }
        failure?.let { throw it }
        return cameraSurface ?: throw IllegalStateException("no camera surface")
    }

    /**
     * Shows the picture in [surface] as well, or stops showing it. Waits until that
     * has happened, because a view's Surface is gone once its callback returns.
     */
    fun setPreview(surface: Surface?) {
        val h = handler ?: return
        val done = CountDownLatch(1)
        h.post {
            replacePreview(surface)
            done.countDown()
        }
        if (!done.await(STOP_WAIT_MS, TimeUnit.MILLISECONDS)) Log.w(TAG, "preview change timed out")
    }

    private fun replacePreview(surface: Surface?) {
        if (context == EGL14.EGL_NO_CONTEXT) return
        dropPreview()
        if (surface == null) return
        try {
            val created = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
            if (created == EGL14.EGL_NO_SURFACE) {
                Log.w(TAG, "preview: eglCreateWindowSurface failed: ${EGL14.eglGetError()}")
                return
            }
            previewSurface = created
            // Swapping must never wait for the display: the encoder's next frame shares
            // this thread, and what is being sent matters more than what is shown.
            if (EGL14.eglMakeCurrent(display, created, created, context)) EGL14.eglSwapInterval(display, 0)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "preview: ${e.message}")
        } finally {
            EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)
        }
    }

    private fun dropPreview() {
        if (previewSurface == EGL14.EGL_NO_SURFACE) return
        EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)
        EGL14.eglDestroySurface(display, previewSurface)
        previewSurface = EGL14.EGL_NO_SURFACE
    }

    private fun setUp(encoderSurface: Surface, h: Handler) {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }

        val attributes = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            // Without this the encoder's Surface refuses the frames on some devices.
            EGL_RECORDABLE_ANDROID, 1,
            EGL14.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val found = IntArray(1)
        check(EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, found, 0) && found[0] > 0) {
            "no EGL config"
        }
        config = configs[0]
        context = EGL14.eglCreateContext(
            display, configs[0], EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0,
        )
        check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
        eglSurface = EGL14.eglCreateWindowSurface(display, configs[0], encoderSurface, intArrayOf(EGL14.EGL_NONE), 0)
        check(eglSurface != EGL14.EGL_NO_SURFACE) { "eglCreateWindowSurface failed" }
        check(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)) { "eglMakeCurrent failed" }

        program = buildProgram()
        GLES20.glUseProgram(program)
        uQuad = GLES20.glGetUniformLocation(program, "uQuad")
        uTexture = GLES20.glGetUniformLocation(program, "uTexture")

        val vertices = ByteBuffer.allocateDirect(8 * Float.SIZE_BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer()
        vertices.put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)).position(0)
        quad = vertices
        val aPos = GLES20.glGetAttribLocation(program, "aPos")
        GLES20.glEnableVertexAttribArray(aPos)
        GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, vertices)

        val names = IntArray(1)
        GLES20.glGenTextures(1, names, 0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, names[0])
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        val st = SurfaceTexture(names[0])
        st.setDefaultBufferSize(cameraWidth, cameraHeight)
        st.setOnFrameAvailableListener({ draw(it) }, h)
        texture = st
        cameraSurface = Surface(st)
        Log.d(TAG, "start: camera ${cameraWidth}x$cameraHeight → ${outWidth}x$outHeight, sensor=$sensorOrientation°")
    }

    private fun buildProgram(): Int {
        fun compile(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            val ok = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, ok, 0)
            check(ok[0] != 0) { "shader: ${GLES20.glGetShaderInfoLog(shader)}" }
            return shader
        }
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, compile(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER))
        GLES20.glAttachShader(p, compile(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER))
        GLES20.glLinkProgram(p)
        val ok = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
        check(ok[0] != 0) { "program: ${GLES20.glGetProgramInfoLog(p)}" }
        return p
    }

    /** One camera frame in, one turned frame out to the encoder and one to the preview. */
    private fun draw(st: SurfaceTexture) {
        if (texture !== st) return
        st.updateTexImage()
        st.getTransformMatrix(textureMatrix)

        // Column 0 row 0 against column 1 row 0: whether x came from the buffer's y.
        val swapsAxes = abs(textureMatrix[0]) < abs(textureMatrix[4])
        drawQuad(swapsAxes, deviceAngle(), outWidth, outHeight, cover = false)
        EGLExt.eglPresentationTimeANDROID(display, eglSurface, st.timestamp)
        EGL14.eglSwapBuffers(display, eglSurface)

        if (previewSurface != EGL14.EGL_NO_SURFACE) drawPreview(swapsAxes)
    }

    private fun drawPreview(swapsAxes: Boolean) {
        if (!EGL14.eglMakeCurrent(display, previewSurface, previewSurface, context)) {
            Log.w(TAG, "preview: eglMakeCurrent failed: ${EGL14.eglGetError()}")
            dropPreview()
            return
        }
        val size = IntArray(2)
        EGL14.eglQuerySurface(display, previewSurface, EGL14.EGL_WIDTH, size, 0)
        EGL14.eglQuerySurface(display, previewSurface, EGL14.EGL_HEIGHT, size, 1)
        if (size[0] > 0 && size[1] > 0) {
            drawQuad(swapsAxes, displayAngle(), size[0], size[1], cover = true)
            // Fails when the view went away under us. Losing a preview frame is harmless,
            // and the view's own callback is on its way to clear this up.
            EGL14.eglSwapBuffers(display, previewSurface)
        }
        EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)
    }

    private fun drawQuad(swapsAxes: Boolean, angle: Int, width: Int, height: Int, cover: Boolean) {
        val (rotation, contentWidth, contentHeight) = VideoRotation.picture(
            cameraWidth, cameraHeight, sensorOrientation, angle, swapsAxes,
        )
        VideoRotation.quadMatrix(contentWidth, contentHeight, width, height, rotation, quadMatrix, cover)

        GLES20.glViewport(0, 0, width, height)
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        GLES20.glUniformMatrix2fv(uQuad, 1, false, quadMatrix, 0)
        GLES20.glUniformMatrix4fv(uTexture, 1, false, textureMatrix, 0)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }

    /** Stop the camera first. Safe when never started. */
    fun stop() {
        val h = handler
        if (h != null) {
            val done = CountDownLatch(1)
            h.post {
                release()
                done.countDown()
            }
            if (!done.await(STOP_WAIT_MS, TimeUnit.MILLISECONDS)) Log.w(TAG, "release timed out")
        }
        handler = null
        thread?.quitSafely()
        thread = null
    }

    private fun release() {
        texture?.setOnFrameAvailableListener(null)
        cameraSurface?.release()
        cameraSurface = null
        texture?.release()
        texture = null
        if (display != EGL14.EGL_NO_DISPLAY) {
            dropPreview()
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            if (eglSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, eglSurface)
            if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
            EGL14.eglTerminate(display)
        }
        eglSurface = EGL14.EGL_NO_SURFACE
        context = EGL14.EGL_NO_CONTEXT
        display = EGL14.EGL_NO_DISPLAY
        quad = null
    }
}
