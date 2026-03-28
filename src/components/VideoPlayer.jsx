import { useRef, useEffect, useState } from 'react';
import { useRoom } from '../contexts/RoomContext';
import CONFIG from '../config';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer({ swapped }) {
  const {
    role, status, remoteStream, remoteCameraStream,
    sendVideoStream, sendSyncEvent, startHeartbeat, stopHeartbeat, onSyncEvent,
    isSyncing, showSyncing,
    trackObjectUrl, trackVideoElement,
  } = useRoom();

  const videoRef = useRef(null);
  const captureStreamRef = useRef(null);
  const fileInputRef = useRef(null);
  const [hasFile, setHasFile] = useState(false);
  const [needsStreamerStart, setNeedsStreamerStart] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [needsUserPlay, setNeedsUserPlay] = useState(false);
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

    const url = URL.createObjectURL(file);
    trackObjectUrl(url);

    const vid = videoRef.current;
    if (!vid) return;

    vid.srcObject = null;
    vid.src = url;
    vid.load();

    vid.onloadedmetadata = () => {
      setDuration(vid.duration);
      setHasFile(true);

      let stream = null;
      if (vid.captureStream) {
        stream = vid.captureStream();
      } else if (vid.mozCaptureStream) {
        stream = vid.mozCaptureStream();
      }
      captureStreamRef.current = stream;
      trackVideoElement(vid);

      if (stream && status === 'connected') {
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

  // Send stream when peer connects (if file already loaded)
  useEffect(() => {
    if (isStreamer && status === 'connected' && captureStreamRef.current) {
      sendVideoStream(captureStreamRef.current);
      const vid = videoRef.current;
      if (vid) startHeartbeat(() => ({ currentTime: vid.currentTime, paused: vid.paused }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ─── Viewer: attach remote video stream ───
  // Don't autoplay with audio — show a "Tap to Watch" overlay instead.
  // This is the ONLY reliable cross-platform approach for mobile.
  useEffect(() => {
    if (!isStreamer && remoteStream && videoRef.current && !swapped) {
      const vid = videoRef.current;
      vid.removeAttribute('src');
      vid.srcObject = remoteStream;
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
  }, [remoteStream, isStreamer, swapped]);

  // Streamer taps "Start Streaming" — real user gesture satisfies autoplay policy
  const handleStreamerStart = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.play().catch(() => {});
    sendSyncEvent('play', vid.currentTime);
    setNeedsStreamerStart(false);
  };

  // Viewer taps "Start Watching" — this is a real user gesture so unmute works
  const handleViewerTap = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = false;
    vid.play().catch(() => {});
    setNeedsUserPlay(false);
  };

  // ─── Swapped mode ───
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (swapped && remoteCameraStream) {
      vid.srcObject = remoteCameraStream;
      vid.play().catch(() => {});
    } else if (!swapped && !isStreamer && remoteStream) {
      vid.srcObject = remoteStream;
      vid.play().catch(() => {});
    }
  }, [swapped, remoteCameraStream, remoteStream, isStreamer]);

  // ─── Sync: viewer receives events from streamer ───
  useEffect(() => {
    onSyncEvent((msg) => {
      if (isStreamer) return;

      const vid = videoRef.current;
      if (!vid) return;

      switch (msg.type) {
        case 'play':
          vid.play().catch(() => {});
          break;
        case 'pause':
          vid.pause();
          break;
        case 'seek':
          vid.currentTime = msg.currentTime;
          showSyncing();
          break;
        case 'sync-heartbeat': {
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
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const update = () => {
      if (vid.duration) setDuration(vid.duration);
      setCurrentTime(vid.currentTime || 0);
      setPaused(vid.paused);
    };
    const onEnded = () => {
      if (isStreamer) {
        setVideoEnded(true);
        setNeedsStreamerStart(false);
        setPaused(true);
        sendSyncEvent('pause', vid.currentTime);
      }
    };

    const interval = setInterval(update, 250);
    vid.addEventListener('loadedmetadata', update);
    vid.addEventListener('play', update);
    vid.addEventListener('pause', update);
    vid.addEventListener('ended', onEnded);

    return () => {
      clearInterval(interval);
      vid.removeEventListener('loadedmetadata', update);
      vid.removeEventListener('play', update);
      vid.removeEventListener('pause', update);
      vid.removeEventListener('ended', onEnded);
    };
  }, [hasFile, remoteStream, isStreamer, sendSyncEvent]);

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

  const toggleFullscreen = () => {
    // Exit CSS-rotation fullscreen
    if (mobileFullscreen) {
      setMobileFullscreen(false);
      return;
    }

    // On mobile with a landscape (rectangular) video, rotate rather than
    // using requestFullscreen (which is unsupported on iOS Safari).
    const isMobile = window.innerWidth <= 768 || navigator.maxTouchPoints > 0;
    const vid = videoRef.current;
    const isLandscape = vid && vid.videoWidth > 0 && vid.videoWidth > vid.videoHeight;
    if (isMobile && isLandscape) {
      setMobileFullscreen(true);
      return;
    }

    // Desktop / portrait video: use native fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen?.();
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const showControlsTemporarily = () => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!paused) setShowControls(false);
    }, 3000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHeartbeat();
      clearTimeout(controlsTimer.current);
      const vid = videoRef.current;
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
          <div className={styles.overlay} onClick={handleViewerTap} style={{ cursor: 'pointer' }}>
            <div className={styles.tapToWatch}>
              <div className={styles.tapIcon}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="white">
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
          <div className={styles.overlay} onClick={handleStreamerStart} style={{ cursor: 'pointer' }}>
            <div className={styles.tapToWatch}>
              <div className={styles.tapIcon}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="white">
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
        />

        {/* Streamer: initial file picker overlay */}
        {!hasFile && isStreamer && !swapped && (
          <div className={styles.overlay}>
            <div className={styles.pickFile}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <path d="M12 18v-6M9 15l3-3 3 3" />
              </svg>
              <h3>Select a video file</h3>
              <p>Choose a video from your device to start streaming</p>
              <button className={styles.pickBtn} onClick={openFilePicker}>
                Choose File
              </button>
            </div>
          </div>
        )}

        {/* Streamer: video ended overlay */}
        {videoEnded && isStreamer && (
          <div className={styles.overlay}>
            <div className={styles.pickFile}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5">
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
        {!isStreamer && !remoteStream && !swapped && (
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
              />
            )}
          </div>
        </div>

        <div className={styles.controlsRow}>
          <div className={styles.controlsLeft}>
            {isStreamer ? (
              <>
                <button className={styles.ctrlBtn} onClick={togglePlay} title={paused ? 'Play' : 'Pause'}>
                  {paused ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="5" y="3" width="4" height="18" rx="1" />
                      <rect x="15" y="3" width="4" height="18" rx="1" />
                    </svg>
                  )}
                </button>

                <button className={styles.ctrlBtn} onClick={() => seek(currentTime - 10)} title="Back 10s">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M2.5 2v6h6M2.5 8a10 10 0 1018 2" />
                  </svg>
                  <span className={styles.seekLabel}>10</span>
                </button>

                <button className={styles.ctrlBtn} onClick={() => seek(currentTime + 10)} title="Forward 10s">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21.5 2v6h-6M21.5 8A10 10 0 103.5 10" />
                  </svg>
                  <span className={styles.seekLabel}>10</span>
                </button>
              </>
            ) : (
              <span className={styles.viewerLabel}>
                {paused ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }}>
                    <rect x="5" y="3" width="4" height="18" rx="1" />
                    <rect x="15" y="3" width="4" height="18" rx="1" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }}>
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
              <button className={styles.changeBtn} onClick={openFilePicker} title="Change video">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
              </button>
            )}
            <div className={styles.volumeGroup}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              />
            </div>

            <button className={styles.ctrlBtn} onClick={toggleFullscreen} title="Fullscreen">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
