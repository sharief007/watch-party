import { useState } from 'react';
import { useRoom } from '../contexts/RoomContext';
import TopBar from './TopBar';
import VideoPlayer from './VideoPlayer';
import ChatPanel from './ChatPanel';
import CameraOverlay from './CameraOverlay';
import styles from './Room.module.css';

export default function Room() {
  const [chatOpen, setChatOpen] = useState(false);
  const [swapped, setSwapped] = useState(false);

  return (
    <div className={styles.room}>
      <TopBar chatOpen={chatOpen} onToggleChat={() => setChatOpen(o => !o)} />

      <div className={`${styles.content} ${chatOpen ? styles.chatOpen : ''}`}>
        <div className={styles.videoSection}>
          <VideoPlayer swapped={swapped} />
          <CameraOverlay swapped={swapped} onSwap={() => setSwapped(s => !s)} />
        </div>

        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    </div>
  );
}
