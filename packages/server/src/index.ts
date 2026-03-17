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

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getOrCreateRoom(code: string): GameRoom {
  let room = rooms.get(code);
  if (!room) {
    room = new GameRoom(code);
    rooms.set(code, room);
    console.log(`Room ${code} created`);
  }
  return room;
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

    if (msg.type === 'join_room') {
      if (playerRoom) {
        playerRoom.removePlayer(playerId);
        playerRooms.delete(playerId);
      }

      const code = msg.roomCode || generateRoomCode();
      const room = getOrCreateRoom(code);
      room.addPlayer(playerId, msg.playerName || 'Player', ws);
      playerRoom = room;
      playerRooms.set(playerId, code);
      console.log(`Player ${playerId} joined room ${code} (${room.playerCount} players)`);
      return;
    }

    if (playerRoom) {
      playerRoom.handleMessage(playerId, msg);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${playerId} disconnected`);
    if (playerRoom) {
      playerRoom.removePlayer(playerId);
      if (playerRoom.isEmpty) {
        rooms.delete(playerRoom.code);
        console.log(`Room ${playerRoom.code} deleted (empty)`);
      }
      playerRooms.delete(playerId);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dyarchy server running on port ${PORT}`);
  if (hasStatic) console.log(`Serving static files from ${STATIC_DIR}`);
});
