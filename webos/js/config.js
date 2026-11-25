// Default DVR settings. Copy values into js/config.local.js (git-ignored) to bake
// credentials into the package, or set them on the TV via the settings screen.
window.DVR_DEFAULTS = {
  host: '192.168.68.150', // DVR IP (WebSocket on the HTTP port)
  httpPort: 80,           // port of the DVR web page / rtspoverwebsocket
  rtspPort: 554,          // RTSP port as seen by the DVR itself
  user: '',
  password: '',
  channels: 8,
  columns: 3,             // 2 = 2x2 grid, 3 = 3x3 grid
  liveGrid: 0             // 1 = live RTSP in the grid (snapshots as fallback); TVs have few decoders
};
