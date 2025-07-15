// socket.js - Socket.io client setup

import { io } from 'socket.io-client';
import { useEffect, useState, useRef } from 'react';

// Socket.io connection URL
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

// Create socket instance
export const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// Custom hook for using socket.io
export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const lastUsernameRef = useRef(null);
  const lastRoomRef = useRef('General');

  // Connect to socket server
  const connect = (username, room = 'General') => {
    lastUsernameRef.current = username;
    lastRoomRef.current = room;
    socket.connect();
    if (username) {
      socket.emit('user_join', username, room);
    }
  };

  // Disconnect from socket server
  const disconnect = () => {
    socket.disconnect();
  };

  // Send a message
  // (file sharing) Accept optional fileData argument
  const sendMessage = (message, fileData) => {
    const payload = { message };
    if (fileData) {
      Object.assign(payload, fileData);
    }
    socket.emit('send_message', payload);
  };

  // Send a private message
  const sendPrivateMessage = (to, message) => {
    socket.emit('private_message', { to, message });
  };

  // Set typing status
  const setTyping = (isTyping) => {
    socket.emit('typing', isTyping);
  };

  // Mark private messages as read when opening a private chat
  const markMessagesAsRead = (senderId, recipientId) => {
    socket.emit('message_read', { senderId, recipientId });
  };

  // Send a reaction to a message
  const sendReaction = (messageId, reaction, userId, username) => {
    socket.emit('message_reaction', { messageId, reaction, userId, username });
  };

  // Socket event listeners
  useEffect(() => {
    // Connection events
    const onConnect = () => {
      setIsConnected(true);
      setIsReconnecting(false);
      setIsDisconnected(false);
      // On reconnect, re-emit user_join with last known username and room
      if (lastUsernameRef.current) {
        socket.emit('user_join', lastUsernameRef.current, lastRoomRef.current || 'General');
      }
    };

    const onDisconnect = () => {
      setIsConnected(false);
      setIsDisconnected(true);
    };

    // Reconnection events
    const onReconnectAttempt = () => {
      setIsReconnecting(true);
    };
    const onReconnect = () => {
      setIsReconnecting(false);
      setIsDisconnected(false);
    };
    const onConnectError = () => {
      setIsReconnecting(false);
      setIsDisconnected(true);
    };

    // Message events
    const onReceiveMessage = (message) => {
      setLastMessage(message);
      setMessages((prev) => [...prev, message]);
    };

    const onPrivateMessage = (message) => {
      setLastMessage(message);
      setMessages((prev) => [...prev, message]);
    };

    // User events
    const onUserList = (userList) => {
      setUsers(userList);
    };

    const onUserJoined = (user) => {
      // (system) Only show join message if not already present for this user/room
      setMessages((prev) => {
        // Check if the last join message for this user/room already exists
        const lastMsg = [...prev].reverse().find(m => m.system && m.room === (user.room || 'General') && m.message.includes(`${user.username} joined`));
        if (lastMsg) return prev;
        return [
          ...prev,
          {
            id: Date.now(),
            system: true,
            message: `${user.username} joined the room${user.room ? `: ${user.room}` : ''}`,
            timestamp: new Date().toISOString(),
            room: user.room || 'General',
          },
        ];
      });
    };

    const onUserLeft = (user) => {
      // (system) Only show leave message if user left the current room
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          system: true,
          message: `${user.username} left the room${user.room ? `: ${user.room}` : ''}`,
          timestamp: new Date().toISOString(),
          room: user.room || 'General',
        },
      ]);
    };

    // Typing events
    const onTypingUsers = (users) => {
      setTypingUsers(users);
    };

    // Listen for message_read events from the server
    const onMessageRead = ({ senderId, recipientId, messageIds }) => {
      setMessages(prev => prev.map(m =>
        m.isPrivate && m.senderId === senderId && m.recipientId === recipientId && messageIds.includes(m.id)
          ? { ...m, read: true }
          : m
      ));
    };

    // Listen for message_reaction events from the server
    const onMessageReaction = ({ messageId, reactions }) => {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, reactions } : m
      ));
    };

    // Register event listeners
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('reconnect_attempt', onReconnectAttempt);
    socket.on('reconnect', onReconnect);
    socket.on('connect_error', onConnectError);
    socket.on('receive_message', onReceiveMessage);
    socket.on('private_message', onPrivateMessage);
    socket.on('user_list', onUserList);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);
    socket.on('typing_users', onTypingUsers);
    socket.on('message_read', onMessageRead);
    socket.on('message_reaction', onMessageReaction);

    // Clean up event listeners
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('reconnect_attempt', onReconnectAttempt);
      socket.off('reconnect', onReconnect);
      socket.off('connect_error', onConnectError);
      socket.off('receive_message', onReceiveMessage);
      socket.off('private_message', onPrivateMessage);
      socket.off('user_list', onUserList);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('typing_users', onTypingUsers);
      socket.off('message_read', onMessageRead);
      socket.off('message_reaction', onMessageReaction);
    };
  }, []);

  return {
    socket,
    isConnected,
    isReconnecting,
    isDisconnected,
    lastMessage,
    messages,
    users,
    typingUsers,
    connect,
    disconnect,
    sendMessage,
    sendPrivateMessage,
    setTyping,
    markMessagesAsRead,
    sendReaction,
  };
};

export default socket; 