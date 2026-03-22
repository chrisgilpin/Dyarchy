import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './GameRoom.js';
import type { ClientMessage } from '@dyarchy/shared';

const PORT = parseInt(process.env.PORT || '3001', 10);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Static file serving — look for the built client in ../public
const STATIC_DIR = join(__dirname, '..', 'public');
const hasStatic = existsSync(STATIC_DIR);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const rooms = new Map<string, GameRoom>();
const playerRooms = new Map<string, string>();
const lobbySubscribers = new Set<WebSocket>();

function generateRoomCode(): string {
  let code: string;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createRoom(code: string, roomName?: string, visibility?: 'public' | 'private'): GameRoom {
  const room = new GameRoom(code, roomName, visibility);
  room.onStatusChange = () => scheduleLobbyBroadcast();
  rooms.set(code, room);
  console.log(`Room ${code} created (${visibility ?? 'public'}, "${roomName ?? code}")`);
  return room;
}

// ===================== Lobby Broadcasting =====================

let lobbyBroadcastScheduled = false;

function scheduleLobbyBroadcast(): void {
  if (lobbyBroadcastScheduled) return;
  lobbyBroadcastScheduled = true;
  queueMicrotask(() => {
    lobbyBroadcastScheduled = false;
    broadcastLobbyList();
  });
}

function broadcastLobbyList(): void {
  if (lobbySubscribers.size === 0) return;
  const lobbyRooms = [...rooms.values()]
    .filter(r => r.visibility === 'public' && r.playerCount > 0)
    .map(r => r.toLobbyInfo());
  const msg = JSON.stringify({ type: 'lobby_list', rooms: lobbyRooms });
  for (const ws of lobbySubscribers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function sendLobbyListTo(ws: WebSocket): void {
  const lobbyRooms = [...rooms.values()]
    .filter(r => r.visibility === 'public' && r.playerCount > 0)
    .map(r => r.toLobbyInfo());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'lobby_list', rooms: lobbyRooms }));
  }
}

// HTTP server — serves static files + health check
const server = createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: rooms.size, players: playerRooms.size }));
    return;
  }

  // Serve static files if available
  if (hasStatic) {
    let filePath = join(STATIC_DIR, url === '/' ? 'index.html' : url);

    // If path is a directory or doesn't exist, try index.html (SPA fallback)
    if (!existsSync(filePath) || (existsSync(filePath) && statSync(filePath).isDirectory())) {
      filePath = join(STATIC_DIR, 'index.html');
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      try {
        const data = readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
        return;
      } catch {
        // fall through to 404
      }
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  const playerId = uuid();
  let playerRoom: GameRoom | null = null;

  console.log(`Player ${playerId} connected`);

  ws.on('message', (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Lobby browsing (no room required)
    if (msg.type === 'subscribe_lobby') {
      lobbySubscribers.add(ws);
      sendLobbyListTo(ws);
      return;
    }
    if (msg.type === 'unsubscribe_lobby') {
      lobbySubscribers.delete(ws);
      return;
    }

    // Create a new room with options
    if (msg.type === 'create_room') {
      if (playerRoom) {
        playerRoom.removePlayer(playerId);
        if (playerRoom.isEmpty) { rooms.delete(playerRoom.code); }
        playerRooms.delete(playerId);
      }

      // Validate custom code if provided
      let code: string;
      if (msg.customCode) {
        const cleaned = msg.customCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (cleaned.length < 4 || cleaned.length > 8) {
          ws.send(JSON.stringify({ type: 'join_error', reason: 'Room code must be 4-8 alphanumeric characters' }));
          return;
        }
        if (rooms.has(cleaned)) {
          ws.send(JSON.stringify({ type: 'join_error', reason: 'Room code already in use' }));
          return;
        }
        code = cleaned;
      } else {
        code = generateRoomCode();
      }

      const room = createRoom(code, msg.roomName || undefined, msg.visibility);
      lobbySubscribers.delete(ws);
      room.addPlayer(playerId, msg.playerName || 'Player', ws);
      playerRoom = room;
      playerRooms.set(playerId, code);
      console.log(`Player ${playerId} created room ${code} (${room.playerCount} players)`);
      scheduleLobbyBroadcast();
      return;
    }

    // Join existing room by code
    if (msg.type === 'join_room') {
      if (playerRoom) {
        playerRoom.removePlayer(playerId);
        if (playerRoom.isEmpty) { rooms.delete(playerRoom.code); }
        playerRooms.delete(playerId);
      }

      // Empty code = legacy host flow (create public room with default name)
      if (!msg.roomCode) {
        const code = generateRoomCode();
        const room = createRoom(code);
        lobbySubscribers.delete(ws);
        room.addPlayer(playerId, msg.playerName || 'Player', ws);
        playerRoom = room;
        playerRooms.set(playerId, code);
        scheduleLobbyBroadcast();
        return;
      }

      const room = rooms.get(msg.roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: 'join_error', reason: 'Room not found' }));
        return;
      }
      if (room.isFull) {
        ws.send(JSON.stringify({ type: 'join_error', reason: 'Room is full' }));
        return;
      }

      lobbySubscribers.delete(ws);
      room.addPlayer(playerId, msg.playerName || 'Player', ws);
      playerRoom = room;
      playerRooms.set(playerId, msg.roomCode);
      console.log(`Player ${playerId} joined room ${msg.roomCode} (${room.playerCount} players)`);
      scheduleLobbyBroadcast();
      return;
    }

    if (playerRoom) {
      playerRoom.handleMessage(playerId, msg);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${playerId} disconnected`);
    lobbySubscribers.delete(ws);
    if (playerRoom) {
      playerRoom.removePlayer(playerId);
      if (playerRoom.isEmpty) {
        rooms.delete(playerRoom.code);
        console.log(`Room ${playerRoom.code} deleted (empty)`);
      }
      playerRooms.delete(playerId);
      scheduleLobbyBroadcast();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dyarchy server running on port ${PORT}`);
  if (hasStatic) console.log(`Serving static files from ${STATIC_DIR}`);
});
