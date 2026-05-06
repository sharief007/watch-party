import { useRef, useEffect, useState, useCallback } from 'react';
import { useRoom } from '../contexts/RoomContext';
import { useMediaSession } from '../hooks/usePresenceHints';
import CONFIG from '../config';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer() {
  const {
    role, status, roomName, remoteStream,
    sendVideoStream, sendSyncEvent, startHeartbeat, stopHeartbeat, onSyncEvent,
    isSyncing, showSyncing,
    trackObjectUrl, trackVideoElement,
  } = useRoom();

  const videoRef = useRef(null);
  const captureStreamRef = useRef(null);
  const fileInputRef = useRef(null);
  const currentFileUrlRef = useRef(null);
  const [hasFile, setHasFile] = useState(false);
  const [needsStreamerStart, setNeedsStreamerStart] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [needsUserPlay, setNeedsUserPlay] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [captureUnsupported, setCaptureUnsupported] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileFullscreen, setMobileFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimer = useRef(null);
  const containerRef = useRef(null);
  const isStreamer = role === 'streamer';

  // iOS-Safari fallback: when HTMLMediaElement.captureStream is missing, draw
  // the video onto a canvas and route audio through WebAudio. The result is a
  // MediaStream that WebRTC can ship to the viewer just like a native one.
  const polyfillCaptureRef = useRef(null);

  const tryCaptureStream = useCallback((vid) => {
    if (!vid) return null;

    // 1) Native captureStream (Chrome/Edge/Brave/Android).
    if (typeof vid.captureStream === 'function') {
      try {
        const s = vid.captureStream();
        if (s && s.getTracks().length > 0) return s;
      } catch { /* fall through to polyfill */ }
    }
    if (typeof vid.mozCaptureStream === 'function') {
      try {
        const s = vid.mozCaptureStream();
        if (s) return s;
      } catch { /* fall through */ }
    }

    // 2) Polyfill (iOS Safari). Needs videoWidth — call after loadedmetadata.
    if (!vid.videoWidth || !vid.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth;
    canvas.height = vid.videoHeight;
    if (typeof canvas.captureStream !== 'function') return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Stop any previous rAF pump (e.g. user picked a new file).
    polyfillCaptureRef.current?.stop?.();

    let stopped = false;
    const pump = () => {
      if (stopped) return;
      if (vid.readyState >= 2) {
        try { ctx.drawImage(vid, 0, 0, canvas.width, canvas.height); } catch { /* ignore */ }
      }
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);

    const videoStream = canvas.captureStream(24);

    // Audio: createMediaElementSource may be called only ONCE per element, so
    // cache the graph on the element itself for subsequent file changes.
    let audioTracks = [];
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!vid._wpAudio) {
          const audioCtx = new AC();
          const source = audioCtx.createMediaElementSource(vid);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          source.connect(audioCtx.destination); // keep local playback audible
          vid._wpAudio = { audioCtx, source, dest };
        }
        audioTracks = vid._wpAudio.dest.stream.getAudioTracks();
        // resume() succeeds when called inside a user gesture (Start Streaming).
        vid._wpAudio.audioCtx.resume?.().catch(() => {});
      }
    } catch { /* createMediaElementSource can fail in rare cases — ignore */ }

    polyfillCaptureRef.current = { stop: () => { stopped = true; } };

    return new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioTracks,
    ]);
  }, []);

  // ─── Streamer: file selection (works for initial + re-select) ───
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset state for new video
    stopHeartbeat();
    setVideoEnded(false);
    setCurrentTime(0);
    setPaused(true);
    setNeedsStreamerStart(false);
    setFileError(null);

    const url = URL.createObjectURL(file);
    trackObjectUrl(url);
    currentFileUrlRef.current = url;

    const vid = videoRef.current;
    if (!vid) return;

    vid.srcObject = null;
    vid.src = url;
    vid.load();

    vid.onloadedmetadata = () => {
      setDuration(vid.duration);
      setHasFile(true);

      const stream = tryCaptureStream(vid);
      captureStreamRef.current = stream;
      trackVideoElement(vid);

      if (!stream) {
        // Browser does not support captureStream (e.g. iOS Safari). The
        // streamer can still preview locally but nothing reaches the viewer.
        setCaptureUnsupported(true);
      } else if (status === 'connected') {
        sendVideoStream(stream);
        startHeartbeat(() => ({ currentTime: vid.currentTime, paused: vid.paused }));
      }

      // Show the start-streaming overlay — requires a real user gesture
      // to satisfy autoplay policy on all browsers/mobile
      setNeedsStreamerStart(true);
    };

    // Reset file input so same file can be re-selected
    e.target.value = '';
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Send stream when peer connects (if file already loaded). Deps include the
  // callbacks they use; React Hook lint can pass without disables.
  useEffect(() => {
    if (isStreamer && status === 'connected' && captureStreamRef.current) {
      sendVideoStream(captureStreamRef.current);
      const vid = videoRef.current;
      if (vid) startHeartbeat(() => ({ currentTime: vid.currentTime, paused: vid.paused }));
    }
  }, [status, isStreamer, sendVideoStream, startHeartbeat]);

  // ─── Viewer: attach remote video stream ───
  // Don't autoplay with audio — show a "Tap to Watch" overlay instead.
  // This is the ONLY reliable cross-platform approach for mobile.
  useEffect(() => {
    if (!isStreamer && remoteStream && videoRef.current) {
      const vid = videoRef.current;
      vid.removeAttribute('src');
      vid.srcObject = remoteStream;
      vid.volume = volume;
      vid.muted = true; // muted autoplay is allowed everywhere
      vid.play()
        .then(() => {
          // Video is playing muted — prompt user to tap for audio
          setNeedsUserPlay(true);
        })
        .catch(() => {
          // Autoplay blocked entirely (rare) — also show tap overlay
          setNeedsUserPlay(true);
        });
    }
    // `volume` intentionally read via current state — re-binding on every
    // volume change would restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStream, isStreamer]);

  // Streamer taps "Start Streaming" — real user gesture satisfies autoplay policy
  const handleStreamerStart = () => {
    const vid = videoRef.current;
    if (!vid) return;
    // If the iOS polyfill is engaged, this gesture is what unblocks the
    // AudioContext so audio actually flows.
    vid._wpAudio?.audioCtx?.resume?.().catch(() => {});
    vid.play()
      .then(() => {
        // Some browsers (Safari) only populate captureStream tracks after
        // playback begins. Retry once we know the element is playing.
        if (!captureStreamRef.current) {
          const stream = tryCaptureStream(vid);
          if (stream) {
            captureStreamRef.current = stream;
            setCaptureUnsupported(false);
            if (status === 'connected') {
              sendVideoStream(stream);
              startHeartbeat(() => ({ currentTime: vid.currentTime, paused: vid.paused }));
            }
          }
        }
      })
      .catch(() => { /* noop */ });
    sendSyncEvent('play', vid.currentTime);
    setNeedsStreamerStart(false);
  };

  // Viewer taps "Start Watching" — this is a real user gesture so unmute works
  const handleViewerTap = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = false;
    vid.volume = volume;
    vid.play().catch(() => {});
    setNeedsUserPlay(false);
  };

  // ─── Sync: viewer receives events from streamer ───
  const needsUserPlayRef = useRef(needsUserPlay);
  useEffect(() => { needsUserPlayRef.current = needsUserPlay; }, [needsUserPlay]);

  useEffect(() => {
    onSyncEvent((msg) => {
      if (isStreamer) return;

      const vid = videoRef.current;
      if (!vid) return;

      const gated = needsUserPlayRef.current;

      switch (msg.type) {
        case 'play':
          if (!gated) vid.play().catch(() => {});
          break;
        case 'pause':
          vid.pause();
          break;
        case 'seek':
          if (!gated) {
            vid.currentTime = msg.currentTime;
            showSyncing();
          }
          break;
        case 'sync-heartbeat': {
          if (gated) break;
          const drift = Math.abs(vid.currentTime - msg.currentTime);
          if (drift > CONFIG.sync.seekToleranceMs / 1000) {
            vid.currentTime = msg.currentTime;
          }
          if (msg.paused && !vid.paused) vid.pause();
          else if (!msg.paused && vid.paused) vid.play().catch(() => {});
          break;
        }
      }
    });
  }, [isStreamer, onSyncEvent, showSyncing]);

  // ─── Time tracking + ended detection ───
  const isStreamerRef = useRef(isStreamer);
  useEffect(() => { isStreamerRef.current = isStreamer; }, [isStreamer]);
  const sendSyncEventRef = useRef(sendSyncEvent);
  useEffect(() => { sendSyncEventRef.current = sendSyncEvent; }, [sendSyncEvent]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const update = () => {
      if (vid.duration) setDuration(vid.duration);
      setCurrentTime(vid.currentTime || 0);
      setPaused(vid.paused);
    };
    const onEnded = () => {
      if (isStreamerRef.current) {
        setVideoEnded(true);
        setNeedsStreamerStart(false);
        setPaused(true);
        sendSyncEventRef.current?.('pause', vid.currentTime);
      }
    };
    const onError = () => {
      if (isStreamerRef.current && vid.src) {
        setFileError('Unable to load this video. Try a different file or format (MP4 / WebM recommended).');
        setHasFile(false);
        setNeedsStreamerStart(false);
      }
    };

    const interval = setInterval(update, 250);
    vid.addEventListener('loadedmetadata', update);
    vid.addEventListener('play', update);
    vid.addEventListener('pause', update);
    vid.addEventListener('ended', onEnded);
    vid.addEventListener('error', onError);

    return () => {
      clearInterval(interval);
      vid.removeEventListener('loadedmetadata', update);
      vid.removeEventListener('play', update);
      vid.removeEventListener('pause', update);
      vid.removeEventListener('ended', onEnded);
      vid.removeEventListener('error', onError);
    };
  }, []);

  // ─── Streamer-only controls ───
  const togglePlay = () => {
    if (!isStreamer) return;
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play();
      sendSyncEvent('play', vid.currentTime);
    } else {
      vid.pause();
      sendSyncEvent('pause', vid.currentTime);
    }
  };

  const seek = (time) => {
    if (!isStreamer) return;
    const vid = videoRef.current;
    if (!vid) return;
    const clamped = Math.max(0, Math.min(time, duration));
    vid.currentTime = clamped;
    sendSyncEvent('seek', clamped);
  };

  const handleProgressChange = (e) => {
    if (!isStreamer) return;
    seek((parseFloat(e.target.value) / 100) * duration);
  };

  const handleVolumeChange = (e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    const vid = videoRef.current;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;

    // Exit any active fullscreen state.
    if (mobileFullscreen) {
      setMobileFullscreen(false);
      try { await window.screen?.orientation?.unlock?.(); } catch { /* ignore */ }
      return;
    }
    if (fsEl) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } catch { /* ignore */ }
      try { await window.screen?.orientation?.unlock?.(); } catch { /* ignore */ }
      return;
    }

    const isLandscapeVid = vid && vid.videoWidth > 0 && vid.videoWidth > vid.videoHeight;

    // Strategy 1: standard requestFullscreen on container (Android Chrome,
    // desktop). After entering, lock screen orientation to landscape if the
    // video is wider than tall, so the user gets a true cinema-style view
    // without us doing any CSS rotation hacks.
    const reqFs =
      container?.requestFullscreen?.bind(container) ||
      container?.webkitRequestFullscreen?.bind(container);
    if (reqFs) {
      try {
        await reqFs();
        if (isLandscapeVid) {
          try { await window.screen?.orientation?.lock?.('landscape'); } catch { /* ignore */ }
        }
        return;
      } catch {
        // Fall through to the next strategy.
      }
    }

    // Strategy 2: iOS Safari. requestFullscreen on a generic element is not
    // supported, but the native video element has its own fullscreen API
    // that hands off to the iOS system player.
    if (vid?.webkitEnterFullscreen) {
      try { vid.webkitEnterFullscreen(); return; } catch { /* ignore */ }
    }

    // Strategy 3 (last resort): cover the viewport via CSS, no rotation.
    setMobileFullscreen(true);
  };

  useEffect(() => {
    const handler = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        try { window.screen?.orientation?.unlock?.(); } catch { /* ignore */ }
      }
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  // OS media controls (lock screen / notification shade). Streamer drives playback;
  // viewer just shows metadata so the OS knows media is active and throttles less.
  useMediaSession({
    enabled: isStreamer ? hasFile : !!remoteStream,
    title: roomName,
    paused,
    onPlay: isStreamer ? togglePlay : null,
    onPause: isStreamer ? togglePlay : null,
    onSeekBackward: isStreamer
      ? (offset) => {
          const vid = videoRef.current;
          if (vid) seek(vid.currentTime - (offset || 10));
        }
      : null,
    onSeekForward: isStreamer
      ? (offset) => {
          const vid = videoRef.current;
          if (vid) seek(vid.currentTime + (offset || 10));
        }
      : null,
  });

  const showControlsTemporarily = () => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!paused) setShowControls(false);
    }, 3000);
  };

  // Cleanup on unmount
  useEffect(() => {
    const vid = videoRef.current;
    const timer = controlsTimer;
    return () => {
      stopHeartbeat();
      clearTimeout(timer.current);
      polyfillCaptureRef.current?.stop?.();
      polyfillCaptureRef.current = null;
      if (vid) {
        vid.pause();
        vid.srcObject = null;
        vid.removeAttribute('src');
      }
    };
  }, [stopHeartbeat]);

  const formatTime = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Keyboard-accessible overlay wrapper: turns a full-bleed div into a
  // standard button role so VoiceOver / NVDA announce it correctly.
  const overlayButtonProps = (onActivate) => ({
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
    style: { cursor: 'pointer' },
  });

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${mobileFullscreen ? styles.mobileFullscreen : ''}`}
      onMouseMove={showControlsTemporarily}
      onTouchStart={showControlsTemporarily}
    >
      <div className={styles.videoWrapper}>
        <video
          ref={videoRef}
          className={styles.video}
          playsInline
        />

        {/* Viewer: tap to unmute/start — required for mobile audio+video */}
        {needsUserPlay && !isStreamer && (
          <div
            className={styles.overlay}
            aria-label="Tap to start watching"
            {...overlayButtonProps(handleViewerTap)}
          >
            <div className={styles.tapToWatch}>
              <div className={styles.tapIcon}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </div>
              <h3>Tap to Start Watching</h3>
              <p>Tap anywhere to enable audio and video</p>
            </div>
          </div>
        )}

        {/* Streamer: tap to begin playback after selecting a file */}
        {needsStreamerStart && isStreamer && (
          <div
            className={styles.overlay}
            aria-label="Start streaming"
            {...overlayButtonProps(handleStreamerStart)}
          >
            <div className={styles.tapToWatch}>
              <div className={styles.tapIcon}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </div>
              <h3>Start Streaming</h3>
              <p>Tap anywhere to begin playback for everyone</p>
            </div>
          </div>
        )}

        {/* Hidden file input (always in DOM for re-selection) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          aria-hidden="true"
        />

        {/* Streamer: initial file picker overlay */}
        {!hasFile && isStreamer && (
          <div className={styles.overlay}>
            <div className={styles.pickFile}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5" aria-hidden="true">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <path d="M12 18v-6M9 15l3-3 3 3" />
              </svg>
              <h3>Select a video file</h3>
              <p>Choose a video from your device to start streaming</p>
              {fileError && <p className={styles.errorText || ''} style={{ color: '#e94560' }}>{fileError}</p>}
              <button className={styles.pickBtn} onClick={openFilePicker}>
                Choose File
              </button>
            </div>
          </div>
        )}

        {/* Streamer: browser doesn't support MediaStream capture from <video> */}
        {captureUnsupported && isStreamer && hasFile && (
          <div className={styles.overlay}>
            <div className={styles.pickFile}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#e94560" strokeWidth="1.5" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h3>Streaming not supported</h3>
              <p>This browser cannot capture video for streaming. Please use Chrome, Edge, or Firefox on desktop or Android.</p>
            </div>
          </div>
        )}

        {/* Streamer: video ended overlay */}
        {videoEnded && isStreamer && (
          <div className={styles.overlay}>
            <div className={styles.pickFile}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="16 12 12 8 8 12" />
                <line x1="12" y1="16" x2="12" y2="8" />
              </svg>
              <h3>Video ended</h3>
              <p>Select another video or replay</p>
              <div className={styles.endedButtons}>
                <button className={styles.pickBtn} onClick={() => { setVideoEnded(false); seek(0); }}>
                  Replay
                </button>
                <button className={`${styles.pickBtn} ${styles.pickBtnAlt}`} onClick={openFilePicker}>
                  New Video
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Viewer: waiting for stream */}
        {!isStreamer && !remoteStream && (
          <div className={styles.overlay}>
            <div className={styles.waiting}>
              <div className={styles.loader} />
              <p>Waiting for stream...</p>
            </div>
          </div>
        )}

        {isSyncing && (
          <div className={styles.syncBanner}>
            <div className={styles.syncDot} />
            Syncing...
          </div>
        )}
      </div>

      {/* Controls */}
      <div className={`${styles.controls} ${showControls || paused ? styles.visible : ''}`}>
        <div className={styles.progressRow}>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
            {isStreamer && (
              <input
                type="range"
                className={styles.progressInput}
                min="0"
                max="100"
                step="0.1"
                value={progressPct}
                onChange={handleProgressChange}
                aria-label="Seek"
              />
            )}
          </div>
        </div>

        <div className={styles.controlsRow}>
          <div className={styles.controlsLeft}>
            {isStreamer ? (
              <>
                <button
                  className={styles.ctrlBtn}
                  onClick={() => seek(currentTime - 30)}
                  title="Back 30s"
                  aria-label="Back 30 seconds"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span className={styles.seekLabel}>30</span>
                </button>

                <button
                  className={`${styles.ctrlBtn} ${styles.seekFine}`}
                  onClick={() => seek(currentTime - 10)}
                  title="Back 10s"
                  aria-label="Back 10 seconds"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span className={styles.seekLabel}>10</span>
                </button>

                <button
                  className={styles.ctrlBtn}
                  onClick={togglePlay}
                  title={paused ? 'Play' : 'Pause'}
                  aria-label={paused ? 'Play' : 'Pause'}
                >
                  {paused ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="5" y="3" width="4" height="18" rx="1" />
                      <rect x="15" y="3" width="4" height="18" rx="1" />
                    </svg>
                  )}
                </button>

                <button
                  className={`${styles.ctrlBtn} ${styles.seekFine}`}
                  onClick={() => seek(currentTime + 10)}
                  title="Forward 10s"
                  aria-label="Forward 10 seconds"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  <span className={styles.seekLabel}>10</span>
                </button>

                <button
                  className={styles.ctrlBtn}
                  onClick={() => seek(currentTime + 30)}
                  title="Forward 30s"
                  aria-label="Forward 30 seconds"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  <span className={styles.seekLabel}>30</span>
                </button>
              </>
            ) : (
              <span className={styles.viewerLabel}>
                {paused ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }} aria-hidden="true">
                    <rect x="5" y="3" width="4" height="18" rx="1" />
                    <rect x="15" y="3" width="4" height="18" rx="1" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }} aria-hidden="true">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
                {paused ? 'Paused' : 'Playing'}
              </span>
            )}

            <span className={styles.time}>{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>

          <div className={styles.controlsRight}>
            {isStreamer && hasFile && (
              <button
                className={styles.changeBtn}
                onClick={openFilePicker}
                title="Change video"
                aria-label="Change video"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
              </button>
            )}
            <div className={styles.volumeGroup}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />
                {volume > 0 && <path d="M15.54 8.46a5 5 0 010 7.07" />}
                {volume > 0.5 && <path d="M19.07 4.93a10 10 0 010 14.14" />}
              </svg>
              <input
                type="range"
                className={styles.volumeSlider}
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
              />
            </div>

            <button
              className={styles.ctrlBtn}
              onClick={toggleFullscreen}
              title="Fullscreen"
              aria-label={isFullscreen || mobileFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {isFullscreen || mobileFullscreen ? (
                  <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3" />
                ) : (
                  <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
