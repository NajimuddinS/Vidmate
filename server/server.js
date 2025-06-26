const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Store active rooms and users
const rooms = new Map();
const users = new Map();

// Room management functions
class Room {
  constructor(id, createdBy) {
    this.id = id;
    this.createdBy = createdBy;
    this.participants = new Set();
    this.createdAt = new Date();
    this.isActive = true;
  }

  addParticipant(userId) {
    this.participants.add(userId);
  }

  removeParticipant(userId) {
    this.participants.delete(userId);
    if (this.participants.size === 0) {
      this.isActive = false;
    }
  }

  getParticipants() {
    return Array.from(this.participants);
  }
}

// User management functions
class User {
  constructor(id, name, socketId) {
    this.id = id;
    this.name = name;
    this.socketId = socketId;
    this.currentRoom = null;
    this.isVideoEnabled = true;
    this.isAudioEnabled = true;
  }
}

// REST API endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/rooms', (req, res) => {
  const { userId, userName } = req.body;
  
  if (!userId || !userName) {
    return res.status(400).json({ error: 'userId and userName are required' });
  }

  const roomId = generateRoomId();
  const room = new Room(roomId, userId);
  rooms.set(roomId, room);

  res.json({
    roomId,
    message: 'Room created successfully',
    createdBy: userId
  });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);

  if (!room || !room.isActive) {
    return res.status(404).json({ error: 'Room not found or inactive' });
  }

  res.json({
    roomId: room.id,
    participants: room.getParticipants(),
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    isActive: room.isActive
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User joins the signaling server
  socket.on('join-server', (userData) => {
    const { userId, userName } = userData;
    const user = new User(userId, userName, socket.id);
    users.set(socket.id, user);
    
    socket.emit('joined-server', {
      message: 'Successfully connected to signaling server',
      userId: user.id
    });
  });

  // User joins a room
  socket.on('join-room', (data) => {
    const { roomId, userId, userName } = data;
    const user = users.get(socket.id);
    
    if (!user) {
      socket.emit('error', { message: 'User not found. Please rejoin the server.' });
      return;
    }

    let room = rooms.get(roomId);
    
    // Create room if it doesn't exist
    if (!room) {
      room = new Room(roomId, userId);
      rooms.set(roomId, room);
    }

    // Add user to room
    room.addParticipant(userId);
    user.currentRoom = roomId;
    socket.join(roomId);

    // Notify existing participants about new user
    socket.to(roomId).emit('user-joined', {
      userId: user.id,
      userName: user.name,
      participants: room.getParticipants()
    });

    // Send current participants to new user
    socket.emit('room-joined', {
      roomId,
      participants: room.getParticipants(),
      message: 'Successfully joined the room'
    });

    console.log(`User ${userName} joined room ${roomId}`);
  });

  // WebRTC signaling events
  socket.on('offer', (data) => {
    const { targetUserId, offer, roomId } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    socket.to(roomId).emit('offer', {
      offer,
      fromUserId: user.id,
      fromUserName: user.name,
      targetUserId
    });
  });

  socket.on('answer', (data) => {
    const { targetUserId, answer, roomId } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    socket.to(roomId).emit('answer', {
      answer,
      fromUserId: user.id,
      fromUserName: user.name,
      targetUserId
    });
  });

  socket.on('ice-candidate', (data) => {
    const { targetUserId, candidate, roomId } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    socket.to(roomId).emit('ice-candidate', {
      candidate,
      fromUserId: user.id,
      targetUserId
    });
  });

  // Media control events
  socket.on('toggle-video', (data) => {
    const { roomId, isEnabled } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    user.isVideoEnabled = isEnabled;
    socket.to(roomId).emit('user-video-toggled', {
      userId: user.id,
      isEnabled
    });
  });

  socket.on('toggle-audio', (data) => {
    const { roomId, isEnabled } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    user.isAudioEnabled = isEnabled;
    socket.to(roomId).emit('user-audio-toggled', {
      userId: user.id,
      isEnabled
    });
  });

  // Chat messages
  socket.on('chat-message', (data) => {
    const { roomId, message } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    const chatMessage = {
      userId: user.id,
      userName: user.name,
      message,
      timestamp: new Date().toISOString()
    };

    io.to(roomId).emit('chat-message', chatMessage);
  });

  // Screen sharing
  socket.on('start-screen-share', (data) => {
    const { roomId } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    socket.to(roomId).emit('user-started-screen-share', {
      userId: user.id,
      userName: user.name
    });
  });

  socket.on('stop-screen-share', (data) => {
    const { roomId } = data;
    const user = users.get(socket.id);
    
    if (!user) return;

    socket.to(roomId).emit('user-stopped-screen-share', {
      userId: user.id,
      userName: user.name
    });
  });

  // User leaves room
  socket.on('leave-room', () => {
    handleUserLeave(socket);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    handleUserLeave(socket);
  });
});

// Helper functions
function handleUserLeave(socket) {
  const user = users.get(socket.id);
  
  if (user && user.currentRoom) {
    const room = rooms.get(user.currentRoom);
    
    if (room) {
      room.removeParticipant(user.id);
      socket.to(user.currentRoom).emit('user-left', {
        userId: user.id,
        userName: user.name,
        participants: room.getParticipants()
      });

      // Clean up empty rooms
      if (room.participants.size === 0) {
        rooms.delete(user.currentRoom);
      }
    }
  }

  users.delete(socket.id);
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Error handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Video call server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});