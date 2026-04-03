import * as THREE from 'three';
import { PLAYER_HEIGHT, GROUND_Y, getMapConfig, MEADOW_MAP } from '@dyarchy/shared';
import type { ServerMessage, SnapshotMsg, RoomStateMsg, MapId } from '@dyarchy/shared';
import type { MapConfig } from '@dyarchy/shared';
import { SceneManager } from './renderer/SceneManager.js';
import { FPSController } from './fps/FPSController.js';
import { RTSController } from './rts/RTSController.js';
import { Connection } from './network/Connection.js';
import { SnapshotRenderer } from './network/SnapshotRenderer.js';
import { SoundManager } from './audio/SoundManager.js';
import { isMobile } from './fps/TouchControls.js';
import { VRManager, saveButtonMap } from './vr/VRManager.js';
import type { GamepadButtonMap } from './vr/VRManager.js';
import { createWeaponModel } from './fps/Weapons.js';

// ===================== DOM Elements =====================

const canvas = document.getElementById('game') as HTMLCanvasElement;

// ===================== Shared Renderer & VR =====================
// A single persistent WebGLRenderer used by all SceneManagers.
// Required for WebXR — setAnimationLoop must stay on one renderer.
const sharedRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
sharedRenderer.setSize(window.innerWidth, window.innerHeight);
sharedRenderer.setPixelRatio(window.devicePixelRatio);

const vrManager = new VRManager(sharedRenderer);
const vrButton = vrManager.createButton();
document.body.appendChild(vrButton);

// Track VR weapon model separately (cloned from FPSController's current weapon)
let vrWeaponId: string | null = null;

// When VR session starts/ends, toggle VR mode on the FPS controller
sharedRenderer.xr.addEventListener('sessionstart', () => {
  if (fpsController) {
    fpsController.vrMode = true;
    fpsController.vrCameraRig = vrManager.cameraRig;
  }
  // If in RTS, switch to FPS for VR
  if (activeRole === 'rts' && fpsController) {
    setRole('fps');
  }
  // Hide touch controls in VR — input comes from gamepad
  document.getElementById('touch-controls')?.style.setProperty('display', 'none');
});
sharedRenderer.xr.addEventListener('sessionend', () => {
  if (fpsController) {
    fpsController.vrMode = false;
    fpsController.vrGamepadInput = null;
  }
  vrWeaponId = null;
  vrManager.setWeaponModel(null);
  // Reset rig to origin so non-VR camera positioning works normally
  vrManager.cameraRig.position.set(0, 0, 0);
  vrManager.cameraRig.rotation.set(0, 0, 0);
  // Restore touch controls if on mobile and in FPS mode
  if (isMobile() && activeRole === 'fps') {
    document.getElementById('touch-controls')?.style.setProperty('display', 'block');
  }
});

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
const nameInput = document.getElementById('player-name') as HTMLInputElement;
const lobbyNameInput = document.getElementById('lobby-name') as HTMLInputElement;
const browseLobby = document.getElementById('browse-lobby') as HTMLDivElement;
const lobbyRoomList = document.getElementById('lobby-room-list') as HTMLDivElement;
const lobbyEmpty = document.getElementById('lobby-empty') as HTMLDivElement;
const roomNameInput = document.getElementById('room-name') as HTMLInputElement;
const visPublicBtn = document.getElementById('vis-public') as HTMLButtonElement;
const visPrivateBtn = document.getElementById('vis-private') as HTMLButtonElement;

// Auto-generate a suggested player name
const NAME_ADJ = ['Swift', 'Bold', 'Brave', 'Fierce', 'Keen', 'Lucky', 'Mighty', 'Noble', 'Silent', 'Wild', 'Sharp', 'Iron', 'Storm', 'Dark'];
const NAME_NOUN = ['Wolf', 'Hawk', 'Bear', 'Fox', 'Eagle', 'Lion', 'Tiger', 'Raven', 'Falcon', 'Viper', 'Cobra', 'Phoenix', 'Dragon', 'Panther'];
function generateName(): string {
  return NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)] + NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)];
}
nameInput.value = generateName();

// ===================== State =====================

let sceneManager: SceneManager;
let fpsController: FPSController;
let rtsController: RTSController;
let connection: Connection | null = null;
let snapshotRenderer: SnapshotRenderer | null = null;
let localFPSEntityId: string | null = null;
let isOnline = false;

type Role = 'fps' | 'rts' | null;
let activeRole: Role = null;
let playerCount = 1; // track how many humans are in the game
let teamPlayerCount = 1; // how many humans on our team
let lastFighterLevel = 0;
let latestPlayerStats: import('@dyarchy/shared').PlayerGameStats[] = [];

// ===================== Scoreboard Overlay =====================

const scoreboardEl = document.createElement('div');
scoreboardEl.id = 'scoreboard-overlay';
scoreboardEl.style.cssText = `
  position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.75); z-index: 40; font-family: system-ui, sans-serif;
`;
document.body.appendChild(scoreboardEl);

function updateScoreboard(): void {
  if (latestPlayerStats.length === 0) {
    scoreboardEl.innerHTML = '<div style="color:#aaa; font-size:18px;">No stats available yet</div>';
    return;
  }

  const rows = latestPlayerStats
    .slice()
    .sort((a, b) => b.playerKills - a.playerKills || (b.playerKills / Math.max(1, b.deaths)) - (a.playerKills / Math.max(1, a.deaths)));

  const header = `<tr style="background:rgba(255,255,255,0.1);">
    <th style="padding:6px 12px; text-align:left;">Player</th>
    <th style="padding:6px 12px;">Kills</th>
    <th style="padding:6px 12px;">Deaths</th>
    <th style="padding:6px 12px;">K/D</th>
    <th style="padding:6px 12px;">CPU Kills</th>
    <th style="padding:6px 12px;">Bldgs Destroyed</th>
    <th style="padding:6px 12px;">Crystals</th>
    <th style="padding:6px 12px;">Bldgs Built</th>
    <th style="padding:6px 12px;">Upgrades</th>
  </tr>`;

  const body = rows.map(s => {
    const kd = s.deaths === 0 ? s.playerKills.toFixed(1) : (s.playerKills / s.deaths).toFixed(1);
    return `<tr style="border-top:1px solid #333;">
      <td style="padding:6px 12px; text-align:left; color:#fff; font-weight:bold;">${escapeHtml(s.playerName)}</td>
      <td style="padding:6px 12px; text-align:center;">${s.playerKills}</td>
      <td style="padding:6px 12px; text-align:center;">${s.deaths}</td>
      <td style="padding:6px 12px; text-align:center;">${kd}</td>
      <td style="padding:6px 12px; text-align:center;">${s.cpuUnitsKilled}</td>
      <td style="padding:6px 12px; text-align:center;">${s.buildingsDestroyed}</td>
      <td style="padding:6px 12px; text-align:center; color:#f0c040;">${s.crystalsCollected}</td>
      <td style="padding:6px 12px; text-align:center;">${s.buildingsBuilt}</td>
      <td style="padding:6px 12px; text-align:center;">${s.upgradeCount}</td>
    </tr>`;
  }).join('');

  scoreboardEl.innerHTML = `
    <div style="background:rgba(0,0,0,0.85); border:1px solid #555; border-radius:8px; padding:16px 8px; max-width:90vw; overflow-x:auto;">
      <div style="text-align:center; color:#ccc; font-size:14px; margin-bottom:10px; font-weight:bold; letter-spacing:1px;">SCOREBOARD</div>
      <table style="border-collapse:collapse; color:#ccc; font-size:14px; width:100%;">
        ${header}${body}
      </table>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let scoreboardVisible = false;
document.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote' && activeRole && !scoreboardVisible) {
    scoreboardVisible = true;
    updateScoreboard();
    scoreboardEl.style.display = 'flex';
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Backquote' && scoreboardVisible) {
    scoreboardVisible = false;
    scoreboardEl.style.display = 'none';
  }
});

/** Show a dramatic full-screen hero upgrade announcement (blue themed) */
function showHeroUpgradeAnnouncement(upgradeType: string, level: number): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; z-index: 50;
    pointer-events: none; animation: fighterLevelFade 3s ease-out forwards;
  `;

  const titles: Record<string, string> = {
    hero_hp: 'HERO HP UPGRADED',
    hero_damage: 'HERO DAMAGE UPGRADED',
    hero_regen: 'AUTO-REGEN UNLOCKED',
  };
  const title = document.createElement('div');
  title.textContent = titles[upgradeType] ?? 'HERO UPGRADED';
  title.style.cssText = `
    color: #4488ff; font-size: 52px; font-weight: 900; font-family: system-ui, sans-serif;
    text-shadow: 0 0 30px rgba(50,100,255,0.8), 0 0 60px rgba(50,100,255,0.4), 0 4px 8px rgba(0,0,0,0.5);
    letter-spacing: 4px; text-transform: uppercase;
    animation: fighterTextSlam 0.5s cubic-bezier(0.2, 0, 0.2, 1);
  `;
  overlay.appendChild(title);

  const subtitles: Record<string, string[]> = {
    hero_hp: ['+25% Max HP', '+100% Max HP', '+200% Max HP'],
    hero_damage: ['+25% Weapon Damage', '+100% Weapon Damage', '+200% Weapon Damage'],
    hero_regen: ['2% HP/s after 7s without damage'],
  };
  const subTexts = subtitles[upgradeType];
  const subText = subTexts ? (level > 0 ? subTexts[Math.min(level - 1, subTexts.length - 1)] : subTexts[0]) : '';
  if (subText) {
    const subtitle = document.createElement('div');
    subtitle.textContent = level > 0 ? `Level ${level} — ${subText}` : subText;
    subtitle.style.cssText = `
      color: #88bbff; font-size: 22px; font-weight: bold; font-family: system-ui, sans-serif;
      text-shadow: 0 0 15px rgba(50,100,255,0.6), 0 2px 4px rgba(0,0,0,0.5);
      margin-top: 12px; opacity: 0; animation: fighterSubFade 2s 0.4s ease-out forwards;
    `;
    overlay.appendChild(subtitle);
  }

  // Reuse same keyframe animations as fighter level-up
  if (!document.getElementById('fighter-level-styles')) {
    const style = document.createElement('style');
    style.id = 'fighter-level-styles';
    style.textContent = `
      @keyframes fighterLevelFade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
      @keyframes fighterTextSlam { 0% { transform: scale(2.5); opacity: 0; } 50% { transform: scale(0.9); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      @keyframes fighterSubFade { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3500);
}

/** Show a dramatic full-screen fighter level-up announcement */
function showFighterLevelUp(level: number): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; z-index: 50;
    pointer-events: none; animation: fighterLevelFade 3s ease-out forwards;
  `;

  // No screen flash — just the text announcement

  const title = document.createElement('div');
  title.textContent = 'FIGHTERS HAVE EVOLVED';
  title.style.cssText = `
    color: #ff4422; font-size: 52px; font-weight: 900; font-family: system-ui, sans-serif;
    text-shadow: 0 0 30px rgba(255,50,0,0.8), 0 0 60px rgba(255,50,0,0.4), 0 4px 8px rgba(0,0,0,0.5);
    letter-spacing: 4px; text-transform: uppercase;
    animation: fighterTextSlam 0.5s cubic-bezier(0.2, 0, 0.2, 1);
  `;
  overlay.appendChild(title);

  const subtitle = document.createElement('div');
  const strengthPct = Math.round((Math.pow(1.15, level) - 1) * 100);
  const speedPct = Math.round((Math.pow(1.10, level) - 1) * 100);
  subtitle.textContent = `Level ${level} — ${strengthPct}% stronger, ${speedPct}% faster`;
  subtitle.style.cssText = `
    color: #ffaa66; font-size: 22px; font-weight: bold; font-family: system-ui, sans-serif;
    text-shadow: 0 0 15px rgba(255,100,0,0.6), 0 2px 4px rgba(0,0,0,0.5);
    margin-top: 12px; opacity: 0; animation: fighterSubFade 2s 0.4s ease-out forwards;
  `;
  overlay.appendChild(subtitle);

  // Add keyframe animations if not already present
  if (!document.getElementById('fighter-level-styles')) {
    const style = document.createElement('style');
    style.id = 'fighter-level-styles';
    style.textContent = `
      @keyframes fighterLevelFade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
      @keyframes fighterFlashPulse { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.5); } }
      @keyframes fighterTextSlam { 0% { transform: scale(2.5); opacity: 0; } 50% { transform: scale(0.9); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      @keyframes fighterSubFade { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3500);
}

// ===================== Game Init =====================

function initOnlineGame(teamId: 1 | 2 = 1, mapConfig?: MapConfig): void {
  if (rtsController) rtsController.destroy();
  if (fpsController) fpsController.destroy();
  if (snapshotRenderer) snapshotRenderer.destroy();

  const mc = mapConfig ?? MEADOW_MAP;
  // For online: create a bare scene (no pre-placed entities — server owns those)
  sceneManager = new SceneManager(canvas, true, mc, sharedRenderer); // skipEntities=true

  // Attach VR camera rig to the new scene
  vrManager.attachToScene(sceneManager.scene, sceneManager.camera);

  const spawn = mc.teamSpawns[teamId];
  const spawnVec = new THREE.Vector3(spawn.x, sceneManager.terrainHeight(spawn.x, spawn.z) + PLAYER_HEIGHT, spawn.z);

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
  fpsController.onServerMessage = (msg) => {
    connection?.send(msg);
  };

  rtsController = new RTSController(sceneManager, canvas);
  rtsController.onBuildingComplete = (buildingType: string) => {
    if (buildingType === 'armory') fpsController.unlockArmory();
    if (buildingType === 'armory_level2') fpsController.armoryLevel2 = true;
    if (buildingType === 'armory_rockets') fpsController.rocketCooldownReduced = true;
  };

  // Wire up online RTS commands
  rtsController.onServerCommand = (cmd) => {
    connection?.send({ type: 'rts_command', ...cmd } as any);
  };
  rtsController.onServerTrain = (baseId) => {
    connection?.send({ type: 'rts_train', baseId, unitType: 'worker' });
  };
  rtsController.onServerCancelTrain = (baseId, index) => {
    connection?.send({ type: 'rts_cancel_train', baseId, index });
  };
  rtsController.onServerBuild = (buildingType, position, builderWorkerId) => {
    connection?.send({
      type: 'rts_command',
      command: 'place_building',
      unitIds: builderWorkerId ? [builderWorkerId] : [],
      targetPos: position,
      buildingType,
    } as any);
  };
  rtsController.onServerUpgrade = (buildingId, upgradeType) => {
    connection?.send({ type: 'rts_upgrade', buildingId, upgradeType } as any);
  };
  rtsController.onServerTrainUnit = (baseId, unitType) => {
    connection?.send({ type: 'rts_train', baseId, unitType } as any);
  };
  rtsController.onServerMessage = (msg) => {
    connection?.send(msg);
  };

  snapshotRenderer = new SnapshotRenderer(sceneManager);
  snapshotRenderer.onBuildingComplete = (entityType, teamId) => {
    const isOurs = teamId === fpsController.localTeamId;
    if (isOurs && entityType === 'armory') {
      fpsController.unlockArmory();
    }
    if (isOurs && entityType === 'hero_academy') {
      fpsController.hasHeroAcademy = true;
    }
    // Notify FPS player about key buildings
    if (isOurs && activeRole === 'fps') {
      const names: Record<string, string> = {
        armory: 'Armory built!', garage: 'Garage built!', main_base: 'New HQ built!', hero_academy: 'Hero Academy built!',
      };
      if (names[entityType]) fpsController.showNotification(names[entityType], '#4c4');
    }
  };
  // Detect HQ upgrade for hero unlock
  snapshotRenderer.onBaseUpgrade = (teamId, level) => {
    if (teamId === fpsController.localTeamId) {
      if (level >= 2) fpsController.baseUpgraded = true;
      if (activeRole === 'fps') {
        fpsController.showNotification(`HQ upgraded to Tier ${level}!`, '#ffd700');
      }
    }
  };
  // Notify FPS player about vehicle spawns (jeep, helicopter)
  snapshotRenderer.onEntityCreated = (entityType, teamId) => {
    if (teamId !== fpsController.localTeamId || activeRole !== 'fps') return;
    if (entityType === 'jeep') fpsController.showNotification('Jeep ready!', '#4c4');
    if (entityType === 'helicopter') fpsController.showNotification('Helicopter ready!', '#4c4');
  };
  // Notify FPS player about key building/entity destruction
  snapshotRenderer.onEntityDestroyed = (entityType, teamId, _id) => {
    if (teamId !== fpsController.localTeamId || activeRole !== 'fps') return;
    if (entityType === 'tower') fpsController.showNotification('Tower destroyed!', '#ff4444');
    if (entityType === 'player_tower') fpsController.showNotification('Tower destroyed!', '#ff4444');
    if (entityType === 'main_base') fpsController.showNotification('HQ destroyed!', '#ff4444');
  };

  gameOverScreen.style.display = 'none';
}

// ===================== Role Management =====================

function setRole(role: Role): void {
  if (activeRole === 'fps') fpsController.disable();
  if (activeRole === 'rts') rtsController.disable();

  activeRole = role;

  if (role === null) {
    overlay.style.display = 'none';
    crosshair.style.display = 'none';
    return;
  }

  roleSelect.style.display = 'none';

  if (role === 'fps') {
    // Enable VR mode if currently presenting
    fpsController.vrMode = vrManager.isPresenting;
    fpsController.vrCameraRig = vrManager.cameraRig;
    fpsController.enable();
    overlay.style.display = vrManager.isPresenting ? 'none' : 'flex';
    crosshair.style.display = vrManager.isPresenting ? 'none' : 'block';
    sceneManager.setCloudsVisible(true);
  } else {
    // VR only supports FPS — if switching to RTS, disable VR on controller
    if (fpsController) {
      fpsController.vrMode = false;
      fpsController.vrGamepadInput = null;
    }
    overlay.style.display = 'none';
    crosshair.style.display = 'none';
    rtsController.enable();
    sceneManager.setCloudsVisible(false);
  }
}

// ===================== Online Mode =====================

async function connectToServer(): Promise<Connection> {
  const conn = new Connection();
  // In production, WS runs on the same host/port.
  // In dev, use the Vite proxy at /ws (handles both HTTP and HTTPS).
  const isDev = window.location.port === '3000';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = isDev
    ? `${protocol}//${window.location.host}/ws`
    : `${protocol}//${window.location.host}`;
  await conn.connect(wsUrl);
  return conn;
}

let roomVisibility: 'public' | 'private' = 'public';

async function hostGame(): Promise<void> {
  connStatus.textContent = 'Connecting...';
  try {
    connection = await connectToServer();
    isOnline = true;
    const playerName = nameInput.value.trim() || generateName();
    const roomName = roomNameInput.value.trim() || `${playerName}'s Game`;
    connection.send({
      type: 'create_room',
      playerName,
      roomName,
      visibility: roomVisibility,
    });
    connection.onMessage(handleServerMessage);
    mainMenu.style.display = 'none';
    lobbyScreen.style.display = 'flex';
    lobbyNameInput.value = playerName;
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
    connection.send({ type: 'join_room', roomCode: code.toUpperCase(), playerName: nameInput.value.trim() || generateName() });
    connection.onMessage(handleServerMessage);
    mainMenu.style.display = 'none';
    lobbyScreen.style.display = 'flex';
    lobbyNameInput.value = nameInput.value.trim() || generateName();
    lobbyStatus.textContent = 'Joining...';
  } catch {
    connStatus.textContent = 'Failed to connect to server';
  }
}

async function browseGames(): Promise<void> {
  connStatus.textContent = 'Connecting...';
  try {
    connection = await connectToServer();
    isOnline = true;
    connection.send({ type: 'subscribe_lobby' });
    connection.onMessage(handleServerMessage);
    mainMenu.style.display = 'none';
    browseLobby.style.display = 'flex';
    connStatus.textContent = '';
  } catch {
    connStatus.textContent = 'Failed to connect to server';
  }
}

function leaveBrowse(): void {
  if (connection) {
    connection.send({ type: 'unsubscribe_lobby' });
    connection.disconnect();
    connection = null;
  }
  browseLobby.style.display = 'none';
  mainMenu.style.display = 'flex';
}

function renderLobbyList(rooms: import('@dyarchy/shared').LobbyRoomInfo[]): void {
  lobbyRoomList.innerHTML = '';
  if (rooms.length === 0) {
    lobbyRoomList.appendChild(lobbyEmpty.cloneNode(true));
    const createBtn = document.createElement('button');
    createBtn.textContent = 'Create a Game';
    createBtn.style.cssText = `
      display:block; margin:16px auto 0; padding:10px 28px;
      background:rgba(60,140,80,0.3); color:#4a8; border:2px solid #4a8;
      border-radius:8px; cursor:pointer; font-size:15px; font-weight:bold;
      font-family:system-ui,sans-serif; transition:background 0.15s;
    `;
    createBtn.addEventListener('mouseenter', () => { createBtn.style.background = 'rgba(60,140,80,0.5)'; });
    createBtn.addEventListener('mouseleave', () => { createBtn.style.background = 'rgba(60,140,80,0.3)'; });
    createBtn.addEventListener('click', () => {
      if (connection) {
        connection.send({ type: 'unsubscribe_lobby' });
        const playerName = nameInput.value.trim() || generateName();
        const roomName = `${playerName}'s Game`;
        connection.send({ type: 'create_room', playerName, roomName, visibility: 'public' });
        browseLobby.style.display = 'none';
        lobbyScreen.style.display = 'flex';
        lobbyNameInput.value = playerName;
        lobbyStatus.textContent = 'Waiting for players...';
      }
    });
    lobbyRoomList.appendChild(createBtn);
    return;
  }
  for (const room of rooms) {
    const row = document.createElement('div');
    const isJoinable = room.playerCount < room.maxPlayers;
    row.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:12px 14px;margin-bottom:6px;
      background:rgba(255,255,255,${isJoinable ? '0.06' : '0.02'});
      border:1px solid ${isJoinable ? '#555' : '#333'};border-radius:8px;
      cursor:${isJoinable ? 'pointer' : 'default'};
      opacity:${isJoinable ? '1' : '0.5'};
      transition:background 0.15s;
    `;
    if (isJoinable) {
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.1)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'rgba(255,255,255,0.06)'; });
      row.addEventListener('click', () => {
        connection?.send({ type: 'unsubscribe_lobby' });
        const playerName = nameInput.value.trim() || generateName();
        connection?.send({ type: 'join_room', roomCode: room.roomCode, playerName });
        browseLobby.style.display = 'none';
        lobbyScreen.style.display = 'flex';
        lobbyNameInput.value = playerName;
        lobbyStatus.textContent = 'Joining...';
      });
    }

    const left = document.createElement('div');
    left.innerHTML = `
      <div style="color:#fff;font-size:15px;font-weight:bold;">${room.roomName}</div>
      <div style="color:#888;font-size:12px;">${room.mapId} &middot; ${room.roomCode}</div>
    `;

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const count = document.createElement('div');
    count.style.cssText = 'color:#ccc;font-size:14px;';
    count.textContent = `${room.playerCount}/${room.maxPlayers}`;

    const pill = document.createElement('div');
    const pillColor = room.playerCount >= room.maxPlayers ? '#cc3333'
      : room.status === 'playing' ? '#cc8800' : '#33aa55';
    const pillText = room.playerCount >= room.maxPlayers ? 'Full'
      : room.status === 'playing' ? 'In Progress — Join' : 'Waiting';
    pill.style.cssText = `padding:3px 10px;border-radius:10px;font-size:11px;color:#fff;background:${pillColor};`;
    pill.textContent = pillText;

    right.appendChild(count);
    right.appendChild(pill);
    row.appendChild(left);
    row.appendChild(right);
    lobbyRoomList.appendChild(row);
  }
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'room_state':
      handleRoomState(msg);
      break;

    case 'game_start':
      document.getElementById('countdown-overlay')?.remove();
      lobbyScreen.style.display = 'none';
      initOnlineGame(msg.yourTeam, getMapConfig(msg.mapId));
      localFPSEntityId = msg.fpsEntityId;
      // Set team for all subsystems
      if (rtsController) {
        rtsController.localTeamId = msg.yourTeam;
        rtsController.teamPlayerCount = msg.teamPlayerCount;
        // Center camera on team's base
        const teamSpawn = getMapConfig(msg.mapId).teamSpawns[msg.yourTeam];
        rtsController.setCameraCenter(teamSpawn.x, teamSpawn.z);
      }
      teamPlayerCount = msg.teamPlayerCount;
      if (fpsController) {
        fpsController.localTeamId = msg.yourTeam;
      }
      if (snapshotRenderer) {
        snapshotRenderer.localFPSEntityId = msg.fpsEntityId;
        snapshotRenderer.localTeamId = msg.yourTeam;
      }
      setRole(msg.yourRole);
      // Load horn audio samples (fire-and-forget)
      SoundManager.instance().loadHornSamples(
        [1, 2, 3].map(i => `/horns/horn${i}.mp3`),
      ).catch(() => { /* horn files not yet provided — silent fallback */ });
      break;

    case 'snapshot':
      if (msg.playerStats) latestPlayerStats = msg.playerStats;
      if (snapshotRenderer) {
        snapshotRenderer.applySnapshot(msg);

        if (rtsController) {
          rtsController.setFromSnapshot(msg);
        }

        // Sync FPS player state from server
        if (fpsController && localFPSEntityId) {
          const fpsEntity = msg.entities.find(e => e.id === localFPSEntityId);
          if (fpsEntity) {
            fpsController.syncFromServer(fpsEntity.hp, fpsEntity.maxHp, fpsEntity.position, fpsEntity.killerEntityId, fpsEntity.killerName, {
              heroType: fpsEntity.heroType,
              heroAbilityActive: fpsEntity.heroAbilityActive,
              shieldHp: fpsEntity.shieldHp,
              abilityCharge: fpsEntity.abilityCharge,
              abilityMaxCharge: fpsEntity.abilityMaxCharge,
              abilityDepleted: fpsEntity.abilityDepleted,
              abilityLockout: fpsEntity.abilityLockout,
            });
          }
        }
        // Detect fighter level-up
        if (msg.fighterLevel > lastFighterLevel && lastFighterLevel >= 0) {
          showFighterLevelUp(msg.fighterLevel);
        }
        lastFighterLevel = msg.fighterLevel;
        // Sync hero upgrade levels to FPS controller for HUD badges
        if (fpsController) {
          const t = fpsController.localTeamId;
          fpsController.heroHpLevel = msg.heroHpLevel?.[t] ?? 0;
          fpsController.heroDmgLevel = msg.heroDmgLevel?.[t] ?? 0;
          fpsController.heroRegenActive = msg.heroRegen?.[t] ?? false;
        }
      }
      break;

    case 'game_over': {
      const teamName = msg.winnerTeam === 1 ? 'Blue Team' : 'Red Team';
      gameOverText.textContent = `${teamName} Wins!`;
      gameOverScreen.style.display = 'flex';
      if (activeRole === 'fps') fpsController.disable();
      if (activeRole === 'rts') rtsController.disable();
      rtsController.gameOver = true;
      activeRole = null;
      crosshair.style.display = 'none';
      overlay.style.display = 'none';
      // Clean up debug overlays
      if (rtsBrainOverlay) { rtsBrainOverlay.remove(); rtsBrainOverlay = null; }
      cheatRtsBrain = false;
      // Play win/lose sound
      if (msg.winnerTeam === 1) SoundManager.instance().victory();
      else SoundManager.instance().gameOver();
      // Show end-of-game awards
      if (msg.stats && msg.stats.length > 0) showEndGameAwards(msg.stats);
      break;
    }

    case 'swap_request': {
      // Teammate is asking to swap roles
      const dialog = document.getElementById('swap-dialog')!;
      const text = document.getElementById('swap-dialog-text')!;
      text.textContent = `${msg.fromPlayer} wants to swap roles: they are ${msg.fromRole.toUpperCase()}, you are ${msg.toRole.toUpperCase()}. Accept?`;
      dialog.style.display = 'flex';
      break;
    }

    case 'swap_result': {
      document.getElementById('swap-dialog')!.style.display = 'none';
      if (msg.accepted && msg.newRole) {
        // Update FPS entity ID (critical for damage sync when swapping to FPS)
        localFPSEntityId = msg.fpsEntityId ?? null;
        if (snapshotRenderer) {
          snapshotRenderer.localFPSEntityId = localFPSEntityId;
        }
        // Switch to the new role
        setRole(msg.newRole);
      } else if (!msg.accepted) {
        // Show rejection briefly
        lobbyStatus.textContent = 'Swap request was declined';
        setTimeout(() => { lobbyStatus.textContent = ''; }, 3000);
      }
      break;
    }

    case 'error':
      lobbyStatus.textContent = msg.message;
      setTimeout(() => { lobbyStatus.textContent = ''; }, 4000);
      break;

    case 'vehicle_entered' as any:
      if (fpsController) {
        fpsController.handleVehicleEntered((msg as any).vehicleId, (msg as any).seat);
      }
      break;

    case 'vehicle_exited' as any:
      if (fpsController) {
        fpsController.handleVehicleExited();
      }
      break;

    case 'chat':
      showChatMessage(msg.from, msg.text);
      break;

    case 'hero_upgrade_complete' as any:
      showHeroUpgradeAnnouncement((msg as any).upgradeType, (msg as any).level);
      break;

    case 'ping' as any:
      // Teammate sent a map ping — show the beacon
      if (rtsController && (msg as any).x !== undefined) {
        rtsController.spawnPingBeacon(new THREE.Vector3((msg as any).x, 0, (msg as any).z));
      }
      break;

    case 'horn_honk' as any: {
      const pos = (msg as any).position;
      if (pos) SoundManager.instance().playHorn(pos.x, pos.z);
      break;
    }

    case 'turret_hit' as any:
      if (fpsController) fpsController.showHitMarker((msg as any).targetId);
      break;

    case 'rocket_fired' as any:
      // Another player fired a rocket — spawn visual-only projectile
      if (fpsController) {
        fpsController.spawnRemoteRocket((msg as any).origin, (msg as any).direction, (msg as any).shooterId);
      } else if (snapshotRenderer) {
        // RTS view: spawn rocket in the scene directly
        spawnRtsRocket((msg as any).origin, (msg as any).direction);
      }
      break;

    case 'heli_impact' as any: {
      // Another player's helicopter minigun hit — spawn debris for all to see
      const pt = new THREE.Vector3((msg as any).x, (msg as any).y, (msg as any).z);
      const kind = (msg as any).kind as 'ground' | 'building' | 'blood';
      if (fpsController) {
        fpsController.spawnImpactDebris(pt, kind);
      }
      break;
    }

    case 'rts_brain_debug' as any:
      updateRtsBrainOverlay((msg as any).plans);
      break;

    case 'lobby_list':
      renderLobbyList(msg.rooms);
      break;

    case 'countdown' as any: {
      const secs = (msg as any).seconds as number;
      let overlay = document.getElementById('countdown-overlay');
      if (secs <= 0) {
        // Cancelled
        overlay?.remove();
        break;
      }
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'countdown-overlay';
        overlay.style.cssText = `
          position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
          z-index:40;pointer-events:none;
        `;
        document.body.appendChild(overlay);
      }
      overlay.innerHTML = `<div style="
        font-size:120px;font-weight:bold;color:#fff;
        text-shadow:0 0 40px rgba(255,200,0,0.8),0 0 80px rgba(255,150,0,0.4);
        font-family:system-ui,sans-serif;
        animation:countdown-pulse 0.5s ease-out;
      ">${secs}</div>`;
      // Add animation keyframes if not already present
      if (!document.getElementById('countdown-style')) {
        const style = document.createElement('style');
        style.id = 'countdown-style';
        style.textContent = `@keyframes countdown-pulse { from { transform:scale(1.5);opacity:0.5; } to { transform:scale(1);opacity:1; } }`;
        document.head.appendChild(style);
      }
      break;
    }

    case 'join_error':
      // Show error wherever the user currently is
      if (browseLobby.style.display !== 'none') {
        // On browse screen — show inline
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f44;font-size:13px;text-align:center;padding:8px;';
        errDiv.textContent = msg.reason;
        lobbyRoomList.prepend(errDiv);
        setTimeout(() => errDiv.remove(), 3000);
      } else {
        connStatus.textContent = msg.reason;
        // Return to main menu if we were trying to join
        if (lobbyScreen.style.display !== 'none') {
          lobbyScreen.style.display = 'none';
          mainMenu.style.display = 'flex';
        }
      }
      break;
  }
}

function handleRoomState(msg: RoomStateMsg): void {
  lobbyCode.textContent = msg.roomName || `Room: ${msg.roomCode}`;
  lobbyStatus.textContent = `Code: ${msg.roomCode}${msg.visibility === 'private' ? ' (Private)' : ''}`;
  playerCount = msg.players.length;

  // Switch preview background when map selection changes
  switchPreviewMap(msg.mapId);

  // Update map selection highlight
  const mapColors: Record<string, { active: string; border: string; inactive: string }> = {
    meadow: { active: 'rgba(60,120,60,0.35)', border: '#4a8', inactive: 'rgba(60,120,60,0.2)' },
    frostpeak: { active: 'rgba(80,100,140,0.35)', border: '#68a', inactive: 'rgba(80,100,140,0.2)' },
    blood_canyon: { active: 'rgba(160,100,40,0.35)', border: '#a84', inactive: 'rgba(160,100,40,0.2)' },
    ironhold: { active: 'rgba(80,50,30,0.35)', border: '#a64', inactive: 'rgba(60,40,30,0.2)' },
  };
  document.querySelectorAll('.map-card').forEach(card => {
    const mapId = card.getAttribute('data-map') ?? '';
    const colors = mapColors[mapId] ?? mapColors.meadow;
    if (mapId === msg.mapId) {
      (card as HTMLElement).style.borderColor = colors.border;
      (card as HTMLElement).style.background = colors.active;
    } else {
      (card as HTMLElement).style.borderColor = '#334';
      (card as HTMLElement).style.background = colors.inactive;
    }
  });

  // Update lobby slot grid with player names and CPU toggles
  document.querySelectorAll('.lobby-slot').forEach(btn => {
    const slotTeam = parseInt(btn.getAttribute('data-team')!);
    const slotRole = btn.getAttribute('data-role')!;
    const playerInSlot = msg.players.find(p => p.team === slotTeam && p.role === slotRole);
    const nameEl = btn.querySelector('.slot-player') as HTMLDivElement;
    const cpuKey = `${slotTeam}_${slotRole}`;
    const cpuDiff = msg.cpuSlots?.[cpuKey] ?? null;

    // Find the matching CPU toggle button
    const cpuBtn = document.querySelector(`.cpu-toggle[data-team="${slotTeam}"][data-role="${slotRole}"]`) as HTMLButtonElement | null;

    if (playerInSlot) {
      nameEl.textContent = playerInSlot.name + (playerInSlot.ready ? ' [Ready]' : '');
      (btn as HTMLElement).style.borderColor = slotTeam === 1 ? '#4488dd' : '#dd4444';
      if (cpuBtn) cpuBtn.style.display = 'none';
    } else if (cpuDiff) {
      // CPU is filling this slot
      const label = cpuLabels[cpuDiff] ?? cpuLabels[''];
      nameEl.textContent = label.text;
      (btn as HTMLElement).style.borderColor = label.color;
      if (cpuBtn) {
        cpuBtn.style.display = 'block';
        cpuBtn.textContent = label.text;
        cpuBtn.style.color = label.color;
        cpuBtn.style.borderColor = label.color;
      }
    } else {
      nameEl.textContent = '— open —';
      (btn as HTMLElement).style.borderColor = '#334';
      if (cpuBtn) {
        cpuBtn.style.display = 'block';
        cpuBtn.textContent = 'CPU: Off';
        cpuBtn.style.color = '#666';
        cpuBtn.style.borderColor = '#333';
      }
    }
  });
}

// ===================== Menu Buttons =====================

document.getElementById('btn-host')!.addEventListener('click', () => hostGame());
document.getElementById('btn-browse')!.addEventListener('click', () => browseGames());
document.getElementById('btn-browse-back')!.addEventListener('click', () => leaveBrowse());
document.getElementById('btn-join')!.addEventListener('click', () => {
  const code = (document.getElementById('room-code') as HTMLInputElement).value;
  joinGame(code);
});

// Visibility toggle
visPublicBtn.addEventListener('click', () => {
  roomVisibility = 'public';
  visPublicBtn.style.borderColor = '#4a8';
  visPublicBtn.style.background = 'rgba(60,140,80,0.3)';
  visPublicBtn.style.color = '#4a8';
  visPrivateBtn.style.borderColor = '#555';
  visPrivateBtn.style.background = 'transparent';
  visPrivateBtn.style.color = '#888';
});
visPrivateBtn.addEventListener('click', () => {
  roomVisibility = 'private';
  visPrivateBtn.style.borderColor = '#c84';
  visPrivateBtn.style.background = 'rgba(180,100,40,0.3)';
  visPrivateBtn.style.color = '#c84';
  visPublicBtn.style.borderColor = '#555';
  visPublicBtn.style.background = 'transparent';
  visPublicBtn.style.color = '#888';
});

// Lobby slot selection — click a team/role slot to join it
document.querySelectorAll('.lobby-slot').forEach(btn => {
  btn.addEventListener('click', () => {
    const team = parseInt(btn.getAttribute('data-team')!) as 1 | 2;
    const role = btn.getAttribute('data-role') as 'fps' | 'rts';
    connection?.send({ type: 'select_role', team, role });
  });
});

// CPU toggle buttons — cycle Off → Easy → Medium → Hard → Off
const cpuCycle: (string | null)[] = [null, 'easy', 'medium', 'hard'];
const cpuLabels: Record<string, { text: string; color: string }> = {
  '': { text: 'CPU: Off', color: '#666' },
  'easy': { text: 'CPU: Easy', color: '#4a4' },
  'medium': { text: 'CPU: Medium', color: '#da4' },
  'hard': { text: 'CPU: Hard', color: '#d44' },
};
document.querySelectorAll('.cpu-toggle').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const team = btn.getAttribute('data-team')!;
    const role = btn.getAttribute('data-role')!;
    const slot = `${team}_${role}`;
    // Read current state from button text and advance to next
    const currentText = btn.textContent?.trim() ?? '';
    const currentKey = Object.entries(cpuLabels).find(([, v]) => v.text === currentText)?.[0] ?? '';
    const idx = cpuCycle.indexOf(currentKey || null);
    const next = cpuCycle[(idx + 1) % cpuCycle.length];
    connection?.send({ type: 'configure_cpu', slot, difficulty: next } as any);
  });
});

// Map selection — click a map card to select it
document.querySelectorAll('.map-card').forEach(card => {
  card.addEventListener('click', () => {
    const mapId = card.getAttribute('data-map') as MapId;
    connection?.send({ type: 'select_map', mapId });
  });
});

document.getElementById('btn-ready')!.addEventListener('click', () => {
  connection?.send({ type: 'ready' });
  lobbyStatus.textContent = 'Ready! Waiting for others...';
});

// Lobby name editing — send name change to server on blur or enter
lobbyNameInput.addEventListener('change', () => {
  const name = lobbyNameInput.value.trim();
  if (name) connection?.send({ type: 'change_name', name } as any);
});
lobbyNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') lobbyNameInput.blur();
});

document.getElementById('btn-fps')!.addEventListener('click', () => setRole('fps'));
document.getElementById('btn-rts')!.addEventListener('click', () => setRole('rts'));

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && activeRole !== null && !rtsController?.gameOver) {
    e.preventDefault();
    connection?.send({ type: 'request_swap' });
  }
  if (e.code === 'KeyM') {
    const sm = SoundManager.instance();
    sm.toggleMute();
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = sm.muted ? 'Sound: OFF [M]' : 'Sound: ON [M]';
  }
});

// Swap dialog buttons
document.getElementById('btn-swap-yes')!.addEventListener('click', () => {
  connection?.send({ type: 'respond_swap', accepted: true });
  document.getElementById('swap-dialog')!.style.display = 'none';
});
document.getElementById('btn-swap-no')!.addEventListener('click', () => {
  connection?.send({ type: 'respond_swap', accepted: false });
  document.getElementById('swap-dialog')!.style.display = 'none';
});

// Mute button
document.getElementById('btn-mute')!.addEventListener('click', () => {
  const sm = SoundManager.instance();
  sm.toggleMute();
  document.getElementById('btn-mute')!.textContent = sm.muted ? 'Sound: OFF [M]' : 'Sound: ON [M]';
});

// Controller config button
document.getElementById('btn-controller-config')!.addEventListener('click', () => toggleControllerConfig());

overlay.addEventListener('click', () => {
  if (isMobile()) {
    // Mobile: no pointer lock — just hide overlay
    overlay.style.display = 'none';
  } else {
    canvas.requestPointerLock();
  }
});

// Mobile: prevent browser gestures on canvas
if (isMobile()) {
  canvas.style.touchAction = 'none';
  document.body.style.touchAction = 'none';
  // Change overlay text
  const overlaySpan = overlay.querySelector('span');
  if (overlaySpan) overlaySpan.textContent = 'Tap to play';
}

// ===================== In-Game Chat =====================

const chatLog = document.createElement('div');
chatLog.id = 'chat-log';
chatLog.style.cssText = `
  position:fixed; bottom:60px; left:16px; width:350px; max-height:200px;
  overflow-y:auto; pointer-events:none; z-index:14;
  font-family:system-ui,sans-serif; font-size:13px;
  display:none;
`;
document.body.appendChild(chatLog);

const chatInputBar = document.createElement('div');
chatInputBar.style.cssText = `
  position:fixed; bottom:16px; left:16px; z-index:30; display:none;
  font-family:system-ui,sans-serif;
`;
const chatTargetLabel = document.createElement('span');
chatTargetLabel.style.cssText = `
  display:inline-block; padding:6px 10px; background:rgba(200,100,0,0.8); color:#fff;
  border:1px solid #c84; border-radius:4px 0 0 4px; font-size:13px; vertical-align:top;
`;
chatTargetLabel.textContent = 'All';
chatInputBar.appendChild(chatTargetLabel);

const chatInput = document.createElement('input');
chatInput.type = 'text';
chatInput.maxLength = 200;
chatInput.placeholder = 'Type a message...';
chatInput.style.cssText = `
  width:260px; padding:6px 10px; background:rgba(0,0,0,0.8); color:#fff;
  border:1px solid #555; border-left:none; border-radius:0 4px 4px 0;
  font-size:13px; outline:none; vertical-align:top;
`;

function closeChat(): void {
  chatInput.value = '';
  chatInputBar.style.display = 'none';
  // Only re-lock pointer in FPS mode
  if (activeRole === 'fps') canvas.requestPointerLock();
}

chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // don't trigger game keys
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text && connection) {
      connection.send({ type: 'send_chat', text, target: chatTarget } as any);
    }
    closeChat();
  }
  if (e.key === 'Escape') {
    closeChat();
  }
});
// Close chat when input loses focus (e.g. player clicks back into game)
chatInput.addEventListener('blur', () => {
  // Small delay so click events on the label can fire first
  setTimeout(() => {
    if (chatInputBar.style.display !== 'none') closeChat();
  }, 100);
});
chatInputBar.appendChild(chatInput);
document.body.appendChild(chatInputBar);

let chatFadeTimers: ReturnType<typeof setTimeout>[] = [];
let chatTarget: 'team' | 'all' = 'all';

function openChat(target: 'team' | 'all'): void {
  chatTarget = target;
  chatTargetLabel.textContent = target === 'team' ? 'Team' : 'All';
  chatTargetLabel.style.background = target === 'team' ? 'rgba(0,100,200,0.8)' : 'rgba(200,100,0,0.8)';
  chatTargetLabel.style.borderColor = target === 'team' ? '#48a' : '#c84';
  chatInputBar.style.display = '';
  if (activeRole === 'fps') document.exitPointerLock();
  chatInput.focus();
}

function spawnRtsRocket(origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }): void {
  if (!snapshotRenderer) return;
  const scene = snapshotRenderer.sceneManager.scene;
  const sm = snapshotRenderer.sceneManager;
  const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();

  const rocketGroup = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6),
    new THREE.MeshLambertMaterial({ color: 0x556633 }),
  );
  body.rotation.x = Math.PI / 2;
  rocketGroup.add(body);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.3, 5),
    new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 }),
  );
  flame.rotation.x = Math.PI / 2;
  flame.position.z = -0.3;
  rocketGroup.add(flame);

  rocketGroup.position.set(origin.x, origin.y, origin.z);
  rocketGroup.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
  scene.add(rocketGroup);

  const ROCKET_SPEED = 20;
  let traveled = 0;
  const animate = () => {
    const step = ROCKET_SPEED * 0.016;
    rocketGroup.position.add(dir.clone().multiplyScalar(step));
    traveled += step;
    (flame.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.random() * 0.5;
    const rp = rocketGroup.position;
    const terrainY = sm.terrainHeight(rp.x, rp.z);
    if (rp.y <= terrainY + 0.2 || traveled > 75) {
      scene.remove(rocketGroup);
      return;
    }
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

function showChatMessage(from: string, text: string): void {
  chatLog.style.display = '';
  const line = document.createElement('div');
  line.style.cssText = 'padding:2px 6px; background:rgba(0,0,0,0.5); border-radius:3px; margin-bottom:2px; color:#fff; transition:opacity 0.5s;';
  if (from) {
    line.innerHTML = `<span style="color:#ffd700;font-weight:bold;">${from}:</span> ${text}`;
  } else {
    line.innerHTML = `<span style="color:#aaa;font-style:italic;">${text}</span>`;
  }
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
  // Fade out after 8 seconds
  const timer = setTimeout(() => {
    line.style.opacity = '0';
    setTimeout(() => line.remove(), 600);
  }, 8000);
  chatFadeTimers.push(timer);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && activeRole && chatInputBar.style.display === 'none') {
    e.preventDefault();
    // Shift+Enter = team chat, Enter = all chat
    openChat(e.shiftKey ? 'team' : 'all');
  }
});

// Cheat menu for solo players
let cheatMenuEl: HTMLDivElement | null = null;
let cheatFriendlyWavesStopped = false;
let cheatEnemyWavesStopped = false;
let cheatUnitsFrozen = false;
let cheatInstantBuild = false;
let cheatTurboJeep = false;
let cheatInvincible = false;
let cheatGameSpeed = 1;
let cheatKeyPresses = 0;
let cheatKeyTimer = 0;
let cheatRtsBrain = false;
let rtsBrainOverlay: HTMLDivElement | null = null;

function updateRtsBrainOverlay(plans: Record<number, { name: string; actions: string[] }>): void {
  if (!cheatRtsBrain) {
    if (rtsBrainOverlay) { rtsBrainOverlay.remove(); rtsBrainOverlay = null; }
    return;
  }

  if (!rtsBrainOverlay) {
    rtsBrainOverlay = document.createElement('div');
    rtsBrainOverlay.style.cssText = `
      position:fixed; top:10px; right:10px; z-index:50; pointer-events:none;
      font-family:monospace; font-size:13px; max-width:340px;
    `;
    document.body.appendChild(rtsBrainOverlay);
  }

  let html = '';
  for (const [teamId, plan] of Object.entries(plans)) {
    const teamColor = Number(teamId) === 1 ? '#4af' : '#f55';
    const teamLabel = Number(teamId) === 1 ? 'Blue' : 'Red';
    html += `<div style="background:rgba(0,0,0,0.8);border:1px solid ${teamColor};border-radius:6px;padding:8px 12px;margin-bottom:6px;">`;
    html += `<div style="color:${teamColor};font-weight:bold;margin-bottom:4px;">${teamLabel} RTS Brain — ${plan.name}</div>`;
    if (plan.actions.length === 0) {
      html += `<div style="color:#888;">No planned actions</div>`;
    } else {
      for (let i = 0; i < plan.actions.length; i++) {
        const color = i === 0 ? '#ff0' : '#ccc';
        html += `<div style="color:${color};padding:1px 0;">${i + 1}. ${plan.actions[i]}</div>`;
      }
    }
    html += `</div>`;
  }

  rtsBrainOverlay.innerHTML = html;
}

function toggleCheatMenu(): void {
  if (cheatMenuEl) {
    cheatMenuEl.remove();
    cheatMenuEl = null;
    return;
  }

  cheatMenuEl = document.createElement('div');
  cheatMenuEl.style.cssText = `
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    background:rgba(10,10,20,0.95); border:2px solid #ff0; border-radius:12px;
    padding:24px 32px; z-index:60; font-family:system-ui,sans-serif; min-width:300px;
  `;

  const title = document.createElement('div');
  title.textContent = 'Dev Tools';
  title.style.cssText = 'color:#ff0;font-size:20px;font-weight:bold;margin-bottom:16px;text-align:center;';
  cheatMenuEl.appendChild(title);

  const makeBtn = (label: string, onClick: () => void) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      display:block; width:100%; padding:10px; margin-bottom:8px;
      background:rgba(255,255,255,0.1); color:#fff; border:1px solid #555;
      border-radius:6px; cursor:pointer; font-size:14px; font-family:system-ui,sans-serif;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#ff0'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#555'; });
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  };

  // Helper: for toggle buttons, update label after click
  const toggleBtn = (btn: HTMLButtonElement, onLabel: string, offLabel: string, isOn: boolean) => {
    btn.textContent = isOn ? onLabel : offLabel;
  };

  // Option A: Get 5000 crystals
  cheatMenuEl.appendChild(makeBtn('+ 5000 Crystals', () => {
    if (connection) {
      for (let i = 0; i < 5; i++) connection.send({ type: 'cheat_crystals' } as any);
    }
    if (fpsController) fpsController.cheatResetCooldowns();
  }));

  // Option B: Toggle friendly fighters
  const friendlyBtn = makeBtn(
    cheatFriendlyWavesStopped ? 'Resume Friendly Fighters' : 'Stop Friendly Fighters',
    () => {
      cheatFriendlyWavesStopped = !cheatFriendlyWavesStopped;
      if (connection) connection.send({ type: 'cheat_toggle_waves', side: 'friendly', stopped: cheatFriendlyWavesStopped } as any);
      toggleBtn(friendlyBtn, 'Resume Friendly Fighters', 'Stop Friendly Fighters', cheatFriendlyWavesStopped);
    },
  );
  cheatMenuEl.appendChild(friendlyBtn);

  // Option C: Toggle enemy fighters
  const enemyBtn = makeBtn(
    cheatEnemyWavesStopped ? 'Resume Enemy Fighters' : 'Stop Enemy Fighters',
    () => {
      cheatEnemyWavesStopped = !cheatEnemyWavesStopped;
      if (connection) connection.send({ type: 'cheat_toggle_waves', side: 'enemy', stopped: cheatEnemyWavesStopped } as any);
      toggleBtn(enemyBtn, 'Resume Enemy Fighters', 'Stop Enemy Fighters', cheatEnemyWavesStopped);
    },
  );
  cheatMenuEl.appendChild(enemyBtn);

  // Option D: Freeze all units
  const freezeBtn = makeBtn(
    cheatUnitsFrozen ? 'Unfreeze All Units' : 'Freeze All Units',
    () => {
      cheatUnitsFrozen = !cheatUnitsFrozen;
      if (connection) connection.send({ type: 'cheat_freeze', frozen: cheatUnitsFrozen } as any);
      toggleBtn(freezeBtn, 'Unfreeze All Units', 'Freeze All Units', cheatUnitsFrozen);
    },
  );
  cheatMenuEl.appendChild(freezeBtn);

  // Option E: Instant build/train/upgrade
  const instantBtn = makeBtn(
    cheatInstantBuild ? 'Disable Instant Build' : 'Enable Instant Build',
    () => {
      cheatInstantBuild = !cheatInstantBuild;
      if (connection) connection.send({ type: 'cheat_instant_build', enabled: cheatInstantBuild } as any);
      toggleBtn(instantBtn, 'Disable Instant Build', 'Enable Instant Build', cheatInstantBuild);
    },
  );
  cheatMenuEl.appendChild(instantBtn);

  // Option F: Spawn Jeep near blue HQ
  cheatMenuEl.appendChild(makeBtn('Spawn Jeep', () => {
    if (connection) connection.send({ type: 'cheat_spawn_jeep' } as any);
  }));

  // Option G: Turbo Jeep toggle
  const turboBtn = makeBtn(
    cheatTurboJeep ? 'Disable Turbo Jeep' : 'Enable Turbo Jeep',
    () => {
      cheatTurboJeep = !cheatTurboJeep;
      if (connection) connection.send({ type: 'cheat_turbo_jeep', enabled: cheatTurboJeep } as any);
      toggleBtn(turboBtn, 'Disable Turbo Jeep', 'Enable Turbo Jeep', cheatTurboJeep);
    },
  );
  cheatMenuEl.appendChild(turboBtn);

  // Option H: FPS Invincibility toggle
  const invincBtn = makeBtn(
    cheatInvincible ? 'Disable Invincibility' : 'Enable Invincibility',
    () => {
      cheatInvincible = !cheatInvincible;
      if (connection) connection.send({ type: 'cheat_invincible', enabled: cheatInvincible } as any);
      toggleBtn(invincBtn, 'Disable Invincibility', 'Enable Invincibility', cheatInvincible);
    },
  );
  cheatMenuEl.appendChild(invincBtn);

  // Option I: Equip Weapon (sub-menu)
  cheatMenuEl.appendChild(makeBtn('Equip Weapon...', () => {
    const children = [...cheatMenuEl!.children];
    children.forEach(c => (c as HTMLElement).style.display = 'none');

    const weaponTitle = document.createElement('div');
    weaponTitle.textContent = 'Select Weapon';
    weaponTitle.style.cssText = 'color:#ff0;font-size:18px;font-weight:bold;margin-bottom:12px;text-align:center;';
    cheatMenuEl!.appendChild(weaponTitle);

    const allWeapons = [
      { id: 'pistol', label: 'Pistol — 8 dmg, 4/s' },
      { id: 'rifle', label: 'Rifle — 15 dmg, 3/s' },
      { id: 'shotgun', label: 'Shotgun — 8x6 dmg, 1/s' },
      { id: 'rocket_launcher', label: 'Rocket Launcher — 80 dmg' },
      { id: 'sniper_rifle', label: 'Sniper Rifle — 40 dmg' },
    ];
    for (const w of allWeapons) {
      cheatMenuEl!.appendChild(makeBtn(w.label, () => {
        if (fpsController) fpsController.cheatEquipWeapon(w.id);
      }));
    }

    const backBtn = makeBtn('Back', () => {
      while (cheatMenuEl!.lastChild !== children[children.length - 1]) {
        cheatMenuEl!.removeChild(cheatMenuEl!.lastChild!);
      }
      children.forEach(c => (c as HTMLElement).style.display = '');
    });
    backBtn.style.borderColor = '#888';
    cheatMenuEl!.appendChild(backBtn);
  }));

  // Option: No weapon cooldown toggle
  const noCdBtn = makeBtn(
    fpsController?.cheatNoCooldown ? 'Disable No Cooldown' : 'Enable No Cooldown',
    () => {
      if (fpsController) {
        fpsController.cheatNoCooldown = !fpsController.cheatNoCooldown;
        fpsController.cheatResetCooldowns();
        toggleBtn(noCdBtn, 'Disable No Cooldown', 'Enable No Cooldown', fpsController.cheatNoCooldown);
      }
    },
  );
  cheatMenuEl.appendChild(noCdBtn);

  // Option: Select Hero (sub-menu)
  cheatMenuEl.appendChild(makeBtn('Select Hero...', () => {
    const children = [...cheatMenuEl!.children];
    children.forEach(c => (c as HTMLElement).style.display = 'none');

    const heroTitle = document.createElement('div');
    heroTitle.textContent = 'Select Hero Class';
    heroTitle.style.cssText = 'color:#ff0;font-size:18px;font-weight:bold;margin-bottom:12px;text-align:center;';
    cheatMenuEl!.appendChild(heroTitle);

    const heroes = [
      { type: 'tank', label: 'Tank — Shield sphere' },
      { type: 'healer', label: 'Healer — Heal aura' },
      { type: 'mechanic', label: 'Mechanic — Repair aura' },
    ];
    for (const h of heroes) {
      cheatMenuEl!.appendChild(makeBtn(h.label, () => {
        if (connection) connection.send({ type: 'cheat_set_hero', heroType: h.type } as any);
        if (fpsController) fpsController.heroType = h.type;
      }));
    }
    cheatMenuEl!.appendChild(makeBtn('Clear Hero', () => {
      if (connection) connection.send({ type: 'cheat_set_hero', heroType: null } as any);
      if (fpsController) fpsController.heroType = null;
    }));

    const backBtn2 = makeBtn('Back', () => {
      while (cheatMenuEl!.lastChild !== children[children.length - 1]) {
        cheatMenuEl!.removeChild(cheatMenuEl!.lastChild!);
      }
      children.forEach(c => (c as HTMLElement).style.display = '');
    });
    backBtn2.style.borderColor = '#888';
    cheatMenuEl!.appendChild(backBtn2);
  }));

  // Option: RTS Brain debug overlay
  const rtsBrainBtn = makeBtn(
    cheatRtsBrain ? 'Hide RTS Brain' : 'Show RTS Brain',
    () => {
      cheatRtsBrain = !cheatRtsBrain;
      if (connection) connection.send({ type: 'cheat_rts_brain', enabled: cheatRtsBrain } as any);
      if (!cheatRtsBrain && rtsBrainOverlay) {
        rtsBrainOverlay.remove();
        rtsBrainOverlay = null;
      }
      toggleBtn(rtsBrainBtn, 'Hide RTS Brain', 'Show RTS Brain', cheatRtsBrain);
    },
  );
  cheatMenuEl.appendChild(rtsBrainBtn);

  // Option: Game speed
  const speedCycle = [1, 2, 4, 8, 16];
  const speedBtn = makeBtn(
    cheatGameSpeed === 1 ? 'Game Speed: 1x (Normal)' : `Game Speed: ${cheatGameSpeed}x`,
    () => {
      const idx = speedCycle.indexOf(cheatGameSpeed);
      cheatGameSpeed = speedCycle[(idx + 1) % speedCycle.length];
      if (connection) connection.send({ type: 'cheat_game_speed', speed: cheatGameSpeed } as any);
      speedBtn.textContent = cheatGameSpeed === 1 ? 'Game Speed: 1x (Normal)' : `Game Speed: ${cheatGameSpeed}x`;
    },
  );
  cheatMenuEl.appendChild(speedBtn);

  // Option: Spawn Helicopter
  cheatMenuEl.appendChild(makeBtn('Spawn Helicopter', () => {
    if (connection) connection.send({ type: 'cheat_spawn_heli' } as any);
  }));

  // Close hint
  const closeHint = document.createElement('div');
  closeHint.textContent = 'Press O or click outside to close';
  closeHint.style.cssText = 'color:#666;font-size:12px;text-align:center;margin-top:8px;';
  cheatMenuEl.appendChild(closeHint);

  document.body.appendChild(cheatMenuEl);

  // Close on click outside
  const closeOnClick = (ev: MouseEvent) => {
    if (cheatMenuEl && !cheatMenuEl.contains(ev.target as Node)) {
      toggleCheatMenu();
      document.removeEventListener('click', closeOnClick);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnClick), 50);
}

// ===================== Controller Config UI =====================

let controllerConfigEl: HTMLDivElement | null = null;
let controllerConfigRAF: number | null = null;

function toggleControllerConfig(): void {
  if (controllerConfigEl) {
    if (controllerConfigRAF !== null) cancelAnimationFrame(controllerConfigRAF);
    controllerConfigRAF = null;
    controllerConfigEl.remove();
    controllerConfigEl = null;
    return;
  }

  controllerConfigEl = document.createElement('div');
  controllerConfigEl.style.cssText = `
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    background:rgba(10,10,20,0.95); border:2px solid #0af; border-radius:12px;
    padding:24px 32px; z-index:1100; font-family:system-ui,sans-serif;
    min-width:420px; max-height:80vh; overflow-y:auto; color:#fff;
  `;

  const title = document.createElement('div');
  title.textContent = 'Controller Config';
  title.style.cssText = 'color:#0af;font-size:20px;font-weight:bold;margin-bottom:16px;text-align:center;';
  controllerConfigEl.appendChild(title);

  // Live gamepad status
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'margin-bottom:16px;font-size:13px;color:#888;';
  controllerConfigEl.appendChild(statusDiv);

  // Live button/axis display
  const liveDiv = document.createElement('div');
  liveDiv.style.cssText = 'margin-bottom:16px;font-size:12px;font-family:monospace;background:rgba(0,0,0,0.4);padding:10px;border-radius:6px;';
  controllerConfigEl.appendChild(liveDiv);

  // Action mapping rows
  const actions: { key: keyof GamepadButtonMap; label: string }[] = [
    { key: 'fire', label: 'Fire (RT/R2)' },
    { key: 'altFire', label: 'Scope (LT/L2)' },
    { key: 'jump', label: 'Jump (A/Cross)' },
    { key: 'interact', label: 'Interact (Y/Triangle)' },
    { key: 'swap', label: 'Weapon Swap (X/Square)' },
    { key: 'heroAbility', label: 'Hero Ability (LB/L1)' },
    { key: 'reload', label: 'Cycle Weapon (RB/R1)' },
  ];

  const currentMap = { ...vrManager.buttonMap };
  const mapRows: HTMLDivElement[] = [];
  let listeningAction: keyof GamepadButtonMap | null = null;
  let listeningBtn: HTMLButtonElement | null = null;

  const mapContainer = document.createElement('div');
  for (const action of actions) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);';

    const label = document.createElement('span');
    label.textContent = action.label;
    label.style.cssText = 'color:#ccc;font-size:14px;';
    row.appendChild(label);

    const btn = document.createElement('button');
    btn.textContent = `Button ${currentMap[action.key]}`;
    btn.style.cssText = `
      padding:6px 16px;background:rgba(255,255,255,0.1);color:#fff;
      border:1px solid #555;border-radius:4px;cursor:pointer;font-size:13px;
      font-family:monospace;min-width:100px;
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Start listening for a button press
      if (listeningBtn) {
        listeningBtn.textContent = `Button ${currentMap[listeningAction!]}`;
        listeningBtn.style.borderColor = '#555';
      }
      listeningAction = action.key;
      listeningBtn = btn;
      btn.textContent = 'Press...';
      btn.style.borderColor = '#0f0';
    });
    row.appendChild(btn);
    mapContainer.appendChild(row);
    mapRows.push(row);
  }
  controllerConfigEl.appendChild(mapContainer);

  // Save / Reset / Close buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:16px;';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'padding:8px 24px;background:rgba(0,255,0,0.15);color:#0f0;border:1px solid #0f0;border-radius:6px;cursor:pointer;font-size:14px;';
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Object.assign(vrManager.buttonMap, currentMap);
    saveButtonMap(currentMap);
    toggleControllerConfig();
  });

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset Defaults';
  resetBtn.style.cssText = 'padding:8px 24px;background:rgba(255,165,0,0.15);color:#fa0;border:1px solid #fa0;border-radius:6px;cursor:pointer;font-size:14px;';
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const defaults: GamepadButtonMap = { fire:7, altFire:6, jump:0, interact:3, swap:2, heroAbility:4, reload:5 };
    Object.assign(currentMap, defaults);
    // Update button labels
    const btns = mapContainer.querySelectorAll('button');
    actions.forEach((a, i) => { btns[i].textContent = `Button ${currentMap[a.key]}`; });
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'padding:8px 24px;background:rgba(255,255,255,0.1);color:#aaa;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:14px;';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleControllerConfig(); });

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(resetBtn);
  btnRow.appendChild(closeBtn);
  controllerConfigEl.appendChild(btnRow);

  document.body.appendChild(controllerConfigEl);

  // Live update loop — show raw gamepad data and detect button presses for remapping
  function updateConfigUI(): void {
    if (!controllerConfigEl) return;
    const gp = vrManager.getRawGamepad();
    if (!gp) {
      statusDiv.textContent = 'No controller detected. Connect a Bluetooth/USB controller.';
      liveDiv.textContent = '';
    } else {
      statusDiv.textContent = `${gp.id} (${gp.buttons.length} buttons, ${gp.axes.length} axes)`;

      // Show live axes
      let html = '<div style="color:#0af;margin-bottom:4px;">Axes:</div>';
      for (let i = 0; i < gp.axes.length; i++) {
        const v = gp.axes[i];
        const bar = Math.abs(v) > 0.1 ? ' <span style="color:#0f0;">◄►</span>' : '';
        html += `  [${i}] ${v.toFixed(2)}${bar}\n`;
      }
      html += '<div style="color:#fa0;margin-top:8px;margin-bottom:4px;">Buttons:</div>';
      for (let i = 0; i < gp.buttons.length; i++) {
        const b = gp.buttons[i];
        const pressed = b.pressed ? ' <span style="color:#0f0;font-weight:bold;">PRESSED</span>' : '';
        const val = b.value > 0.01 ? ` (${b.value.toFixed(2)})` : '';
        html += `  [${i}]${val}${pressed}\n`;
      }
      liveDiv.innerHTML = `<pre style="margin:0;white-space:pre-wrap;">${html}</pre>`;

      // Detect button press for remapping
      if (listeningAction) {
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i].pressed) {
            currentMap[listeningAction] = i;
            if (listeningBtn) {
              listeningBtn.textContent = `Button ${i}`;
              listeningBtn.style.borderColor = '#555';
            }
            listeningAction = null;
            listeningBtn = null;
            break;
          }
        }
      }
    }
    controllerConfigRAF = requestAnimationFrame(updateConfigUI);
  }
  controllerConfigRAF = requestAnimationFrame(updateConfigUI);
}

document.addEventListener('keydown', (e) => {
  // Don't trigger dev tools when typing in an input field
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  // F8 to open controller config
  if (e.code === 'F8') { toggleControllerConfig(); return; }
  if (e.code === 'KeyO' && (rtsController || fpsController)) {
    if (playerCount <= 1) {
      // Solo: single press opens menu
      toggleCheatMenu();
    } else {
      // Multiplayer: 4 rapid presses to open
      const now = performance.now();
      if (now - cheatKeyTimer > 1500) cheatKeyPresses = 0; // reset if too slow
      cheatKeyTimer = now;
      cheatKeyPresses++;
      if (cheatKeyPresses >= 4) {
        cheatKeyPresses = 0;
        toggleCheatMenu();
      }
    }
  }
});

document.getElementById('btn-play-again')!.addEventListener('click', () => {
  gameOverScreen.style.display = 'none';
  document.getElementById('end-awards')?.remove();
  lobbyScreen.style.display = 'flex';
});

// ===================== Menu Background Preview =====================

let previewScene: SceneManager | null = null;
const previewCamera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.5, 500);
let previewChangeTimer = 0;
let previewMapId: MapId = (['meadow', 'frostpeak', 'blood_canyon', 'ironhold'] as MapId[])[Math.floor(Math.random() * 4)];
let previewMapConfig: MapConfig = getMapConfig(previewMapId);

// Camera keyframes: each is a distinct viewpoint, scaled to map size
interface CamKeyframe { x: number; y: number; z: number; lookX: number; lookZ: number }
function randomKeyframe(): CamKeyframe {
  const angle = Math.random() * Math.PI * 2;
  const mapScale = Math.max(previewMapConfig.width, previewMapConfig.depth) / 240; // normalize to meadow size
  const radius = (50 + Math.random() * 60) * mapScale;
  const height = (20 + Math.random() * 40) * mapScale;
  const lookOffset = (Math.random() - 0.5) * 30 * mapScale;
  return {
    x: Math.cos(angle) * radius,
    y: height,
    z: Math.sin(angle) * radius,
    lookX: lookOffset,
    lookZ: (Math.random() - 0.5) * 30 * mapScale,
  };
}

let prevKeyframe: CamKeyframe = randomKeyframe();
let nextKeyframe: CamKeyframe = randomKeyframe();
let keyframeT = 0; // 0–1 interpolation between keyframes
const KEYFRAME_DURATION = 10; // seconds per transition (slow cinematic pace)

function initPreviewScene(mapConfig?: MapConfig): void {
  // Destroy old scene if switching maps
  if (previewScene) {
    previewScene.destroy();
    previewScene = null;
  }
  previewScene = new SceneManager(canvas, false, mapConfig ?? previewMapConfig, sharedRenderer);
}

function switchPreviewMap(mapId: MapId): void {
  if (mapId === previewMapId && previewScene) return;
  previewMapId = mapId;
  previewMapConfig = getMapConfig(mapId);
  initPreviewScene(previewMapConfig);
  // Reset camera flyby with keyframes scaled to the new map
  prevKeyframe = randomKeyframe();
  nextKeyframe = randomKeyframe();
  previewChangeTimer = 0;
  keyframeT = 0;
}

function updatePreview(dt: number): void {
  if (!previewScene) initPreviewScene();
  if (!previewScene) return;

  previewChangeTimer += dt;
  keyframeT = Math.min(1, previewChangeTimer / KEYFRAME_DURATION);

  if (previewChangeTimer >= KEYFRAME_DURATION) {
    previewChangeTimer = 0;
    keyframeT = 0;
    prevKeyframe = nextKeyframe;
    nextKeyframe = randomKeyframe();
  }

  // Smooth ease-in-out interpolation
  const t = keyframeT * keyframeT * (3 - 2 * keyframeT); // smoothstep
  const cx = prevKeyframe.x + (nextKeyframe.x - prevKeyframe.x) * t;
  const cy = prevKeyframe.y + (nextKeyframe.y - prevKeyframe.y) * t;
  const cz = prevKeyframe.z + (nextKeyframe.z - prevKeyframe.z) * t;
  const lx = prevKeyframe.lookX + (nextKeyframe.lookX - prevKeyframe.lookX) * t;
  const lz = prevKeyframe.lookZ + (nextKeyframe.lookZ - prevKeyframe.lookZ) * t;

  previewCamera.position.set(cx, cy, cz);
  previewCamera.lookAt(lx, 0, lz);
  previewCamera.aspect = canvas.width / canvas.height;
  previewCamera.updateProjectionMatrix();
  previewScene.renderWith(previewCamera);
}

// Initialize preview with a random map
initPreviewScene();

// ===================== End-Game Awards =====================

function showEndGameAwards(stats: import('@dyarchy/shared').PlayerGameStats[]): void {
  // Remove old awards if present
  document.getElementById('end-awards')?.remove();

  const awards: { title: string; desc: string; winner: string; value: string }[] = [];

  // 1. Marksman — highest hit %
  const shooters = stats.filter(s => s.shotsFired > 0);
  if (shooters.length > 0) {
    const best = shooters.reduce((a, b) => (a.shotsHit / a.shotsFired) > (b.shotsHit / b.shotsFired) ? a : b);
    const pct = Math.min(100, Math.round((best.shotsHit / best.shotsFired) * 100));
    awards.push({ title: 'Marksman', desc: 'Highest accuracy', winner: best.playerName, value: `${pct}%` });
  }

  // 2. Killer Instinct — most opponent kills
  const killers = stats.filter(s => s.kills > 0);
  if (killers.length > 0) {
    const best = killers.reduce((a, b) => a.kills > b.kills ? a : b);
    awards.push({ title: 'Killer Instinct', desc: 'Most opponent kills', winner: best.playerName, value: `${best.kills}` });
  }

  // 3. Backstabber — most friendly fire kills
  const traitors = stats.filter(s => s.friendlyKills > 0);
  if (traitors.length > 0) {
    const best = traitors.reduce((a, b) => a.friendlyKills > b.friendlyKills ? a : b);
    awards.push({ title: 'Backstabber', desc: 'Most friendly fire kills', winner: best.playerName, value: `${best.friendlyKills}` });
  }

  // 4. Gravestone Collector — most deaths
  const dying = stats.filter(s => s.deaths > 0);
  if (dying.length > 0) {
    const best = dying.reduce((a, b) => a.deaths > b.deaths ? a : b);
    awards.push({ title: 'Gravestone Collector', desc: 'Most deaths', winner: best.playerName, value: `${best.deaths}` });
  }

  // 5. MVP — best K/D ratio (min 1 kill)
  const eligible = stats.filter(s => s.kills > 0);
  if (eligible.length > 0) {
    const kd = (s: typeof stats[0]) => s.kills / Math.max(1, s.deaths);
    const best = eligible.reduce((a, b) => kd(a) > kd(b) ? a : b);
    awards.push({ title: 'MVP', desc: 'Best K/D ratio', winner: best.playerName, value: `${kd(best).toFixed(1)}` });
  }

  // 6. Bob the Builder — most buildings constructed
  const builders = stats.filter(s => s.buildingsBuilt > 0);
  if (builders.length > 0) {
    const best = builders.reduce((a, b) => a.buildingsBuilt > b.buildingsBuilt ? a : b);
    awards.push({ title: 'Bob the Builder', desc: 'Most buildings constructed', winner: best.playerName, value: `${best.buildingsBuilt}` });
  }

  // 7. Road Rage — most jeep kills
  const drivers = stats.filter(s => s.jeepKills > 0);
  if (drivers.length > 0) {
    const best = drivers.reduce((a, b) => a.jeepKills > b.jeepKills ? a : b);
    awards.push({ title: 'Road Rage', desc: 'Most vehicle kills', winner: best.playerName, value: `${best.jeepKills}` });
  }

  if (awards.length === 0) return;

  const container = document.createElement('div');
  container.id = 'end-awards';
  container.style.cssText = `
    display:flex; flex-wrap:wrap; justify-content:center; gap:10px;
    margin-top:20px; max-width:700px;
  `;

  for (const award of awards) {
    const card = document.createElement('div');
    card.style.cssText = `
      background:rgba(255,255,255,0.07); border:1px solid #444; border-radius:8px;
      padding:10px 16px; min-width:140px; text-align:center;
      font-family:system-ui,sans-serif;
    `;
    card.innerHTML = `
      <div style="color:#ffd700;font-size:13px;font-weight:bold;letter-spacing:1px;">${award.title}</div>
      <div style="color:#fff;font-size:18px;font-weight:bold;margin:4px 0;">${award.winner}</div>
      <div style="color:#aaa;font-size:12px;">${award.desc}</div>
      <div style="color:#8cf;font-size:14px;margin-top:2px;">${award.value}</div>
    `;
    container.appendChild(card);
  }

  gameOverScreen.appendChild(container);
}

// ===================== Game Loop =====================
// Uses renderer.setAnimationLoop for WebXR compatibility.
// During an XR session, Three.js drives frames via XRSession.requestAnimationFrame.
// Outside XR, it falls back to window.requestAnimationFrame.

let lastTime = performance.now();

function loop(now: number, _xrFrame?: unknown): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const inVR = vrManager.isPresenting;

  if (rtsController) {
    rtsController.isFPSMode = activeRole === 'fps';
    rtsController.activeCamera = activeRole === 'fps' ? sceneManager.camera : rtsController.getCamera();
    rtsController.fpsPlayerEntityId = snapshotRenderer?.localFPSEntityId ?? null;
    rtsController.localLayerId = snapshotRenderer?.localLayerId ?? 0;
    rtsController.tickVisuals(dt);

    if (snapshotRenderer) {
      snapshotRenderer.isFPSMode = activeRole === 'fps';
      snapshotRenderer.update(dt);
    }
  }

  // Update spatial audio listener position
  const sm = SoundManager.instance();
  if (activeRole === 'fps') {
    const p = fpsController.getPosition();
    sm.setListenerPosition(p.x, p.y, p.z, true);
  } else if (activeRole === 'rts') {
    const vc = rtsController.getViewCenter();
    sm.setListenerPosition(vc.x, 0, vc.z, false);
  }
  sm.tickHornCooldown(dt);

  // Animate dying entities (death tip-over + fade)
  if (sceneManager) sceneManager.updateDying(dt);

  // Tick weapon cooldowns even when in RTS mode
  if (fpsController) fpsController.tickCooldowns(dt);

  if (activeRole === 'fps') {
    // Sync wave timer to FPS HUD
    if (rtsController) fpsController.waveTimer = rtsController.getWaveTimer();

    // ---- VR path ----
    if (inVR) {
      // Feed gamepad input to FPS controller
      const gpInput = vrManager.getGamepadInput();
      fpsController.vrGamepadInput = gpInput;

      // Gamepad: right stick horizontal → smooth yaw turn, vertical → aim pitch
      if (gpInput) {
        if (Math.abs(gpInput.lookX) > 0.1) {
          vrManager.addRigYaw(-gpInput.lookX * dt * 2.5);
        }
        if (Math.abs(gpInput.lookY) > 0.1) {
          vrManager.setAimPitch(vrManager.aimPitch - gpInput.lookY * dt * 2.5);
        }
      }
      // Sync aim pitch to FPS controller for shooting calculations
      fpsController.vrAimPitch = vrManager.aimPitch;

      fpsController.update(dt);

      // Sync VR weapon model when weapon changes
      const wpn = fpsController.getActiveWeapon();
      if (wpn.id !== vrWeaponId) {
        vrWeaponId = wpn.id;
        vrManager.setWeaponModel(createWeaponModel(wpn));
      }
      vrManager.setWeaponRecoil(fpsController.isDead ? 0 : 0);

      // Update 3D HUD
      const maxCd = 1 / wpn.fireRate;
      const cdPct = Math.min(1, (fpsController as any).weaponCooldowns?.get?.(wpn.id) ?? 0) / maxCd;
      vrManager.updateHUD(
        fpsController.hp,
        fpsController.maxHp,
        wpn.name,
        cdPct,
        fpsController.isDead,
      );

      // Render (Three.js handles stereo automatically during XR session)
      sceneManager.render();
      // No weapon overlay — weapon is a child of the camera via VR mount

      // Hide DOM overlays in VR (not visible in headset anyway)
      overlay.style.display = 'none';
      crosshair.style.display = 'none';
    } else {
      // ---- Standard flat-screen path ----
      // Poll gamepad for controller support outside VR
      fpsController.vrGamepadInput = vrManager.getGamepadInput();
      fpsController.update(dt);
      sceneManager.renderWith(sceneManager.camera);
      fpsController.renderWeaponView(sceneManager.renderer);
      overlay.style.display = fpsController.isPointerLocked() ? 'none' : 'flex';
      // Hide crosshair for sniper rifle (no hip-fire crosshair — must use scope)
      const activeWpn = fpsController.getActiveWeapon();
      crosshair.style.display = (activeWpn.id === 'sniper_rifle' && fpsController.isPointerLocked()) ? 'none' : crosshair.style.display;
    }
  } else if (activeRole === 'rts') {
    rtsController.updateCamera(dt);
    sceneManager.renderWith(rtsController.getCamera());
  } else if (rtsController?.gameOver) {
    sceneManager.renderWith(rtsController.getCamera());
  } else if (!activeRole && !rtsController) {
    // No game active — render preview background for menus
    updatePreview(dt);
  }

  // Also render preview when on lobby screen (no active game yet)
  if (lobbyScreen.style.display === 'flex' && !activeRole) {
    updatePreview(dt);
  }
}

sharedRenderer.setAnimationLoop(loop);
