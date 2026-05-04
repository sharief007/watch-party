import { useEffect, useRef } from 'react';

// Keeps the screen awake while `active` is true. Re-acquires after the page
// returns from background, since the spec drops the lock on visibility change.
export function useWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          try { lock.release(); } catch { /* ignore */ }
          return;
        }
        lockRef.current = lock;
        lock.addEventListener('release', () => {
          if (lockRef.current === lock) lockRef.current = null;
        });
      } catch {
        // user agent rejected (e.g. backgrounded, low battery) — try again on next visibility
      }
    };

    acquire();

    const onVis = () => {
      if (document.visibilityState === 'visible' && !lockRef.current) acquire();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      if (lockRef.current) {
        try { lockRef.current.release(); } catch { /* ignore */ }
        lockRef.current = null;
      }
    };
  }, [active]);
}

// Sets MediaSession metadata + action handlers. Pass null/undefined for any
// handler the caller doesn't want exposed (e.g. viewers don't get play/pause).
// Handlers are read via a ref so deps stay stable.
export function useMediaSession({
  enabled,
  title,
  paused,
  onPlay,
  onPause,
  onSeekBackward,
  onSeekForward,
}) {
  const handlersRef = useRef({});
  handlersRef.current = { onPlay, onPause, onSeekBackward, onSeekForward };

  const hasPlay = !!onPlay;
  const hasPause = !!onPause;
  const hasSeekBack = !!onSeekBackward;
  const hasSeekFwd = !!onSeekForward;

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!enabled) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      } catch { /* ignore */ }
      return;
    }

    try {
      // eslint-disable-next-line no-undef
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Watch Party',
        artist: 'Watch Party',
      });
      navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
    } catch { /* ignore */ }

    const set = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); }
      catch { /* unsupported action — ignore */ }
    };

    set('play', hasPlay ? () => handlersRef.current.onPlay?.() : null);
    set('pause', hasPause ? () => handlersRef.current.onPause?.() : null);
    set('seekbackward', hasSeekBack
      ? (e) => handlersRef.current.onSeekBackward?.(e?.seekOffset || 10)
      : null);
    set('seekforward', hasSeekFwd
      ? (e) => handlersRef.current.onSeekForward?.(e?.seekOffset || 10)
      : null);

    return () => {
      ['play', 'pause', 'seekbackward', 'seekforward'].forEach((a) => {
        try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ }
      });
    };
  }, [enabled, title, paused, hasPlay, hasPause, hasSeekBack, hasSeekFwd]);
}
