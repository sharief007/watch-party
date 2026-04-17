import { useRoom } from '../contexts/RoomContext';
import styles from './TopBar.module.css';

export default function TopBar({ chatOpen, onToggleChat }) {
  const {
    status, role, roomName, leaveRoom,
    cameraEnabled, micEnabled, toggleCamera, toggleMic,
    localCameraStream, startCamera,
    unreadCount,
  } = useRoom();

  const statusLabel =
    status === 'connected' ? 'Connected'
    : status === 'connecting' ? 'Connecting...'
    : status === 'reconnecting' ? 'Reconnecting...'
    : 'Disconnected';

  // First tap on camera button starts the camera (user gesture required for mobile).
  // Subsequent taps toggle enable/disable.
  const handleCameraClick = async () => {
    if (!localCameraStream) {
      await startCamera();
    } else {
      toggleCamera();
    }
  };

  const handleMicClick = async () => {
    if (!localCameraStream) {
      // Mic requires camera to be started first (they share the same getUserMedia call)
      await startCamera();
    } else {
      toggleMic();
    }
  };

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <button className={styles.backBtn} onClick={leaveRoom} title="Leave room">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className={styles.info}>
          <span className={styles.roomName}>{roomName}</span>
          <span className={styles.status}>
            <span className={`${styles.dot} ${styles[status]}`} />
            {statusLabel}
            <span className={styles.roleBadge}>{role === 'streamer' ? 'Streaming' : 'Watching'}</span>
          </span>
        </div>
      </div>

      <div className={styles.right}>
        <button
          className={`${styles.iconBtn} ${localCameraStream && !micEnabled ? styles.off : ''} ${!localCameraStream ? styles.inactive : ''}`}
          onClick={handleMicClick}
          title={!localCameraStream ? 'Enable mic' : micEnabled ? 'Mute mic' : 'Unmute mic'}
        >
          {localCameraStream && !micEnabled ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
              <path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .87-.16 1.7-.44 2.47" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        <button
          className={`${styles.iconBtn} ${localCameraStream && !cameraEnabled ? styles.off : ''} ${!localCameraStream ? styles.inactive : ''}`}
          onClick={handleCameraClick}
          title={!localCameraStream ? 'Enable camera' : cameraEnabled ? 'Disable camera' : 'Enable camera'}
        >
          {localCameraStream && !cameraEnabled ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          )}
        </button>

        <button
          className={`${styles.iconBtn} ${styles.chatBtn}`}
          onClick={onToggleChat}
          title="Toggle chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
        </button>
      </div>
    </header>
  );
}
