import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  AttachmentMeta,
  ChatMessage,
  PublicUser,
  SocketConnectionState,
} from '../types';

interface UseChatSocketOptions {
  token: string | null;
  onMessageNew: (message: ChatMessage) => void;
  onPresenceSnapshot: (onlineUserIds: string[]) => void;
  onPresenceUpdate: (payload: {
    userId: string;
    isOnline: boolean;
    lastSeen: string;
  }) => void;
  onTypingUpdate: (payload: { userId: string; isTyping: boolean }) => void;
  onMessagesReadAck: (payload: { readerId: string; messageIds: string[] }) => void;
  onUserRegistered: (user: PublicUser) => void;
  onReconnected: () => void;
}

export function useChatSocket(options: UseChatSocketOptions) {
  const [connectionState, setConnectionState] =
    useState<SocketConnectionState>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const hasConnectedOnceRef = useRef(false);

  // Keep latest callbacks in refs to avoid tearing down the socket on re-renders
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    if (!options.token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      hasConnectedOnceRef.current = false;
      setConnectionState('disconnected');
      setConnectionError(null);
      return;
    }

    setConnectionState('connecting');
    setConnectionError(null);

    const socket = io({
      auth: { token: options.token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10_000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      setConnectionError(null);
      if (hasConnectedOnceRef.current) {
        callbacksRef.current.onReconnected();
      }
      hasConnectedOnceRef.current = true;
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') {
        setConnectionState('disconnected');
        setConnectionError(null);
      } else {
        setConnectionState('reconnecting');
        setConnectionError('Real-time connection lost. Reconnecting automatically...');
      }
    });

    socket.on('connect_error', (err) => {
      setConnectionState('error');
      setConnectionError(
        err.message || 'Unable to connect to real-time messaging server.',
      );
    });

    socket.io.on('reconnect_attempt', () => {
      setConnectionState('reconnecting');
      setConnectionError('Attempting to restore real-time connection...');
    });

    socket.on('presence:snapshot', (payload: { onlineUserIds: string[] }) => {
      if (Array.isArray(payload?.onlineUserIds)) {
        callbacksRef.current.onPresenceSnapshot(payload.onlineUserIds);
      }
    });

    socket.on(
      'presence:update',
      (payload: { userId: string; isOnline: boolean; lastSeen: string }) => {
        if (payload?.userId) {
          callbacksRef.current.onPresenceUpdate(payload);
        }
      },
    );

    socket.on('message:new', (message: ChatMessage) => {
      if (message?.id) {
        callbacksRef.current.onMessageNew(message);
      }
    });

    socket.on(
      'typing:update',
      (payload: { userId: string; isTyping: boolean }) => {
        if (payload?.userId) {
          callbacksRef.current.onTypingUpdate(payload);
        }
      },
    );

    socket.on(
      'messages:read_ack',
      (payload: { readerId: string; messageIds: string[] }) => {
        if (payload?.readerId && Array.isArray(payload.messageIds)) {
          callbacksRef.current.onMessagesReadAck(payload);
        }
      },
    );

    socket.on('user:registered', (user: PublicUser) => {
      if (user?.id) {
        callbacksRef.current.onUserRegistered(user);
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [options.token]);

  const sendMessage = useCallback(
    (
      recipientId: string,
      content: string,
      attachment: AttachmentMeta | null,
    ): Promise<ChatMessage> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          reject(
            new Error(
              'Not connected to messaging server. Please wait for reconnection.',
            ),
          );
          return;
        }

        socket.emit(
          'message:send',
          { recipientId, content, attachment },
          (ack: { ok: boolean; error?: string; message?: ChatMessage }) => {
            if (ack?.ok && ack.message) {
              resolve(ack.message);
            } else {
              reject(new Error(ack?.error || 'Message failed to send.'));
            }
          },
        );
      });
    },
    [],
  );

  const emitMessagesRead = useCallback((peerId: string) => {
    socketRef.current?.emit('messages:read', { peerId });
  }, []);

  const emitTypingStart = useCallback((recipientId: string) => {
    socketRef.current?.emit('typing:start', { recipientId });
  }, []);

  const emitTypingStop = useCallback((recipientId: string) => {
    socketRef.current?.emit('typing:stop', { recipientId });
  }, []);

  const manualReconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket && !socket.connected) {
      setConnectionState('connecting');
      setConnectionError(null);
      socket.connect();
    }
  }, []);

  return {
    connectionState,
    connectionError,
    sendMessage,
    emitMessagesRead,
    emitTypingStart,
    emitTypingStop,
    manualReconnect,
  };
}
