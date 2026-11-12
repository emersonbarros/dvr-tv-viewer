// Grid tiles: periodically refreshed JPEG snapshots from the DVR
// (/cgi-bin/snapshot.cgi, HTTP Digest auth). TVs only have a few hardware video
// decoders, so by default live video is reserved for the fullscreen view; with
// "live grid" enabled, GridTile (gridtile.js) uses snapshots as the fallback.
(function () {
  'use strict';

  var MAX_PARALLEL = 3;   // concurrent snapshot requests to the DVR
  var MIN_INTERVAL = 700; // ms between refreshes of the same tile
  var running = 0, waiting = [];
  var auth = null;        // shared digest challenge { realm, nonce, qop, opaque, nc }

  function acquire(fn) {
    if (running < MAX_PARALLEL) { running++; fn(); } else waiting.push(fn);
  }
  function release() {
    running--;
    var next = waiting.shift();
    if (next) { running++; next(); }
  }

  function parseChallenge(h) {
    var p = {};
    h.replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, function (m, k, v1, v2) { p[k.toLowerCase()] = v1 !== undefined ? v1 : v2; });
    return { digest: /^digest/i.test(h), realm: p.realm, nonce: p.nonce, qop: p.qop, opaque: p.opaque, nc: 0 };
  }

  function authHeader(s, uri) {
    if (!auth.digest) return 'Basic ' + btoa(unescape(encodeURIComponent(s.user + ':' + s.password)));
    var ha1 = md5(s.user + ':' + auth.realm + ':' + s.password), ha2 = md5('GET:' + uri);
    var h = 'Digest username="' + s.user + '", realm="' + auth.realm + '", nonce="' + auth.nonce + '", uri="' + uri + '"';
    if (auth.qop) {
      auth.nc++;
      var nc = ('0000000' + auth.nc.toString(16)).slice(-8), cnonce = Math.random().toString(16).slice(2, 10);
      h += ', qop=auth, nc=' + nc + ', cnonce="' + cnonce + '", response="' +
        md5(ha1 + ':' + auth.nonce + ':' + nc + ':' + cnonce + ':auth:' + ha2) + '"';
    } else {
      h += ', response="' + md5(ha1 + ':' + auth.nonce + ':' + ha2) + '"';
    }
    if (auth.opaque) h += ', opaque="' + auth.opaque + '"';
    return h;
  }

  // GET a snapshot as Blob; retries once with a fresh challenge on 401.
  function fetchSnapshot(s, channel, cb) {
    var uri = '/cgi-bin/snapshot.cgi?channel=' + channel;
    var url = 'http://' + s.host + ':' + s.httpPort + uri;
    function attempt(retry) {
      var x = new XMLHttpRequest();
      x.open('GET', url);
      x.responseType = 'blob';
      x.timeout = 8000;
      if (auth) x.setRequestHeader('Authorization', authHeader(s, uri));
      x.onload = function () {
        if (x.status === 401 && retry) {
          auth = parseChallenge(x.getResponseHeader('WWW-Authenticate') || '');
          return attempt(false);
        }
        if (x.status === 401) return cb('Usuário ou senha inválidos');
        if (x.status !== 200) return cb('Erro ' + x.status);
        cb(null, x.response);
      };
      x.onerror = function () { cb('Sem conexão com o DVR'); };
      x.ontimeout = function () { cb('Tempo esgotado'); };
      x.send();
    }
    attempt(true);
  }

  function SnapshotTile(img, statusEl, settings) {
    this.img = img;
    this.statusEl = statusEl;
    this.settings = settings;
    this.channel = 0;
    this.gen = 0;
    this.url = null;
  }

  SnapshotTile.prototype.setStatus = function (t) {
    this.statusEl.textContent = t || '';
    this.statusEl.style.display = t ? '' : 'none';
  };

  SnapshotTile.prototype.start = function (channel) {
    this.stop();
    this.channel = channel;
    this.failures = 0;
    this.setStatus('Conectando…');
    this.loop(++this.gen);
  };

  SnapshotTile.prototype.loop = function (gen) {
    var self = this;
    acquire(function () {
      if (gen !== self.gen) return release();
      var t0 = Date.now();
      fetchSnapshot(self.settings, self.channel, function (err, blob) {
        release();
        if (gen !== self.gen) return;
        var delay;
        if (err) {
          self.failures++;
          self.setStatus(err);
          delay = Math.min(30000, 2000 * self.failures);
        } else {
          self.failures = 0;
          var url = URL.createObjectURL(blob), old = self.url;
          self.url = url;
          self.img.onload = function () { if (old) URL.revokeObjectURL(old); };
          self.img.src = url;
          self.img.style.visibility = 'visible';
          self.setStatus('');
          delay = Math.max(0, MIN_INTERVAL - (Date.now() - t0));
        }
        self.timer = setTimeout(function () { if (gen === self.gen) self.loop(gen); }, delay);
      });
    });
  };

  /** Stop refreshing but keep the last image (live video is covering the tile). */
  SnapshotTile.prototype.pause = function () {
    this.gen++;
    clearTimeout(this.timer);
  };

  SnapshotTile.prototype.resume = function () {
    if (this.channel) this.loop(++this.gen);
  };

  SnapshotTile.prototype.stop = function () {
    this.gen++;
    clearTimeout(this.timer);
    this.channel = 0;
    this.setStatus('');
    this.img.style.visibility = 'hidden';
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.img.removeAttribute('src');
  };

  window.SnapshotTile = SnapshotTile;
})();
