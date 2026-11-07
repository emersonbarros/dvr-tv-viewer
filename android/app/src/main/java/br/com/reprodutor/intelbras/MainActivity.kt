package br.com.reprodutor.intelbras

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Camera grid (snapshot tiles; live video only in fullscreen). D-pad moves between cameras, OK opens fullscreen,
 * MENU (or long-press OK) opens settings. Pressing left/right past the
 * edge of the grid switches page when there are more cameras than tiles.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var settings: Settings
    private lateinit var grid: LinearLayout
    private lateinit var pageLabel: TextView
    private val cells = mutableListOf<SnapshotCell>()
    private val cellViews = mutableListOf<View>()
    private var page = 0
    private var columns = 0

    private val perPage get() = columns * columns
    private val pageCount get() = (settings.channels + perPage - 1) / perPage

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)
        settings = Settings(this)
        grid = findViewById(R.id.grid)
        pageLabel = findViewById(R.id.pageLabel)
    }

    override fun onStart() {
        super.onStart()
        if (!settings.isConfigured) {
            startActivity(Intent(this, SettingsActivity::class.java))
            return
        }
        if (columns != settings.columns) buildGrid()
        if (page >= pageCount) page = 0
        showPage()
    }

    override fun onStop() {
        super.onStop()
        cells.forEach { it.stop() }
    }

    private fun buildGrid() {
        cells.forEach { it.stop() }
        cells.clear()
        cellViews.clear()
        grid.removeAllViews()
        columns = settings.columns
        val inflater = LayoutInflater.from(this)
        repeat(columns) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            grid.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            repeat(columns) {
                val v = inflater.inflate(R.layout.snapshot_cell, row, false)
                row.addView(v, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
                val cell = SnapshotCell(v, settings)
                v.setOnClickListener { if (cell.channel > 0) openFullscreen(cell.channel) }
                v.setOnLongClickListener { openSettings(); true }
                cells += cell
                cellViews += v
            }
        }
    }

    private fun showPage() {
        val first = page * perPage + 1
        cells.forEachIndexed { i, cell ->
            val ch = first + i
            if (ch <= settings.channels) {
                cell.start(ch)
                cellViews[i].isFocusable = true
            } else {
                cell.clear()
                cellViews[i].isFocusable = false
            }
        }
        if (pageCount > 1) {
            pageLabel.text = "Página ${page + 1}/$pageCount  ◀ ▶"
            pageLabel.visibility = View.VISIBLE
        } else {
            pageLabel.visibility = View.GONE
        }
        if (currentFocus == null || currentFocus?.isFocusable == false) cellViews.firstOrNull()?.requestFocus()
    }

    private fun openFullscreen(channel: Int) {
        startActivity(Intent(this, FullscreenActivity::class.java).putExtra(FullscreenActivity.EXTRA_CHANNEL, channel))
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    // Reaches here only when focus could not move further (edge of the grid).
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_DOWN ->
                if (pageCount > 1) { page = (page + 1) % pageCount; showPage(); focusRow(edgeLeft = true); return true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_UP ->
                if (pageCount > 1) { page = (page - 1 + pageCount) % pageCount; showPage(); focusRow(edgeLeft = false); return true }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> { openSettings(); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    /** After a page change, keep focus on the same row at the opposite edge. */
    private fun focusRow(edgeLeft: Boolean) {
        val idx = cellViews.indexOf(currentFocus).coerceAtLeast(0)
        val row = idx / columns
        val target = (if (edgeLeft) (row * columns until (row + 1) * columns) else ((row + 1) * columns - 1 downTo row * columns))
            .firstOrNull { cellViews[it].isFocusable } ?: 0
        cellViews[target].requestFocus()
    }
}
