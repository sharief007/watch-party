import { useRef, useEffect, useState, useCallback } from 'react';
import { useRoom } from '../contexts/RoomContext';
import styles from './CameraOverlay.module.css';

// Responsive widths: floor / target-%-of-viewport / cap. Height auto-derives
// from the 4:3 aspect-ratio on .videoBox in CSS. XL caps at 480 px on desktop
// but shrinks to 66vw on narrow phones so it cannot overflow the viewport.
const SIZES = [
  { w: 'clamp(120px, 22vw, 140px)', label: 'S' },
  { w: 'clamp(160px, 32vw, 220px)', label: 'M' },
  { w: 'clamp(200px, 48vw, 340px)', label: 'L' },
  { w: 'clamp(240px, 66vw, 480px)', label: 'XL' },
];

export default function CameraOverlay({ showRemoteCam = true }) {
  const { remoteCameraStream, localCameraStream } = useRoom();
  const remoteRef = useRef(null);
  const localRef = useRef(null);
  const [sizeIdx, setSizeIdx] = useState(1); // start at M
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: null, y: null });
  const dragStart = useRef(null);
  const overlayRef = useRef(null);

  // Attach streams
  useEffect(() => {
    if (remoteRef.current && remoteCameraStream && showRemoteCam) {
      remoteRef.current.srcObject = remoteCameraStream;
      remoteRef.current.play().catch(() => {});
    }
  }, [remoteCameraStream, showRemoteCam]);

  useEffect(() => {
    if (localRef.current && localCameraStream) {
      localRef.current.srcObject = localCameraStream;
      localRef.current.play().catch(() => {});
    }
  }, [localCameraStream]);

  const cycleSize = () => {
    setSizeIdx(i => (i + 1) % SIZES.length);
  };

  // Clamp a position so the overlay stays inside the viewport. Uses the
  // current bounding box for size, falling back to sensible defaults.
  const clampPos = useCallback((x, y) => {
    const el = overlayRef.current;
    const w = el ? el.offsetWidth : 200;
    const h = el ? el.offsetHeight : 150;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }, []);

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
      // Pointer events carry clientX/clientY directly; no TouchEvent fallback
      // is needed because we're listening to pointermove, not touchmove.
      const next = clampPos(
        e.clientX - dragStart.current.offsetX,
        e.clientY - dragStart.current.offsetY,
      );
      setPos(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, clampPos]);

  // Re-clamp when viewport changes (device rotation, window resize) so the
  // overlay cannot end up outside the visible area.
  useEffect(() => {
    const onResize = () => {
      setPos(prev => {
        if (prev.x === null || prev.y === null) return prev;
        return clampPos(prev.x, prev.y);
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [clampPos]);

  const hasRemote = !!remoteCameraStream && showRemoteCam;
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
      {/* Remote camera */}
      {hasRemote && (
        <div className={styles.videoBox}>
          <video
            ref={remoteRef}
            className={styles.video}
            playsInline
            autoPlay
          />
          <span className={styles.label}>Remote</span>
        </div>
      )}

      {/* Local camera */}
      {hasLocal && (
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
        <button
          className={styles.ctrlBtn}
          onClick={cycleSize}
          title={`Size: ${SIZES[(sizeIdx + 1) % SIZES.length].label}`}
          aria-label={`Change size (current: ${size.label})`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
