/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import Peer from 'peerjs';
import CONFIG from '../config';

const RoomContext = createContext(null);

const RECONNECT_MAX_DELAY_MS = 30_000;
const ICE_RESTART_GRACE_MS = 3000;

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now() + '-' + Math.random().toString(36).slice(2, 10);
};

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
  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const localStreamRef = useRef(null);
  const heartbeatRef = useRef(null);
  const syncCallbackRef = useRef(null);
  const cleanupRef = useRef({ objectUrls: [], videoElements: [], streams: [] });
  const syncingTimerRef = useRef(null);
  const callsRef = useRef(new Map());
  const cameraStartingRef = useRef(false);
  const connTimeoutRef = useRef(null);
  const roleRef = useRef(null);
  const roomIdRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const isLeavingRef = useRef(false);
  const hasEverConnectedRef = useRef(false);
  const lastVideoStreamRef = useRef(null);

  const sendData = useCallback((data) => {
    const conn = connRef.current;
    if (conn && conn.open) conn.send(data);
  }, []);

  const closeCall = useCallback((key) => {
    const c = callsRef.current.get(key);
    if (c) {
      if (c.__iceGraceTimer) { clearTimeout(c.__iceGraceTimer); c.__iceGraceTimer = null; }
      try { c.close(); } catch { /* noop */ }
      callsRef.current.delete(key);
    }
  }, []);

  const closeAllCalls = useCallback(() => {
    for (const [, c] of callsRef.current) {
      if (c.__iceGraceTimer) { clearTimeout(c.__iceGraceTimer); c.__iceGraceTimer = null; }
      try { c.close(); } catch { /* noop */ }
    }
    callsRef.current.clear();
  }, []);

  const resendVideoIfNeededRef = useRef(null);
  const resendCameraIfNeededRef = useRef(null);

  const attachIceListeners = useCallback((call, onFailed) => {
    let attached = false;
    let closed = false;
    const clearGrace = () => {
      if (call.__iceGraceTimer) { clearTimeout(call.__iceGraceTimer); call.__iceGraceTimer = null; }
    };
    const markClosed = () => { closed = true; clearGrace(); };
    try { call.on('close', markClosed); } catch { /* noop */ }
    try { call.on('error', markClosed); } catch { /* noop */ }

    const tryAttach = (retries = 20) => {
      if (attached || closed) return;
      const pc = call.peerConnection;
      if (!pc) {
        if (retries > 0) setTimeout(() => tryAttach(retries - 1), 200);
        return;
      }
      attached = true;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (closed) return;
        const s = pc.iceConnectionState;
        if (s === 'failed') {
          try { pc.restartIce?.(); } catch { /* noop */ }
          clearGrace();
          call.__iceGraceTimer = setTimeout(() => {
            call.__iceGraceTimer = null;
            if (closed) return;
            const cur = pc.iceConnectionState;
            if (cur === 'failed' || cur === 'disconnected' || cur === 'closed') {
              try { onFailed(); } catch { /* noop */ }
            }
          }, ICE_RESTART_GRACE_MS);
        }
      });
    };
    tryAttach();
  }, []);

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
    const delay = Math.max(500, Math.random() * base);
    reconnectAttemptsRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      tryReconnectRef.current?.();
    }, delay);
  }, [clearReconnectTimer]);

  const setupDataConnection = useCallback((conn) => {
    const prev = connRef.current;
    if (prev && prev !== conn) {
      try { prev.close(); } catch { /* noop */ }
    }
    connRef.current = conn;

    if (connTimeoutRef.current) clearTimeout(connTimeoutRef.current);
    connTimeoutRef.current = setTimeout(() => {
      if (connRef.current === conn && !conn.open) {
        if (hasEverConnectedRef.current && !isLeavingRef.current) {
          try { conn.close(); } catch { /* noop */ }
          if (connRef.current === conn) connRef.current = null;
          setStatus('reconnecting');
          scheduleReconnect();
          return;
        }
        setStatus('error');
        setError('Could not establish a connection. Check the room name, ensure both devices are online, and try again.');
        if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
        if (connRef.current === conn) connRef.current = null;
      }
    }, 20000);

    conn.on('open', () => {
      if (connTimeoutRef.current) { clearTimeout(connTimeoutRef.current); connTimeoutRef.current = null; }
      reconnectAttemptsRef.current = 0;
      hasEverConnectedRef.current = true;
      clearReconnectTimer();
      setStatus('connected');
      setError(null);

      if (roleRef.current === 'streamer' && lastVideoStreamRef.current && peerRef.current && conn.peer) {
        const key = 'out:video:' + conn.peer;
        closeCall(key);
        try {
          const call = peerRef.current.call(conn.peer, lastVideoStreamRef.current, { metadata: { type: 'video' } });
          callsRef.current.set(key, call);
          attachIceListeners(call, () => { closeCall(key); resendVideoIfNeededRef.current?.(); });
        } catch { /* noop */ }
      }

      if (localStreamRef.current && peerRef.current && conn.peer) {
        const key = 'out:camera:' + conn.peer;
        closeCall(key);
        try {
          const call = peerRef.current.call(conn.peer, localStreamRef.current, { metadata: { type: 'camera' } });
          callsRef.current.set(key, call);
          attachIceListeners(call, () => { closeCall(key); resendCameraIfNeededRef.current?.(); });
        } catch { /* noop */ }
      }
    });
    conn.on('data', (data) => {
      if (data.type === 'chat') {
        setChatMessages(prev => [...prev, { ...data, id: data.id || makeId(), isMine: false }]);
        if (!chatOpenRef.current) setUnreadCount(prev => prev + 1);
      } else if (['play', 'pause', 'seek', 'sync-heartbeat'].includes(data.type)) {
        if (syncCallbackRef.current) syncCallbackRef.current(data);
      }
    });
    conn.on('close', () => {
      if (connRef.current !== conn) return;
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
    });
  }, [attachIceListeners, closeAllCalls, closeCall, clearReconnectTimer, scheduleReconnect]);

  const handleIncomingCall = useCallback((call) => {
    const type = call.metadata?.type || 'video';
    const key = 'in:' + type + ':' + call.peer;
    closeCall(key);
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

  const bindPeerEvents = useCallback((peer) => {
    peer.on('call', (call) => handleIncomingCall(call));
    peer.on('connection', (conn) => setupDataConnection(conn));
    peer.on('error', (err) => {
      const t = err?.type;
      if (t === 'peer-unavailable') {
        if (hasEverConnectedRef.current && !isLeavingRef.current) {
          scheduleReconnect();
          return;
        }
        setStatus('error');
        setError('Room not found. Check the room name and try again.');
      } else if (t === 'network' || t === 'disconnected' || t === 'server-error' || t === 'socket-error') {
        if (isLeavingRef.current) return;
        if (hasEverConnectedRef.current) {
          setStatus('reconnecting');
          scheduleReconnect();
        } else {
          setStatus('error');
          setError(err?.message || 'Network error — unable to reach signaling server.');
        }
      } else if (t !== 'unavailable-id') {
        setError(err?.message || String(err));
      }
    });
    peer.on('disconnected', () => {
      if (isLeavingRef.current) return;
      try { peer.reconnect(); } catch { /* noop */ }
    });
  }, [handleIncomingCall, scheduleReconnect, setupDataConnection]);

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

  const createRoom = useCallback(async (name) => {
    const roomId = CONFIG.peerjs.roomPrefix + '-' + name.toLowerCase().trim();
    roomIdRef.current = roomId;
    setRoomName(name);
    setRole('streamer');
    roleRef.current = 'streamer';
    setStatus('connecting');
    setError(null);
    isLeavingRef.current = false;
    hasEverConnectedRef.current = false;
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

  const joinRoom = useCallback(async (name) => {
    const roomId = CONFIG.peerjs.roomPrefix + '-' + name.toLowerCase().trim();
    roomIdRef.current = roomId;
    setRoomName(name);
    setRole('viewer');
    roleRef.current = 'viewer';
    setStatus('connecting');
    setError(null);
    isLeavingRef.current = false;
    hasEverConnectedRef.current = false;
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

  useEffect(() => {
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
          try { peer.reconnect(); } catch { /* noop */ }
        }

        if (r === 'viewer') {
          const conn = peer.connect(roomId, { reliable: true });
          setupDataConnection(conn);
        }
      } catch {
        scheduleReconnect();
      }
    };
  }, [initPeer, bindPeerEvents, setupDataConnection, scheduleReconnect]);

  const cancelReconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
  }, [clearReconnectTimer]);

  const sendVideoStream = useCallback((stream) => {
    lastVideoStreamRef.current = stream || null;
    const conn = connRef.current;
    if (!conn || !peerRef.current) return;
    const key = 'out:video:' + conn.peer;
    closeCall(key);
    try {
      const call = peerRef.current.call(conn.peer, stream, { metadata: { type: 'video' } });
      callsRef.current.set(key, call);
      attachIceListeners(call, () => { closeCall(key); resendVideoIfNeededRef.current?.(); });
    } catch { /* noop */ }
  }, [attachIceListeners, closeCall]);

  useEffect(() => {
    resendVideoIfNeededRef.current = () => {
      const stream = lastVideoStreamRef.current;
      const conn = connRef.current;
      if (stream && conn && conn.open) sendVideoStream(stream);
    };
  }, [sendVideoStream]);

  const sendCameraCallRef = useRef(null);
  useEffect(() => {
    sendCameraCallRef.current = (stream) => {
      const conn = connRef.current;
      if (!conn || !conn.open || !peerRef.current) return;
      const key = 'out:camera:' + conn.peer;
      closeCall(key);
      try {
        const call = peerRef.current.call(conn.peer, stream, { metadata: { type: 'camera' } });
        callsRef.current.set(key, call);
        attachIceListeners(call, () => { closeCall(key); resendCameraIfNeededRef.current?.(); });
      } catch { /* noop */ }
    };
    resendCameraIfNeededRef.current = () => {
      const stream = localStreamRef.current;
      if (stream) sendCameraCallRef.current?.(stream);
    };
  }, [attachIceListeners, closeCall]);

  const startCamera = useCallback(async () => {
    if (cameraStartingRef.current || localStreamRef.current) return localStreamRef.current;
    cameraStartingRef.current = true;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not available in this browser. Use HTTPS and a recent Chrome/Safari/Firefox build.');
      cameraStartingRef.current = false;
      return null;
    }

    // Try a chain of progressively looser constraints. Mobile browsers often
    // reject the ideal constraints (resolution, framerate) but accept simpler
    // ones; we also explicitly request the front camera, which is what users
    // expect for a watch-party use case.
    const attempts = [
      { video: { ...CONFIG.media.camera, facingMode: { ideal: 'user' } }, audio: CONFIG.media.audio },
      { video: { facingMode: { ideal: 'user' } }, audio: true },
      { video: true, audio: true },
      { video: true, audio: false },
      { video: false, audio: true },
    ];

    let stream = null;
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) break;
      } catch (e) {
        lastErr = e;
      }
    }

    cameraStartingRef.current = false;

    if (!stream) {
      const name = lastErr?.name || '';
      let msg = 'Could not access camera or microphone.';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        msg = 'Camera/mic permission was denied. Enable it for this site in your browser settings.';
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        msg = 'No camera or microphone was found on this device.';
      } else if (name === 'NotReadableError') {
        msg = 'Camera or microphone is busy in another app. Close other apps using it and try again.';
      } else if (lastErr?.message) {
        msg = `Camera error: ${lastErr.message}`;
      }
      setError(msg);
      return null;
    }

    localStreamRef.current = stream;
    cleanupRef.current.streams.push(stream);
    setLocalCameraStream(stream);
    sendCameraCallRef.current?.(stream);
    return stream;
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !cameraEnabled;
    stream.getVideoTracks().forEach(t => { t.enabled = enabled; });
    setCameraEnabled(enabled);
    if (enabled) {
      const conn = connRef.current;
      if (conn && conn.open && !callsRef.current.has('out:camera:' + conn.peer)) {
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
    const msg = { type: 'chat', id: makeId(), text: text.trim(), timestamp: Date.now(), sender: role };
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
    if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
    syncingTimerRef.current = setTimeout(() => {
      syncingTimerRef.current = null;
      setIsSyncing(false);
    }, 1500);
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
    hasEverConnectedRef.current = false;
    if (connTimeoutRef.current) {
      clearTimeout(connTimeoutRef.current);
      connTimeoutRef.current = null;
    }
    if (syncingTimerRef.current) {
      clearTimeout(syncingTimerRef.current);
      syncingTimerRef.current = null;
    }

    closeAllCalls();
    lastVideoStreamRef.current = null;

    cleanupRef.current.streams.forEach(s => {
      try { s.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
    });
    cleanupRef.current.videoElements.forEach(el => {
      try {
        el.pause();
        el.removeAttribute('src');
        el.srcObject = null;
        el.load();
      } catch { /* noop */ }
    });
    cleanupRef.current.objectUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
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
    status, role, roomName, error, clearError: () => setError(null),
    remoteStream, remoteCameraStream, localCameraStream,
    cameraEnabled, micEnabled,
    chatMessages, unreadCount, setUnreadCount,
    chatOpen, setChatOpen,
    isSyncing, showSyncing,
    createRoom, joinRoom, leaveRoom, cancelReconnect,
    sendVideoStream, startCamera, toggleCamera, toggleMic,
    sendChat, sendSyncEvent, startHeartbeat, stopHeartbeat, onSyncEvent, sendData,
    trackObjectUrl, trackVideoElement,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}
