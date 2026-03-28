import { useRef, useEffect, useCallback, useState } from 'react';
import { useRoom } from '../contexts/RoomContext';
import CONFIG from '../config';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer({ swapped }) {
  const {
    role, status, remoteStream, remoteCameraStream,
    sendVideoStream, sendSyncEvent, startHeartbeat, stopHeartbeat, onSyncEvent,
    isSyncing, showSyncing,
  } = useRoom();

  const videoRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const fileInputRef = useRef(null);
  const [hasFile, setHasFile] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimer = useRef(null);
  const containerRef = useRef(null);
  const isSyncingRef = useRef(false);
  const isStreamer = role === 'streamer';

  // Determine which stream to show in the main video
  const mainStream = swapped ? remoteCameraStream : (isStreamer ? null : remoteStream);

  // --- Streamer: file handling ---
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const hidden = document.createElement('video');
    hidden.playsInline = true;
    hidden.src = URL.createObjectURL(file);
    hiddenVideoRef.current = hidden;

    hidden.onloadedmetadata = () => {
      setDuration(hidden.duration);
      setHasFile(true);

      let stream;
      if (hidden.captureStream) {
        stream = hidden.captureStream();
      } else if (hidden.mozCaptureStream) {
        stream = hidden.mozCaptureStream();
      }

      if (!stream) return;

      // Show in main video
      if (videoRef.current && !swapped) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      // Send to peer if connected
      if (status === 'connected') {
        sendVideoStream(stream);
        startHeartbeat(() => ({
          currentTime: hidden.currentTime,
          paused: hidden.paused,
        }));
      }
    };
  }, [status, sendVideoStream, startHeartbeat, swapped]);

  // Resend stream when peer connects after file is loaded
  useEffect(() => {
    if (isStreamer && status === 'connected' && hiddenVideoRef.current) {
      const hidden = hiddenVideoRef.current;
      const stream = hidden.captureStream?.() || hidden.mozCaptureStream?.();
      if (stream) {
        sendVideoStream(stream);
        startHeartbeat(() => ({
          currentTime: hidden.currentTime,
          paused: hidden.paused,
        }));
      }
    }
  }, [status, isStreamer, sendVideoStream, startHeartbeat]);

  // --- Viewer: attach remote stream ---
  useEffect(() => {
    if (!isStreamer && remoteStream && videoRef.current && !swapped) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.play().catch(() => {});
    }
  }, [remoteStream, isStreamer, swapped]);

  // --- Swapped mode: show camera in main ---
  useEffect(() => {
    if (!videoRef.current) return;
    if (swapped && remoteCameraStream) {
      videoRef.current.srcObject = remoteCameraStream;
      videoRef.current.play().catch(() => {});
    } else if (!swapped) {
      if (isStreamer && hiddenVideoRef.current) {
        const stream = hiddenVideoRef.current.captureStream?.() || hiddenVideoRef.current.mozCaptureStream?.();
        if (stream) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } else if (remoteStream) {
        videoRef.current.srcObject = remoteStream;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [swapped, remoteCameraStream, remoteStream, isStreamer]);

  // --- Sync handling ---
  useEffect(() => {
    onSyncEvent((msg) => {
      isSyncingRef.current = true;
      const hidden = hiddenVideoRef.current;

      if (isStreamer && hidden) {
        switch (msg.type) {
          case 'play': hidden.play().catch(() => {}); break;
          case 'pause': hidden.pause(); break;
          case 'seek': hidden.currentTime = msg.currentTime; break;
        }
      } else {
        // Viewer
        switch (msg.type) {
          case 'play':
            if (videoRef.current) videoRef.current.play().catch(() => {});
            break;
          case 'pause':
            if (videoRef.current) videoRef.current.pause();
            break;
          case 'seek':
            showSyncing();
            break;
          case 'sync-heartbeat': {
            if (videoRef.current) {
              const diff = Math.abs(videoRef.current.currentTime - msg.currentTime) * 1000;
              if (diff > CONFIG.sync.seekToleranceMs) {
                showSyncing();
              }
              if (msg.paused && !videoRef.current.paused) videoRef.current.pause();
              else if (!msg.paused && videoRef.current.paused) videoRef.current.play().catch(() => {});
            }
            break;
          }
        }
      }

      setTimeout(() => { isSyncingRef.current = false; }, 100);
    });
  }, [isStreamer, onSyncEvent, showSyncing]);

  // --- Time update ---
  useEffect(() => {
    const src = isStreamer ? hiddenVideoRef.current : videoRef.current;
    if (!src) return;

    const onTime = () => {
      setCurrentTime(src.currentTime);
      setDuration(src.duration || 0);
      setPaused(src.paused);
    };
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);

    const interval = setInterval(onTime, 250);
    src.addEventListener('play', onPlay);
    src.addEventListener('pause', onPause);
    src.addEventListener('loadedmetadata', () => setDuration(src.duration));

    return () => {
      clearInterval(interval);
      src.removeEventListener('play', onPlay);
      src.removeEventListener('pause', onPause);
    };
  }, [isStreamer, hasFile, remoteStream]);

  // --- Controls ---
  const togglePlay = () => {
    const hidden = hiddenVideoRef.current;
    if (isStreamer && hidden) {
      if (hidden.paused) { hidden.play(); sendSyncEvent('play', hidden.currentTime); }
      else { hidden.pause(); sendSyncEvent('pause', hidden.currentTime); }
    } else {
      sendSyncEvent(paused ? 'play' : 'pause', currentTime);
    }
  };

  const seek = (time) => {
    const clamped = Math.max(0, Math.min(time, duration));
    if (isStreamer && hiddenVideoRef.current) {
      hiddenVideoRef.current.currentTime = clamped;
    }
    sendSyncEvent('seek', clamped);
  };

  const handleProgressChange = (e) => {
    const pct = parseFloat(e.target.value);
    seek((pct / 100) * duration);
  };

  const handleVolumeChange = (e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
    if (hiddenVideoRef.current) hiddenVideoRef.current.volume = v;
  };

  const toggleFullscreen = () => {
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

  // Auto-hide controls
  const showControlsTemporarily = () => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!paused) setShowControls(false);
    }, 3000);
  };

  const formatTime = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onMouseMove={showControlsTemporarily}
      onTouchStart={showControlsTemporarily}
    >
      {/* Main video */}
      <div className={styles.videoWrapper}>
        <video
          ref={videoRef}
          className={styles.video}
          playsInline
          onClick={togglePlay}
        />

        {/* Overlays */}
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
              <button className={styles.pickBtn} onClick={() => fileInputRef.current?.click()}>
                Choose File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        )}

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
        {/* Progress bar */}
        <div className={styles.progressRow}>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
            <input
              type="range"
              className={styles.progressInput}
              min="0"
              max="100"
              step="0.1"
              value={progressPct}
              onChange={handleProgressChange}
            />
          </div>
        </div>

        <div className={styles.controlsRow}>
          <div className={styles.controlsLeft}>
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

            <span className={styles.time}>{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>

          <div className={styles.controlsRight}>
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
                {isFullscreen ? (
                  <>
                    <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3" />
                  </>
                ) : (
                  <>
                    <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
