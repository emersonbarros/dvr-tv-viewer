// Fragmented MP4 muxer for a single H.264/H.265 video track (for Media Source Extensions).
(function () {
  'use strict';

  var TIMESCALE = 90000; // RTP video clock

  // --- bit reader for SPS parsing (handles emulation-prevention bytes) --------
  function unescapeRbsp(nal, start) {
    var out = [], zeros = 0;
    for (var i = start; i < nal.length; i++) {
      var b = nal[i];
      if (zeros >= 2 && b === 3) { zeros = 0; continue; }
      out.push(b);
      zeros = b === 0 ? zeros + 1 : 0;
    }
    return new Uint8Array(out);
  }

  function BitReader(bytes) { this.b = bytes; this.pos = 0; }
  BitReader.prototype.u = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      var byte = this.b[this.pos >> 3] || 0;
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  };
  BitReader.prototype.ue = function () {
    var zeros = 0;
    while (this.u(1) === 0 && zeros < 32) zeros++;
    return Math.pow(2, zeros) - 1 + this.u(zeros);
  };
  BitReader.prototype.se = function () {
    var v = this.ue();
    return v & 1 ? (v + 1) / 2 : -v / 2;
  };

  function parseH264Sps(sps) {
    var r = new BitReader(unescapeRbsp(sps, 1));
    var profile = r.u(8); r.u(8); r.u(8); r.ue();
    var chroma = 1;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].indexOf(profile) >= 0) {
      chroma = r.ue();
      if (chroma === 3) r.u(1);
      r.ue(); r.ue(); r.u(1);
      if (r.u(1)) {
        for (var i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
          if (r.u(1)) {
            var size = i < 6 ? 16 : 64, last = 8, next = 8;
            for (var j = 0; j < size; j++) {
              if (next !== 0) next = (last + r.se() + 256) % 256;
              last = next === 0 ? last : next;
            }
          }
        }
      }
    }
    r.ue();
    var pocType = r.ue();
    if (pocType === 0) r.ue();
    else if (pocType === 1) {
      r.u(1); r.se(); r.se();
      var n = r.ue();
      for (var k = 0; k < n; k++) r.se();
    }
    r.ue(); r.u(1);
    var wMbs = r.ue() + 1, hMap = r.ue() + 1, frameMbsOnly = r.u(1);
    if (!frameMbsOnly) r.u(1);
    r.u(1);
    var cl = 0, cr = 0, ct = 0, cb = 0;
    if (r.u(1)) { cl = r.ue(); cr = r.ue(); ct = r.ue(); cb = r.ue(); }
    var cropX = chroma === 0 || chroma === 3 ? 1 : 2;
    var cropY = (chroma === 1 ? 2 : 1) * (2 - frameMbsOnly);
    return {
      width: wMbs * 16 - (cl + cr) * cropX,
      height: (2 - frameMbsOnly) * hMap * 16 - (ct + cb) * cropY
    };
  }

  function parseH265Sps(sps) {
    var rb = unescapeRbsp(sps, 2);
    var r = new BitReader(rb);
    r.u(4);
    var maxSub = r.u(3);
    r.u(1);
    // general profile_tier_level: 12 bytes starting at byte 1
    var ptl = rb.subarray(1, 13);
    r.pos += 96;
    var subProfile = [], subLevel = [], i;
    for (i = 0; i < maxSub; i++) { subProfile.push(r.u(1)); subLevel.push(r.u(1)); }
    if (maxSub > 0) for (i = maxSub; i < 8; i++) r.u(2);
    for (i = 0; i < maxSub; i++) {
      if (subProfile[i]) r.pos += 88;
      if (subLevel[i]) r.pos += 8;
    }
    r.ue();
    var chroma = r.ue();
    if (chroma === 3) r.u(1);
    var w = r.ue(), h = r.ue();
    if (r.u(1)) {
      var sx = chroma === 1 || chroma === 2 ? 2 : 1, sy = chroma === 1 ? 2 : 1;
      w -= (r.ue() + r.ue()) * sx;
      h -= (r.ue() + r.ue()) * sy;
    }
    return { width: w, height: h, ptl: ptl, chroma: chroma };
  }

  function hex2(n) { return ('0' + n.toString(16)).slice(-2); }

  function h265CodecString(ptl) {
    var space = ptl[0] >> 6, tier = (ptl[0] >> 5) & 1, idc = ptl[0] & 0x1f;
    var compat = ((ptl[1] << 24) | (ptl[2] << 16) | (ptl[3] << 8) | ptl[4]) >>> 0;
    var rev = 0;
    for (var i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
    var s = 'hvc1.' + ['', 'A', 'B', 'C'][space] + idc + '.' + (rev >>> 0).toString(16) + '.' +
      (tier ? 'H' : 'L') + ptl[11];
    var cons = [ptl[5], ptl[6], ptl[7], ptl[8], ptl[9], ptl[10]];
    while (cons.length && cons[cons.length - 1] === 0) cons.pop();
    for (var j = 0; j < cons.length; j++) s += '.' + cons[j].toString(16).toUpperCase();
    return s;
  }

  // --- box helpers ------------------------------------------------------------
  function u8(arr) { return new Uint8Array(arr); }
  function u16(v) { return [(v >> 8) & 0xff, v & 0xff]; }
  function u32(v) { return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]; }
  function u64(v) { var hi = Math.floor(v / 4294967296), lo = v % 4294967296; return u32(hi).concat(u32(lo)); }

  function box(type) {
    var parts = [], len = 8, i;
    for (i = 1; i < arguments.length; i++) {
      var p = arguments[i];
      if (!(p instanceof Uint8Array)) p = u8(p);
      parts.push(p);
      len += p.length;
    }
    var out = new Uint8Array(len);
    out.set(u32(len), 0);
    for (i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    var off = 8;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  var MATRIX = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0];

  function initSegment(track) {
    var w = track.width, h = track.height;
    var config;
    if (track.codec === 'H264') {
      var sps = track.sps, pps = track.pps;
      config = box('avcC', [1, sps[1], sps[2], sps[3], 0xff, 0xe1].concat(u16(sps.length)),
        sps, [1].concat(u16(pps.length)), pps);
    } else {
      var ptl = track.ptl;
      var arrays = [];
      [[32, track.vps], [33, track.sps], [34, track.pps]].forEach(function (a) {
        arrays.push(u8([0x80 | a[0]].concat(u16(1), u16(a[1].length))), a[1]);
      });
      config = box.apply(null, ['hvcC',
        [1].concat(Array.prototype.slice.call(ptl, 0, 12),
          [0xf0, 0x00, 0xfc, 0xfc | (track.chroma & 3), 0xf8, 0xf8, 0, 0, 0x0f, 3])].concat(arrays));
    }
    var sampleEntry = box(track.codec === 'H264' ? 'avc1' : 'hvc1',
      [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        .concat(u16(w), u16(h), [0, 0x48, 0, 0, 0, 0x48, 0, 0, 0, 0, 0, 0, 0, 1],
          zeros(32), [0, 0x18, 0xff, 0xff]),
      config);

    var stsd = box('stsd', [0, 0, 0, 0, 0, 0, 0, 1], sampleEntry);
    var empty = [0, 0, 0, 0, 0, 0, 0, 0];
    var stbl = box('stbl', stsd, box('stts', empty), box('stsc', empty),
      box('stsz', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), box('stco', empty));
    var dinf = box('dinf', box('dref', [0, 0, 0, 0, 0, 0, 0, 1], box('url ', [0, 0, 0, 1])));
    var minf = box('minf', box('vmhd', [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]), dinf, stbl);
    var hdlr = box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, 0x76, 0x69, 0x64, 0x65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x56, 0x69, 0x64, 0x65, 0x6f, 0]);
    var mdhd = box('mdhd', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].concat(u32(TIMESCALE), [0, 0, 0, 0, 0x55, 0xc4, 0, 0]));
    var mdia = box('mdia', mdhd, hdlr, minf);
    var tkhd = box('tkhd', [0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].concat(MATRIX, u16(w), [0, 0], u16(h), [0, 0]));
    var trak = box('trak', tkhd, mdia);
    var mvhd = box('mvhd', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].concat(u32(TIMESCALE), [0, 0, 0, 0, 0, 1, 0, 0, 1, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0], MATRIX, zeros(24), [0, 0, 0, 2]));
    var mvex = box('mvex', box('trex', [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    var moov = box('moov', mvhd, trak, mvex);
    var ftyp = box('ftyp', [0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1, 0x69, 0x73, 0x6f, 0x6d, 0x61, 0x76, 0x63, 0x31]);
    return RtspUtil.concat([ftyp, moov]);
  }

  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }

  function mediaSegment(seq, sample) {
    // sample: { dts, duration, key, data (AVCC/HVCC length-prefixed) }
    var flags = sample.key ? 0x02000000 : 0x01010000;
    var trun = box('trun', [0, 0, 0x07, 0x01, 0, 0, 0, 1].concat(u32(0), u32(sample.duration),
      u32(sample.data.length), u32(flags)));
    var tfhd = box('tfhd', [0, 0x02, 0, 0, 0, 0, 0, 1]);
    var tfdt = box('tfdt', [1, 0, 0, 0].concat(u64(sample.dts)));
    var traf = box('traf', tfhd, tfdt, trun);
    var moof = box('moof', box('mfhd', [0, 0, 0, 0].concat(u32(seq))), traf);
    // patch trun data_offset = moof size + mdat header
    var trunOffset = moof.length - trun.length + 16;
    moof.set(u32(moof.length + 8), trunOffset);
    var mdatHead = u8(u32(sample.data.length + 8).concat([0x6d, 0x64, 0x61, 0x74]));
    return RtspUtil.concat([moof, mdatHead, sample.data]);
  }

  // --- Remuxer: access units -> init + media segments --------------------------
  function Remuxer(media, onInit, onSegment) {
    this.codec = media.codec;
    this.media = media;
    this.onInit = onInit;
    this.onSegment = onSegment;
    this.params = {};
    this.ready = false;
    this.seq = 0;
    this.prev = null;
    this.baseTs = null;
    this.lastDts = 0;
    if (media.spropH264) { this.params.sps = media.spropH264[0]; this.params.pps = media.spropH264[1]; }
    if (media.spropH265) { this.params.vps = media.spropH265.vps; this.params.sps = media.spropH265.sps; this.params.pps = media.spropH265.pps; }
  }

  Remuxer.prototype.nalType = function (nal) {
    return this.codec === 'H264' ? nal[0] & 0x1f : (nal[0] >> 1) & 0x3f;
  };

  Remuxer.prototype.push = function (nals, ts) {
    var h264 = this.codec === 'H264', key = false, keep = [], len = 0;
    for (var i = 0; i < nals.length; i++) {
      var n = nals[i], t = this.nalType(n);
      if (h264) {
        if (t === 7) this.params.sps = n;
        else if (t === 8) this.params.pps = n;
        else if (t === 9) continue; // AUD
        if (t === 5) key = true;
      } else {
        if (t === 32) this.params.vps = n;
        else if (t === 33) this.params.sps = n;
        else if (t === 34) this.params.pps = n;
        else if (t === 35) continue; // AUD
        if (t >= 16 && t <= 21) key = true;
      }
      keep.push(n);
      len += 4 + n.length;
    }
    if (!keep.length) return;

    if (!this.ready) {
      if (!key || !this.params.sps || !this.params.pps || (!h264 && !this.params.vps)) return;
      this.startTrack();
    }

    var data = new Uint8Array(len), off = 0;
    for (var j = 0; j < keep.length; j++) {
      data.set(u32(keep[j].length), off);
      data.set(keep[j], off + 4);
      off += 4 + keep[j].length;
    }

    if (this.baseTs === null) this.baseTs = ts;
    var dts = ((ts - this.baseTs) >>> 0); // handles 32-bit RTP wrap relative to base
    var cur = { dts: dts, key: key, data: data };
    if (this.prev) {
      var dur = cur.dts - this.prev.dts;
      if (dur <= 0 || dur > TIMESCALE * 2) dur = 3000; // fallback ~30fps
      this.prev.duration = dur;
      this.prev.dts = this.lastDts;
      this.lastDts += dur;
      this.onSegment(mediaSegment(++this.seq, this.prev));
    }
    this.prev = cur;
  };

  Remuxer.prototype.startTrack = function () {
    var p = this.params, track = { codec: this.codec, sps: p.sps, pps: p.pps, vps: p.vps };
    var info;
    try {
      info = this.codec === 'H264' ? parseH264Sps(p.sps) : parseH265Sps(p.sps);
    } catch (e) {
      info = {};
    }
    track.width = info.width || this.media.width || 1280;
    track.height = info.height || this.media.height || 720;
    if (this.codec === 'H264') {
      track.mime = 'video/mp4; codecs="avc1.' + hex2(p.sps[1]) + hex2(p.sps[2]) + hex2(p.sps[3]) + '"';
    } else {
      track.ptl = info.ptl;
      track.chroma = info.chroma === undefined ? 1 : info.chroma;
      track.mime = 'video/mp4; codecs="' + h265CodecString(info.ptl) + '"';
    }
    this.ready = true;
    this.onInit(track.mime, initSegment(track), track);
  };

  window.Remuxer = Remuxer;
})();
