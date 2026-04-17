import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import Peer from 'peerjs';
import CONFIG from '../config';

const RoomContext = createContext(null);

const RECONNECT_MAX_DELAY_MS = 30_000;
const ICE_RESTART_GRACE_MS = 3000;

export function RoomProvider({ children }) {
  const [status, setStatus] = useState('idle');
  const [role, setRole] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteCameraStream, setRemoteCameraStream] = useState(null);
  const [localCameraStream, setLocalCameraStream] = useState(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const localStreamRef = useRef(null);
  const heartbeatRef = useRef(null);
  const syncCallbackRef = useRef(null);
  const cleanupRef = useRef({ objectUrls: [], videoElements: [], streams: [] });

  // Single Map of all media calls, keyed by `${direction}:${type}:${peerId}`.
  // Direction ∈ out|in; type ∈ video|camera. Replaces videoCallRef/cameraCallRef/
  // incomingCallsRef so stale calls are replaced deterministically.
  const callsRef = useRef(new Map());
  const cameraStartingRef = useRef(false);
  const connTimeoutRef = useRef(null);

  // Reconnect / role refs (read from non-React code paths)
  const roleRef = useRef(null);
  const roomIdRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const isLeavingRef = useRef(false);
  // Remember the streamer's file capture stream so we can re-send on reconnect.
  const lastVideoStreamRef = useRef(null);

  const sendData = useCallback((data) => {
    const conn = connRef.current;
    if (conn && conn.open) {
      conn.send(data);
    }
  }, []);

  // ─── Call management ────────────────────────────────────────────────
  const closeCall = useCallback((key) => {
    const c = callsRef.current.get(key);
    if (c) {
      try { c.close(); } catch {}
      callsRef.current.delete(key);
    }
  }, []);

  const closeAllCalls = useCallback(() => {
    for (const [, c] of callsRef.current) { try { c.close(); } catch {} }
    callsRef.current.clear();
  }, []);

  // Forward declarations for ICE-failure re-issue handlers (defined later).
  const resendVideoIfNeededRef = useRef(null);
  const resendCameraIfNeededRef = useRef(null);

  // Attach ICE state listeners to a MediaConnection. On failure, try restartIce;
  // if still bad after a grace window, invoke the on-fail callback to re-issue
  // the call. PeerJS exposes the underlying RTCPeerConnection as `peerConnection`,
  // but it may be null for a brief window after construction — so we poll.
  const attachIceListeners = useCallback((call, onFailed) => {
    let attached = false;
    const tryAttach = (retries = 20) => {
      if (attached) return;
      const pc = call.peerConnection;
      if (!pc) {
        if (retries > 0) setTimeout(() => tryAttach(retries - 1), 200);
        return;
      }
      attached = true;
      pc.addEventListener('iceconnectionstatechange', () => {
        const s = pc.iceConnectionState;
        if (s === 'failed') {
          try { pc.restartIce?.(); } catch {}
          setTimeout(() => {
            const cur = pc.iceConnectionState;
            if (cur === 'failed' || cur === 'disconnected' || cur === 'closed') {
              try { onFailed(); } catch {}
            }
          }, ICE_RESTART_GRACE_MS);
        }
      });
    };
    tryAttach();
  }, []);

  // ─── Reconnect loop ─────────────────────────────────────────────────
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const tryReconnectRef = useRef(null);

  const scheduleReconnect = useCallback(() => {
    if (isLeavingRef.current) return;
    clearReconnectTimer();
    const attempt = reconnectAttemptsRef.current;
    const base = Math.min(RECONNECT_MAX_DELAY_MS, 1000 * Math.pow(2, attempt));
    // Full-jitter: random delay in [500ms, base]
    const delay = Math.max(500, Math.random() * base);
    reconnectAttemptsRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      tryReconnectRef.current?.();
    }, delay);
  }, [clearReconnectTimer]);

  // ─── Data connection setup ──────────────────────────────────────────
  const setupDataConnection = useCallback((conn) => {
    connRef.current = conn;

    if (connTimeoutRef.current) clearTimeout(connTimeoutRef.current);
    connTimeoutRef.current = setTimeout(() => {
      if (connRef.current === conn && !conn.open) {
        // During reconnect mode, just try again rather than hard-failing.
        if (reconnectAttemptsRef.current > 0) {
          try { conn.close(); } catch {}
          connRef.current = null;
          scheduleReconnect();
          return;
        }
        setStatus('error');
        setError('Could not establish a connection. Check the room name, ensure both devices are online, and try again.');
        if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
        connRef.current = null;
      }
    }, 20000);

    conn.on('open', () => {
      if (connTimeoutRef.current) { clearTimeout(connTimeoutRef.current); connTimeoutRef.current = null; }
      reconnectAttemptsRef.current = 0;
      clearReconnectTimer();
      setStatus('connected');
      setError(null);

      // Streamer: re-send the file capture stream if we had one before the drop.
      if (roleRef.current === 'streamer' && lastVideoStreamRef.current && peerRef.current && conn.peer) {
        const key = `out:video:${conn.peer}`;
        closeCall(key);
        try {
          const call = peerRef.current.call(conn.peer, lastVideoStreamRef.current, { metadata: { type: 'video' } });
          callsRef.current.set(key, call);
          attachIceListeners(call, () => { closeCall(key); resendVideoIfNeededRef.current?.(); });
        } catch {}
      }

      // Both sides: re-send camera if we have one locally.
      if (localStreamRef.current && peerRef.current && conn.peer) {
        const key = `out:camera:${conn.peer}`;
        closeCall(key);
        try {
          const call = peerRef.current.call(conn.peer, localStreamRef.current, { metadata: { type: 'camera' } });
          callsRef.current.set(key, call);
          attachIceListeners(call, () => { closeCall(key); resendCameraIfNeededRef.current?.(); });
        } catch {}
      }
    });
    conn.on('data', (data) => {
      if (data.type === 'chat') {
        setChatMessages(prev => [...prev, { ...data, isMine: false }]);
        setUnreadCount(prev => prev + 1);
      } else if (['play', 'pause', 'seek', 'sync-heartbeat'].includes(data.type)) {
        if (syncCallbackRef.current) {
          syncCallbackRef.current(data);
        }
      }
    });
    conn.on('close', () => {
      // Close all media calls — they'll be re-issued on reconnect. Do NOT
      // destroy the peer, stop local streams, or touch the local camera.
      closeAllCalls();
      connRef.current = null;
      setRemoteStream(null);
      setRemoteCameraStream(null);

      if (isLeavingRef.current) return;
      setStatus('reconnecting');
      scheduleReconnect();
    });
    conn.on('error', (err) => {
      setError(err?.message || String(err));
      // Let close handler drive the retry.
    });
  }, [attachIceListeners, closeAllCalls, closeCall, clearReconnectTimer, scheduleReconnect]);

  // ─── Incoming call handler ──────────────────────────────────────────
  const handleIncomingCall = useCallback((call) => {
    const type = call.metadata?.type || 'video';
    const key = `in:${type}:${call.peer}`;
    closeCall(key); // drop any prior incoming call of the same type+peer
    callsRef.current.set(key, call);
    call.on('close', () => { if (callsRef.current.get(key) === call) callsRef.current.delete(key); });
    call.on('error', () => { if (callsRef.current.get(key) === call) callsRef.current.delete(key); });

    if (type === 'video') {
      call.answer();
      call.on('stream', (stream) => setRemoteStream(stream));
    } else if (type === 'camera') {
      call.answer();
      call.on('stream', (stream) => setRemoteCameraStream(stream));
    }
    attachIceListeners(call, () => closeCall(key));
  }, [attachIceListeners, closeCall]);

  // Register long-lived peer event handlers. Called once per Peer instance,
  // both on initial create/join and on each reconnect that recreates the peer.
  const bindPeerEvents = useCallback((peer) => {
    peer.on('call', (call) => handleIncomingCall(call));
    peer.on('connection', (conn) => setupDataConnection(conn));
    peer.on('error', (err) => {
      const t = err?.type;
      if (t === 'peer-unavailable') {
        // Initial join miss → hard error. Reconnect loop → keep trying.
        if (reconnectAttemptsRef.current > 0 && !isLeavingRef.current) {
          scheduleReconnect();
          return;
        }
        setStatus('error');
        setError('Room not found. Check the room name and try again.');
      } else if (t === 'network' || t === 'disconnected' || t === 'server-error' || t === 'socket-error') {
        if (!isLeavingRef.current) {
          setStatus('reconnecting');
          scheduleReconnect();
        }
      } else if (t !== 'unavailable-id') {
        setError(err?.message || String(err));
      }
    });
    peer.on('disconnected', () => {
      if (isLeavingRef.current) return;
      // Signaling-server WebSocket dropped; peer object is still alive.
      try { peer.reconnect(); } catch {}
    });
  }, [handleIncomingCall, scheduleReconnect, setupDataConnection]);

  // Init a new Peer and await 'open'. Uses once() + off() so the error listener
  // from the init Promise does not linger.
  const initPeer = useCallback(async (peerId) => {
    const peer = new Peer(peerId, {
      host: CONFIG.peerjs.host,
      port: CONFIG.peerjs.port,
      secure: CONFIG.peerjs.secure,
      config: {
        iceServers: CONFIG.ice.servers,
        iceCandidatePoolSize: CONFIG.ice.iceCandidatePoolSize,
      },
    });
    await new Promise((resolve, reject) => {
      const onOpen = () => { peer.off('error', onError); resolve(); };
      const onError = (err) => { peer.off('open', onOpen); reject(err); };
      peer.once('open', onOpen);
      peer.once('error', onError);
    });
    return peer;
  }, []);

  // ─── Create room (streamer) ─────────────────────────────────────────
  const createRoom = useCallback(async (name) => {
    const roomId = `${CONFIG.peerjs.roomPrefix}-${name.toLowerCase().trim()}`;
    roomIdRef.current = roomId;
    setRoomName(name);
    setRole('streamer');
    roleRef.current = 'streamer';
    setStatus('connecting');
    setError(null);
    isLeavingRef.current = false;
    reconnectAttemptsRef.current = 0;

    try {
      const peer = await initPeer(roomId);
      peerRef.current = peer;
      bindPeerEvents(peer);
    } catch (err) {
      setStatus('error');
      setError(err?.type === 'unavailable-id' ? 'Room already exists. Try a different name.' : (err?.message || 'Connection failed'));
    }
  }, [bindPeerEvents, initPeer]);

  // ─── Join room (viewer) ─────────────────────────────────────────────
  const joinRoom = useCallback(async (name) => {
    const roomId = `${CONFIG.peerjs.roomPrefix}-${name.toLowerCase().trim()}`;
    roomIdRef.current = roomId;
    setRoomName(name);
    setRole('viewer');
    roleRef.current = 'viewer';
    setStatus('connecting');
    setError(null);
    isLeavingRef.current = false;
    reconnectAttemptsRef.current = 0;

    try {
      const peer = await initPeer(undefined);
      peerRef.current = peer;
      bindPeerEvents(peer);
      const conn = peer.connect(roomId, { reliable: true });
      setupDataConnection(conn);
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Connection failed');
    }
  }, [bindPeerEvents, initPeer, setupDataConnection]);

  // ─── Reconnect entry point ──────────────────────────────────────────
  // Assigned via ref so scheduleReconnect (defined earlier) can invoke it.
  tryReconnectRef.current = async () => {
    if (isLeavingRef.current) return;
    const roomId = roomIdRef.current;
    const r = roleRef.current;
    if (!roomId || !r) return;

    try {
      let peer = peerRef.current;
      const needNewPeer = !peer || peer.destroyed;
      if (needNewPeer) {
        const peerId = r === 'streamer' ? roomId : undefined;
        peer = await initPeer(peerId);
        peerRef.current = peer;
        bindPeerEvents(peer);
      } else if (peer.disconnected) {
        try { peer.reconnect(); } catch {}
      }

      if (r === 'viewer') {
        const conn = peer.connect(roomId, { reliable: true });
        setupDataConnection(conn);
      }
      // Streamer: 'connection' is already bound; wait for viewer to reconnect.
      // The reconnect loop will stop once status becomes 'connected'.
    } catch {
      scheduleReconnect();
    }
  };

  const cancelReconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
  }, [clearReconnectTimer]);

  // ─── Send video stream (from file captureStream) ────────────────────
  const sendVideoStream = useCallback((stream) => {
    lastVideoStreamRef.current = stream || null;
    const conn = connRef.current;
    if (!conn || !peerRef.current) return;
    const key = `out:video:${conn.peer}`;
    closeCall(key);
    try {
      const call = peerRef.current.call(conn.peer, stream, { metadata: { type: 'video' } });
      callsRef.current.set(key, call);
      attachIceListeners(call, () => { closeCall(key); resendVideoIfNeededRef.current?.(); });
    } catch {}
  }, [attachIceListeners, closeCall]);

  resendVideoIfNeededRef.current = () => {
    const stream = lastVideoStreamRef.current;
    const conn = connRef.current;
    if (stream && conn && conn.open) sendVideoStream(stream);
  };

  // ─── Start local camera + send to peer ──────────────────────────────
  const sendCameraCallRef = useRef(null);
  sendCameraCallRef.current = (stream) => {
    const conn = connRef.current;
    if (!conn || !conn.open || !peerRef.current) return;
    const key = `out:camera:${conn.peer}`;
    closeCall(key);
    try {
      const call = peerRef.current.call(conn.peer, stream, { metadata: { type: 'camera' } });
      callsRef.current.set(key, call);
      attachIceListeners(call, () => { closeCall(key); resendCameraIfNeededRef.current?.(); });
    } catch {}
  };

  resendCameraIfNeededRef.current = () => {
    const stream = localStreamRef.current;
    if (stream) sendCameraCallRef.current?.(stream);
  };

  const startCamera = useCallback(async () => {
    if (cameraStartingRef.current || localStreamRef.current) return localStreamRef.current;
    cameraStartingRef.current = true;
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: CONFIG.media.camera,
          audio: CONFIG.media.audio,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      }

      localStreamRef.current = stream;
      cleanupRef.current.streams.push(stream);
      setLocalCameraStream(stream);

      sendCameraCallRef.current?.(stream);
      return stream;
    } catch {
      return null;
    } finally {
      cameraStartingRef.current = false;
    }
  }, []);

  // Flip track.enabled. When re-enabling, also re-issue the camera call if the
  // prior one was torn down (transient drop). Audio is on the same stream, so
  // toggleMic does not need to re-call.
  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !cameraEnabled;
    stream.getVideoTracks().forEach(t => { t.enabled = enabled; });
    setCameraEnabled(enabled);

    if (enabled) {
      const conn = connRef.current;
      if (conn && conn.open && !callsRef.current.has(`out:camera:${conn.peer}`)) {
        sendCameraCallRef.current?.(stream);
      }
    }
  }, [cameraEnabled]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !micEnabled;
    stream.getAudioTracks().forEach(t => { t.enabled = enabled; });
    setMicEnabled(enabled);
  }, [micEnabled]);

  const sendChat = useCallback((text) => {
    if (!text.trim()) return;
    const msg = { type: 'chat', text: text.trim(), timestamp: Date.now(), sender: role };
    sendData(msg);
    setChatMessages(prev => [...prev, { ...msg, isMine: true }]);
  }, [sendData, role]);

  const sendSyncEvent = useCallback((type, currentTime) => {
    sendData({ type, currentTime });
  }, [sendData]);

  const startHeartbeat = useCallback((getState) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const state = getState();
      sendData({ type: 'sync-heartbeat', currentTime: state.currentTime, paused: state.paused });
    }, CONFIG.sync.heartbeatIntervalMs);
  }, [sendData]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const onSyncEvent = useCallback((callback) => {
    syncCallbackRef.current = callback;
  }, []);

  const showSyncing = useCallback(() => {
    setIsSyncing(true);
    setTimeout(() => setIsSyncing(false), 1500);
  }, []);

  const trackObjectUrl = useCallback((url) => {
    cleanupRef.current.objectUrls.push(url);
  }, []);

  const trackVideoElement = useCallback((el) => {
    if (!cleanupRef.current.videoElements.includes(el)) {
      cleanupRef.current.videoElements.push(el);
    }
  }, []);

  const fullCleanup = useCallback(() => {
    stopHeartbeat();
    clearReconnectTimer();
    isLeavingRef.current = true;
    reconnectAttemptsRef.current = 0;
    if (connTimeoutRef.current) {
      clearTimeout(connTimeoutRef.current);
      connTimeoutRef.current = null;
    }

    closeAllCalls();
    lastVideoStreamRef.current = null;

    cleanupRef.current.streams.forEach(s => {
      try { s.getTracks().forEach(t => t.stop()); } catch {}
    });
    cleanupRef.current.videoElements.forEach(el => {
      try {
        el.pause();
        el.removeAttribute('src');
        el.srcObject = null;
        el.load();
      } catch {}
    });
    cleanupRef.current.objectUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch {}
    });
    cleanupRef.current = { objectUrls: [], videoElements: [], streams: [] };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    connRef.current = null;
    roomIdRef.current = null;
    roleRef.current = null;
  }, [clearReconnectTimer, closeAllCalls, stopHeartbeat]);

  const leaveRoom = useCallback(() => {
    fullCleanup();
    setStatus('idle');
    setRole(null);
    setRemoteStream(null);
    setRemoteCameraStream(null);
    setLocalCameraStream(null);
    setChatMessages([]);
    setUnreadCount(0);
    setError(null);
    cameraStartingRef.current = false;
  }, [fullCleanup]);

  useEffect(() => {
    const onBeforeUnload = () => fullCleanup();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      fullCleanup();
    };
  }, [fullCleanup]);

  const value = {
    status, role, roomName, error,
    remoteStream, remoteCameraStream, localCameraStream,
    cameraEnabled, micEnabled,
    chatMessages, unreadCount, setUnreadCount,
    isSyncing, showSyncing,
    createRoom, joinRoom, leaveRoom, cancelReconnect,
    sendVideoStream, startCamera, toggleCamera, toggleMic,
    sendChat, sendSyncEvent, startHeartbeat, stopHeartbeat, onSyncEvent, sendData,
    trackObjectUrl, trackVideoElement,
    peerRef, connRef,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}
