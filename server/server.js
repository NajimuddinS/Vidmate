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

  // Send initial connection acknowledgment
  socket.emit('connected', {
    message: 'Connected to video call server',
    socketId: socket.id,
    timestamp: new Date().toISOString()
  });

  // User joins the signaling server
  socket.on('join-server', (userData) => {
    try {
      // Validate userData
      if (!userData || typeof userData !== 'object') {
        socket.emit('error', { message: 'Invalid user data provided' });
        return;
      }

      const { userId, userName } = userData;
      
      // Validate required fields
      if (!userId || !userName) {
        socket.emit('error', { message: 'userId and userName are required' });
        return;
      }

      const user = new User(userId, userName, socket.id);
      users.set(socket.id, user);
      
      socket.emit('joined-server', {
        message: 'Successfully connected to signaling server',
        userId: user.id
      });

      console.log(`User ${userName} (${userId}) connected with socket ${socket.id}`);
    } catch (error) {
      console.error('Error in join-server:', error);
      socket.emit('error', { message: 'Failed to join server' });
    }
  });

  // User joins a room
  socket.on('join-room', (data) => {
    try {
      // Validate data
      if (!data || typeof data !== 'object') {
        socket.emit('error', { message: 'Invalid room data provided' });
        return;
      }

      const { roomId, userId, userName } = data;
      
      // Validate required fields
      if (!roomId || !userId || !userName) {
        socket.emit('error', { message: 'roomId, userId, and userName are required' });
        return;
      }

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
    } catch (error) {
      console.error('Error in join-room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // WebRTC signaling events
  socket.on('offer', (data) => {
    try {
      if (!data || !data.targetUserId || !data.offer || !data.roomId) {
        socket.emit('error', { message: 'Invalid offer data' });
        return;
      }

      const { targetUserId, offer, roomId } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      socket.to(roomId).emit('offer', {
        offer,
        fromUserId: user.id,
        fromUserName: user.name,
        targetUserId
      });
    } catch (error) {
      console.error('Error in offer:', error);
      socket.emit('error', { message: 'Failed to send offer' });
    }
  });

  socket.on('answer', (data) => {
    try {
      if (!data || !data.targetUserId || !data.answer || !data.roomId) {
        socket.emit('error', { message: 'Invalid answer data' });
        return;
      }

      const { targetUserId, answer, roomId } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      socket.to(roomId).emit('answer', {
        answer,
        fromUserId: user.id,
        fromUserName: user.name,
        targetUserId
      });
    } catch (error) {
      console.error('Error in answer:', error);
      socket.emit('error', { message: 'Failed to send answer' });
    }
  });

  socket.on('ice-candidate', (data) => {
    try {
      if (!data || !data.targetUserId || !data.candidate || !data.roomId) {
        socket.emit('error', { message: 'Invalid ICE candidate data' });
        return;
      }

      const { targetUserId, candidate, roomId } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      socket.to(roomId).emit('ice-candidate', {
        candidate,
        fromUserId: user.id,
        targetUserId
      });
    } catch (error) {
      console.error('Error in ice-candidate:', error);
      socket.emit('error', { message: 'Failed to send ICE candidate' });
    }
  });

  // Media control events
  socket.on('toggle-video', (data) => {
    try {
      if (!data || !data.roomId || typeof data.isEnabled !== 'boolean') {
        socket.emit('error', { message: 'Invalid video toggle data' });
        return;
      }

      const { roomId, isEnabled } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      user.isVideoEnabled = isEnabled;
      socket.to(roomId).emit('user-video-toggled', {
        userId: user.id,
        isEnabled
      });
    } catch (error) {
      console.error('Error in toggle-video:', error);
      socket.emit('error', { message: 'Failed to toggle video' });
    }
  });

  socket.on('toggle-audio', (data) => {
    try {
      if (!data || !data.roomId || typeof data.isEnabled !== 'boolean') {
        socket.emit('error', { message: 'Invalid audio toggle data' });
        return;
      }

      const { roomId, isEnabled } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      user.isAudioEnabled = isEnabled;
      socket.to(roomId).emit('user-audio-toggled', {
        userId: user.id,
        isEnabled
      });
    } catch (error) {
      console.error('Error in toggle-audio:', error);
      socket.emit('error', { message: 'Failed to toggle audio' });
    }
  });

  // Chat messages
  socket.on('chat-message', (data) => {
    try {
      if (!data || !data.roomId || !data.message || typeof data.message !== 'string') {
        socket.emit('error', { message: 'Invalid chat message data' });
        return;
      }

      const { roomId, message } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Sanitize message (basic protection)
      const sanitizedMessage = message.trim().substring(0, 500);
      
      if (!sanitizedMessage) {
        socket.emit('error', { message: 'Message cannot be empty' });
        return;
      }

      const chatMessage = {
        userId: user.id,
        userName: user.name,
        message: sanitizedMessage,
        timestamp: new Date().toISOString()
      };

      io.to(roomId).emit('chat-message', chatMessage);
    } catch (error) {
      console.error('Error in chat-message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Screen sharing
  socket.on('start-screen-share', (data) => {
    try {
      if (!data || !data.roomId) {
        socket.emit('error', { message: 'Invalid screen share data' });
        return;
      }

      const { roomId } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      socket.to(roomId).emit('user-started-screen-share', {
        userId: user.id,
        userName: user.name
      });
    } catch (error) {
      console.error('Error in start-screen-share:', error);
      socket.emit('error', { message: 'Failed to start screen share' });
    }
  });

  socket.on('stop-screen-share', (data) => {
    try {
      if (!data || !data.roomId) {
        socket.emit('error', { message: 'Invalid screen share data' });
        return;
      }

      const { roomId } = data;
      const user = users.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      socket.to(roomId).emit('user-stopped-screen-share', {
        userId: user.id,
        userName: user.name
      });
    } catch (error) {
      console.error('Error in stop-screen-share:', error);
      socket.emit('error', { message: 'Failed to stop screen share' });
    }
  });

  // User leaves room
  socket.on('leave-room', () => {
    try {
      handleUserLeave(socket);
    } catch (error) {
      console.error('Error in leave-room:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    try {
      console.log(`User disconnected: ${socket.id}`);
      handleUserLeave(socket);
    } catch (error) {
      console.error('Error in disconnect:', error);
    }
  });
});

// Helper functions
function handleUserLeave(socket) {
  try {
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
          console.log(`Room ${user.currentRoom} deleted (empty)`);
        }
      }
    }

    users.delete(socket.id);
  } catch (error) {
    console.error('Error in handleUserLeave:', error);
  }
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