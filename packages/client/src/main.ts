import * as THREE from 'three';
import { TEAM_SPAWNS, PLAYER_HEIGHT, GROUND_Y } from '@dyarchy/shared';
import type { ServerMessage, SnapshotMsg, RoomStateMsg } from '@dyarchy/shared';
import { SceneManager } from './renderer/SceneManager.js';
import { FPSController } from './fps/FPSController.js';
import { RTSController } from './rts/RTSController.js';
import { Connection } from './network/Connection.js';
import { SnapshotRenderer } from './network/SnapshotRenderer.js';
import { SoundManager } from './audio/SoundManager.js';

// ===================== DOM Elements =====================

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const roleSelect = document.getElementById('role-select') as HTMLDivElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const gameOverScreen = document.getElementById('game-over') as HTMLDivElement;
const gameOverText = document.getElementById('game-over-text') as HTMLDivElement;
const mainMenu = document.getElementById('main-menu') as HTMLDivElement;
const lobbyScreen = document.getElementById('lobby') as HTMLDivElement;
const lobbyCode = document.getElementById('lobby-code') as HTMLDivElement;
const lobbyPlayers = document.getElementById('lobby-players') as HTMLDivElement;
const lobbyStatus = document.getElementById('lobby-status') as HTMLDivElement;
const connStatus = document.getElementById('connection-status') as HTMLDivElement;

// ===================== State =====================

let sceneManager: SceneManager;
let fpsController: FPSController;
let rtsController: RTSController;
let connection: Connection | null = null;
let snapshotRenderer: SnapshotRenderer | null = null;
let isOnline = false;
let localFPSEntityId: string | null = null;

type Role = 'fps' | 'rts' | null;
let activeRole: Role = null;

// ===================== Game Init =====================

function initOfflineGame(): void {
  if (rtsController) rtsController.destroy();
  if (fpsController) fpsController.destroy();

  sceneManager = new SceneManager(canvas);

  const spawn = TEAM_SPAWNS[1];
  const spawnVec = new THREE.Vector3(spawn.x, GROUND_Y + PLAYER_HEIGHT, spawn.z);

  fpsController = new FPSController(
    sceneManager.camera, canvas, spawnVec, sceneManager.obstacleBoxes, sceneManager,
  );

  rtsController = new RTSController(sceneManager, canvas);
  rtsController.onBuildingComplete = (buildingType: string) => {
    if (buildingType === 'armory') fpsController.unlockArmory();
  };

  gameOverScreen.style.display = 'none';
}

function initOnlineGame(): void {
  if (rtsController) rtsController.destroy();
  if (fpsController) fpsController.destroy();
  if (snapshotRenderer) snapshotRenderer.destroy();

  // For online: create a bare scene (no pre-placed entities — server owns those)
  sceneManager = new SceneManager(canvas, true); // skipEntities=true

  const spawn = TEAM_SPAWNS[1];
  const spawnVec = new THREE.Vector3(spawn.x, GROUND_Y + PLAYER_HEIGHT, spawn.z);

  fpsController = new FPSController(
    sceneManager.camera, canvas, spawnVec, sceneManager.obstacleBoxes, sceneManager,
  );

  // Online mode: server owns the FPS entity, remove local mesh + entity entirely
  fpsController.isOnline = true;
  if (fpsController.playerEntity) {
    sceneManager.removeEntity(fpsController.playerEntity.id);
    fpsController.playerEntity = null;
  }

  // Send FPS inputs to server
  let inputSeq = 0;
  fpsController.onInput = (keys, yaw, pitch, dt) => {
    connection?.send({
      type: 'fps_input',
      seq: inputSeq++,
      keys, yaw, pitch, dt,
    });
  };

  // Send hits to server
  fpsController.onHit = (targetId, damage) => {
    connection?.send({ type: 'fps_hit', targetId, damage });
  };

  rtsController = new RTSController(sceneManager, canvas);
  rtsController.onBuildingComplete = (buildingType: string) => {
    if (buildingType === 'armory') fpsController.unlockArmory();
  };

  // Wire up online RTS commands
  rtsController.onServerCommand = (cmd) => {
    connection?.send({ type: 'rts_command', ...cmd } as any);
  };
  rtsController.onServerTrain = (baseId) => {
    connection?.send({ type: 'rts_train', baseId, unitType: 'grunt' });
  };
  rtsController.onServerCancelTrain = (baseId, index) => {
    connection?.send({ type: 'rts_cancel_train', baseId, index });
  };
  rtsController.onServerBuild = (buildingType, position, builderGruntId) => {
    connection?.send({
      type: 'rts_command',
      command: 'place_building',
      unitIds: builderGruntId ? [builderGruntId] : [],
      targetPos: position,
      buildingType,
    } as any);
  };

  snapshotRenderer = new SnapshotRenderer(sceneManager);
  snapshotRenderer.onBuildingComplete = (entityType, teamId) => {
    // Only care about our team's buildings
    if (teamId === 1 && entityType === 'armory') {
      fpsController.unlockArmory();
    }
  };

  gameOverScreen.style.display = 'none';
}

// ===================== Role Management =====================

function setRole(role: Role): void {
  if (activeRole === 'fps') fpsController.disable();
  if (activeRole === 'rts') rtsController.disable();

  activeRole = role;

  if (role === null) {
    if (!isOnline) {
      roleSelect.style.display = 'flex';
    }
    overlay.style.display = 'none';
    crosshair.style.display = 'none';
    return;
  }

  roleSelect.style.display = 'none';

  if (role === 'fps') {
    fpsController.enable();
    overlay.style.display = 'flex';
    crosshair.style.display = 'block';
  } else {
    overlay.style.display = 'none';
    crosshair.style.display = 'none';
    rtsController.enable();
  }
}

// ===================== Offline Mode =====================

function startOffline(): void {
  isOnline = false;
  mainMenu.style.display = 'none';
  initOfflineGame();
  setRole(null);
}

// ===================== Online Mode =====================

async function connectToServer(): Promise<Connection> {
  const conn = new Connection();
  // In production, WS runs on the same host/port. In dev, use :3001
  const isDev = window.location.port === '3000';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = isDev
    ? `ws://${window.location.hostname}:3001`
    : `${protocol}//${window.location.host}`;
  await conn.connect(wsUrl);
  return conn;
}

async function hostGame(): Promise<void> {
  connStatus.textContent = 'Connecting...';
  try {
    connection = await connectToServer();
    isOnline = true;
    connection.send({ type: 'join_room', roomCode: '', playerName: 'Player' });
    connection.onMessage(handleServerMessage);
    mainMenu.style.display = 'none';
    lobbyScreen.style.display = 'flex';
    lobbyStatus.textContent = 'Waiting for players...';
  } catch {
    connStatus.textContent = 'Failed to connect to server';
  }
}

async function joinGame(code: string): Promise<void> {
  if (!code) { connStatus.textContent = 'Enter a room code'; return; }
  connStatus.textContent = 'Connecting...';
  try {
    connection = await connectToServer();
    isOnline = true;
    connection.send({ type: 'join_room', roomCode: code.toUpperCase(), playerName: 'Player' });
    connection.onMessage(handleServerMessage);
    mainMenu.style.display = 'none';
    lobbyScreen.style.display = 'flex';
    lobbyStatus.textContent = 'Joining...';
  } catch {
    connStatus.textContent = 'Failed to connect to server';
  }
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'room_state':
      handleRoomState(msg);
      break;

    case 'game_start':
      lobbyScreen.style.display = 'none';
      initOnlineGame();
      localFPSEntityId = msg.fpsEntityId;
      if (snapshotRenderer && msg.fpsEntityId) {
        snapshotRenderer.localFPSEntityId = msg.fpsEntityId;
      }
      setRole(msg.yourRole);
      break;

    case 'snapshot':
      if (snapshotRenderer) {
        snapshotRenderer.applySnapshot(msg);

        if (rtsController) {
          rtsController.setFromSnapshot(msg);
        }

        // Sync FPS player state from server
        if (fpsController && localFPSEntityId) {
          const fpsEntity = msg.entities.find(e => e.id === localFPSEntityId);
          if (fpsEntity) {
            fpsController.syncFromServer(fpsEntity.hp, fpsEntity.maxHp, fpsEntity.position);
          }
        }
      }
      break;

    case 'game_over': {
      const teamName = msg.winnerTeam === 1 ? 'Blue Team' : 'Red Team';
      gameOverText.textContent = `${teamName} Wins!`;
      gameOverScreen.style.display = 'flex';
      if (activeRole === 'fps') fpsController.disable();
      if (activeRole === 'rts') rtsController.disable();
      activeRole = null;
      crosshair.style.display = 'none';
      overlay.style.display = 'none';
      // Play win/lose sound (team 1 = local player's team)
      if (msg.winnerTeam === 1) SoundManager.instance().victory();
      else SoundManager.instance().gameOver();
      break;
    }

    case 'error':
      lobbyStatus.textContent = msg.message;
      break;
  }
}

function handleRoomState(msg: RoomStateMsg): void {
  lobbyCode.textContent = `Room: ${msg.roomCode}`;
  lobbyPlayers.innerHTML = msg.players.map(p => {
    const team = p.team ? `Team ${p.team}` : 'No team';
    const role = p.role ?? 'No role';
    const ready = p.ready ? ' [Ready]' : '';
    return `<div>${p.name} — ${team} / ${role}${ready}</div>`;
  }).join('');
}

// ===================== Menu Buttons =====================

document.getElementById('btn-offline')!.addEventListener('click', () => startOffline());
document.getElementById('btn-host')!.addEventListener('click', () => hostGame());
document.getElementById('btn-join')!.addEventListener('click', () => {
  const code = (document.getElementById('room-code') as HTMLInputElement).value;
  joinGame(code);
});

document.getElementById('btn-role-fps')!.addEventListener('click', () => {
  connection?.send({ type: 'select_role', team: 1, role: 'fps' });
});
document.getElementById('btn-role-rts')!.addEventListener('click', () => {
  connection?.send({ type: 'select_role', team: 1, role: 'rts' });
});
document.getElementById('btn-ready')!.addEventListener('click', () => {
  connection?.send({ type: 'ready' });
  lobbyStatus.textContent = 'Ready! Waiting for others...';
});

document.getElementById('btn-fps')!.addEventListener('click', () => setRole('fps'));
document.getElementById('btn-rts')!.addEventListener('click', () => setRole('rts'));

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && activeRole !== null && !rtsController?.gameOver) {
    e.preventDefault();
    setRole(activeRole === 'fps' ? 'rts' : 'fps');
  }
  if (e.code === 'KeyM') {
    const sm = SoundManager.instance();
    sm.toggleMute();
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = sm.muted ? 'Sound: OFF [M]' : 'Sound: ON [M]';
  }
});

// Mute button
document.getElementById('btn-mute')!.addEventListener('click', () => {
  const sm = SoundManager.instance();
  sm.toggleMute();
  document.getElementById('btn-mute')!.textContent = sm.muted ? 'Sound: OFF [M]' : 'Sound: ON [M]';
});

overlay.addEventListener('click', () => canvas.requestPointerLock());

document.getElementById('btn-play-again')!.addEventListener('click', () => {
  if (isOnline) {
    gameOverScreen.style.display = 'none';
    lobbyScreen.style.display = 'flex';
  } else {
    initOfflineGame();
    setRole(null);
  }
});

// ===================== Game Loop =====================

let lastTime = performance.now();

function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (rtsController) {
    if (!isOnline) {
      // Offline: run local simulation
      rtsController.isFPSMode = activeRole === 'fps';
      rtsController.activeCamera = activeRole === 'fps' ? sceneManager.camera : rtsController.getCamera();
      rtsController.fpsPlayerEntityId = fpsController?.playerEntity?.id ?? null;
      rtsController.tick(dt);

      if (rtsController.gameOver && gameOverScreen.style.display === 'none') {
        const winner = rtsController.gameOver.winner;
        gameOverText.textContent = `${winner === 1 ? 'Blue' : 'Red'} Team Wins!`;
        gameOverScreen.style.display = 'flex';
        if (activeRole === 'fps') fpsController.disable();
        if (activeRole === 'rts') rtsController.disable();
        activeRole = null;
        crosshair.style.display = 'none';
        overlay.style.display = 'none';
        if (winner === 1) SoundManager.instance().victory();
        else SoundManager.instance().gameOver();
      }
    } else {
      // Online: interpolate entities + tick visuals
      rtsController.isFPSMode = activeRole === 'fps';
      rtsController.activeCamera = activeRole === 'fps' ? sceneManager.camera : rtsController.getCamera();
      rtsController.fpsPlayerEntityId = snapshotRenderer?.localFPSEntityId ?? null;
      rtsController.tickVisuals(dt);

      if (snapshotRenderer) {
        snapshotRenderer.isFPSMode = activeRole === 'fps';
        snapshotRenderer.update(dt);
      }
    }
  }

  // Update spatial audio listener position
  if (activeRole === 'fps') {
    const p = fpsController.getPosition();
    SoundManager.instance().setListenerPosition(p.x, p.y, p.z, true);
  } else if (activeRole === 'rts') {
    const vc = rtsController.getViewCenter();
    SoundManager.instance().setListenerPosition(vc.x, 0, vc.z, false);
  }

  if (activeRole === 'fps') {
    fpsController.update(dt);
    sceneManager.renderWith(sceneManager.camera);
    fpsController.renderWeaponView(sceneManager.renderer);
    overlay.style.display = fpsController.isPointerLocked() ? 'none' : 'flex';
  } else if (activeRole === 'rts') {
    rtsController.updateCamera(dt);
    sceneManager.renderWith(rtsController.getCamera());
  } else if (rtsController?.gameOver) {
    sceneManager.renderWith(rtsController.getCamera());
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
