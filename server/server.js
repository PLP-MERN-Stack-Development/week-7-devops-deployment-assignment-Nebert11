// server.js - Main server file for Socket.io chat application

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Connect to MongoDB Atlas
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGODB_URI not set in environment variables.');
  process.exit(1);
}
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10, // Connection pooling
})
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Middleware
const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());
app.use(helmet());
app.use(morgan('combined'));
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and messages
const users = {};
const messages = [];
const typingUsers = {};
// (1) Maintain a list of rooms (default 'General')
const rooms = ['General'];

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // (4) Send the current room list to the client on connect
  socket.emit('room_list', rooms);

  // (2) Handle user joining a room (default to 'General')
  socket.on('user_join', (username, room = 'General') => {
    users[socket.id] = { username, id: socket.id, room };
    socket.join(room);
    io.emit('user_list', Object.values(users).filter(u => u.room === room));
    io.emit('user_joined', { username, id: socket.id, room });
    console.log(`${username} joined the room: ${room}`);
  });

  // (3) Handle room creation
  socket.on('create_room', (roomName) => {
    if (!rooms.includes(roomName)) {
      rooms.push(roomName);
      io.emit('room_list', rooms);
    }
  });

  // (2) Handle switching/joining a different room
  socket.on('join_room', (roomName) => {
    const user = users[socket.id];
    if (user) {
      socket.leave(user.room);
      user.room = roomName;
      socket.join(roomName);
      io.emit('user_list', Object.values(users).filter(u => u.room === roomName));
    }
  });

  // (10) Listen for leave_room event and broadcast user_left only on explicit leave
  socket.on('leave_room', ({ room, username }) => {
    socket.leave(room);
    io.to(room).emit('user_left', { username, id: socket.id, room });
    console.log(`${username} left the room: ${room}`);
  });

  // Handle chat messages
  // (2) Only broadcast messages to users in the same room
  socket.on('send_message', (messageData) => {
    const user = users[socket.id];
    const room = user?.room || 'General';
    const message = {
      ...messageData,
      id: Date.now(),
      sender: user?.username || 'Anonymous',
      senderId: socket.id,
      timestamp: new Date().toISOString(),
      room,
    };
    
    messages.push(message);
    
    // Debug log for message and room
    console.log('Emitting message to room:', room, message);
    
    // Limit stored messages to prevent memory issues
    if (messages.length > 100) {
      messages.shift();
    }
    
    io.to(room).emit('receive_message', message);
    // (Task 5.4) Emit delivery acknowledgment to sender
    socket.emit('message_delivered', { id: message.id });
  });

  // Handle typing indicator
  // (2) Only broadcast typing events to users in the same room
  socket.on('typing', (isTyping) => {
    const user = users[socket.id];
    if (user) {
      const username = user.username;
      const room = user.room;
      
      if (isTyping) {
        typingUsers[socket.id] = username;
      } else {
        delete typingUsers[socket.id];
      }
      
      io.to(room).emit('typing_users', Object.values(typingUsers));
    }
  });

  // Handle private messages
  socket.on('private_message', ({ to, message }) => {
    const senderUser = users[socket.id];
    const recipientUser = users[to];
    const messageData = {
      id: Date.now(),
      sender: senderUser?.username || 'Anonymous',
      senderId: socket.id,
      recipient: recipientUser?.username || '',
      recipientId: to,
      message,
      timestamp: new Date().toISOString(),
      isPrivate: true,
    };
    socket.to(to).emit('private_message', messageData);
    socket.emit('private_message', messageData);
  });

  // Handle read receipts for private messages
  socket.on('message_read', ({ senderId, recipientId }) => {
    // Find all private messages from senderId to recipientId that are not yet read
    const readMessageIds = messages
      .filter(m => m.isPrivate && m.senderId === senderId && m.recipientId === recipientId && !m.read)
      .map(m => m.id);
    // Mark them as read
    messages.forEach(m => {
      if (readMessageIds.includes(m.id)) m.read = true;
    });
    // Notify the sender
    if (readMessageIds.length > 0) {
      io.to(senderId).emit('message_read', { senderId, recipientId, messageIds: readMessageIds });
    }
  });

  // Handle message reactions
  socket.on('message_reaction', ({ messageId, reaction, userId, username }) => {
    // Find the message
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    // Initialize reactions if not present
    if (!msg.reactions) msg.reactions = {};
    // Set or update the user's reaction
    msg.reactions[userId] = reaction;
    // Broadcast the updated message to the room
    io.to(msg.room).emit('message_reaction', { messageId, reactions: msg.reactions });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      // No longer emit user_left here
      // const { username, room } = user;
      // io.to(room).emit('user_left', { username, id: socket.id });
      console.log(`${user.username} disconnected`);
    }
    
    delete users[socket.id];
    delete typingUsers[socket.id];
    // (4) Update user list for all rooms
    rooms.forEach(r => {
      io.to(r).emit('user_list', Object.values(users).filter(u => u.room === r));
    });
    rooms.forEach(r => {
      io.to(r).emit('typing_users', Object.values(typingUsers));
    });
  });
});

// API routes
app.get('/api/messages', (req, res) => {
  // (Task 5.1) Paginated, room-specific message fetching
  const { room = 'General', skip = 0, limit = 20 } = req.query;
  // Filter messages for the room
  const roomMessages = messages.filter(m => m.room === room);
  // Sort oldest to newest (already in order, but just in case)
  roomMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  // Paginate
  const start = Math.max(0, roomMessages.length - Number(skip) - Number(limit));
  const end = roomMessages.length - Number(skip);
  const paginated = roomMessages.slice(start, end);
  res.json({
    messages: paginated,
    hasMore: start > 0
  });
});

// (Task 5.5) Message search endpoint
app.get('/api/messages/search', (req, res) => {
  const { room = 'General', query = '' } = req.query;
  const q = query.trim().toLowerCase();
  if (!q) return res.json({ messages: [] });
  const results = messages.filter(m =>
    m.room === room &&
    ((m.message && m.message.toLowerCase().includes(q)) ||
     (m.sender && m.sender.toLowerCase().includes(q)))
  );
  res.json({ messages: results });
});

app.get('/api/users', (req, res) => {
  res.json(Object.values(users));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get('/', (req, res) => {
  res.send('Socket.io Chat Server is running');
});

// Error handling middleware (should be after all routes)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io }; 