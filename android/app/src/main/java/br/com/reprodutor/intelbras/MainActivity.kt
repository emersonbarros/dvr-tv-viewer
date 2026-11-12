package br.com.reprodutor.intelbras

import android.content.Intent
import android.os.Bundle
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Camera grid: snapshot tiles, optionally upgraded to live RTSP sub stream (see [SnapshotCell]). D-pad moves between cameras, OK opens fullscreen,
 * MENU (or long-press OK) opens settings. Pressing left/right past the
 * edge of the grid switches page when there are more cameras than tiles.
 * On touch screens, a horizontal swipe also switches page.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var settings: Settings
    private lateinit var grid: LinearLayout
    private lateinit var pageLabel: TextView
    private val cells = mutableListOf<SnapshotCell>()
    private val cellViews = mutableListOf<View>()
    private var page = 0
    private var columns = 0

    private val swipe by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                if (e1 == null || pageCount <= 1) return false
                val dx = e2.x - e1.x
                val dy = e2.y - e1.y
                val minDistance = 80 * resources.displayMetrics.density
                if (Math.abs(dx) < minDistance || Math.abs(dx) < 1.5f * Math.abs(dy)) return false
                changePage(if (dx < 0) 1 else -1)
                return true
            }
        })
    }

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
                cell.start(ch, liveDelayMs = i * 300L)
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
                if (pageCount > 1) { changePage(1); focusRow(edgeLeft = true); return true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_UP ->
                if (pageCount > 1) { changePage(-1); focusRow(edgeLeft = false); return true }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> { openSettings(); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun changePage(delta: Int) {
        page = (page + delta + pageCount) % pageCount
        showPage()
    }

    /**
     * Watch every touch for a horizontal swipe. When one is recognised, the tile under the finger
     * gets ACTION_CANCEL instead of ACTION_UP so the swipe does not also open fullscreen.
     */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (swipe.onTouchEvent(ev) && ev.actionMasked == MotionEvent.ACTION_UP) {
            val cancel = MotionEvent.obtain(ev).apply { action = MotionEvent.ACTION_CANCEL }
            super.dispatchTouchEvent(cancel)
            cancel.recycle()
            return true
        }
        return super.dispatchTouchEvent(ev)
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
