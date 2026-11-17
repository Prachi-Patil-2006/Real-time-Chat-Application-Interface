export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeen: string;
  createdAt: string;
}

export interface AttachmentMeta {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  url: string;
  downloadUrl: string;
  isImage: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  attachment: AttachmentMeta | null;
  createdAt: string;
  readAt: string | null;
}

export interface DirectoryUser extends PublicUser {
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export type SocketConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';
