package br.com.reprodutor.intelbras

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.rtsp.RtspMediaSource
import androidx.media3.ui.PlayerView
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.random.Random

/**
 * Grid tile. Always starts with periodically refreshed JPEG snapshots from the DVR
 * (/cgi-bin/snapshot.cgi with HTTP Digest auth). When live grid is enabled it also
 * opens the RTSP sub stream; once the first video frame is rendered the snapshot is
 * hidden and its polling paused. If the stream fails (DVR, network, or the device
 * running out of video decoders) the tile falls back to snapshots and retries later.
 * Many TVs expose a single hardware video decoder, so live grid is off by default there.
 */
@OptIn(UnstableApi::class)
class SnapshotCell(
    private val root: View,
    private val settings: Settings,
) {
    private val image: ImageView = root.findViewById(R.id.image)
    private val playerView: PlayerView = root.findViewById(R.id.playerView)
    private val status: TextView = root.findViewById(R.id.status)
    private val label: TextView = root.findViewById(R.id.label)
    private val focusBorder: View = root.findViewById(R.id.focusBorder)
    private val handler = Handler(Looper.getMainLooper())

    var channel: Int = 0
        private set
    private var generation = 0      // snapshot polling; bumped to pause/stop it
    private var liveGeneration = 0  // live player; bumped to cancel pending reconnects
    private var failures = 0
    private var liveFailures = 0
    private var player: ExoPlayer? = null
    private var showingLive = false

    init {
        root.setOnFocusChangeListener { _, hasFocus ->
            focusBorder.visibility = if (hasFocus) View.VISIBLE else View.INVISIBLE
        }
    }

    /** [liveDelayMs] staggers RTSP connections so the DVR is not hit by all of them at once. */
    fun start(channel: Int, liveDelayMs: Long = 0) {
        stop()
        this.channel = channel
        failures = 0
        liveFailures = 0
        label.text = "CAM $channel"
        label.visibility = View.VISIBLE
        status.text = "Conectando…"
        load(generation)
        if (settings.liveGrid) {
            val gen = liveGeneration
            handler.postDelayed({ if (gen == liveGeneration) connectLive() }, liveDelayMs)
        }
    }

    fun clear() {
        stop()
        label.visibility = View.GONE
        status.text = ""
    }

    fun stop() {
        generation++
        liveGeneration++
        channel = 0
        handler.removeCallbacksAndMessages(null)
        releasePlayer()
        showSnapshot()
        image.setImageDrawable(null)
    }

    private fun connectLive() {
        if (channel <= 0) return
        val gen = liveGeneration
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(500, 2000, 250, 250)
            .build()
        val p = ExoPlayer.Builder(root.context, softwareFirstRenderers(root.context))
            .setLoadControl(loadControl).build()
        p.volume = 0f
        p.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() {
                if (gen != liveGeneration) return
                liveFailures = 0
                showingLive = true
                generation++ // pause snapshot polling while live video is on screen
                image.visibility = View.GONE
                status.text = ""
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && gen == liveGeneration) liveFailed()
            }

            override fun onPlayerError(error: PlaybackException) {
                if (gen == liveGeneration) liveFailed()
            }
        })
        val source = RtspMediaSource.Factory()
            .setForceUseRtpTcp(true)
            .setTimeoutMs(8000)
            .createMediaSource(MediaItem.fromUri(settings.rtspUrl(channel, SUB_STREAM)))
        playerView.visibility = View.VISIBLE // TextureView needs to be laid out to get a surface
        playerView.player = p
        p.setMediaSource(source)
        p.playWhenReady = true
        p.prepare()
        player = p
    }

    /** Back to snapshots, then retry live with backoff (5 s, 10 s, ... up to 60 s). */
    private fun liveFailed() {
        liveFailures++
        liveGeneration++
        releasePlayer()
        if (showingLive) {
            showSnapshot()
            load(generation)
        }
        val gen = liveGeneration
        handler.postDelayed({ if (gen == liveGeneration) connectLive() },
            (5000L * liveFailures).coerceAtMost(60000L))
    }

    private fun showSnapshot() {
        showingLive = false
        image.visibility = View.VISIBLE
        playerView.visibility = View.GONE
    }

    private fun releasePlayer() {
        playerView.player = null
        player?.release()
        player = null
    }

    private fun load(gen: Int) {
        val ch = channel
        val started = System.currentTimeMillis()
        executor.execute {
            if (gen != generation) return@execute
            val result = runCatching { fetch(settings, ch) }
            handler.post {
                if (gen != generation) return@post
                val delay: Long = result.fold(
                    onSuccess = { bmp ->
                        failures = 0
                        image.setImageBitmap(bmp)
                        status.text = ""
                        (MIN_INTERVAL_MS - (System.currentTimeMillis() - started)).coerceAtLeast(0)
                    },
                    onFailure = { e ->
                        failures++
                        status.text = e.message ?: "Erro"
                        (2000L * failures).coerceAtMost(30000L)
                    },
                )
                handler.postDelayed({ if (gen == generation) load(gen) }, delay)
            }
        }
    }

    private class DvrException(message: String) : Exception(message)

    private class Challenge(val realm: String, val nonce: String, val qop: String?, val opaque: String?, val digest: Boolean) {
        var nc = 0
    }

    companion object {
        private const val MIN_INTERVAL_MS = 700L
        private const val SUB_STREAM = 1
        private val executor = Executors.newFixedThreadPool(3) // concurrent requests to the DVR
        @Volatile private var challenge: Challenge? = null

        private fun md5(s: String): String =
            MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

        private fun parseChallenge(header: String): Challenge {
            val p = Regex("(\\w+)=(?:\"([^\"]*)\"|([^,\\s]*))").findAll(header)
                .associate { it.groupValues[1].lowercase() to it.groupValues[2].ifEmpty { it.groupValues[3] } }
            return Challenge(p["realm"] ?: "", p["nonce"] ?: "", p["qop"], p["opaque"],
                header.trim().startsWith("digest", ignoreCase = true))
        }

        @Synchronized
        private fun authorization(s: Settings, uri: String): String? {
            val c = challenge ?: return null
            if (!c.digest) return "Basic " + Base64.encodeToString("${s.user}:${s.password}".toByteArray(), Base64.NO_WRAP)
            val ha1 = md5("${s.user}:${c.realm}:${s.password}")
            val ha2 = md5("GET:$uri")
            val sb = StringBuilder("Digest username=\"${s.user}\", realm=\"${c.realm}\", nonce=\"${c.nonce}\", uri=\"$uri\"")
            if (c.qop != null) {
                c.nc++
                val nc = "%08x".format(c.nc)
                val cnonce = "%08x".format(Random.nextInt())
                sb.append(", qop=auth, nc=$nc, cnonce=\"$cnonce\", response=\"${md5("$ha1:${c.nonce}:$nc:$cnonce:auth:$ha2")}\"")
            } else {
                sb.append(", response=\"${md5("$ha1:${c.nonce}:$ha2")}\"")
            }
            c.opaque?.let { sb.append(", opaque=\"$it\"") }
            return sb.toString()
        }

        private fun fetch(s: Settings, channel: Int, retry: Boolean = true): Bitmap {
            val uri = "/cgi-bin/snapshot.cgi?channel=$channel"
            val conn = URL("http://${s.host}:${s.httpPort}$uri").openConnection() as HttpURLConnection
            try {
                conn.connectTimeout = 5000
                conn.readTimeout = 8000
                authorization(s, uri)?.let { conn.setRequestProperty("Authorization", it) }
                when (val code = conn.responseCode) {
                    200 -> return conn.inputStream.use { BitmapFactory.decodeStream(it) }
                        ?: throw DvrException("Imagem inválida")
                    401 -> {
                        val www = conn.getHeaderField("WWW-Authenticate")
                        if (!retry || www == null) throw DvrException("Usuário ou senha inválidos")
                        challenge = parseChallenge(www)
                        return fetch(s, channel, false)
                    }
                    else -> throw DvrException("Erro $code")
                }
            } catch (e: DvrException) {
                throw e
            } catch (e: Exception) {
                throw DvrException("Sem conexão com o DVR")
            } finally {
                conn.disconnect()
            }
        }
    }
}
