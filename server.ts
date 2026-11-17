import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import type { AttachmentMeta } from './src/types.ts';
import {
  requireAuth,
  signAuthToken,
  verifyAuthToken,
  type AuthenticatedRequest,
} from './server/auth.ts';
import { chatStore } from './server/store.ts';

const PORT = Number(process.env.PORT) || 3000;
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.csv',
  '.xlsx',
  '.zip',
]);

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
]);

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = ALLOWED_MIME_TYPES.has(file.mimetype);
    const extOk = ALLOWED_EXTENSIONS.has(ext);
    if (!mimeOk || !extOk) {
      cb(
        new Error(
          'Unsupported file type. Allowed formats: PNG, JPG, GIF, WEBP, PDF, DOC, DOCX, TXT, CSV, XLSX, ZIP.',
        ),
      );
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: true, credentials: true },
    pingTimeout: 20_000,
    pingInterval: 10_000,
  });

  // Track active WebSocket connections per userId for accurate multi-tab presence
  const onlineSockets = new Map<string, Set<string>>();

  const getOnlineUserIds = (): Set<string> => {
    const active = new Set<string>();
    for (const [uid, sockets] of onlineSockets.entries()) {
      if (sockets.size > 0) active.add(uid);
    }
    return active;
  };

  app.use(express.json({ limit: '2mb' }));

  // Serve uploaded media inline for image previews
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Register a new user account
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, password, role } = req.body ?? {};
      if (typeof name !== 'string' || name.trim().length < 2) {
        res.status(400).json({ error: 'Name must be at least 2 characters.' });
        return;
      }
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        res.status(400).json({ error: 'Please provide a valid email address.' });
        return;
      }
      if (typeof password !== 'string' || password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters.' });
        return;
      }

      if (chatStore.findUserByEmail(email)) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = chatStore.createUser({
        name,
        email,
        passwordHash,
        role: typeof role === 'string' ? role : undefined,
      });

      const token = signAuthToken({ userId: user.id, email: user.email });
      const publicUser = chatStore.toPublicUser(user, getOnlineUserIds());

      // Broadcast newly registered user to existing connected clients
      io.emit('user:registered', publicUser);

      res.status(201).json({ token, user: publicUser });
    } catch {
      res.status(500).json({ error: 'Unable to complete registration. Please try again.' });
    }
  });

  // Authenticate existing user
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const user = chatStore.findUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const token = signAuthToken({ userId: user.id, email: user.email });
      const publicUser = chatStore.toPublicUser(user, getOnlineUserIds());
      res.json({ token, user: publicUser });
    } catch {
      res.status(500).json({ error: 'Unable to sign in. Please try again.' });
    }
  });

  // Protected: validate current JWT and return active profile
  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = chatStore.findUserById(req.user!.userId);
    if (!user) {
      res.status(401).json({ error: 'User account no longer exists.' });
      return;
    }
    res.json({ user: chatStore.toPublicUser(user, getOnlineUserIds()) });
  });

  // Protected: fetch directory of other users with online status & latest thread info
  app.get('/api/users', requireAuth, (req: AuthenticatedRequest, res) => {
    const currentUserId = req.user!.userId;
    const users = chatStore.getDirectoryForUser(currentUserId, getOnlineUserIds());
    res.json({ users });
  });

  // Protected: fetch message history with a specific peer and mark incoming messages read
  app.get('/api/messages/:peerId', requireAuth, (req: AuthenticatedRequest, res) => {
    const currentUserId = req.user!.userId;
    const peerId = String(req.params.peerId);
    const peer = chatStore.findUserById(peerId);
    if (!peer) {
      res.status(404).json({ error: 'Recipient not found.' });
      return;
    }

    const updatedIds = chatStore.markConversationRead(currentUserId, peerId);
    if (updatedIds.length > 0) {
      io.to(`user:${peerId}`).emit('messages:read_ack', {
        readerId: currentUserId,
        messageIds: updatedIds,
      });
    }

    const messages = chatStore.getConversation(currentUserId, peerId);
    res.json({ messages });
  });

  // Protected: upload a file attachment with validation
  app.post('/api/upload', requireAuth, (req: AuthenticatedRequest, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File exceeds the 10 MB maximum upload limit.' });
          return;
        }
        res.status(400).json({ error: err.message || 'File upload failed.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No file selected for upload.' });
        return;
      }

      const attachment: AttachmentMeta = {
        id: `att_${crypto.randomUUID().slice(0, 12)}`,
        originalName: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${encodeURIComponent(req.file.filename)}`,
        downloadUrl: `/api/files/${encodeURIComponent(req.file.filename)}?name=${encodeURIComponent(req.file.originalname)}`,
        isImage: IMAGE_MIME_TYPES.has(req.file.mimetype),
      };

      res.status(201).json({ attachment });
    });
  });

  // Force download with original filename safely
  app.get('/api/files/:storedName', (req, res) => {
    const safeStored = path.basename(String(req.params.storedName));
    const filePath = path.join(UPLOADS_DIR, safeStored);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    const requestedName =
      typeof req.query.name === 'string' && req.query.name.trim()
        ? path.basename(req.query.name.trim())
        : safeStored;
    res.download(filePath, requestedName);
  });

  // Socket.IO JWT authentication middleware
  io.use((socket, next) => {
    const token =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : '';
    if (!token) {
      next(new Error('Authentication token required for WebSocket connection.'));
      return;
    }

    try {
      const payload = verifyAuthToken(token);
      const user = chatStore.findUserById(payload.userId);
      if (!user) {
        next(new Error('Account not found.'));
        return;
      }
      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('Invalid or expired session token.'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.data.userId);
    socket.join(`user:${userId}`);

    let sockets = onlineSockets.get(userId);
    const wasOffline = !sockets || sockets.size === 0;
    if (!sockets) {
      sockets = new Set();
      onlineSockets.set(userId, sockets);
    }
    sockets.add(socket.id);

    const nowIso = new Date().toISOString();
    chatStore.updateLastSeen(userId, nowIso);

    // Send initial online user IDs snapshot to this socket
    socket.emit('presence:snapshot', {
      onlineUserIds: Array.from(getOnlineUserIds()),
    });

    if (wasOffline) {
      io.emit('presence:update', {
        userId,
        isOnline: true,
        lastSeen: nowIso,
      });
    }

    socket.on(
      'message:send',
      (
        payload: {
          recipientId?: string;
          content?: string;
          attachment?: AttachmentMeta | null;
        },
        ack?: (result: { ok: boolean; error?: string; message?: unknown }) => void,
      ) => {
        const recipientId = typeof payload?.recipientId === 'string' ? payload.recipientId : '';
        const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
        const attachment = payload?.attachment ?? null;

        if (!recipientId || !chatStore.findUserById(recipientId)) {
          ack?.({ ok: false, error: 'Recipient not found.' });
          return;
        }
        if (!content && !attachment) {
          ack?.({ ok: false, error: 'Cannot send an empty message.' });
          return;
        }

        const saved = chatStore.addMessage({
          senderId: userId,
          recipientId,
          content,
          attachment,
        });

        io.to(`user:${recipientId}`).to(`user:${userId}`).emit('message:new', saved);
        ack?.({ ok: true, message: saved });
      },
    );

    socket.on('messages:read', (payload: { peerId?: string }) => {
      const peerId = typeof payload?.peerId === 'string' ? payload.peerId : '';
      if (!peerId) return;
      const updatedIds = chatStore.markConversationRead(userId, peerId);
      if (updatedIds.length > 0) {
        io.to(`user:${peerId}`).emit('messages:read_ack', {
          readerId: userId,
          messageIds: updatedIds,
        });
      }
    });

    socket.on('typing:start', (payload: { recipientId?: string }) => {
      const recipientId = typeof payload?.recipientId === 'string' ? payload.recipientId : '';
      if (!recipientId) return;
      io.to(`user:${recipientId}`).emit('typing:update', {
        userId,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (payload: { recipientId?: string }) => {
      const recipientId = typeof payload?.recipientId === 'string' ? payload.recipientId : '';
      if (!recipientId) return;
      io.to(`user:${recipientId}`).emit('typing:update', {
        userId,
        isTyping: false,
      });
    });

    socket.on('disconnect', () => {
      const userSockets = onlineSockets.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineSockets.delete(userId);
          const lastSeen = new Date().toISOString();
          chatStore.updateLastSeen(userId, lastSeen);
          io.emit('presence:update', {
            userId,
            isOnline: false,
            lastSeen,
          });
        }
      }
    });
  });

  // Mount Vite in dev or serve production static bundle
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RelayChat server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
