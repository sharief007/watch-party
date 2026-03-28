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
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
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
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
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
