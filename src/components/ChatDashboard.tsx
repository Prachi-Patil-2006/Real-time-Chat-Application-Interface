import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  Download,
  FileText,
  LogOut,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChatSocket } from '../hooks/useChatSocket';
import {
  fetchMessages,
  fetchUsersDirectory,
  uploadFileWithProgress,
  validateAttachmentFile,
} from '../services/api';
import type { AttachmentMeta, ChatMessage, DirectoryUser, PublicUser } from '../types';
import {
  formatDayLabel,
  formatFileSize,
  formatLastSeen,
  formatMessageTime,
} from '../utils/formatters';
import { Avatar } from './Avatar';

export function ChatDashboard() {
  const { user, token, logout } = useAuth();

  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [presenceFilter, setPresenceFilter] = useState<'all' | 'online'>('all');

  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [draftText, setDraftText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});

  // File upload state
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [stagedAttachment, setStagedAttachment] = useState<AttachmentMeta | null>(null);
  const [lightboxImage, setLightboxImage] = useState<AttachmentMeta | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const selectedPeerIdRef = useRef<string | null>(null);
  selectedPeerIdRef.current = selectedPeerId;

  // Responsive mobile view toggle: show list when no peer is selected
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const loadDirectory = useCallback(async () => {
    try {
      setDirectoryError(null);
      const { users } = await fetchUsersDirectory();
      setDirectory(users);
      // On desktop initial load, auto-select the first conversation if none selected
      setSelectedPeerId((prev) => {
        if (prev && users.some((u) => u.id === prev)) return prev;
        if (window.innerWidth >= 768 && users.length > 0) {
          return users[0].id;
        }
        return prev;
      });
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : 'Unable to load contacts.',
      );
    } finally {
      setIsLoadingDirectory(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const loadConversation = useCallback(async (peerId: string) => {
    setIsLoadingMessages(true);
    setMessagesError(null);
    try {
      const { messages: history } = await fetchMessages(peerId);
      setMessages(history);
      // Reset unread count locally for this peer
      setDirectory((prev) =>
        prev.map((u) => (u.id === peerId ? { ...u, unreadCount: 0 } : u)),
      );
    } catch (err) {
      setMessagesError(
        err instanceof Error ? err.message : 'Unable to load conversation.',
      );
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPeerId) {
      setMessages([]);
      return;
    }
    loadConversation(selectedPeerId);
  }, [selectedPeerId, loadConversation]);

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedPeerId]);

  // Socket.IO event handlers
  const handlePresenceSnapshot = useCallback((onlineUserIds: string[]) => {
    const onlineSet = new Set(onlineUserIds);
    setDirectory((prev) =>
      prev.map((u) => ({
        ...u,
        isOnline: onlineSet.has(u.id),
      })),
    );
  }, []);

  const handlePresenceUpdate = useCallback(
    (payload: { userId: string; isOnline: boolean; lastSeen: string }) => {
      setDirectory((prev) =>
        prev.map((u) =>
          u.id === payload.userId
            ? { ...u, isOnline: payload.isOnline, lastSeen: payload.lastSeen }
            : u,
        ),
      );
    },
    [],
  );

  const handleTypingUpdate = useCallback(
    (payload: { userId: string; isTyping: boolean }) => {
      setTypingUsers((prev) => ({ ...prev, [payload.userId]: payload.isTyping }));
    },
    [],
  );

  const handleMessagesReadAck = useCallback(
    (payload: { readerId: string; messageIds: string[] }) => {
      const idSet = new Set(payload.messageIds);
      const readAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => (idSet.has(m.id) ? { ...m, readAt } : m)),
      );
    },
    [],
  );

  const handleUserRegistered = useCallback(
    (newUser: PublicUser) => {
      if (newUser.id === user?.id) return;
      setDirectory((prev) => {
        if (prev.some((u) => u.id === newUser.id)) return prev;
        return [{ ...newUser, lastMessage: null, unreadCount: 0 }, ...prev];
      });
    },
    [user?.id],
  );

  const socketRefEmitRead = useRef<(peerId: string) => void>(() => {});

  const handleMessageNew = useCallback(
    (msg: ChatMessage) => {
      const currentUserId = user?.id;
      if (!currentUserId) return;

      const peerId = msg.senderId === currentUserId ? msg.recipientId : msg.senderId;
      const isCurrentThread = selectedPeerIdRef.current === peerId;

      if (isCurrentThread) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (msg.senderId === peerId) {
          socketRefEmitRead.current(peerId);
        }
      }

      setDirectory((prev) => {
        const updated = prev.map((u) => {
          if (u.id !== peerId) return u;
          const shouldIncrementUnread =
            msg.senderId === peerId && !isCurrentThread;
          return {
            ...u,
            lastMessage: msg,
            unreadCount: shouldIncrementUnread ? u.unreadCount + 1 : u.unreadCount,
          };
        });
        return [...updated].sort((a, b) => {
          const timeA = a.lastMessage?.createdAt ?? a.createdAt;
          const timeB = b.lastMessage?.createdAt ?? b.createdAt;
          return timeB.localeCompare(timeA);
        });
      });
    },
    [user?.id],
  );

  const handleReconnected = useCallback(() => {
    loadDirectory();
    if (selectedPeerIdRef.current) {
      loadConversation(selectedPeerIdRef.current);
    }
  }, [loadDirectory, loadConversation]);

  const {
    connectionState,
    connectionError,
    sendMessage,
    emitMessagesRead,
    emitTypingStart,
    emitTypingStop,
    manualReconnect,
  } = useChatSocket({
    token,
    onMessageNew: handleMessageNew,
    onPresenceSnapshot: handlePresenceSnapshot,
    onPresenceUpdate: handlePresenceUpdate,
    onTypingUpdate: handleTypingUpdate,
    onMessagesReadAck: handleMessagesReadAck,
    onUserRegistered: handleUserRegistered,
    onReconnected: handleReconnected,
  });

  socketRefEmitRead.current = emitMessagesRead;

  const selectedPeer = useMemo(
    () => directory.find((u) => u.id === selectedPeerId) ?? null,
    [directory, selectedPeerId],
  );

  const filteredDirectory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return directory.filter((u) => {
      if (presenceFilter === 'online' && !u.isOnline) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [directory, searchQuery, presenceFilter]);

  const handleSelectPeer = (peerId: string) => {
    setSelectedPeerId(peerId);
    setMobileShowChat(true);
    setSendError(null);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadError(null);
    const validationErr = validateAttachmentFile(file);
    if (validationErr) {
      setUploadError(validationErr);
      return;
    }

    setUploadProgress(0);
    const { promise, abort } = uploadFileWithProgress(file, (pct) => {
      setUploadProgress(pct);
    });
    uploadAbortRef.current = abort;

    try {
      const attachment = await promise;
      setStagedAttachment(attachment);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'File upload failed.');
    } finally {
      setUploadProgress(null);
      uploadAbortRef.current = null;
    }
  };

  const handleCancelUpload = () => {
    uploadAbortRef.current?.();
    uploadAbortRef.current = null;
    setUploadProgress(null);
  };

  const handleDraftChange = (value: string) => {
    setDraftText(value);
    if (!selectedPeerId) return;

    if (value.trim().length > 0) {
      emitTypingStart(selectedPeerId);
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => {
        if (selectedPeerId) emitTypingStop(selectedPeerId);
      }, 2000);
    } else {
      emitTypingStop(selectedPeerId);
    }
  };

  const handleSend = async () => {
    if (!selectedPeerId) return;
    const trimmed = draftText.trim();
    if (!trimmed && !stagedAttachment) return;
    if (isSending || uploadProgress !== null) return;

    setSendError(null);
    setIsSending(true);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    emitTypingStop(selectedPeerId);

    try {
      const saved = await sendMessage(selectedPeerId, trimmed, stagedAttachment);
      setMessages((prev) => {
        if (prev.some((m) => m.id === saved.id)) return prev;
        return [...prev, saved];
      });
      setDraftText('');
      setStagedAttachment(null);
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : 'Failed to send message.',
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group messages with day separators
  const groupedMessages = useMemo(() => {
    const groups: Array<{ dayLabel: string; items: ChatMessage[] }> = [];
    for (const msg of messages) {
      const label = formatDayLabel(msg.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.dayLabel !== label) {
        groups.push({ dayLabel: label, items: [msg] });
      } else {
        lastGroup.items.push(msg);
      }
    }
    return groups;
  }, [messages]);

  const onlineCount = useMemo(
    () => directory.filter((u) => u.isOnline).length,
    [directory],
  );

  if (!user) return null;

  return (
    <div className="h-dvh w-full bg-slate-50 flex overflow-hidden">
      {/* Left Sidebar: User Profile + Contacts Directory */}
      <aside
        className={`${
          mobileShowChat ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 lg:w-[340px] shrink-0 bg-white border-r border-slate-200 flex-col h-full`}
      >
        {/* Brand & Current User Profile Section */}
        <div className="px-4 py-3.5 border-b border-slate-200 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
                <MessageSquare className="h-4 w-4" />
              </div>
              <span className="text-base font-bold tracking-tight text-slate-900 font-display whitespace-nowrap">
                RelayChat
              </span>
            </div>

            <button
              type="button"
              onClick={logout}
              className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Log out</span>
            </button>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Avatar
              name={user.name}
              avatarUrl={user.avatarUrl}
              isOnline={connectionState === 'connected'}
              showPresenceDot
              size="md"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {user.name}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {user.role} ·{' '}
                <span
                  className={
                    connectionState === 'connected'
                      ? 'text-emerald-700 font-medium'
                      : 'text-amber-700 font-medium'
                  }
                >
                  {connectionState === 'connected' ? 'Online' : 'Connecting'}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Search & Online Filter Controls */}
        <div className="px-4 py-3 border-b border-slate-200 space-y-2.5">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search people..."
              aria-label="Search conversations"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/15"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setPresenceFilter('all')}
              className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                presenceFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({directory.length})
            </button>
            <button
              type="button"
              onClick={() => setPresenceFilter('online')}
              className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                presenceFilter === 'online'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Online ({onlineCount})
            </button>
          </div>
        </div>

        {/* User Directory List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {isLoadingDirectory ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="h-11 w-11 rounded-full bg-slate-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-28 bg-slate-200 rounded" />
                    <div className="h-3 w-44 bg-slate-100 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : directoryError ? (
            <div className="p-5 text-center space-y-3">
              <p className="text-sm text-red-700">{directoryError}</p>
              <button
                type="button"
                onClick={loadDirectory}
                className="h-9 px-3.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Retry
              </button>
            </div>
          ) : filteredDirectory.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              {presenceFilter === 'online'
                ? 'No teammates are currently online.'
                : 'No contacts match your search.'}
            </div>
          ) : (
            filteredDirectory.map((peer) => {
              const isSelected = peer.id === selectedPeerId;
              const isTyping = Boolean(typingUsers[peer.id]);
              const lastMsgPreview = peer.lastMessage
                ? peer.lastMessage.content ||
                  (peer.lastMessage.attachment
                    ? `Attachment: ${peer.lastMessage.attachment.originalName}`
                    : '')
                : peer.isOnline
                  ? 'Online now'
                  : formatLastSeen(peer.lastSeen);

              return (
                <button
                  key={peer.id}
                  type="button"
                  onClick={() => handleSelectPeer(peer.id)}
                  className={`w-full px-4 py-3.5 flex items-start gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-700 ${
                    isSelected ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <Avatar
                    name={peer.name}
                    avatarUrl={peer.avatarUrl}
                    isOnline={peer.isOnline}
                    showPresenceDot
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {peer.name}
                      </span>
                      {peer.lastMessage && (
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {formatMessageTime(peer.lastMessage.createdAt)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className={`text-xs truncate ${
                          isTyping
                            ? 'text-teal-700 font-medium'
                            : peer.unreadCount > 0
                              ? 'text-slate-800 font-medium'
                              : 'text-slate-500'
                        }`}
                      >
                        {isTyping ? 'Typing...' : lastMsgPreview}
                      </p>
                      {peer.unreadCount > 0 && (
                        <span className="text-[11px] font-mono tabular-nums font-semibold text-teal-800 bg-teal-100 px-1.5 py-0.5 rounded shrink-0">
                          {peer.unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          peer.isOnline ? 'bg-emerald-600' : 'bg-slate-400'
                        }`}
                      />
                      <span className="truncate">
                        {peer.isOnline ? 'Online' : formatLastSeen(peer.lastSeen)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Conversation Viewport */}
      <main
        className={`${
          mobileShowChat ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col min-w-0 h-full bg-slate-50`}
      >
        {/* Real-time WebSocket Connection Error / Reconnect Banner */}
        {connectionState !== 'connected' && (
          <div
            role="status"
            className={`px-4 py-2.5 border-b flex items-center justify-between gap-3 text-xs sm:text-sm ${
              connectionState === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {connectionError ||
                  (connectionState === 'connecting'
                    ? 'Connecting to real-time messaging server...'
                    : 'Reconnecting to messaging server...')}
              </span>
            </div>
            {(connectionState === 'error' || connectionState === 'disconnected') && (
              <button
                type="button"
                onClick={manualReconnect}
                className="h-8 px-3 rounded-md bg-white border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reconnect</span>
              </button>
            )}
          </div>
        )}

        {!selectedPeer ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="h-12 w-12 rounded-xl bg-white border border-slate-200 text-slate-500 flex items-center justify-center mb-4">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              Select a teammate to start chatting
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-sm">
              Choose a conversation from the sidebar to send instant messages or share files.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header with Selected User Information */}
            <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileShowChat(false)}
                  aria-label="Back to contacts"
                  className="md:hidden h-11 w-11 -ml-2 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 shrink-0"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                <Avatar
                  name={selectedPeer.name}
                  avatarUrl={selectedPeer.avatarUrl}
                  isOnline={selectedPeer.isOnline}
                  showPresenceDot
                  size="md"
                />

                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-900 truncate">
                    {selectedPeer.name}
                  </h2>
                  <p className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                    {typingUsers[selectedPeer.id] ? (
                      <span className="text-teal-700 font-medium">Typing...</span>
                    ) : selectedPeer.isOnline ? (
                      <>
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-600 shrink-0" />
                        <span className="text-emerald-700 font-medium">Online</span>
                        <span aria-hidden="true">·</span>
                        <span>{selectedPeer.role}</span>
                      </>
                    ) : (
                      <>
                        <span className="inline-block h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                        <span>{formatLastSeen(selectedPeer.lastSeen)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{selectedPeer.role}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Live Socket Status Indicator */}
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                {connectionState === 'connected' ? (
                  <>
                    <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-slate-600 font-medium">Live</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                    <span className="text-amber-700 font-medium">Reconnecting</span>
                  </>
                )}
              </div>
            </header>

            {/* Message Display Area */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
              {isLoadingMessages ? (
                <div className="space-y-4">
                  <div className="h-12 w-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
                  <div className="h-12 w-72 bg-teal-700/15 rounded-xl ml-auto animate-pulse" />
                  <div className="h-16 w-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
                </div>
              ) : messagesError ? (
                <div className="py-12 text-center space-y-3">
                  <p className="text-sm text-red-700">{messagesError}</p>
                  <button
                    type="button"
                    onClick={() => loadConversation(selectedPeer.id)}
                    className="h-9 px-4 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Retry loading messages
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center px-4">
                  <Avatar
                    name={selectedPeer.name}
                    avatarUrl={selectedPeer.avatarUrl}
                    isOnline={selectedPeer.isOnline}
                    showPresenceDot
                    size="lg"
                  />
                  <h3 className="text-base font-semibold text-slate-900 mt-3">
                    Start a conversation with {selectedPeer.name}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1 max-w-sm">
                    Messages and shared files appear here in real time.
                  </p>
                </div>
              ) : (
                groupedMessages.map((group) => (
                  <div key={group.dayLabel} className="space-y-3">
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="text-[11px] font-medium text-slate-500 shrink-0">
                        {group.dayLabel}
                      </span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <div className="space-y-2.5">
                      {group.items.map((msg) => {
                        const isMine = msg.senderId === user.id;
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[85%] sm:max-w-[70%] lg:max-w-[60%] rounded-2xl px-4 py-2.5 ${
                                isMine
                                  ? 'bg-teal-700 text-white rounded-br-sm'
                                  : 'bg-white border border-slate-200 text-slate-900 rounded-bl-sm'
                              }`}
                            >
                              {msg.attachment && (
                                <div className="mb-2">
                                  {msg.attachment.isImage ? (
                                    <div className="space-y-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setLightboxImage(msg.attachment)}
                                        className="block rounded-lg overflow-hidden border border-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                                      >
                                        <img
                                          src={msg.attachment.url}
                                          alt={msg.attachment.originalName}
                                          referrerPolicy="no-referrer"
                                          className="max-h-64 w-auto object-contain bg-slate-100"
                                        />
                                      </button>
                                      <div className="flex items-center justify-between gap-3 text-xs">
                                        <span
                                          className={`truncate ${
                                            isMine ? 'text-teal-100' : 'text-slate-600'
                                          }`}
                                        >
                                          {msg.attachment.originalName}
                                        </span>
                                        <a
                                          href={msg.attachment.downloadUrl}
                                          download={msg.attachment.originalName}
                                          className={`inline-flex items-center gap-1 font-medium shrink-0 hover:underline ${
                                            isMine ? 'text-white' : 'text-teal-700'
                                          }`}
                                        >
                                          <Download className="h-3.5 w-3.5" />
                                          <span>Save</span>
                                        </a>
                                      </div>
                                    </div>
                                  ) : (
                                    <div
                                      className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border ${
                                        isMine
                                          ? 'bg-teal-800/60 border-teal-600/60 text-white'
                                          : 'bg-slate-50 border-slate-200 text-slate-900'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <FileText className="h-5 w-5 shrink-0 opacity-90" />
                                        <div className="min-w-0">
                                          <p className="text-xs font-semibold truncate">
                                            {msg.attachment.originalName}
                                          </p>
                                          <p
                                            className={`text-[11px] font-mono tabular-nums ${
                                              isMine ? 'text-teal-100' : 'text-slate-500'
                                            }`}
                                          >
                                            {formatFileSize(msg.attachment.size)}
                                          </p>
                                        </div>
                                      </div>
                                      <a
                                        href={msg.attachment.downloadUrl}
                                        download={msg.attachment.originalName}
                                        aria-label={`Download ${msg.attachment.originalName}`}
                                        className={`h-9 px-2.5 rounded-md flex items-center gap-1 text-xs font-semibold shrink-0 transition-colors ${
                                          isMine
                                            ? 'bg-white/15 hover:bg-white/25 text-white'
                                            : 'bg-white border border-slate-200 hover:bg-slate-100 text-slate-700'
                                        }`}
                                      >
                                        <Download className="h-3.5 w-3.5" />
                                        <span>Download</span>
                                      </a>
                                    </div>
                                  )}
                                </div>
                              )}

                              {msg.content && (
                                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                  {msg.content}
                                </p>
                              )}

                              <div
                                className={`mt-1 flex items-center justify-end gap-1.5 text-[11px] font-mono tabular-nums ${
                                  isMine ? 'text-teal-100/90' : 'text-slate-400'
                                }`}
                              >
                                <span>{formatMessageTime(msg.createdAt)}</span>
                                {isMine && (
                                  <span
                                    title={msg.readAt ? 'Read' : 'Delivered'}
                                    aria-label={msg.readAt ? 'Read' : 'Delivered'}
                                  >
                                    {msg.readAt ? (
                                      <CheckCheck className="h-3.5 w-3.5 text-white" />
                                    ) : (
                                      <Check className="h-3.5 w-3.5" />
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input & File Upload Footer */}
            <footer className="bg-white border-t border-slate-200 px-4 sm:px-6 py-3 shrink-0 space-y-2.5">
              {(uploadError || sendError) && (
                <div
                  role="alert"
                  className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                    <span className="truncate">{uploadError || sendError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadError(null);
                      setSendError(null);
                    }}
                    aria-label="Dismiss error"
                    className="p-1 text-red-600 hover:text-red-800 shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {uploadProgress !== null && (
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs text-slate-700 mb-1">
                      <span className="font-medium">Uploading attachment...</span>
                      <span className="font-mono tabular-nums">{uploadProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-700 transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelUpload}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {stagedAttachment && uploadProgress === null && (
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {stagedAttachment.isImage ? (
                      <img
                        src={stagedAttachment.url}
                        alt={stagedAttachment.originalName}
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 rounded object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                        <FileText className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {stagedAttachment.originalName}
                      </p>
                      <p className="text-[11px] font-mono tabular-nums text-slate-500">
                        {formatFileSize(stagedAttachment.size)} · Ready to send
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStagedAttachment(null)}
                    aria-label="Remove attachment"
                    className="h-8 w-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.txt,.csv,.xlsx,.zip"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadProgress !== null}
                  aria-label="Attach file"
                  title="Attach image or document (max 10 MB)"
                  className="h-11 w-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50"
                >
                  <Paperclip className="h-5 w-5" />
                </button>

                <textarea
                  rows={1}
                  value={draftText}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={`Message ${selectedPeer.name}...`}
                  aria-label={`Message ${selectedPeer.name}`}
                  className="flex-1 min-h-[44px] max-h-32 py-2.5 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:bg-white focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/15"
                />

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={
                    isSending ||
                    uploadProgress !== null ||
                    (!draftText.trim() && !stagedAttachment)
                  }
                  aria-label="Send message"
                  className="h-11 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold flex items-center gap-2 shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </div>
            </footer>
          </>
        )}
      </main>

      {/* Image Preview Lightbox Modal */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxImage.originalName}
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 flex flex-col items-center justify-center p-4 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl w-full flex flex-col items-center gap-3"
          >
            <div className="w-full flex items-center justify-between text-white">
              <span className="text-sm font-medium truncate">
                {lightboxImage.originalName}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={lightboxImage.downloadUrl}
                  download={lightboxImage.originalName}
                  className="h-9 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  aria-label="Close preview"
                  className="h-9 w-9 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.originalName}
              referrerPolicy="no-referrer"
              className="max-h-[80vh] w-auto rounded-lg object-contain bg-slate-900"
            />
          </div>
        </div>
      )}
    </div>
  );
}
