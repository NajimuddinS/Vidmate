import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import HomePage from './components/HomePage';
import VideoCall from './components/VideoCall';
import './App.css';

const API_BASE_URL = 'https://vidmate-svii.onrender.com';

function App() {
  const [socket, setSocket] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [username, setUsername] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io(API_BASE_URL, {
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
      newSocket.emit('join-server');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('joined-server', () => {
      console.log('Successfully joined server');
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const joinRoom = (roomId, displayName) => {
    if (socket && roomId && displayName) {
      setUsername(displayName);
      setCurrentRoom(roomId);
      socket.emit('join-room', { roomId, username: displayName });
    }
  };

  const leaveRoom = () => {
    if (socket && currentRoom) {
      socket.emit('leave-room', { roomId: currentRoom });
      setCurrentRoom(null);
      setUsername('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      {!currentRoom ? (
        <HomePage 
          onJoinRoom={joinRoom} 
          isConnected={isConnected}
          apiBaseUrl={API_BASE_URL}
        />
      ) : (
        <VideoCall
          socket={socket}
          roomId={currentRoom}
          username={username}
          onLeaveRoom={leaveRoom}
        />
      )}
    </div>
  );
}

export default App;