// Grid tile: snapshots always start first; with live grid enabled it also opens the
// RTSP sub stream. Once video is actually playing the snapshot is hidden and its
// polling paused. If the stream fails (DVR, network, or the TV running out of video
// decoders) the tile goes back to snapshots while CameraPlayer retries with backoff.
(function () {
  'use strict';

  function GridTile(cellEl, settings) {
    var self = this;
    this.cellEl = cellEl;
    this.settings = settings;
    this.snapshot = new SnapshotTile(cellEl.querySelector('img'), cellEl.querySelector('.status'), settings);
    // The live player's own status text stays hidden; the snapshot status is what the user sees.
    var liveStatus = document.createElement('div');
    this.live = new CameraPlayer(cellEl.querySelector('video'), liveStatus, settings, {
      onPlaying: function () {
        self.snapshot.pause();
        self.snapshot.setStatus('');
        self.cellEl.classList.add('live');
      },
      onFailure: function () {
        if (!self.cellEl.classList.contains('live')) return;
        self.cellEl.classList.remove('live');
        self.snapshot.resume();
      }
    });
  }

  /** delayMs staggers RTSP connections so the DVR is not hit by all tiles at once. */
  GridTile.prototype.start = function (channel, delayMs) {
    this.stop();
    this.snapshot.start(channel);
    if (this.settings.liveGrid) this.live.start(channel, false, delayMs || 1);
  };

  GridTile.prototype.stop = function () {
    this.live.stop();
    this.snapshot.stop();
    this.cellEl.classList.remove('live');
  };

  window.GridTile = GridTile;
})();
