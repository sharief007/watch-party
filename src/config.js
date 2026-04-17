const CONFIG = {
  app: {
    name: 'Watch Party',
    version: '1.0.0',
    themeColor: '#0f0f1a',
  },

  peerjs: {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    roomPrefix: 'watchparty',
  },

  ice: {
    // Ordered fastest-first. STUN finishes gathering quickly, then TURN UDP,
    // TURN TCP, TURNS (TLS). Keeps first-media-frame latency low while still
    // penetrating strict mobile-carrier NAT.
    servers: [
      // ── STUN ─────────────────────────────────────────────────────────────
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' },
      { urls: 'stun:stun.cloudflare.com:3478' },

      // ── TURN UDP (OpenRelay — no account needed) ─────────────────────────
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },

      // ── TURN TCP (fallback when UDP blocked) ─────────────────────────────
      {
        urls: 'turn:openrelay.metered.ca:80?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },

      // ── TURNS (TLS) — strict symmetric-NAT fallback ──────────────────────
      {
        urls: 'turns:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turns:freestun.net:5349',
        username: 'free',
        credential: 'free',
      },

      // ── TURN: FreeSun (last-resort UDP) ──────────────────────────────────
      {
        urls: 'turn:freestun.net:3478',
        username: 'free',
        credential: 'free',
      },
      {
        urls: 'turn:freestun.net:3479',
        username: 'free',
        credential: 'free',
      },
    ],
    // Pre-gather candidates before a call is made; reduces connection setup time
    iceCandidatePoolSize: 10,
  },

  video: {
    maxBitrate: 2500000,
  },

  media: {
    camera: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24 },
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  },

  sync: {
    seekToleranceMs: 300,
    heartbeatIntervalMs: 3000,
  },
};

export default CONFIG;
