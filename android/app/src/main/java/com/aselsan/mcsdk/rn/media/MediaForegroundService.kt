package com.aselsan.mcsdk.rn.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * MediaForegroundService — keeps the microphone usable while the app is not on
 * screen.
 *
 * Android 11+ cuts background access to the mic. AudioRecord does not fail when
 * that happens: read() keeps returning buffers, they are just full of zeros. A
 * foregroundServiceType="microphone" service is the only thing that holds the
 * grant, so a PTT app cannot work without one.
 *
 * The service runs for as long as the SDK is registered rather than only during
 * a call. A radio is expected to be able to receive at any moment, and Android
 * 14+ refuses to *start* a microphone-typed service from the background — so
 * starting it lazily when a call arrives would be exactly when it is not
 * allowed. It therefore starts once, from the foreground, at registration.
 *
 * It holds no audio state of its own: capture and playback belong to the media
 * pipeline. This only owns the notification and the OS-level grant.
 */
class MediaForegroundService : Service() {

    companion object {
        private const val TAG = "McSdkMediaSvc"

        private const val CHANNEL_ID = "mcx_call_service"
        private const val NOTIFICATION_ID = 0x4D43 // "MC"

        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_CHANNEL_NAME = "channelName"

        @Volatile
        private var running = false

        val isRunning: Boolean get() = running

        /**
         * Starts the service. Must be called while the app is in the foreground
         * on Android 14+, which is why registration (not call setup) is the
         * trigger. Strings are passed in so they can come from the app's i18n
         * rather than being hardcoded here.
         */
        fun start(context: Context, title: String, text: String, channelName: String) {
            val intent = Intent(context, MediaForegroundService::class.java).apply {
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_TEXT, text)
                putExtra(EXTRA_CHANNEL_NAME, channelName)
            }
            // startForegroundService requires startForeground() within ~5s,
            // which onStartCommand does below.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MediaForegroundService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "MCX"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
        val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME) ?: "MCX"

        createChannel(channelName)

        try {
            val notification = buildNotification(title, text)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            running = true
            Log.d(TAG, "foreground service started")
        } catch (e: Exception) {
            // On Android 14+ this throws if we were started from the background.
            // Report it rather than dying: the app stays usable in the
            // foreground, it just will not survive the screen going off.
            running = false
            Log.e(TAG, "startForeground failed: ${e.message}", e)
            stopSelf()
        }

        // The grant must persist; the system may restart us if it kills us.
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        Log.d(TAG, "foreground service stopped")
        super.onDestroy()
    }

    private fun createChannel(channelName: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        // LOW: no sound, no heads-up — this is a status indicator, not an alert.
        val channel = NotificationChannel(
            CHANNEL_ID,
            channelName,
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(title: String, text: String): Notification {
        // Tapping it reopens the app rather than launching a second task.
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = launch?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle(title)
            .setContentText(text)
            // The app icon: a dedicated small icon would need a new drawable,
            // and this keeps the notification consistent with the launcher.
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .setContentIntent(pending)
            .build()
    }
}
