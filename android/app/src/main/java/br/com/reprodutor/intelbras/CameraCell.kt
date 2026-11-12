package br.com.reprodutor.intelbras

import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.rtsp.RtspMediaSource
import androidx.media3.ui.PlayerView

/**
 * One camera tile: owns an ExoPlayer playing an RTSP stream, shows status text,
 * and reconnects automatically on errors.
 */
@OptIn(UnstableApi::class)
class CameraCell(
    private val root: View,
    private val settings: Settings,
    private val preferMainStream: Boolean,
) {
    private val playerView: PlayerView = root.findViewById(R.id.playerView)
    private val status: TextView = root.findViewById(R.id.status)
    private val label: TextView = root.findViewById(R.id.label)
    private val focusBorder: View = root.findViewById(R.id.focusBorder)
    private val handler = Handler(Looper.getMainLooper())

    private var player: ExoPlayer? = null
    var channel: Int = 0
        private set
    private var failures = 0

    init {
        root.setOnFocusChangeListener { _, hasFocus ->
            focusBorder.visibility = if (hasFocus) View.VISIBLE else View.INVISIBLE
        }
    }

    fun start(channel: Int) {
        stop()
        this.channel = channel
        failures = 0
        label.text = "CAM $channel"
        label.visibility = View.VISIBLE
        connect()
    }

    /** Shows an empty tile (used to fill unused grid slots). */
    fun clear() {
        stop()
        channel = 0
        label.visibility = View.GONE
        status.text = ""
    }

    private fun currentSubtype(): Int {
        // Grid uses the sub stream (lighter); fullscreen uses the main stream.
        // If the preferred stream keeps failing (e.g. sub stream disabled on the DVR), alternate.
        val preferred = if (preferMainStream) 0 else 1
        return if (failures % 2 == 0) preferred else 1 - preferred
    }

    private fun connect() {
        status.text = "Conectando…"
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(500, 2000, 250, 250)
            .build()
        val p = ExoPlayer.Builder(root.context, softwareFirstRenderers(root.context))
            .setLoadControl(loadControl).build()
        if (!preferMainStream) p.volume = 0f
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_READY -> { status.text = ""; failures = 0 }
                    Player.STATE_BUFFERING -> if (status.text.isEmpty()) status.text = "Carregando…"
                    Player.STATE_ENDED -> scheduleReconnect("Stream encerrado")
                    else -> Unit
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                failures++
                scheduleReconnect("Sem sinal (${error.errorCodeName})")
            }
        })
        val source = RtspMediaSource.Factory()
            .setForceUseRtpTcp(true)
            .setTimeoutMs(8000)
            .createMediaSource(MediaItem.fromUri(settings.rtspUrl(channel, currentSubtype())))
        p.setMediaSource(source)
        p.playWhenReady = true
        p.prepare()
        playerView.player = p
        player = p
    }

    private fun scheduleReconnect(message: String) {
        status.text = "$message\nReconectando…"
        releasePlayer()
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ if (channel > 0) connect() }, 3000)
    }

    private fun releasePlayer() {
        playerView.player = null
        player?.release()
        player = null
    }

    fun stop() {
        handler.removeCallbacksAndMessages(null)
        releasePlayer()
    }
}

/**
 * Prefer Android's software decoders (OMX.google.*) over the hardware ones. The MediaTek
 * hardware decoders on the Sony BRAVIA (MT5891) render the DVR's RTSP streams as
 * green/magenta garbage, while the software decoders handle them correctly.
 */
@OptIn(UnstableApi::class)
internal fun softwareFirstRenderers(context: android.content.Context) =
    DefaultRenderersFactory(context).setMediaCodecSelector { mime, secure, tunneling ->
        MediaCodecSelector.DEFAULT.getDecoderInfos(mime, secure, tunneling)
            .sortedBy { if (it.softwareOnly) 0 else 1 }
    }
