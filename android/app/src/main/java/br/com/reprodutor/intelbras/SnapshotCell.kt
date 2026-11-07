package br.com.reprodutor.intelbras

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.random.Random

/**
 * Grid tile showing periodically refreshed JPEG snapshots from the DVR
 * (/cgi-bin/snapshot.cgi with HTTP Digest auth). Many TVs expose a single
 * hardware video decoder, so live video is reserved for the fullscreen view.
 */
class SnapshotCell(
    private val root: View,
    private val settings: Settings,
) {
    private val image: ImageView = root.findViewById(R.id.image)
    private val status: TextView = root.findViewById(R.id.status)
    private val label: TextView = root.findViewById(R.id.label)
    private val focusBorder: View = root.findViewById(R.id.focusBorder)
    private val handler = Handler(Looper.getMainLooper())

    var channel: Int = 0
        private set
    private var generation = 0
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
        status.text = "Conectando…"
        load(generation)
    }

    fun clear() {
        stop()
        label.visibility = View.GONE
        status.text = ""
    }

    fun stop() {
        generation++
        channel = 0
        handler.removeCallbacksAndMessages(null)
        image.setImageDrawable(null)
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
