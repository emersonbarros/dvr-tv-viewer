// One live camera in a <video> element: RTSP-over-WebSocket -> fMP4 -> MediaSource.
// Reconnects automatically; if the preferred stream fails (codec unsupported,
// sub stream disabled...), alternates between main and sub stream.
(function () {
  'use strict';

  var MAX_LATENCY = 3;     // seconds behind live edge before jumping forward
  var KEEP_BUFFER = 10;    // seconds of history kept in the SourceBuffer

  function CameraPlayer(video, statusEl, settings) {
    this.video = video;
    this.statusEl = statusEl;
    this.settings = settings;
    this.channel = 0;
    this.failures = 0;
    this.timer = null;
  }

  CameraPlayer.prototype.setStatus = function (text) {
    this.statusEl.textContent = text || '';
    this.statusEl.style.display = text ? '' : 'none';
  };

  CameraPlayer.prototype.start = function (channel, preferMain, delayMs) {
    var self = this;
    this.stop();
    this.channel = channel;
    this.preferMain = !!preferMain;
    this.failures = 0;
    if (delayMs) {
      this.setStatus('Conectando…');
      this.timer = setTimeout(function () { if (self.channel === channel) self.connect(); }, delayMs);
    } else {
      this.connect();
    }
  };

  CameraPlayer.prototype.subtype = function () {
    var preferred = this.preferMain ? 0 : 1;
    return this.failures % 2 === 0 ? preferred : 1 - preferred;
  };

  CameraPlayer.prototype.connect = function () {
    var self = this, s = this.settings, video = this.video;
    var gen = this.gen = (this.gen || 0) + 1;
    this.setStatus('Conectando…');
    this.queue = [];
    this.sb = null;

    var ms = this.ms = new MediaSource();
    video.src = URL.createObjectURL(ms);
    video.muted = true;

    var wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    var rtspUrl = 'rtsp://' + s.host + ':' + s.rtspPort + '/cam/realmonitor?channel=' + this.channel +
      '&subtype=' + this.subtype();

    var remux = null;
    this.client = new RtspWsClient({
      wsUrl: wsProto + '://' + s.host + ':' + s.httpPort + '/rtspoverwebsocket',
      rtspUrl: rtspUrl,
      user: s.user,
      password: s.password,
      onMedia: function (media) {
        if (gen !== self.gen) return;
        self.setStatus('Carregando…');
        remux = new Remuxer(media, function (mime, init) {
          if (!window.MediaSource || !MediaSource.isTypeSupported(mime)) {
            return self.retry('Codec não suportado na TV (' + media.codec + ')');
          }
          self.whenOpen(function () {
            try {
              self.sb = ms.addSourceBuffer(mime);
            } catch (e) {
              return self.retry('Erro ao iniciar vídeo');
            }
            self.sb.addEventListener('updateend', function () { self.pump(); });
            self.queue.unshift(init);
            self.pump();
          });
        }, function (seg) {
          self.queue.push(seg);
          self.pump();
        });
      },
      onAccessUnit: function (nals, ts) { if (remux && gen === self.gen) remux.push(nals, ts); },
      onError: function (msg) { if (gen === self.gen) self.retry(msg); }
    });
    this.client.connect();

    this.watchdog = setInterval(function () { self.check(); }, 1000);
    this.lastProgress = Date.now();
    this.lastTime = -1;
  };

  CameraPlayer.prototype.whenOpen = function (fn) {
    if (this.ms.readyState === 'open') return fn();
    var ms = this.ms;
    ms.addEventListener('sourceopen', function once() {
      ms.removeEventListener('sourceopen', once);
      fn();
    });
  };

  CameraPlayer.prototype.pump = function () {
    var sb = this.sb;
    if (!sb || sb.updating || !this.queue.length || this.ms.readyState !== 'open') return;
    try {
      sb.appendBuffer(this.queue.shift());
    } catch (e) {
      if (e.name === 'QuotaExceededError') this.trim(true);
      else this.retry('Erro de decodificação');
    }
  };

  CameraPlayer.prototype.trim = function (force) {
    var sb = this.sb, v = this.video;
    if (!sb || sb.updating || !sb.buffered.length) return;
    var start = sb.buffered.start(0), cut = v.currentTime - (force ? 1 : KEEP_BUFFER);
    if (cut - start > 1) { try { sb.remove(start, cut); } catch (e) { /* ignore */ } }
  };

  // Runs every second: keep latency low, detect stalls.
  // Seeking is expensive (decoder restarts from the previous keyframe), so small
  // drift is absorbed by playing slightly faster; only large drift triggers a seek.
  CameraPlayer.prototype.check = function () {
    var v = this.video, sb = this.sb;
    if (sb && sb.buffered.length) {
      var end = sb.buffered.end(sb.buffered.length - 1);
      var start = sb.buffered.start(0);
      var lag = end - v.currentTime;
      if (v.currentTime < start || lag > MAX_LATENCY) v.currentTime = Math.max(start, end - 0.5);
      else if (v.playbackRate !== undefined) v.playbackRate = lag > 1 ? 1.1 : 1;
      if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      this.trim(false);
      if (v.currentTime !== this.lastTime && v.readyState >= 2) {
        this.lastTime = v.currentTime;
        this.lastProgress = Date.now();
        if (this.statusEl.textContent) { this.setStatus(''); this.failures = 0; }
      }
    }
    if (Date.now() - this.lastProgress > 15000) this.retry('Sem imagem');
  };

  CameraPlayer.prototype.retry = function (msg) {
    var self = this, ch = this.channel;
    this.failures++;
    this.teardown();
    this.setStatus(msg + '\nReconectando…');
    // Exponential backoff with jitter so several tiles don't hammer the DVR at once.
    var delay = Math.min(30000, 3000 * Math.pow(2, Math.min(this.failures - 1, 4))) + Math.random() * 2000;
    this.timer = setTimeout(function () { if (self.channel === ch) self.connect(); }, delay);
  };

  CameraPlayer.prototype.teardown = function () {
    this.gen = (this.gen || 0) + 1;
    clearInterval(this.watchdog);
    clearTimeout(this.timer);
    if (this.client) { this.client.close(); this.client = null; }
    this.sb = null;
    this.queue = [];
    if (this.ms) {
      try { if (this.ms.readyState === 'open') this.ms.endOfStream(); } catch (e) { /* ignore */ }
      this.ms = null;
    }
    if (this.video.src) {
      URL.revokeObjectURL(this.video.src);
      this.video.removeAttribute('src');
      try { this.video.load(); } catch (e2) { /* ignore */ }
    }
  };

  CameraPlayer.prototype.stop = function () {
    this.teardown();
    this.channel = 0;
    this.setStatus('');
  };

  window.CameraPlayer = CameraPlayer;
})();
