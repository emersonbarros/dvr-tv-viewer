package br.com.reprodutor.intelbras

import android.graphics.Rect
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        keepFieldsAboveKeyboard()
        val s = Settings(this)
        val host = findViewById<EditText>(R.id.host).apply { setText(s.host) }
        val httpPort = findViewById<EditText>(R.id.httpPort).apply { setText(s.httpPort.toString()) }
        val port = findViewById<EditText>(R.id.port).apply { setText(s.port.toString()) }
        val user = findViewById<EditText>(R.id.user).apply { setText(s.user) }
        val password = findViewById<EditText>(R.id.password).apply { setText(s.password) }
        val channels = findViewById<EditText>(R.id.channels).apply { setText(s.channels.toString()) }
        val layout = findViewById<RadioGroup>(R.id.layout).apply {
            check(if (s.columns == 3) R.id.layout3 else R.id.layout2)
        }
        val liveGrid = findViewById<CheckBox>(R.id.liveGrid).apply { isChecked = s.liveGrid }
        findViewById<Button>(R.id.save).setOnClickListener {
            if (host.text.isBlank() || user.text.isBlank()) {
                Toast.makeText(this, "Informe IP e usuário", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            s.host = host.text.toString().trim()
            s.httpPort = httpPort.text.toString().toIntOrNull() ?: 80
            s.port = port.text.toString().toIntOrNull() ?: 554
            s.user = user.text.toString().trim()
            s.password = password.text.toString()
            s.channels = (channels.text.toString().toIntOrNull() ?: 8).coerceIn(1, 64)
            s.columns = if (layout.checkedRadioButtonId == R.id.layout3) 3 else 2
            s.liveGrid = liveGrid.isChecked
            finish()
        }
    }

    /**
     * The app theme is fullscreen and targetSdk 35 forces edge-to-edge, so adjustResize alone does
     * not shrink the window when the keyboard opens. Pad the ScrollView by the keyboard/system-bar
     * insets instead and scroll the focused field back into view.
     */
    private fun keepFieldsAboveKeyboard() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val scroll = findViewById<ScrollView>(R.id.settingsScroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            v.post { scrollToFocused(scroll) }
            insets
        }
        // Also when moving between fields while the keyboard stays open.
        scroll.viewTreeObserver.addOnGlobalFocusChangeListener { _, _ -> scroll.post { scrollToFocused(scroll) } }
    }

    private fun scrollToFocused(scroll: ScrollView) {
        val f = currentFocus ?: return
        if (f === scroll) return
        val r = Rect(0, 0, f.width, f.height)
        scroll.offsetDescendantRectToMyCoords(f, r)
        val margin = (24 * resources.displayMetrics.density).toInt()
        val top = scroll.scrollY + scroll.paddingTop
        val bottom = scroll.scrollY + scroll.height - scroll.paddingBottom
        when {
            r.bottom + margin > bottom -> scroll.smoothScrollBy(0, r.bottom + margin - bottom)
            r.top - margin < top -> scroll.smoothScrollBy(0, r.top - margin - top)
        }
    }
}
