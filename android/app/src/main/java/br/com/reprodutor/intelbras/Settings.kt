package br.com.reprodutor.intelbras

import android.content.Context
import android.net.Uri

/** Persistent DVR connection settings. Defaults come from local.properties via BuildConfig. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("dvr", Context.MODE_PRIVATE)

    var host: String
        get() = prefs.getString("host", BuildConfig.DEFAULT_HOST)!!
        set(v) = prefs.edit().putString("host", v).apply()
    var port: Int
        get() = prefs.getInt("port", BuildConfig.DEFAULT_PORT.toIntOrNull() ?: 554)
        set(v) = prefs.edit().putInt("port", v).apply()
    var user: String
        get() = prefs.getString("user", BuildConfig.DEFAULT_USER)!!
        set(v) = prefs.edit().putString("user", v).apply()
    var password: String
        get() = prefs.getString("password", BuildConfig.DEFAULT_PASSWORD)!!
        set(v) = prefs.edit().putString("password", v).apply()
    var channels: Int
        get() = prefs.getInt("channels", 8)
        set(v) = prefs.edit().putInt("channels", v).apply()
    /** Grid columns: 2 (2x2) or 3 (3x3). */
    var columns: Int
        get() = prefs.getInt("columns", 2)
        set(v) = prefs.edit().putInt("columns", v).apply()

    val isConfigured: Boolean get() = host.isNotBlank() && user.isNotBlank()

    /**
     * Dahua/Intelbras RTSP URL. subtype 0 = main stream, 1 = sub stream.
     * Media3 reads credentials from the URI's user-info and handles Digest/Basic auth.
     */
    fun rtspUrl(channel: Int, subtype: Int): Uri = Uri.parse(
        "rtsp://${Uri.encode(user)}:${Uri.encode(password)}@$host:$port" +
            "/cam/realmonitor?channel=$channel&subtype=$subtype"
    )
}
