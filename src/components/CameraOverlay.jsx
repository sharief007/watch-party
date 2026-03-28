import { useRef, useEffect, useState, useCallback } from 'react';
import { useRoom } from '../contexts/RoomContext';
import styles from './CameraOverlay.module.css';

const SIZES = [
  { w: 140, h: 105, label: 'S' },
  { w: 220, h: 165, label: 'M' },
  { w: 340, h: 255, label: 'L' },
  { w: 480, h: 360, label: 'XL' },
];

export default function CameraOverlay({ swapped, onSwap }) {
  const { remoteCameraStream, localCameraStream, remoteStream, role } = useRoom();
  const remoteRef = useRef(null);
  const localRef = useRef(null);
  const [sizeIdx, setSizeIdx] = useState(1); // start at M
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: null, y: null });
  const dragStart = useRef(null);
  const overlayRef = useRef(null);

  // In swapped mode, PiP shows the video stream instead of the camera
  const pipStream = swapped
    ? (role === 'streamer' ? null : remoteStream)
    : remoteCameraStream;

  // Attach streams
  useEffect(() => {
    if (remoteRef.current && pipStream) {
      remoteRef.current.srcObject = pipStream;
    }
  }, [pipStream]);

  useEffect(() => {
    if (localRef.current && localCameraStream) {
      localRef.current.srcObject = localCameraStream;
    }
  }, [localCameraStream]);

  const cycleSize = () => {
    setSizeIdx(i => (i + 1) % SIZES.length);
  };

  // Dragging
  const onPointerDown = useCallback((e) => {
    if (e.target.closest('button')) return;
    setDragging(true);
    const rect = overlayRef.current.getBoundingClientRect();
    dragStart.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      setPos({
        x: clientX - dragStart.current.offsetX,
        y: clientY - dragStart.current.offsetY,
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  const hasRemote = !!pipStream;
  const hasLocal = !!localCameraStream;
  if (!hasRemote && !hasLocal) return null;

  const size = SIZES[sizeIdx];
  const posStyle = pos.x !== null
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : {};

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      style={{ width: size.w, ...posStyle }}
      onPointerDown={onPointerDown}
    >
      {/* Remote camera (or video when swapped) */}
      {hasRemote && (
        <div className={styles.videoBox}>
          <video
            ref={remoteRef}
            className={styles.video}
            playsInline
            autoPlay
            muted={swapped}
          />
          <span className={styles.label}>{swapped ? 'Video' : 'Remote'}</span>
        </div>
      )}

      {/* Local camera */}
      {hasLocal && !swapped && (
        <div className={`${styles.videoBox} ${styles.local}`}>
          <video
            ref={localRef}
            className={styles.video}
            playsInline
            autoPlay
            muted
          />
          <span className={styles.label}>You</span>
        </div>
      )}

      {/* Controls */}
      <div className={styles.controls}>
        <button className={styles.ctrlBtn} onClick={onSwap} title="Swap with main video">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 014-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
        </button>
        <button className={styles.ctrlBtn} onClick={cycleSize} title={`Size: ${SIZES[(sizeIdx + 1) % SIZES.length].label}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
