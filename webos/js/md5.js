// Minimal MD5 (RFC 1321) for RTSP Digest auth. Returns lowercase hex.
(function () {
  'use strict';
  var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  var K = [];
  for (var i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

  function utf8(str) {
    var out = [];
    var s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function md5(str) {
    var bytes = utf8(str);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var b = 0; b < 8; b++) bytes.push(b < 4 ? (bitLen >>> (8 * b)) & 0xff : 0);

    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    var M = new Array(16);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var j = 0; j < 16; j++) {
        var p = off + j * 4;
        M[j] = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (var r = 0; r < 64; r++) {
        var F, g;
        if (r < 16) { F = (B & C) | (~B & D); g = r; }
        else if (r < 32) { F = (D & B) | (~D & C); g = (5 * r + 1) % 16; }
        else if (r < 48) { F = B ^ C ^ D; g = (3 * r + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * r) % 16; }
        var tmp = D;
        D = C;
        C = B;
        var x = (A + F + K[r] + M[g]) | 0;
        var sh = S[(r >> 4) * 4 + (r % 4)];
        B = (B + ((x << sh) | (x >>> (32 - sh)))) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var hex = '';
    [a0, b0, c0, d0].forEach(function (v) {
      for (var k = 0; k < 4; k++) hex += ('0' + ((v >>> (8 * k)) & 0xff).toString(16)).slice(-2);
    });
    return hex;
  }

  window.md5 = md5;
})();
