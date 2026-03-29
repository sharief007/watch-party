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
    servers: [
      // ── STUN servers ──────────────────────────────────────────────────────
      // Google (5 independent servers)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // Mozilla
      { urls: 'stun:stun.services.mozilla.com' },
      // Cloudflare
      { urls: 'stun:stun.cloudflare.com:3478' },

      // ── TURN: OpenRelay by Metered.ca (no account needed) ────────────────
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:80?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      // TURNS (TLS) — penetrates strict mobile-carrier symmetric NAT
      {
        urls: 'turns:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },

      // ── TURN: FreeSun (free, no account needed) ───────────────────────────
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
      // TURNS (TLS) variant
      {
        urls: 'turns:freestun.net:5349',
        username: 'free',
        credential: 'free',
      },

      // ── TURN: Numb by Viagenie (long-running free public server) ──────────
      {
        urls: 'turn:numb.viagenie.ca',
        username: 'webrtc@live.com',
        credential: 'muazkh',
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
