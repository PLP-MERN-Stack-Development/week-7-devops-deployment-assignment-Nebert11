import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
// import './App.css'
import { useSocket } from './socket/socket'
import axios from 'axios';

// Example: Lazy load a secondary component
const LazyDemo = lazy(() => import('./LazyDemo'));

function App() {
  const [count, setCount] = useState(0)
  // (1) Prompt user for username
  const [username, setUsername] = useState(() => localStorage.getItem('username') || '');
  const [input, setInput] = useState('');
  const [messageInput, setMessageInput] = useState('');
  // (1) Select user to message (for private messaging)
  const [selectedUser, setSelectedUser] = useState(null);
  // (2) Private message input
  const [privateMessageInput, setPrivateMessageInput] = useState('');
  // (1) Room state: current room, available rooms, and new room input
  const [room, setRoom] = useState(() => localStorage.getItem('room') || 'General');
  const [rooms, setRooms] = useState(['General']);
  const [roomInput, setRoomInput] = useState('');
  // (2) Connect with username, room, and manage chat state
  const { isConnected, isReconnecting, isDisconnected, connect, disconnect, messages, sendMessage, setTyping, typingUsers, users, sendPrivateMessage, socket, markMessagesAsRead, sendReaction } = useSocket();

  // (3) Listen for room list updates from server
  useEffect(() => {
    if (!socket) return;
    const handleRoomList = (roomList) => setRooms(roomList);
    socket.on('room_list', handleRoomList);
    return () => socket.off('room_list', handleRoomList);
  }, [socket]);

  useEffect(() => {
    // (2) Connect to server with username and room when both are set
    if (username && room) {
      connect(username, room);
      return () => disconnect();
    }
  }, [username, room]);

  // (6) Track rooms the user has joined (state + localStorage)
  const [joinedRooms, setJoinedRooms] = useState(() => {
    const saved = localStorage.getItem('joinedRooms');
    // (6) Always include 'General' in joinedRooms
    const initial = saved ? JSON.parse(saved) : [];
    return initial.includes('General') ? initial : ['General', ...initial];
  });
  // (6) Track rooms joined for system message logic
  const joinedRoomsRef = useRef(new Set(joinedRooms));

  // (6) Persist joined rooms to localStorage and update ref
  useEffect(() => {
    // (6) Always keep 'General' in joinedRooms
    if (!joinedRooms.includes('General')) {
      setJoinedRooms(prev => ['General', ...prev]);
      return;
    }
    localStorage.setItem('joinedRooms', JSON.stringify(joinedRooms));
    joinedRoomsRef.current = new Set(joinedRooms);
  }, [joinedRooms]);

  // (6) When user joins a new room, add to joinedRooms
  const handleJoinRoom = (r) => {
    if (!joinedRooms.includes(r)) {
      setJoinedRooms((prev) => [...prev, r]);
    }
    setRoom(r);
    socket.emit('join_room', r);
  };

  // (6) When user leaves a room, remove from joinedRooms and switch to General if needed
  const handleLeaveRoom = (r) => {
    if (r === 'General') return; // Can't leave General
    setJoinedRooms((prev) => prev.filter(roomName => roomName !== r));
    socket.emit('leave_room', { room: r, username }); // (10) Emit leave_room event only on explicit leave
    if (room === r) {
      setRoom('General');
      socket.emit('join_room', 'General');
    }
  };

  // (7) Track all users who have ever joined the current room and their online status
  const [allUsers, setAllUsers] = useState({}); // { username: { id, online } }

  // (7) Update allUsers when user list changes
  useEffect(() => {
    if (!room) return;
    setAllUsers(prev => {
      const updated = { ...prev };
      users.forEach(u => {
        updated[u.username] = { id: u.id, online: true };
      });
      // Mark users not in the current users list as offline
      Object.keys(updated).forEach(username => {
        if (!users.find(u => u.username === username)) {
          updated[username].online = false;
        }
      });
      return updated;
    });
  }, [users, room]);

  // (9) Track room membership to avoid duplicate join indicators
  const [roomMembers, setRoomMembers] = useState({}); // { roomName: Set of usernames }

  // (9) Update roomMembers when a user joins a room (system message logic)
  useEffect(() => {
    // Listen for system join messages in messages array
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || !lastMsg.system || !lastMsg.room || !lastMsg.message.includes('joined')) return;
    setRoomMembers(prev => {
      const updated = { ...prev };
      if (!updated[lastMsg.room]) updated[lastMsg.room] = new Set();
      updated[lastMsg.room].add(lastMsg.message.split(' joined')[0]);
      return updated;
    });
  }, [messages]);

  // (9) Filter system join messages: only show if user not already in roomMembers
  const filteredMessages = messages.filter(msg => {
    if (!msg.system || !msg.room || !msg.message.includes('joined')) return true;
    const username = msg.message.split(' joined')[0];
    if (!roomMembers[msg.room]) return true;
    // Only show the first join message for this user/room
    return Array.from(roomMembers[msg.room]).filter(u => u === username).length <= 1;
  });

  // (10) File input state for file sharing
  const [fileData, setFileData] = useState(null);

  // (10) Handle file selection and send as message
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      setFileData({
        file: reader.result,
        fileName: selectedFile.name,
        fileType: selectedFile.type,
      });
    };
    reader.readAsDataURL(selectedFile);
    e.target.value = '';
  };

  const [pendingMessages, setPendingMessages] = useState([]);

  // (5.4) Listen for delivery acknowledgment and remove from pending
  useEffect(() => {
    if (!socket) return;
    const onDelivered = ({ id }) => {
      setPendingMessages(prev => prev.filter(m => m.id !== id));
    };
    socket.on('message_delivered', onDelivered);
    return () => socket.off('message_delivered', onDelivered);
  }, [socket]);

  // (12) Mark private messages as read when opening a private chat
  useEffect(() => {
    if (selectedUser && socket && markMessagesAsRead) {
      markMessagesAsRead(socket.id, selectedUser.id);
    }
  }, [selectedUser, socket, markMessagesAsRead]);

  // (13) Reaction options (expanded)
  const reactionOptions = ['👍', '❤️', '😂', '😍', '😮', '😢', '👏', '🙌', '🤔', '😎', '🔥', '🎉', '🙏', '😆', '😡', '😱'];
  // (14) Emoji options for message input
  const emojiOptions = ['😀', '😂', '😍', '😎', '😢', '😡', '👍', '🙏', '🎉', '🔥', '❤️', '👏', '🙌', '😮', '😱', '🤔'];
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // (14) Add emoji to message input
  const handleAddEmoji = (emoji) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // (13) Track which message's reaction picker is open
  const [openReactionPicker, setOpenReactionPicker] = useState(null);

  // (13) React button and dropdown (only if user hasn't reacted or wants to change)
  const handleReact = (messageId, reaction) => {
    sendReaction(messageId, reaction, socket.id, username);
  };

  // (15) In-app notification state for new messages in inactive rooms
  const [notification, setNotification] = useState(null);

  // (15) Show notification only if the message is truly unseen
  useEffect(() => {
    if (!messages.length) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg.room || lastMsg.isPrivate || lastMsg.system) return;
    // Only show notification if not in the room, the message is not already visible, and not sent by the current user
    if (lastMsg.room !== room && lastMsg.sender !== username) {
      setNotification({
        room: lastMsg.room,
        sender: lastMsg.sender,
        message: lastMsg.message,
        id: lastMsg.id,
      });
    } else {
      // If the user is in the room, or sent the message, clear any notification for that room
      setNotification(null);
    }
  }, [messages, room]);

  // (15) Dismiss notification if the user switches to the notified room or the message is visible
  useEffect(() => {
    if (notification && notification.room === room) {
      setNotification(null);
    }
    // Also dismiss if the message is now visible in the chat
    if (notification && messages.some(m => m.id === notification.id && m.room === room)) {
      setNotification(null);
    }
  }, [room, notification, messages]);

  // (15) Dismiss notification
  const dismissNotification = () => setNotification(null);

  // (16) Sound notification for new messages in inactive rooms
  const notificationSoundUrl = 'https://cdn.pixabay.com/audio/2022/07/26/audio_124bfae5c3.mp3'; // Free notification sound
  const notificationAudioRef = useRef(null);

  useEffect(() => {
    if (notification && notification.sender !== username) {
      // Play sound when notification is shown
      if (notificationAudioRef.current) {
        notificationAudioRef.current.currentTime = 0;
        notificationAudioRef.current.play();
      }
    }
  }, [notification, username]);

  // (17) Request browser notification permission on mount
  useEffect(() => {
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // (17.1) Ref to always have the latest handleJoinRoom for notification click
  const handleJoinRoomRef = useRef(handleJoinRoom);
  useEffect(() => {
    handleJoinRoomRef.current = handleJoinRoom;
  }, [handleJoinRoom]);

  // (17) Show browser notification for new messages in inactive rooms
  useEffect(() => {
    if (
      notification &&
      notification.sender !== username &&
      window.Notification &&
      Notification.permission === 'granted'
    ) {
      const notif = new Notification(
        `New message from ${notification.sender} in ${notification.room}`,
        {
          body: notification.text ? notification.text.slice(0, 100) : '',
          icon: '/favicon.ico', // fallback icon
        }
      );
      notif.onclick = () => {
        window.focus();
        // Switch to the relevant room
        if (handleJoinRoomRef.current && notification.room) {
          handleJoinRoomRef.current(notification.room);
        }
      };
    }
  }, [notification, username]);

  // (5.1) Message pagination state
  const [paginatedMessages, setPaginatedMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const chatContainerRef = useRef(null);
  const MESSAGES_PAGE_SIZE = 20;

  // (5.1) Fetch messages for current room with pagination
  const fetchMessages = async (opts = {}) => {
    const { append = false, skip = 0 } = opts;
    setLoadingMessages(true);
    try {
      const res = await axios.get(`/api/messages`, {
        params: { room, skip, limit: MESSAGES_PAGE_SIZE },
      });
      const newMessages = res.data.messages || [];
      setHasMoreMessages(res.data.hasMore);
      setPaginatedMessages(prev =>
        append ? [...newMessages, ...prev] : newMessages
      );
    } catch (err) {
      // Optionally handle error
    } finally {
      setLoadingMessages(false);
    }
  };

  // (5.1) On room change, load latest messages
  useEffect(() => {
    fetchMessages({ append: false, skip: 0 });
  }, [room]);

  // (5.1) Infinite scroll: fetch older messages when scrolled to top
  const handleScroll = async () => {
    if (!chatContainerRef.current || loadingMessages || !hasMoreMessages) return;
    if (chatContainerRef.current.scrollTop === 0) {
      await fetchMessages({
        append: true,
        skip: paginatedMessages.length,
      });
      // Maintain scroll position after loading more
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = 1;
      }
    }
  };

  // (5.1) Attach scroll handler
  useEffect(() => {
    const ref = chatContainerRef.current;
    if (ref) {
      ref.addEventListener('scroll', handleScroll);
      return () => ref.removeEventListener('scroll', handleScroll);
    }
  }, [chatContainerRef, loadingMessages, hasMoreMessages, paginatedMessages.length]);

  // (5.1) Use paginatedMessages for rendering chat
  // (5.4) Send message with pending state (no timeout)
  const handleSendMessage = async (e, retryMsg) => {
    if (e) e.preventDefault();
    const msgText = retryMsg ? retryMsg.message : messageInput.trim();
    const msgFile = retryMsg ? retryMsg.fileData : fileData;
    if (!msgText && !msgFile) return;
    const tempId = retryMsg ? retryMsg.id : Date.now() + Math.random();
    const newPending = {
      id: tempId,
      message: msgText,
      sender: username,
      timestamp: new Date().toISOString(),
      room,
      fileData: msgFile,
      status: 'pending',
      createdAt: Date.now(),
    };
    setPendingMessages(prev => [
      ...prev.filter(m => m.id !== tempId),
      newPending
    ]);
    sendMessage(msgText, msgFile);
    if (!retryMsg) {
      setMessageInput('');
      setFileData(null);
      setTyping(false);
    }
  };

  // (5.5) Message search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // (5.5) Handle message search
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    setSearchLoading(true);
    try {
      const res = await axios.get('/api/messages/search', {
        params: { room, query: searchTerm },
      });
      setSearchResults(res.data.messages || []);
    } catch (err) {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  // (5.5) Clear search
  const clearSearch = () => {
    setSearchTerm('');
    setSearchResults(null);
  };

  // (1) Save username and room to localStorage on login
  useEffect(() => {
    if (username) {
      localStorage.setItem('username', username);
    }
  }, [username]);
  useEffect(() => {
    if (room) {
      localStorage.setItem('room', room);
    }
  }, [room]);

  // (Optional) Logout handler to clear localStorage
  const handleLogout = () => {
    setUsername('');
    setInput('');
    localStorage.removeItem('username');
    localStorage.removeItem('room');
  };

  // Sidebar drawer state for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar when clicking outside (mobile)
  useEffect(() => {
    if (!sidebarOpen) return;
    const handleClick = (e) => {
      if (e.target.closest('.sidebar') || e.target.closest('.sidebar-toggle')) return;
      setSidebarOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sidebarOpen]);

  if (!username) {
    // (1) Show username prompt UI
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '4rem' }}>
        <h2>Enter your username to join the chat</h2>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Username"
          style={{ padding: '0.5rem', fontSize: '1rem', marginBottom: '1rem' }}
        />
        <button
          onClick={() => setUsername(input.trim())}
          disabled={!input.trim()}
          style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}
        >
          Join Chat
        </button>
      </div>
    );
  }

  // (5.4) Combine paginatedMessages and pendingMessages for rendering
  const allMessages = [...paginatedMessages, ...pendingMessages];

  // (4) Display online users sidebar, room list, and chat area
  return (
    <>
      {/* App name header */}
      <h1 style={{ textAlign: 'center', marginTop: '2rem', marginBottom: '1.5rem', fontSize: '2.2rem', fontWeight: 700, letterSpacing: 1, color: '#1976d2' }}>NeChat App</h1>
      {/* Example of code splitting: Lazy loaded component */}
      <Suspense fallback={<div>Loading demo...</div>}>
        <LazyDemo />
      </Suspense>
      {/* Responsive styles for mobile/desktop */}
      <style>{`
        @media (max-width: 700px) {
          .main-container {
            flex-direction: row !important;
            padding: 4px !important;
            gap: 4px !important;
          }
          .sidebar {
            min-width: 200px !important;
            max-width: 80vw !important;
            width: 70vw !important;
            border-right: 1px solid #eee !important;
            border-bottom: none !important;
            padding-right: 0 !important;
            padding-bottom: 0 !important;
            overflow-y: auto !important;
            height: 100% !important;
            position: fixed !important;
            top: 0; left: 0;
            background: #fff;
            z-index: 2000;
            box-shadow: 2px 0 8px #0002;
            transform: translateX(-100%);
            transition: transform 0.25s;
          }
          .sidebar.open {
            transform: translateX(0);
          }
          .sidebar-backdrop {
            display: block;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.15);
            z-index: 1999;
          }
          .sidebar-toggle {
            display: block !important;
            position: absolute;
            top: 18px; left: 18px;
            z-index: 2100;
            background: none;
            border: none;
            font-size: 2rem;
            color: #1976d2;
            cursor: pointer;
          }
        }
        @media (min-width: 701px) {
          .sidebar-toggle { display: none !important; }
          .sidebar { position: static !important; transform: none !important; box-shadow: none !important; }
          .sidebar-backdrop { display: none !important; }
        }
      `}</style>
      {/* Hamburger icon for mobile */}
      <button className="sidebar-toggle" style={{ display: 'none' }} onClick={() => setSidebarOpen(v => !v)} title="Open sidebar">
        &#9776;
      </button>
      {/* Sidebar backdrop for mobile */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <div className="main-container" style={{ maxWidth: 1000, margin: '2rem auto', border: '1px solid #ddd', borderRadius: 8, padding: 24, background: '#fff', display: 'flex', gap: 24, position: 'relative', minHeight: 600 }}>
        {/* (5.2) Connection status banner */}
        {isDisconnected && (
          <div style={{ position: 'absolute', top: -40, left: 0, right: 0, background: '#ffcccc', color: '#a00', padding: 8, textAlign: 'center', borderRadius: 8 }}>
            Disconnected from server. Trying to reconnect...
          </div>
        )}
        {isReconnecting && !isDisconnected && (
          <div style={{ position: 'absolute', top: -40, left: 0, right: 0, background: '#fff3cd', color: '#856404', padding: 8, textAlign: 'center', borderRadius: 8 }}>
            Reconnecting to server...
          </div>
        )}
        {/* (16) Audio element for notification sound */}
        <audio ref={notificationAudioRef} src={notificationSoundUrl} preload="auto" />
        {/* (15) In-app notification banner for new messages in inactive rooms */}
        {notification && (
          <div style={{ position: 'absolute', top: -40, left: 0, right: 0, background: '#1976d2', color: '#fff', padding: '10px 20px', borderRadius: 6, boxShadow: '0 2px 8px #0002', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 100 }}>
            <span>
              New message in <strong>{notification.room}</strong> from <strong>{notification.sender}</strong>: {notification.message}
            </span>
            <button onClick={dismissNotification} style={{ marginLeft: 16, background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }} title="Dismiss">×</button>
          </div>
        )}
        {/* (4) Online Users Sidebar */}
        <div className={`sidebar${sidebarOpen ? ' open' : ''}`} style={{ minWidth: 180, borderRight: '1px solid #eee', paddingRight: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 18 }}>Online Users</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {/* (7) Show online/offline status for users */}
            {Object.entries(allUsers).length === 0 && <li style={{ color: '#888' }}>No users online</li>}
            {Object.entries(allUsers).map(([listedUsername, info]) => (
              <li
                key={info.id}
                style={{
                  color: listedUsername === username ? '#1976d2' : '#222',
                  fontWeight: listedUsername === username ? 'bold' : 'normal',
                  cursor: listedUsername !== username ? 'pointer' : 'default',
                  background: selectedUser && selectedUser.id === info.id ? '#e3f2fd' : 'transparent',
                  borderRadius: 4,
                  padding: '2px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onClick={() => listedUsername !== username && setSelectedUser({ username: listedUsername, id: info.id })}
              >
                {/* (7) Online/offline dot */}
                <span style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: info.online ? '#4caf50' : '#bbb',
                  marginRight: 6,
                }} />
                {listedUsername} {/* (7) Only show (You) for the current user */} {listedUsername === username && <span style={{ fontSize: 12, color: '#bbb' }}>(You)</span>}
              </li>
            ))}
          </ul>
          {/* (2) Show private chat area if a user is selected */}
          {selectedUser && (
            <div style={{ marginTop: 16, padding: 8, border: '1px solid #eee', borderRadius: 4, background: '#f9f9f9' }}>
              <strong>Private chat with {selectedUser.username}</strong>
              {/* (4) Display private messages: Only show messages between current user and selected user */}
              <div style={{ maxHeight: 120, overflowY: 'auto', margin: '8px 0', fontSize: 14 }}>
                {/* (11) Show private messages between current user and selected user */}
                {messages.filter(m => m.isPrivate &&
                  ((m.senderId === socket.id && m.recipientId === selectedUser.id) ||
                   (m.senderId === selectedUser.id && m.recipientId === socket.id)))
                  .length === 0 && (
                  <div style={{ color: '#888' }}>No private messages yet.</div>
                )}
                {messages
                  .filter(m => m.isPrivate &&
                    ((m.senderId === socket.id && m.recipientId === selectedUser.id) ||
                     (m.senderId === selectedUser.id && m.recipientId === socket.id)))
                  .map(m => (
                    <div key={m.id} style={{ marginBottom: 4 }}>
                      <span style={{ fontWeight: m.sender === username ? 'bold' : 'normal', color: m.sender === username ? '#1976d2' : '#222' }}>{m.sender}</span>
                      {': '}
                      <span>{m.message}</span>
                      {/* (12) Show read receipt for sent messages */}
                      {m.senderId === socket.id && m.read && (
                        <span style={{ color: '#4caf50', marginLeft: 6 }} title="Read">✓</span>
                      )}
                      <span style={{ fontSize: 11, color: '#bbb', marginLeft: 6 }}>{new Date(m.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
              </div>
              {/* (3) Send private message */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  if (privateMessageInput.trim()) {
                    sendPrivateMessage(selectedUser.id, privateMessageInput.trim());
                    setPrivateMessageInput('');
                  }
                }}
                style={{ display: 'flex', gap: 4 }}
              >
                <input
                  type="text"
                  value={privateMessageInput}
                  onChange={e => setPrivateMessageInput(e.target.value)}
                  placeholder={`Message ${selectedUser.username}...`}
                  style={{ flex: 1, padding: '0.3rem', fontSize: '1rem' }}
                />
                <button type="submit" style={{ padding: '0.3rem 0.7rem', fontSize: '1rem' }} disabled={!privateMessageInput.trim()}>
                  Send
                </button>
              </form>
              <button onClick={() => setSelectedUser(null)} style={{ marginTop: 6, fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Close</button>
            </div>
          )}
          {/* (5) Room list and create room UI */}
          <div style={{ marginTop: 32 }}>
            <h4>Rooms</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rooms.map(r => (
                <li key={r} style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* (6) Show room name button, and Join/Leave as appropriate */}
                  <button
                    style={{
                      background: r === room ? '#1976d2' : joinedRooms.includes(r) ? '#eee' : '#fff',
                      color: r === room ? '#fff' : '#222',
                      border: '1px solid #ccc',
                      borderRadius: 4,
                      padding: '4px 10px',
                      cursor: r === room ? 'default' : joinedRooms.includes(r) ? 'pointer' : 'pointer',
                      fontWeight: r === room ? 'bold' : 'normal',
                    }}
                    disabled={r === room}
                    // (6) Switch rooms, but don't rejoin if already a member
                    onClick={() => {
                      if (joinedRooms.includes(r) && r !== room) {
                        setRoom(r);
                      }
                    }}
                  >
                    {/* (6) Show room name or 'Active' */}
                    {r === room ? 'Active' : r}
                  </button>
                  {r !== 'General' && !joinedRooms.includes(r) && (
                    <button
                      style={{ padding: '2px 8px', fontSize: 12, borderRadius: 4, background: '#1976d2', color: '#fff', border: 'none', cursor: 'pointer' }}
                      // (6) Join room
                      onClick={() => handleJoinRoom(r)}
                    >
                      Join
                    </button>
                  )}
                  {r !== 'General' && joinedRooms.includes(r) && (
                    <button
                      style={{ padding: '2px 8px', fontSize: 12, borderRadius: 4, background: '#e53935', color: '#fff', border: 'none', cursor: 'pointer' }}
                      // (6) Leave room
                      onClick={() => handleLeaveRoom(r)}
                    >
                      Leave
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {/* (5) Create new room */}
            <form
              onSubmit={e => {
                e.preventDefault();
                if (roomInput.trim() && !rooms.includes(roomInput.trim())) {
                  socket.emit('create_room', roomInput.trim());
                  handleJoinRoom(roomInput.trim());
                  setRoomInput('');
                }
              }}
              style={{ marginTop: 8, display: 'flex', gap: 4 }}
            >
              <input
                type="text"
                value={roomInput}
                onChange={e => setRoomInput(e.target.value)}
                placeholder="New room name"
                style={{ flex: 1, padding: '0.3rem', fontSize: '1rem' }}
              />
              <button type="submit" style={{ padding: '0.3rem 0.7rem', fontSize: '1rem' }} disabled={!roomInput.trim() || rooms.includes(roomInput.trim())}>
                Create
              </button>
            </form>
          </div>
        </div>
        {/* (5.1) Chat container with infinite scroll and input at bottom */}
        <div className="chat-area" style={{ flex: 1, height: 500, display: 'flex', flexDirection: 'column', border: '1px solid #eee', borderRadius: 8, padding: 0, background: '#fafafa' }}>
          {/* Messages area */}
          <div ref={chatContainerRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column-reverse' }}>
            {loadingMessages && <div style={{ textAlign: 'center', margin: 8 }}>Loading...</div>}
            {(searchResults !== null ? searchResults : allMessages).map(msg => {
              const isPending = pendingMessages.some(m => m.id === msg.id);
              return (
                <div key={msg.id} style={{ marginBottom: 8, color: msg.system ? '#888' : '#222', position: 'relative', opacity: isPending ? 0.6 : 1 }}>
                  <span style={{ fontWeight: msg.sender === username ? 'bold' : 'normal', color: msg.sender === username ? '#1976d2' : '#222' }}>{msg.sender}</span>
                  {': '}
                  <span>{msg.message}</span>
                  {/* (10) Show file if present */}
                  {msg.file && msg.fileType && msg.fileType.startsWith('image/') && (
                    <div><img src={msg.file} alt={msg.fileName} style={{ maxWidth: 200, maxHeight: 200, marginTop: 4 }} /></div>
                  )}
                  {msg.file && msg.fileType && msg.fileType.startsWith('video/') && (
                    <div><video src={msg.file} controls style={{ maxWidth: 200, maxHeight: 200, marginTop: 4 }} /></div>
                  )}
                  {msg.file && msg.fileType && !msg.fileType.startsWith('image/') && !msg.fileType.startsWith('video/') && (
                    <div><a href={msg.file} download={msg.fileName} style={{ color: '#1976d2', marginTop: 4, display: 'inline-block' }}>{msg.fileName}</a></div>
                  )}
                  <span style={{ fontSize: 12, color: '#bbb', marginLeft: 8 }}>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  {/* (5.4) Show sending indicator for pending messages */}
                  {isPending && (
                    <span style={{ marginLeft: 8, color: '#aaa', fontSize: 12 }}>(sending...)</span>
                  )}
                  {/* (13) User's selected reaction (large/bold, always visible) */}
                  {msg.reactions && msg.reactions[socket.id] && (
                    <button
                      style={{
                        marginLeft: 8,
                        fontWeight: 'bold',
                        fontSize: 22,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        verticalAlign: 'middle',
                      }}
                      title="Change your reaction"
                      onClick={() => setOpenReactionPicker(openReactionPicker === msg.id ? null : msg.id)}
                    >
                      {msg.reactions[socket.id]}
                    </button>
                  )}
                  {/* (13) React button and dropdown (only if user hasn't reacted or wants to change, and not your own message) */}
                  {msg.sender !== username && (!msg.reactions || !msg.reactions[socket.id] || openReactionPicker === msg.id) && (
                    <button
                      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, marginLeft: 8 }}
                      onClick={() => setOpenReactionPicker(openReactionPicker === msg.id ? null : msg.id)}
                      title="React"
                    >
                      {/* (13) Dropdown arrow symbol for reaction picker */}
                      ▼
                    </button>
                  )}
                  {openReactionPicker === msg.id && (
                    <div style={{ position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid #ccc', borderRadius: 6, boxShadow: '0 2px 8px #0002', padding: 6, top: 24, left: 0, display: 'flex', gap: 6 }}>
                      {reactionOptions.map(reaction => (
                        <button
                          key={reaction}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20 }}
                          onClick={() => handleReact(msg.id, reaction)}
                          title={`React with ${reaction}`}
                        >
                          {reaction}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Typing indicator at the bottom of chat area */}
          {typingUsers.filter(u => u !== username).length > 0 && (
            <div style={{ minHeight: 24, color: '#888', fontStyle: 'italic', margin: '0 0 4px 12px', textAlign: 'left' }}>
              {typingUsers.filter(u => u !== username).join(', ')} {typingUsers.filter(u => u !== username).length === 1 ? 'is' : 'are'} typing...
            </div>
          )}
          {/* Message input at bottom */}
          <form className="message-input-form" onSubmit={handleSendMessage} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderTop: '1px solid #eee', background: '#fff' }}>
            <input
              type="text"
              value={messageInput}
              onChange={e => {
                setMessageInput(e.target.value);
                setTyping(e.target.value.length > 0);
              }}
              onBlur={() => setTyping(false)}
              placeholder="Type a message..."
              style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
            />
            {/* (14) Emoji picker button */}
            <button
              type="button"
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, marginRight: 4 }}
              onClick={() => setShowEmojiPicker(v => !v)}
              title="Add emoji"
            >
              😊
            </button>
            {showEmojiPicker && (
              <div style={{ position: 'absolute', zIndex: 20, background: '#fff', border: '1px solid #ccc', borderRadius: 6, boxShadow: '0 2px 8px #0002', padding: 6, bottom: 60, left: 20, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {emojiOptions.map(emoji => (
                  <button
                    key={emoji}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 22 }}
                    onClick={() => handleAddEmoji(emoji)}
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            {/* (10) File input */}
            <input
              type="file"
              style={{ display: 'none' }}
              id="file-input"
              onChange={handleFileChange}
              accept="image/*,video/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx"
            />
            <label htmlFor="file-input" style={{ cursor: 'pointer', background: '#eee', borderRadius: 4, padding: '0.5rem', marginRight: 4 }} title="Attach file">
              📎
            </label>
            {fileData && (
              <span style={{ fontSize: 12, color: '#1976d2' }}>{fileData.fileName}</span>
            )}
            <button type="submit" style={{ padding: '0.5rem 1rem', fontSize: '1rem' }} disabled={!messageInput.trim() && !fileData}>
              Send
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export default App
