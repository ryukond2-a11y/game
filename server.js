// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');
const {
  createGame,
  playCard,
  markStuck,
  viewFor,
} = require('./gameEngine');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

// ---------- Auth helpers ----------

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ---------- Auth API ----------

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({
      error: 'invalid_input',
      message: 'ユーザー名は3文字以上、パスワードは6文字以上にしてください。',
    });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'username_taken', message: 'そのユーザー名は既に使われています。' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);
  const user = { id: info.lastInsertRowid, username };
  return res.json({ token: signToken(user), username: user.username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'bad_credentials', message: 'ユーザー名またはパスワードが違います。' });
  }
  return res.json({ token: signToken(user), username: user.username });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db
    .prepare('SELECT username, wins, losses FROM users WHERE id = ?')
    .get(req.user.uid);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json(user);
});

// ---------- In-memory room state ----------
// rooms: Map<roomCode, {
//   code, hostSocketId, players: [{socketId, uid, username}],
//   game: gameEngineState|null
// }>
const rooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicRoomInfo(room) {
  return {
    code: room.code,
    players: room.players.map((p) => p.username),
    started: !!room.game,
  };
}

function pidForSocket(room, socketId) {
  const idx = room.players.findIndex((p) => p.socketId === socketId);
  if (idx === -1) return null;
  return idx === 0 ? 'p1' : 'p2';
}

function sendGameState(room) {
  if (!room.game) return;
  for (const p of room.players) {
    const pid = pidForSocket(room, p.socketId);
    io.to(p.socketId).emit('game:state', viewFor(room.game, pid));
  }
}

function endRoomForDisconnect(room, leavingUid) {
  const leaver = room.players.find((p) => p.uid === leavingUid);
  const remaining = room.players.filter((p) => p.uid !== leavingUid);
  if (room.game && room.game.status === 'playing' && remaining.length > 0 && leaver) {
    room.game.status = 'over';
    const leaverPid = pidForSocket(room, leaver.socketId);
    room.game.winner = leaverPid ? (leaverPid === 'p1' ? 'p2' : 'p1') : 'draw';
    room.game.lastEvent = { type: 'opponent_left' };
    sendGameState(room);
  }
  room.players = remaining;
  if (room.players.length === 0) {
    rooms.delete(room.code);
  } else {
    io.to(room.code).emit('room:update', publicRoomInfo(room));
  }
}

// Grace period (ms) given to a socket that disconnects, e.g. because the
// browser is navigating from lobby.html to game.html. If it doesn't
// reconnect (room:rejoin) within this window, it's treated as a real leave.
const DISCONNECT_GRACE_MS = 8000;

// ---------- Socket auth ----------

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload; // { uid, username }
    next();
  } catch (e) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.currentRoom = null;

  socket.on('room:create', (_data, cb) => {
    const code = makeRoomCode();
    const room = {
      code,
      players: [{ socketId: socket.id, uid: socket.user.uid, username: socket.user.username }],
      game: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.currentRoom = code;
    cb && cb({ ok: true, room: publicRoomInfo(room), you: 'p1' });
  });

  socket.on('room:join', (data, cb) => {
    const code = (data && data.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, reason: 'not_found' });
    if (room.players.length >= 2) return cb && cb({ ok: false, reason: 'full' });
    if (room.players.some((p) => p.uid === socket.user.uid)) {
      return cb && cb({ ok: false, reason: 'already_in_room' });
    }
    room.players.push({ socketId: socket.id, uid: socket.user.uid, username: socket.user.username });
    socket.join(code);
    socket.currentRoom = code;
    io.to(code).emit('room:update', publicRoomInfo(room));
    cb && cb({ ok: true, room: publicRoomInfo(room), you: pidForSocket(room, socket.id) });
  });

  // Used when a client navigates from lobby.html to game.html (a full page
  // load creates a brand new socket). Re-associates the new socket with
  // the existing room membership by matching the authenticated user id.
  socket.on('room:rejoin', (data, cb) => {
    const code = (data && data.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, reason: 'not_found' });
    const player = room.players.find((p) => p.uid === socket.user.uid);
    if (!player) return cb && cb({ ok: false, reason: 'not_a_member' });
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.socketId = socket.id;
    socket.join(code);
    socket.currentRoom = code;
    cb && cb({ ok: true, room: publicRoomInfo(room), gameStarted: !!room.game, you: pidForSocket(room, socket.id) });
    if (room.game) {
      const pid = pidForSocket(room, socket.id);
      io.to(socket.id).emit('game:state', viewFor(room.game, pid));
    }
  });

  socket.on('game:start', (_data, cb) => {
    const room = rooms.get(socket.currentRoom);
    if (!room) return cb && cb({ ok: false, reason: 'no_room' });
    if (room.players.length !== 2) return cb && cb({ ok: false, reason: 'need_two_players' });
    if (room.players[0].socketId !== socket.id) {
      return cb && cb({ ok: false, reason: 'only_host_can_start' });
    }
    room.game = createGame();
    io.to(room.code).emit('game:started');
    sendGameState(room);
    cb && cb({ ok: true });
  });

  socket.on('game:play', (data, cb) => {
    const room = rooms.get(socket.currentRoom);
    if (!room || !room.game) return cb && cb({ ok: false, reason: 'no_game' });
    const pid = pidForSocket(room, socket.id);
    const result = playCard(room.game, pid, data && data.cardId, data && data.pileIndex);
    if (result.ok) {
      sendGameState(room);
      if (room.game.status === 'over') {
        recordResult(room);
      }
    }
    cb && cb(result);
  });

  socket.on('game:stuck', (_data, cb) => {
    const room = rooms.get(socket.currentRoom);
    if (!room || !room.game) return cb && cb({ ok: false, reason: 'no_game' });
    const pid = pidForSocket(room, socket.id);
    const result = markStuck(room.game, pid);
    sendGameState(room);
    if (room.game.status === 'over') {
      recordResult(room);
    }
    cb && cb(result);
  });

  socket.on('room:leave', () => {
    const room = rooms.get(socket.currentRoom);
    if (room) endRoomForDisconnect(room, socket.user.uid);
    socket.currentRoom = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.currentRoom);
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    player.disconnectTimer = setTimeout(() => {
      endRoomForDisconnect(room, player.uid);
    }, DISCONNECT_GRACE_MS);
  });
});

function recordResult(room) {
  const winnerPid = room.game.winner;
  if (winnerPid === 'draw' || !winnerPid) return;
  const winnerIdx = winnerPid === 'p1' ? 0 : 1;
  const loserIdx = winnerIdx === 0 ? 1 : 0;
  const winner = room.players[winnerIdx];
  const loser = room.players[loserIdx];
  try {
    if (winner) db.prepare('UPDATE users SET wins = wins + 1 WHERE id = ?').run(winner.uid);
    if (loser) db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').run(loser.uid);
  } catch (e) {
    console.error('recordResult failed', e);
  }
}

server.listen(PORT, () => {
  console.log(`Speed online server running on http://localhost:${PORT}`);
});
