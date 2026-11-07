package br.com.reprodutor.intelbras

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        val s = Settings(this)
        val host = findViewById<EditText>(R.id.host).apply { setText(s.host) }
        val port = findViewById<EditText>(R.id.port).apply { setText(s.port.toString()) }
        val user = findViewById<EditText>(R.id.user).apply { setText(s.user) }
        val password = findViewById<EditText>(R.id.password).apply { setText(s.password) }
        val channels = findViewById<EditText>(R.id.channels).apply { setText(s.channels.toString()) }
        val layout = findViewById<RadioGroup>(R.id.layout).apply {
            check(if (s.columns == 3) R.id.layout3 else R.id.layout2)
        }
        findViewById<Button>(R.id.save).setOnClickListener {
            if (host.text.isBlank() || user.text.isBlank()) {
                Toast.makeText(this, "Informe IP e usuário", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            s.host = host.text.toString().trim()
            s.port = port.text.toString().toIntOrNull() ?: 554
            s.user = user.text.toString().trim()
            s.password = password.text.toString()
            s.channels = (channels.text.toString().toIntOrNull() ?: 8).coerceIn(1, 64)
            s.columns = if (layout.checkedRadioButtonId == R.id.layout3) 3 else 2
            finish()
        }
    }
}
