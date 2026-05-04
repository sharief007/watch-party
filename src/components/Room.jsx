import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoom } from '../contexts/RoomContext';
import { useWakeLock } from '../hooks/usePresenceHints';
import TopBar from './TopBar';
import VideoPlayer from './VideoPlayer';
import ChatPanel from './ChatPanel';
import CameraOverlay from './CameraOverlay';
import LeaveConfirmModal from './LeaveConfirmModal';
import styles from './Room.module.css';

const SENTINEL = { __watchPartyInRoom: true };

export default function Room() {
  const { chatOpen, setChatOpen, leaveRoom, status, error, clearError, remoteCameraStream } = useRoom();
  useWakeLock(status === 'connected');
  const [showRemoteCam, setShowRemoteCam] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const sentinelPushedRef = useRef(false);

  // Auto-dismiss transient errors (e.g. camera permission) after 6s.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => clearError(), 6000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  const requestLeave = useCallback(() => setConfirmOpen(true), []);
  const cancelLeave = useCallback(() => setConfirmOpen(false), []);
  const confirmLeave = useCallback(() => {
    setConfirmOpen(false);
    leaveRoom();
  }, [leaveRoom]);

  // Intercept Android system back button (and browser back) so accidental
  // presses don't drop the peer connection. The sentinel pushed here is
  // re-pushed on every back so a held-down or repeated press still hits us.
  useEffect(() => {
    if (!sentinelPushedRef.current) {
      try {
        window.history.pushState(SENTINEL, '');
        sentinelPushedRef.current = true;
      } catch {
        // pushState can throw in some sandboxed contexts; degrade gracefully
      }
    }

    const onPopState = () => {
      try {
        window.history.pushState(SENTINEL, '');
      } catch {
        // ignore
      }
      setConfirmOpen(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div className={styles.room}>
      <TopBar
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(o => !o)}
        onRequestLeave={requestLeave}
        showRemoteCam={showRemoteCam}
        onToggleRemoteCam={() => setShowRemoteCam(v => !v)}
        hasRemoteCam={!!remoteCameraStream}
      />

      <div className={`${styles.content} ${chatOpen ? styles.chatOpen : ''}`}>
        <div className={styles.videoSection}>
          <VideoPlayer />
          <CameraOverlay showRemoteCam={showRemoteCam} />
        </div>

        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>

      <LeaveConfirmModal
        open={confirmOpen}
        onCancel={cancelLeave}
        onConfirm={confirmLeave}
      />

      {error && (
        <div className={styles.toast} role="status" aria-live="polite">
          <span>{error}</span>
          <button
            type="button"
            className={styles.toastClose}
            onClick={clearError}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
