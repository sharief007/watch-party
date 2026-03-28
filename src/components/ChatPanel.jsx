import { useState, useRef, useEffect } from 'react';
import { useRoom } from '../contexts/RoomContext';
import styles from './ChatPanel.module.css';

export default function ChatPanel({ open, onClose }) {
  const { chatMessages, sendChat, setUnreadCount } = useRoom();
  const [input, setInput] = useState('');
  const messagesRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Clear unread when opened
  useEffect(() => {
    if (open) setUnreadCount(0);
  }, [open, setUnreadCount]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendChat(input);
    setInput('');
  };

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`${styles.panel} ${open ? styles.open : ''}`}>
      <div className={styles.header}>
        <h3>Chat</h3>
        <button className={styles.closeBtn} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className={styles.messages} ref={messagesRef}>
        {chatMessages.length === 0 && (
          <div className={styles.empty}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-400)" strokeWidth="1.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <p>No messages yet</p>
          </div>
        )}
        {chatMessages.map((msg, i) => (
          <div key={`${msg.timestamp}-${i}`} className={`${styles.msg} ${msg.isMine ? styles.mine : styles.theirs}`}>
            <div className={styles.bubble}>
              {msg.text}
            </div>
            <span className={styles.time}>{formatTime(msg.timestamp)}</span>
          </div>
        ))}
      </div>

      <div className={styles.inputArea}>
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          autoComplete="off"
        />
        <button className={styles.sendBtn} onClick={handleSend} disabled={!input.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22,2 15,22 11,13 2,9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
