import { useEffect, useRef } from 'react';
import styles from './LeaveConfirmModal.module.css';

export default function LeaveConfirmModal({ open, onCancel, onConfirm }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onCancel} role="presentation">
      <div
        className={styles.modal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
        aria-describedby="leave-confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="leave-confirm-title" className={styles.title}>Leave the room?</h2>
        <p id="leave-confirm-desc" className={styles.desc}>
          You will disconnect from your peer. You can rejoin afterwards.
        </p>
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            type="button"
            className={`${styles.btn} ${styles.cancel}`}
            onClick={onCancel}
          >
            Stay
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.confirm}`}
            onClick={onConfirm}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
