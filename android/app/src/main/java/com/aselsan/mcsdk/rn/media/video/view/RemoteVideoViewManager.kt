package com.aselsan.mcsdk.rn.media.video.view

import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Where a view and the video code drawing into it meet. They live in different
 * worlds: React Native creates and destroys the view as screens come and go, on its
 * own schedule, and the video may start before or after. Process-wide, like
 * CallAudioRouter, so a JS reload's new module finds the same one.
 *
 * Everything runs on the main thread except the video code's calls in and out, hence
 * the lock.
 */
open class VideoSurfaceSlot {

    private var current: Surface? = null
    private var listener: ((Surface?) -> Unit)? = null

    /** Calls [l] with the Surface now, if there is one, and whenever it changes. */
    @Synchronized
    fun setListener(l: ((Surface?) -> Unit)?) {
        listener = l
        l?.invoke(current)
    }

    @Synchronized
    fun onCreated(surface: Surface) {
        current = surface
        listener?.invoke(surface)
    }

    /**
     * Ignored unless [surface] is the current one: a screen being replaced can
     * destroy its old view after the new one has already appeared.
     */
    @Synchronized
    fun onDestroyed(surface: Surface) {
        if (current !== surface) return
        current = null
        listener?.invoke(null)
    }
}

/** The decoder's view of the far end. */
object RemoteVideoSurface : VideoSurfaceSlot()

/** The camera's own picture, as the sender draws it. */
object LocalVideoSurface : VideoSurfaceSlot()

/**
 * A SurfaceView because the frames then reach the screen through the compositor,
 * without passing through the app's own drawing at all.
 */
private fun surfaceViewFor(context: ThemedReactContext, slot: VideoSurfaceSlot): SurfaceView =
    SurfaceView(context).apply {
        holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                slot.onCreated(holder.surface)
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

            // The Surface is gone when this returns, so whatever draws into it has to
            // have let go of it by then; the listener does that synchronously.
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                slot.onDestroyed(holder.surface)
            }
        })
    }

/** The view the decoder draws into. */
class RemoteVideoViewManager : SimpleViewManager<SurfaceView>() {

    override fun getName() = "McSdkVideoView"

    override fun createViewInstance(context: ThemedReactContext): SurfaceView =
        surfaceViewFor(context, RemoteVideoSurface)
}

/** The view the sender shows the camera in. */
class LocalVideoViewManager : SimpleViewManager<SurfaceView>() {

    override fun getName() = "McSdkLocalVideoView"

    /**
     * Over the remote view: on a video call this one is the small picture in the
     * corner, and two SurfaceViews otherwise stack in no particular order. A media
     * overlay is still under the window, so React Native's own views draw over it.
     */
    override fun createViewInstance(context: ThemedReactContext): SurfaceView =
        surfaceViewFor(context, LocalVideoSurface).apply { setZOrderMediaOverlay(true) }
}
