import { useState } from 'react';
import { useRoom } from '../contexts/RoomContext';
import styles from './Lobby.module.css';

export default function Lobby() {
  const { createRoom, joinRoom, error, status } = useRoom();
  const [roomInput, setRoomInput] = useState('');
  const isLoading = status === 'connecting';

  const handleCreate = () => {
    if (roomInput.trim()) createRoom(roomInput.trim());
  };
  const handleJoin = () => {
    if (roomInput.trim()) joinRoom(roomInput.trim());
  };

  return (
    <div className={styles.lobby}>
      <div className={styles.bg}>
        <div className={styles.orb1} />
        <div className={styles.orb2} />
        <div className={styles.orb3} />
      </div>

      <div className={styles.card}>
        <div className={styles.logo}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="url(#g1)" />
            <path d="M18 14L34 24L18 34V14Z" fill="white" fillOpacity="0.95" />
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="48" y2="48">
                <stop stopColor="#6c5ce7" />
                <stop offset="1" stopColor="#e94560" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className={styles.title}>Watch Party</h1>
        <p className={styles.subtitle}>Watch together, anywhere</p>

        <div className={styles.inputGroup}>
          <label className={styles.label}>Room Name</label>
          <input
            className={styles.input}
            type="text"
            value={roomInput}
            onChange={e => setRoomInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            placeholder="e.g. movie-night"
            autoFocus
            disabled={isLoading}
          />
        </div>

        <div className={styles.buttons}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleCreate}
            disabled={!roomInput.trim() || isLoading}
          >
            {isLoading ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            )}
            Create Room
          </button>
          <button
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={handleJoin}
            disabled={!roomInput.trim() || isLoading}
          >
            {isLoading ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
              </svg>
            )}
            Join Room
          </button>
        </div>

        {error && (
          <div className={styles.error}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        <p className={styles.hint}>
          Create a room and share the name with a friend, or join an existing room.
        </p>
      </div>
    </div>
  );
}
