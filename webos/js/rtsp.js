// RTSP client over the DVR's "rtspoverwebsocket" endpoint (Dahua/Intelbras).
// Speaks plain RTSP through a WebSocket, receives RTP interleaved ($-framed),
// depacketizes H.264 (RFC 6184) / H.265 (RFC 7798) into access units.
(function () {
  'use strict';

  // Ring buffer of RTSP exchanges (no credentials) for remote debugging via the web inspector.
  var LOG = window.RTSP_LOG = [];
  function log(line) {
    LOG.push(new Date().toISOString().slice(11, 23) + ' ' + line);
    if (LOG.length > 300) LOG.shift();
  }

  function strToBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function bytesToStr(b, start, end) {
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  function parseAuthParams(header) {
    var params = {};
    var re = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g, m;
    while ((m = re.exec(header))) params[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
    return params;
  }

  function parseSdp(sdp) {
    // Returns the first video media section.
    var lines = sdp.split(/\r?\n/), media = null, out = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('m=') === 0) {
        media = l.indexOf('m=video') === 0 ? { payloadType: +l.split(' ')[3] } : null;
        if (media && !out) out = media;
        else if (media) media = null; // only first video track
        continue;
      }
      if (!media) {
        var dim = /^a=x-dimensions:(\d+),(\d+)/.exec(l);
        if (dim && out) { out.width = +dim[1]; out.height = +dim[2]; }
        continue;
      }
      var m;
      if ((m = /^a=control:(.*)$/.exec(l))) media.control = m[1].trim();
      else if ((m = /^a=rtpmap:\d+ ([\w-]+)\/(\d+)/.exec(l))) { media.codec = m[1].toUpperCase(); media.clockRate = +m[2]; }
      else if ((m = /^a=fmtp:\d+ (.*)$/.exec(l))) media.fmtp = m[1];
      else if ((m = /^a=x-dimensions:(\d+),(\d+)/.exec(l))) { media.width = +m[1]; media.height = +m[2]; }
    }
    if (out && out.fmtp) {
      var sprop = /sprop-parameter-sets=([^;]+)/.exec(out.fmtp);
      if (sprop) out.spropH264 = sprop[1].split(',').map(b64ToBytes);
      ['vps', 'sps', 'pps'].forEach(function (k) {
        var r = new RegExp('sprop-' + k + '=([^;]+)').exec(out.fmtp);
        if (r) (out.spropH265 = out.spropH265 || {})[k] = b64ToBytes(r[1]);
      });
    }
    return out;
  }

  function b64ToBytes(s) {
    try { return strToBytes(atob(s.trim())); } catch (e) { return null; }
  }

  function resolveUrl(base, control) {
    if (!control || control === '*') return base;
    if (/^rtsp:\/\//i.test(control)) return control;
    return base.replace(/\/?$/, '/') + control;
  }

  // ---------------------------------------------------------------------------
  // Depacketizer: RTP payloads -> access units (array of NAL units, no start codes)
  function Depacketizer(codec, onAccessUnit) {
    this.h265 = codec === 'H265';
    this.onAccessUnit = onAccessUnit;
    this.nals = [];
    this.ts = null;
    this.fu = null;
    this.lastSeq = null;
  }

  Depacketizer.prototype.push = function (payload, ts, marker, seq) {
    if (this.lastSeq !== null && ((this.lastSeq + 1) & 0xffff) !== seq) this.fu = null; // packet loss
    this.lastSeq = seq;
    if (this.ts !== null && ts !== this.ts) this.flush();
    this.ts = ts;
    if (this.h265) this.pushH265(payload); else this.pushH264(payload);
    if (marker) this.flush();
  };

  Depacketizer.prototype.pushH264 = function (p) {
    var type = p[0] & 0x1f;
    if (type >= 1 && type <= 23) {
      this.nals.push(p);
    } else if (type === 24) { // STAP-A
      for (var i = 1; i + 2 <= p.length;) {
        var size = (p[i] << 8) | p[i + 1];
        i += 2;
        if (i + size > p.length) break;
        this.nals.push(p.subarray(i, i + size));
        i += size;
      }
    } else if (type === 28) { // FU-A
      var start = p[1] & 0x80, end = p[1] & 0x40;
      if (start) this.fu = [new Uint8Array([(p[0] & 0xe0) | (p[1] & 0x1f)]), p.subarray(2)];
      else if (this.fu) this.fu.push(p.subarray(2));
      if (end && this.fu) { this.nals.push(concat(this.fu)); this.fu = null; }
    }
  };

  Depacketizer.prototype.pushH265 = function (p) {
    var type = (p[0] >> 1) & 0x3f;
    if (type < 48) {
      this.nals.push(p);
    } else if (type === 48) { // AP
      for (var i = 2; i + 2 <= p.length;) {
        var size = (p[i] << 8) | p[i + 1];
        i += 2;
        if (i + size > p.length) break;
        this.nals.push(p.subarray(i, i + size));
        i += size;
      }
    } else if (type === 49) { // FU
      var fuh = p[2], start = fuh & 0x80, end = fuh & 0x40;
      if (start) this.fu = [new Uint8Array([(p[0] & 0x81) | ((fuh & 0x3f) << 1), p[1]]), p.subarray(3)];
      else if (this.fu) this.fu.push(p.subarray(3));
      if (end && this.fu) { this.nals.push(concat(this.fu)); this.fu = null; }
    }
  };

  Depacketizer.prototype.flush = function () {
    if (this.nals.length) this.onAccessUnit(this.nals, this.ts);
    this.nals = [];
  };

  function concat(parts) {
    var len = 0, i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  // ---------------------------------------------------------------------------
  // RTSP client
  function RtspWsClient(opts) {
    this.opts = opts; // wsUrl, rtspUrl, user, password, onMedia(info), onAccessUnit(nals, ts), onError(msg)
    this.cseq = 0;
    this.buf = new Uint8Array(0);
    this.pending = {};
    this.auth = null;
    this.session = null;
    this.closed = false;
  }

  RtspWsClient.prototype.connect = function () {
    var self = this;
    var ws = this.ws = new WebSocket(this.opts.wsUrl);
    ws.binaryType = 'arraybuffer';
    ws.onopen = function () { self.start(); };
    ws.onmessage = function (e) {
      var data = typeof e.data === 'string' ? strToBytes(e.data) : new Uint8Array(e.data);
      self.onData(data);
    };
    ws.onerror = function () { log('ws error ' + self.opts.rtspUrl); self.fail('Falha na conexão'); };
    ws.onclose = function (e) { log('ws close ' + e.code + ' ' + self.opts.rtspUrl); self.fail('Conexão encerrada'); };
  };

  RtspWsClient.prototype.close = function () {
    this.closed = true;
    clearInterval(this.keepAlive);
    if (this.ws) {
      try {
        if (this.ws.readyState === 1 && this.session) this.send('TEARDOWN', this.opts.rtspUrl, {});
      } catch (e) { /* ignore */ }
      this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
      try { this.ws.close(); } catch (e2) { /* ignore */ }
    }
  };

  RtspWsClient.prototype.fail = function (msg) {
    if (this.closed) return;
    this.close();
    if (this.opts.onError) this.opts.onError(msg);
  };

  RtspWsClient.prototype.send = function (method, url, headers, cb) {
    var cseq = ++this.cseq;
    var req = method + ' ' + url + ' RTSP/1.0\r\nCSeq: ' + cseq + '\r\n';
    if (this.auth) req += 'Authorization: ' + this.authHeader(method, url) + '\r\n';
    if (this.session) req += 'Session: ' + this.session + '\r\n';
    for (var k in headers) req += k + ': ' + headers[k] + '\r\n';
    req += '\r\n';
    this.pending[cseq] = { method: method, url: url, headers: headers, cb: cb, retried: false };
    log('> ' + method + ' ' + url + ' (CSeq ' + cseq + ')');
    this.ws.send(req);
  };

  RtspWsClient.prototype.authHeader = function (method, url) {
    var a = this.auth, user = this.opts.user, pass = this.opts.password;
    if (a.scheme === 'basic') return 'Basic ' + btoa(unescape(encodeURIComponent(user + ':' + pass)));
    var ha1 = md5(user + ':' + a.realm + ':' + pass);
    var ha2 = md5(method + ':' + url);
    var h = 'Digest username="' + user + '", realm="' + a.realm + '", nonce="' + a.nonce + '", uri="' + url + '"';
    if (a.qop) {
      a.nc = (a.nc || 0) + 1;
      var nc = ('0000000' + a.nc.toString(16)).slice(-8);
      var cnonce = Math.random().toString(16).slice(2, 10);
      h += ', qop=auth, nc=' + nc + ', cnonce="' + cnonce + '", response="' +
        md5(ha1 + ':' + a.nonce + ':' + nc + ':' + cnonce + ':auth:' + ha2) + '"';
    } else {
      h += ', response="' + md5(ha1 + ':' + a.nonce + ':' + ha2) + '"';
    }
    if (a.opaque) h += ', opaque="' + a.opaque + '"';
    return h;
  };

  RtspWsClient.prototype.onResponse = function (res) {
    var req = this.pending[res.cseq];
    delete this.pending[res.cseq];
    log('< ' + res.status + ' CSeq ' + res.cseq + (req ? ' ' + req.method : '') +
      (res.status >= 300 && res.status !== 401 ? ' ' + JSON.stringify(res.headers) + ' ' + res.body.slice(0, 200) : ''));
    if (!req) return;
    if (res.status === 401 && !req.retried) {
      var www = res.headers['www-authenticate'] || '';
      var p = parseAuthParams(www);
      this.auth = { scheme: /^digest/i.test(www) ? 'digest' : 'basic', realm: p.realm, nonce: p.nonce, opaque: p.opaque, qop: p.qop };
      this.send(req.method, req.url, req.headers, req.cb);
      this.pending[this.cseq].retried = true;
      return;
    }
    if (res.status === 401) return this.fail('Usuário ou senha inválidos');
    if (res.status >= 300) return this.fail('Erro RTSP ' + res.status + ' (' + req.method + ')');
    if (req.cb) req.cb(res);
  };

  RtspWsClient.prototype.start = function () {
    var self = this, url = this.opts.rtspUrl;
    this.send('OPTIONS', url, {}, function () {
      self.send('DESCRIBE', url, { Accept: 'application/sdp' }, function (res) {
        var media = parseSdp(res.body);
        if (!media) return self.fail('Sem vídeo no stream');
        if (media.codec !== 'H264' && media.codec !== 'H265') return self.fail('Codec não suportado: ' + media.codec);
        self.media = media;
        var base = res.headers['content-base'] || res.headers['content-location'] || url;
        var trackUrl = resolveUrl(base, media.control);
        self.depack = new Depacketizer(media.codec, function (nals, ts) {
          if (self.opts.onAccessUnit) self.opts.onAccessUnit(nals, ts);
        });
        self.send('SETUP', trackUrl, { Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1' }, function (res2) {
          self.session = (res2.headers.session || '').split(';')[0].trim();
          var tr = /interleaved=(\d+)/.exec(res2.headers.transport || '');
          self.rtpChannel = tr ? +tr[1] : 0;
          if (self.opts.onMedia) self.opts.onMedia(media);
          self.send('PLAY', url, { Range: 'npt=0.000-' }, function () {
            self.keepAlive = setInterval(function () {
              if (self.ws && self.ws.readyState === 1) self.send('GET_PARAMETER', url, {});
            }, 30000);
          });
        });
      });
    });
  };

  RtspWsClient.prototype.onData = function (data) {
    if (this.buf.length) {
      var merged = new Uint8Array(this.buf.length + data.length);
      merged.set(this.buf, 0);
      merged.set(data, this.buf.length);
      data = merged;
    }
    var off = 0, n = data.length;
    while (off < n) {
      if (data[off] === 0x24) { // '$' interleaved frame
        if (off + 4 > n) break;
        var ch = data[off + 1], len = (data[off + 2] << 8) | data[off + 3];
        if (off + 4 + len > n) break;
        if (ch === this.rtpChannel) this.onRtp(data.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      } else if (data[off] === 0x52 && n - off >= 8 && bytesToStr(data, off, off + 5) === 'RTSP/') {
        var end = -1;
        for (var i = off; i + 3 < n; i++) {
          if (data[i] === 13 && data[i + 1] === 10 && data[i + 2] === 13 && data[i + 3] === 10) { end = i; break; }
        }
        if (end < 0) break;
        var head = bytesToStr(data, off, end);
        var lines = head.split('\r\n'), headers = {};
        for (var j = 1; j < lines.length; j++) {
          var c = lines[j].indexOf(':');
          if (c > 0) headers[lines[j].slice(0, c).trim().toLowerCase()] = lines[j].slice(c + 1).trim();
        }
        var bodyLen = +(headers['content-length'] || 0);
        if (end + 4 + bodyLen > n) break;
        var body = bytesToStr(data, end + 4, end + 4 + bodyLen);
        off = end + 4 + bodyLen;
        this.onResponse({ status: +lines[0].split(' ')[1], cseq: +headers.cseq, headers: headers, body: body });
        if (this.closed) return;
      } else if (data[off] === 0x52 && n - off < 8) {
        break; // possibly partial "RTSP/"
      } else {
        off++; // resync
      }
    }
    this.buf = off < n ? new Uint8Array(data.subarray(off)) : new Uint8Array(0); // copy (old webOS lacks TypedArray.slice)
  };

  RtspWsClient.prototype.onRtp = function (pkt) {
    if (pkt.length < 12 || !this.depack) return;
    var cc = pkt[0] & 0x0f, ext = pkt[0] & 0x10, pad = pkt[0] & 0x20;
    var marker = pkt[1] & 0x80, pt = pkt[1] & 0x7f;
    if (this.media && pt !== this.media.payloadType) return;
    var seq = (pkt[2] << 8) | pkt[3];
    var ts = ((pkt[4] << 24) | (pkt[5] << 16) | (pkt[6] << 8) | pkt[7]) >>> 0;
    var off = 12 + cc * 4;
    if (ext) {
      if (off + 4 > pkt.length) return;
      off += 4 + (((pkt[off + 2] << 8) | pkt[off + 3]) * 4);
    }
    var end = pkt.length - (pad ? pkt[pkt.length - 1] : 0);
    if (off >= end) return;
    this.depack.push(pkt.subarray(off, end), ts, marker, seq);
  };

  window.RtspWsClient = RtspWsClient;
  window.RtspUtil = { concat: concat, parseSdp: parseSdp };
})();
