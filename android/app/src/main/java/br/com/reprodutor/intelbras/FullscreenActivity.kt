package br.com.reprodutor.intelbras

import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity

/** Single camera, main stream. Left/right switch camera, BACK returns to the grid. */
class FullscreenActivity : AppCompatActivity() {
    companion object { const val EXTRA_CHANNEL = "channel" }

    private lateinit var settings: Settings
    private lateinit var cell: CameraCell
    private var channel = 1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_fullscreen)
        settings = Settings(this)
        channel = savedInstanceState?.getInt(EXTRA_CHANNEL) ?: intent.getIntExtra(EXTRA_CHANNEL, 1)
        val root = findViewById<View>(R.id.cell)
        root.findViewById<View>(R.id.focusBorder).visibility = View.GONE
        root.isFocusable = false
        cell = CameraCell(root, settings, preferMainStream = true)
    }

    override fun onStart() {
        super.onStart()
        cell.start(channel)
    }

    override fun onStop() {
        super.onStop()
        cell.stop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(EXTRA_CHANNEL, channel)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val n = settings.channels
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_CHANNEL_UP -> { channel = channel % n + 1; cell.start(channel); return true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_CHANNEL_DOWN -> { channel = (channel - 2 + n) % n + 1; cell.start(channel); return true }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { finish(); return true }
        }
        return super.onKeyDown(keyCode, event)
    }
}
