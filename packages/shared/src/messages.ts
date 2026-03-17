import type { Vec3, TeamId, Role } from './types.js';

// ===================== Client → Server =====================

export interface JoinRoomMsg {
  type: 'join_room';
  roomCode: string;
  playerName: string;
}

export interface SelectRoleMsg {
  type: 'select_role';
  team: TeamId;
  role: Role;
}

export interface ReadyMsg {
  type: 'ready';
}

export interface RequestSwapMsg {
  type: 'request_swap';
}

export interface RespondSwapMsg {
  type: 'respond_swap';
  accepted: boolean;
}

export interface FPSInputMsg {
  type: 'fps_input';
  seq: number;
  keys: { forward: boolean; backward: boolean; left: boolean; right: boolean; jump: boolean };
  yaw: number;
  pitch: number;
  dt: number;
}

export interface FPSShootMsg {
  type: 'fps_shoot';
  weaponId: string;
  origin: Vec3;
  direction: Vec3;
}

export interface FPSHitMsg {
  type: 'fps_hit';
  targetId: string;
  damage: number;
}

export interface RTSCommandMsg {
  type: 'rts_command';
  command: 'move' | 'attack' | 'harvest' | 'build_at' | 'place_building';
  unitIds: string[];
  targetPos?: Vec3;
  targetId?: string;
  buildingType?: string;
}

export interface RTSTrainMsg {
  type: 'rts_train';
  baseId: string;
  unitType: string;
}

export interface RTSCancelTrainMsg {
  type: 'rts_cancel_train';
  baseId: string;
  index: number;
}

export type ClientMessage =
  | JoinRoomMsg
  | SelectRoleMsg
  | ReadyMsg
  | RequestSwapMsg
  | RespondSwapMsg
  | FPSInputMsg
  | FPSShootMsg
  | FPSHitMsg
  | RTSCommandMsg
  | RTSTrainMsg
  | RTSCancelTrainMsg;

// ===================== Server → Client =====================

export interface RoomStateMsg {
  type: 'room_state';
  roomCode: string;
  players: { id: string; name: string; team: TeamId | null; role: Role | null; ready: boolean }[];
  status: 'waiting' | 'playing';
}

export interface GameStartMsg {
  type: 'game_start';
  yourTeam: TeamId;
  yourRole: Role;
  fpsEntityId: string | null; // ID of this player's FPS entity (if role is fps)
}

export interface SnapshotEntity {
  id: string;
  entityType: string;
  position: Vec3;
  rotation: Vec3;
  teamId: TeamId;
  hp: number;
  maxHp: number;
  status: 'active' | 'constructing';
  constructionProgress: number;
}

export interface SnapshotTrainingQueue {
  baseId: string;
  queue: { elapsed: number; duration: number }[];
}

export interface SnapshotMsg {
  type: 'snapshot';
  tick: number;
  entities: SnapshotEntity[];
  teamResources: Record<number, number>;
  teamSupply: Record<number, { used: number; cap: number }>;
  trainingQueues: Record<number, SnapshotTrainingQueue[]>; // by team
  waveTimer: number;
  gameTime: number;
}

export interface FPSCorrectionMsg {
  type: 'fps_correction';
  seq: number;
  position: Vec3;
  velocity: Vec3;
}

export interface HitConfirmMsg {
  type: 'hit_confirm';
  targetId: string;
  damage: number;
  killed: boolean;
}

export interface GameOverMsg {
  type: 'game_over';
  winnerTeam: TeamId;
}

export interface PlayerDiedMsg {
  type: 'player_died';
  playerId: string;
  respawnAt: number;
}

export interface PlayerRespawnedMsg {
  type: 'player_respawned';
  playerId: string;
  position: Vec3;
}

export interface ChatMsg {
  type: 'chat';
  from: string;
  text: string;
}

export interface SwapRequestMsg {
  type: 'swap_request';
  fromPlayer: string;
  fromRole: Role;
  toRole: Role;
}

export interface SwapResultMsg {
  type: 'swap_result';
  accepted: boolean;
  newRole?: Role;
}

export interface ErrorMsg {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | RoomStateMsg
  | GameStartMsg
  | SnapshotMsg
  | FPSCorrectionMsg
  | HitConfirmMsg
  | GameOverMsg
  | PlayerDiedMsg
  | PlayerRespawnedMsg
  | SwapRequestMsg
  | SwapResultMsg
  | ChatMsg
  | ErrorMsg;
