import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AttachmentMeta, ChatMessage, DirectoryUser, PublicUser } from '../src/types.ts';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: string;
  passwordHash: string;
  avatarUrl: string | null;
  lastSeen: string;
  createdAt: string;
}

interface StoreData {
  users: StoredUser[];
  messages: ChatMessage[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'chat-store.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function buildSeedData(): StoreData {
  const now = Date.now();
  const isoAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const passwordHash = bcrypt.hashSync('password123', 10);

  const mayaId = 'usr_maya_lin';
  const marcusId = 'usr_marcus_cole';
  const elenaId = 'usr_elena_rostova';

  const users: StoredUser[] = [
    {
      id: mayaId,
      name: 'Maya Lin',
      email: 'maya@relaychat.dev',
      role: 'Product Designer',
      passwordHash,
      avatarUrl: '/src/assets/images/avatar_maya_lin_1794927879498.jpg',
      lastSeen: isoAgo(3),
      createdAt: isoAgo(60 * 24 * 14),
    },
    {
      id: marcusId,
      name: 'Marcus Cole',
      email: 'marcus@relaychat.dev',
      role: 'Platform Engineer',
      passwordHash,
      avatarUrl: '/src/assets/images/avatar_marcus_cole_1794927879084.jpg',
      lastSeen: isoAgo(12),
      createdAt: isoAgo(60 * 24 * 12),
    },
    {
      id: elenaId,
      name: 'Elena Rostova',
      email: 'elena@relaychat.dev',
      role: 'Engineering Lead',
      passwordHash,
      avatarUrl: '/src/assets/images/avatar_elena_rostova_1794927879809.jpg',
      lastSeen: isoAgo(48),
      createdAt: isoAgo(60 * 24 * 10),
    },
  ];

  const messages: ChatMessage[] = [
    {
      id: 'msg_seed_01',
      senderId: marcusId,
      recipientId: mayaId,
      content: 'Morning Maya! The WebSocket presence gateway is live on staging. Ready to verify the unread badge behavior?',
      attachment: null,
      createdAt: isoAgo(95),
      readAt: isoAgo(92),
    },
    {
      id: 'msg_seed_02',
      senderId: mayaId,
      recipientId: marcusId,
      content: 'Yes! I just checked the header typography and spacing across mobile and desktop breakpoints.',
      attachment: null,
      createdAt: isoAgo(90),
      readAt: isoAgo(88),
    },
    {
      id: 'msg_seed_03',
      senderId: marcusId,
      recipientId: mayaId,
      content: 'Nice. File uploads up to 10 MB now stream with progress tracking and strict MIME validation.',
      attachment: null,
      createdAt: isoAgo(42),
      readAt: isoAgo(40),
    },
    {
      id: 'msg_seed_04',
      senderId: elenaId,
      recipientId: mayaId,
      content: 'Hey Maya, could you share the updated spacing guidelines before the 2 PM review?',
      attachment: null,
      createdAt: isoAgo(28),
      readAt: null,
    },
  ];

  return { users, messages };
}

class ChatStore {
  private data: StoreData;

  constructor() {
    ensureDataDir();
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as StoreData;
        if (Array.isArray(parsed.users) && Array.isArray(parsed.messages)) {
          this.data = parsed;
          return;
        }
      } catch {
        // Fall through to seed on corrupted JSON
      }
    }
    this.data = buildSeedData();
    this.persist();
  }

  private persist(): void {
    ensureDataDir();
    const tmpPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, STORE_PATH);
  }

  toPublicUser(user: StoredUser, onlineUserIds: Set<string>): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      isOnline: onlineUserIds.has(user.id),
      lastSeen: user.lastSeen,
      createdAt: user.createdAt,
    };
  }

  findUserByEmail(email: string): StoredUser | undefined {
    const normalized = email.trim().toLowerCase();
    return this.data.users.find((u) => u.email.toLowerCase() === normalized);
  }

  findUserById(id: string): StoredUser | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  createUser(params: {
    name: string;
    email: string;
    passwordHash: string;
    role?: string;
  }): StoredUser {
    const now = new Date().toISOString();
    const user: StoredUser = {
      id: `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: params.name.trim(),
      email: params.email.trim().toLowerCase(),
      role: params.role?.trim() || 'Team Member',
      passwordHash: params.passwordHash,
      avatarUrl: null,
      lastSeen: now,
      createdAt: now,
    };
    this.data.users.push(user);
    this.persist();
    return user;
  }

  updateLastSeen(userId: string, timestamp: string): void {
    const user = this.findUserById(userId);
    if (!user) return;
    user.lastSeen = timestamp;
    this.persist();
  }

  getDirectoryForUser(
    currentUserId: string,
    onlineUserIds: Set<string>,
  ): DirectoryUser[] {
    return this.data.users
      .filter((u) => u.id !== currentUserId)
      .map((peer) => {
        const thread = this.data.messages.filter(
          (m) =>
            (m.senderId === currentUserId && m.recipientId === peer.id) ||
            (m.senderId === peer.id && m.recipientId === currentUserId),
        );
        const lastMessage = thread.length > 0 ? thread[thread.length - 1] : null;
        const unreadCount = thread.filter(
          (m) => m.senderId === peer.id && m.recipientId === currentUserId && !m.readAt,
        ).length;

        return {
          ...this.toPublicUser(peer, onlineUserIds),
          lastMessage,
          unreadCount,
        };
      })
      .sort((a, b) => {
        const timeA = a.lastMessage?.createdAt ?? a.createdAt;
        const timeB = b.lastMessage?.createdAt ?? b.createdAt;
        return timeB.localeCompare(timeA);
      });
  }

  getConversation(userA: string, userB: string): ChatMessage[] {
    return this.data.messages
      .filter(
        (m) =>
          (m.senderId === userA && m.recipientId === userB) ||
          (m.senderId === userB && m.recipientId === userA),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  markConversationRead(readerId: string, peerId: string): string[] {
    const now = new Date().toISOString();
    const updatedIds: string[] = [];
    for (const msg of this.data.messages) {
      if (msg.senderId === peerId && msg.recipientId === readerId && !msg.readAt) {
        msg.readAt = now;
        updatedIds.push(msg.id);
      }
    }
    if (updatedIds.length > 0) {
      this.persist();
    }
    return updatedIds;
  }

  addMessage(params: {
    senderId: string;
    recipientId: string;
    content: string;
    attachment: AttachmentMeta | null;
  }): ChatMessage {
    const message: ChatMessage = {
      id: `msg_${crypto.randomUUID()}`,
      senderId: params.senderId,
      recipientId: params.recipientId,
      content: params.content.trim(),
      attachment: params.attachment,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    this.data.messages.push(message);
    this.persist();
    return message;
  }
}

export const chatStore = new ChatStore();
