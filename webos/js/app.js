// UI: camera grid, fullscreen view and settings, driven by the TV remote.
(function () {
  'use strict';

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, BACKSPACE: 8,
    CH_UP: 33, CH_DOWN: 34, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406
  };

  // ---- settings (localStorage, defaults from config.js / config.local.js) ----
  var FIELDS = ['host', 'httpPort', 'rtspPort', 'user', 'password', 'channels', 'columns'];
  var NUMERIC = { httpPort: 1, rtspPort: 1, channels: 1, columns: 1 };

  function loadSettings() {
    var s = {}, saved = {};
    try { saved = JSON.parse(localStorage.getItem('dvr') || '{}'); } catch (e) { /* ignore */ }
    FIELDS.forEach(function (k) {
      s[k] = saved[k] !== undefined && saved[k] !== '' ? saved[k] : window.DVR_DEFAULTS[k];
    });
    return s;
  }

  function saveSettings(s) {
    try { localStorage.setItem('dvr', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  var settings = loadSettings();

  // ---- DOM ----
  var gridEl = document.getElementById('grid');
  var fullEl = document.getElementById('full');
  var pageLabel = document.getElementById('pageLabel');
  var hint = document.getElementById('hint');
  var form = document.getElementById('settings');

  var mode = 'grid'; // grid | full | settings
  var cells = [];    // { el, player, labelEl }
  var page = 0, focus = 0, columns = 0;
  var fullChannel = 1;
  var fullPlayer = new CameraPlayer(fullEl.querySelector('video'), fullEl.querySelector('.status'), settings);

  function perPage() { return columns * columns; }
  function pageCount() { return Math.ceil(settings.channels / perPage()); }

  function buildGrid() {
    cells.forEach(function (c) { c.player.stop(); });
    gridEl.innerHTML = '';
    cells = [];
    columns = settings.columns === 3 ? 3 : 2;
    var size = 100 / columns;
    for (var i = 0; i < columns * columns; i++) {
      var el = document.createElement('div');
      el.className = 'cell';
      el.style.left = (i % columns) * size + '%';
      el.style.top = Math.floor(i / columns) * size + '%';
      el.style.width = size + '%';
      el.style.height = size + '%';
      el.innerHTML = '<img alt=""><div class="label"></div><div class="status"></div>';
      gridEl.appendChild(el);
      (function (index) {
        el.addEventListener('click', function () { focus = index; openFull(); });
      })(i);
      cells.push({
        el: el,
        labelEl: el.querySelector('.label'),
        player: new SnapshotTile(el.querySelector('img'), el.querySelector('.status'), settings)
      });
    }
  }

  function channelAt(i) { return page * perPage() + i + 1; }

  function showGrid() {
    mode = 'grid';
    form.classList.add('hidden');
    fullEl.classList.add('hidden');
    gridEl.classList.remove('hidden');
    if (columns !== (settings.columns === 3 ? 3 : 2)) buildGrid();
    if (page >= pageCount()) page = 0;
    cells.forEach(function (c, i) {
      var ch = channelAt(i);
      if (ch <= settings.channels) {
        c.el.classList.remove('empty');
        c.labelEl.textContent = 'CAM ' + ch;
        c.labelEl.style.display = '';
        c.player.start(ch);
      } else {
        c.el.classList.add('empty');
        c.labelEl.style.display = 'none';
        c.player.stop();
      }
    });
    if (channelAt(focus) > settings.channels) focus = 0;
    updateFocus();
    if (pageCount() > 1) {
      pageLabel.textContent = 'Página ' + (page + 1) + '/' + pageCount() + '  ◀ ▶';
      pageLabel.classList.remove('hidden');
    } else {
      pageLabel.classList.add('hidden');
    }
    flashHint();
  }

  function stopGrid() { cells.forEach(function (c) { c.player.stop(); }); }

  function updateFocus() {
    cells.forEach(function (c, i) { c.el.classList.toggle('focused', i === focus); });
  }

  var hintTimer;
  function flashHint() {
    hint.classList.remove('fade', 'hidden');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.classList.add('fade'); }, 5000);
  }

  function changePage(delta) {
    if (pageCount() <= 1) return;
    page = (page + delta + pageCount()) % pageCount();
    var row = Math.floor(focus / columns);
    focus = row * columns + (delta > 0 ? 0 : columns - 1);
    while (focus > 0 && channelAt(focus) > settings.channels) focus--;
    showGrid();
  }

  function moveFocus(dx, dy) {
    var x = focus % columns, y = Math.floor(focus / columns);
    var nx = x + dx, ny = y + dy;
    if (nx < 0) return changePage(-1);
    if (nx >= columns || (dx > 0 && channelAt(y * columns + nx) > settings.channels)) return changePage(1);
    if (ny < 0 || ny >= columns) return;
    var idx = ny * columns + nx;
    if (channelAt(idx) > settings.channels) return;
    focus = idx;
    updateFocus();
  }

  // ---- fullscreen ----
  function openFull(channel) {
    fullChannel = channel || channelAt(focus);
    if (fullChannel > settings.channels) return;
    stopGrid(); // free decoders: TVs have few hardware decoders
    mode = 'full';
    gridEl.classList.add('hidden');
    pageLabel.classList.add('hidden');
    hint.classList.add('hidden');
    fullEl.classList.remove('hidden');
    fullEl.querySelector('.label').textContent = 'CAM ' + fullChannel;
    fullPlayer.start(fullChannel, true);
  }

  function switchFull(delta) {
    var n = settings.channels;
    fullChannel = ((fullChannel - 1 + delta + n) % n) + 1;
    fullEl.querySelector('.label').textContent = 'CAM ' + fullChannel;
    fullPlayer.start(fullChannel, true);
  }

  function closeFull() {
    fullPlayer.stop();
    // keep the grid focus on the camera we were watching
    page = Math.floor((fullChannel - 1) / perPage());
    focus = (fullChannel - 1) % perPage();
    showGrid();
  }

  // ---- settings ----
  function openSettings() {
    stopGrid();
    fullPlayer.stop();
    mode = 'settings';
    gridEl.classList.add('hidden');
    fullEl.classList.add('hidden');
    pageLabel.classList.add('hidden');
    hint.classList.add('hidden');
    form.classList.remove('hidden');
    FIELDS.forEach(function (k) { form.elements[k].value = settings[k]; });
    form.querySelector('.error').textContent = '';
    form.elements.host.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var s = {};
    FIELDS.forEach(function (k) {
      var v = form.elements[k].value;
      s[k] = NUMERIC[k] ? parseInt(v, 10) : (k === 'password' ? v : v.trim());
    });
    if (!s.host || !s.user) { form.querySelector('.error').textContent = 'Informe IP e usuário'; return; }
    s.httpPort = s.httpPort || 80;
    s.rtspPort = s.rtspPort || 554;
    s.channels = Math.min(Math.max(s.channels || 8, 1), 64);
    s.columns = s.columns === 3 ? 3 : 2;
    for (var k in s) settings[k] = s[k]; // players hold a reference to this object
    saveSettings(settings);
    if (document.activeElement) document.activeElement.blur();
    showGrid();
  });

  function settingsKey(e) {
    var els = Array.prototype.slice.call(form.querySelectorAll('input, select, button'));
    var i = els.indexOf(document.activeElement);
    if (e.keyCode === KEY.DOWN || (e.keyCode === KEY.OK && els[i] && els[i].tagName === 'INPUT')) {
      if (e.keyCode === KEY.OK && document.activeElement) document.activeElement.blur(); // close keyboard
      els[Math.min(i + 1, els.length - 1)].focus();
      e.preventDefault();
    } else if (e.keyCode === KEY.UP) {
      els[Math.max(i - 1, 0)].focus();
      e.preventDefault();
    } else if (e.keyCode === KEY.BACK || e.keyCode === KEY.ESC) {
      if (settings.user) showGrid();
      e.preventDefault();
    }
  }

  // ---- remote control ----
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (mode === 'settings') return settingsKey(e);
    if (k === KEY.RED || k === KEY.GREEN) { openSettings(); e.preventDefault(); return; }

    if (mode === 'full') {
      if (k === KEY.LEFT || k === KEY.CH_DOWN) switchFull(-1);
      else if (k === KEY.RIGHT || k === KEY.CH_UP) switchFull(1);
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.OK || k === KEY.BACKSPACE) closeFull();
      else return;
      e.preventDefault();
      return;
    }

    flashHint();
    switch (k) {
      case KEY.LEFT: moveFocus(-1, 0); break;
      case KEY.RIGHT: moveFocus(1, 0); break;
      case KEY.UP: moveFocus(0, -1); break;
      case KEY.DOWN: moveFocus(0, 1); break;
      case KEY.CH_UP: changePage(1); break;
      case KEY.CH_DOWN: changePage(-1); break;
      case KEY.OK: openFull(); break;
      case KEY.BACK:
        stopGrid();
        if (window.webOS && webOS.platformBack) webOS.platformBack(); else window.close();
        break;
      default: return;
    }
    e.preventDefault();
  });

  // Pause streams when the app goes to background (webOS fires visibilitychange).
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopGrid(); fullPlayer.stop(); }
    else if (mode === 'grid') showGrid();
    else if (mode === 'full') openFull(fullChannel);
  });

  // ---- start ----
  window.APP = { stop: function () { stopGrid(); fullPlayer.stop(); }, settings: settings, CameraPlayer: CameraPlayer };
  if (!settings.user) openSettings(); else showGrid();
})();
