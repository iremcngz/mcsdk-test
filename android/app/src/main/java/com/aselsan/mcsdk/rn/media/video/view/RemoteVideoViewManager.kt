package com.aselsan.mcsdk.rn.media.video.view

import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Where the view and the decoder meet. They live in different worlds: React Native
 * creates and destroys the view as screens come and go, on its own schedule, and the
 * receiver may start before or after. Process-wide, like CallAudioRouter, so a JS
 * reload's new module finds the same one.
 *
 * Everything runs on the main thread except the receiver's calls in and out, hence
 * the lock.
 */
object RemoteVideoSurface {

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

/**
 * The view the decoder draws into. A SurfaceView because the decoded frames then
 * reach the screen through the compositor, without passing through the app's own
 * drawing at all.
 */
class RemoteVideoViewManager : SimpleViewManager<SurfaceView>() {

    override fun getName() = "McSdkVideoView"

    override fun createViewInstance(context: ThemedReactContext): SurfaceView =
        SurfaceView(context).apply {
            holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) {
                    RemoteVideoSurface.onCreated(holder.surface)
                }

                override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

                // The Surface is gone when this returns, so the decoder has to have
                // let go of it by then; the listener stops it synchronously.
                override fun surfaceDestroyed(holder: SurfaceHolder) {
                    RemoteVideoSurface.onDestroyed(holder.surface)
                }
            })
        }
}
