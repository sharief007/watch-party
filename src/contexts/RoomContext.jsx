import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import Peer from 'peerjs';
import CONFIG from '../config';

const RoomContext = createContext(null);

export function RoomProvider({ children }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error
  const [role, setRole] = useState(null); // streamer | viewer
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteCameraStream, setRemoteCameraStream] = useState(null);
  const [localCameraStream, setLocalCameraStream] = useState(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [syncState, setSyncState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [isSyncing, setIsSyncing] = useState(false);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const localStreamRef = useRef(null);
  const heartbeatRef = useRef(null);
  const syncCallbackRef = useRef(null);

  const sendData = useCallback((data) => {
    const conn = connRef.current;
    if (conn && conn.open) {
      conn.send(data);
    }
  }, []);

  const setupDataConnection = useCallback((conn) => {
    connRef.current = conn;
    conn.on('open', () => {
      setStatus('connected');
      setError(null);
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
    conn.on('close', () => setStatus('idle'));
    conn.on('error', (err) => setError(err.message));
  }, []);

  const handleIncomingCall = useCallback((call) => {
    const type = call.metadata?.type || 'video';
    if (type === 'video') {
      call.answer();
      call.on('stream', (stream) => setRemoteStream(stream));
    } else if (type === 'camera') {
      const localCam = localStreamRef.current;
      call.answer(localCam || undefined);
      call.on('stream', (stream) => setRemoteCameraStream(stream));
    }
  }, []);

  const createRoom = useCallback(async (name) => {
    const roomId = `${CONFIG.peerjs.roomPrefix}-${name.toLowerCase().trim()}`;
    setRoomName(name);
    setRole('streamer');
    setStatus('connecting');
    setError(null);

    try {
      const peer = new Peer(roomId, {
        host: CONFIG.peerjs.host,
        port: CONFIG.peerjs.port,
        secure: CONFIG.peerjs.secure,
        config: { iceServers: CONFIG.ice.servers },
      });
      peerRef.current = peer;

      await new Promise((resolve, reject) => {
        peer.on('open', resolve);
        peer.on('error', reject);
      });

      peer.on('connection', (conn) => setupDataConnection(conn));
      peer.on('call', (call) => handleIncomingCall(call));
      peer.on('error', (err) => {
        if (err.type !== 'peer-unavailable') setError(err.message);
      });
    } catch (err) {
      setStatus('error');
      setError(err.type === 'unavailable-id' ? 'Room already exists. Try a different name.' : (err.message || 'Connection failed'));
    }
  }, [setupDataConnection, handleIncomingCall]);

  const joinRoom = useCallback(async (name) => {
    const roomId = `${CONFIG.peerjs.roomPrefix}-${name.toLowerCase().trim()}`;
    setRoomName(name);
    setRole('viewer');
    setStatus('connecting');
    setError(null);

    try {
      const peer = new Peer(undefined, {
        host: CONFIG.peerjs.host,
        port: CONFIG.peerjs.port,
        secure: CONFIG.peerjs.secure,
        config: { iceServers: CONFIG.ice.servers },
      });
      peerRef.current = peer;

      await new Promise((resolve, reject) => {
        peer.on('open', resolve);
        peer.on('error', reject);
      });

      peer.on('call', (call) => handleIncomingCall(call));
      peer.on('error', (err) => {
        if (err.type !== 'peer-unavailable') setError(err.message);
      });

      const conn = peer.connect(roomId, { reliable: true });
      setupDataConnection(conn);
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Connection failed');
    }
  }, [setupDataConnection, handleIncomingCall]);

  const sendVideoStream = useCallback((stream) => {
    const conn = connRef.current;
    if (!conn || !peerRef.current) return;
    const remotePeerId = conn.peer;
    peerRef.current.call(remotePeerId, stream, { metadata: { type: 'video' } });
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: CONFIG.media.camera,
        audio: CONFIG.media.audio,
      });
      localStreamRef.current = stream;
      setLocalCameraStream(stream);

      const conn = connRef.current;
      if (conn && peerRef.current) {
        const call = peerRef.current.call(conn.peer, stream, { metadata: { type: 'camera' } });
        call.on('stream', (s) => setRemoteCameraStream(s));
      }
      return stream;
    } catch {
      return null;
    }
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !cameraEnabled;
    stream.getVideoTracks().forEach(t => { t.enabled = enabled; });
    setCameraEnabled(enabled);
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
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
  }, []);

  const onSyncEvent = useCallback((callback) => {
    syncCallbackRef.current = callback;
  }, []);

  const showSyncing = useCallback(() => {
    setIsSyncing(true);
    setTimeout(() => setIsSyncing(false), 1500);
  }, []);

  const leaveRoom = useCallback(() => {
    stopHeartbeat();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    connRef.current = null;
    setStatus('idle');
    setRole(null);
    setRemoteStream(null);
    setRemoteCameraStream(null);
    setLocalCameraStream(null);
    setChatMessages([]);
    setUnreadCount(0);
    setError(null);
  }, [stopHeartbeat]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerRef.current) peerRef.current.destroy();
    };
  }, [stopHeartbeat]);

  const value = {
    status, role, roomName, error,
    remoteStream, remoteCameraStream, localCameraStream,
    cameraEnabled, micEnabled,
    chatMessages, unreadCount, setUnreadCount,
    syncState, setSyncState, isSyncing, showSyncing,
    createRoom, joinRoom, leaveRoom,
    sendVideoStream, startCamera, toggleCamera, toggleMic,
    sendChat, sendSyncEvent, startHeartbeat, stopHeartbeat, onSyncEvent, sendData,
    peerRef, connRef,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}
