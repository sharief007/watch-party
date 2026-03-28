import { RoomProvider, useRoom } from './contexts/RoomContext';
import Lobby from './components/Lobby';
import Room from './components/Room';

function AppContent() {
  const { status, role } = useRoom();
  const inRoom = role && (status === 'connecting' || status === 'connected');
  return inRoom ? <Room /> : <Lobby />;
}

export default function App() {
  return (
    <RoomProvider>
      <AppContent />
    </RoomProvider>
  );
}
