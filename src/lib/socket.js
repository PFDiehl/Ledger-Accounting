// Real-time collaboration via Socket.io
// Per-org rooms with presence indicators and live data push

import { Server } from 'socket.io';
import jwt        from 'jsonwebtoken';
import prisma     from '../lib/prisma.js';
import { redis }  from '../lib/cache.js';

// ── Track online users in Redis ───────────────────────────────────────────────
// Key: presence:{orgId}  →  Hash of userId → { name, page, joinedAt }

const PRESENCE_TTL = 30; // seconds; clients ping every 15s

async function setPresence(orgId, userId, data) {
  const key = `presence:${orgId}`;
  await redis.hset(key, userId, JSON.stringify({ ...data, updatedAt: Date.now() }));
  await redis.expire(key, PRESENCE_TTL * 10); // keep key alive
}

async function removePresence(orgId, userId) {
  await redis.hdel(`presence:${orgId}`, userId);
}

async function getPresence(orgId) {
  const raw  = await redis.hgetall(`presence:${orgId}`) ?? {};
  const cutoff = Date.now() - PRESENCE_TTL * 1000;
  return Object.entries(raw)
    .map(([uid, json]) => ({ userId: uid, ...JSON.parse(json) }))
    .filter(u => u.updatedAt > cutoff);
}

// ── Socket.io server setup ────────────────────────────────────────────────────

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin:      process.env.FRONTEND_URL ?? 'http://localhost:5173',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout:  5_000,
  });

  // ── Auth middleware ────────────────────────────────────────────────────────

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token ?? socket.handshake.headers.authorization?.replace('Bearer ','');
    const orgId = socket.handshake.auth.orgId;

    if (!token || !orgId) return next(new Error('Missing credentials'));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const member  = await prisma.orgMember.findFirst({
        where:   { orgId, userId: payload.userId },
        include: { user: { select: { id:true, fullName:true, email:true } } },
      });
      if (!member) return next(new Error('Not a member of this org'));

      socket.userId = payload.userId;
      socket.orgId  = orgId;
      socket.user   = member.user;
      socket.role   = member.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────

  io.on('connection', async (socket) => {
    const { orgId, userId, user } = socket;
    const room = `org:${orgId}`;

    // Join the org room
    socket.join(room);

    // Set presence
    await setPresence(orgId, userId, {
      name:  user.fullName,
      email: user.email,
      page:  socket.handshake.auth.page ?? 'unknown',
    });

    // Broadcast updated presence to org room
    const presence = await getPresence(orgId);
    io.to(room).emit('presence:updated', presence);

    console.log(`[ws] ${user.fullName} connected to org ${orgId} (${socket.id})`);

    // ── Client events ──────────────────────────────────────────────────────

    // Heartbeat — client pings every 15s to keep presence alive
    socket.on('presence:ping', async (data) => {
      await setPresence(orgId, userId, {
        name:  user.fullName,
        email: user.email,
        page:  data?.page ?? 'unknown',
      });
      const p = await getPresence(orgId);
      io.to(room).emit('presence:updated', p);
    });

    // User navigated to a new page
    socket.on('presence:page', async ({ page }) => {
      await setPresence(orgId, userId, { name: user.fullName, email: user.email, page });
      const p = await getPresence(orgId);
      io.to(room).emit('presence:updated', p);
    });

    // User is viewing/editing a specific entity (invoice, journal entry, etc.)
    socket.on('entity:focus', ({ entityType, entityId }) => {
      socket.to(room).emit('entity:focus', { userId, userName: user.fullName, entityType, entityId });
    });

    socket.on('entity:blur', ({ entityType, entityId }) => {
      socket.to(room).emit('entity:blur', { userId, entityType, entityId });
    });

    // Typing indicator on invoice notes / journal description
    socket.on('typing:start', ({ entityType, entityId, field }) => {
      socket.to(room).emit('typing:start', { userId, userName: user.fullName, entityType, entityId, field });
    });

    socket.on('typing:stop', ({ entityType, entityId, field }) => {
      socket.to(room).emit('typing:stop', { userId, entityType, entityId, field });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────

    socket.on('disconnect', async () => {
      await removePresence(orgId, userId);
      const p = await getPresence(orgId);
      io.to(room).emit('presence:updated', p);
      console.log(`[ws] ${user.fullName} disconnected from org ${orgId}`);
    });
  });

  return io;
}

// ── Push helpers — called from routes to broadcast updates ────────────────────

let _io = null;
export function setIO(io) { _io = io; }
export function getIO()   { return _io; }

export function broadcastToOrg(orgId, event, data) {
  if (!_io) return;
  _io.to(`org:${orgId}`).emit(event, data);
}

// Broadcast a data update — clients can invalidate their cache / refetch
export function broadcastDataUpdate(orgId, resource, data = {}) {
  broadcastToOrg(orgId, 'data:updated', { resource, ...data, ts: Date.now() });
}
