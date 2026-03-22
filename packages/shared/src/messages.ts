import type { Vec3, TeamId, Role, HeroType } from './types.js';
import type { MapId } from './maps.js';

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
  command: 'move' | 'attack' | 'harvest' | 'build_at' | 'place_building' | 'repair';
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

export interface RTSUpgradeMsg {
  type: 'rts_upgrade';
  buildingId: string;
  upgradeType: 'barracks_level2' | 'base_upgrade' | 'armory_level2' | 'harvest_boost';
}

export interface ChangeNameMsg {
  type: 'change_name';
  name: string;
}

export interface SelectMapMsg {
  type: 'select_map';
  mapId: MapId;
}

export interface EnterVehicleMsg {
  type: 'enter_vehicle';
  vehicleId: string;
  seat: 'driver' | 'gunner';
}

export interface ExitVehicleMsg {
  type: 'exit_vehicle';
}

export interface VehicleInputMsg {
  type: 'vehicle_input';
  seq: number;
  forward: boolean;
  backward: boolean;
  cameraYaw: number;  // mouse look direction — vehicle steers toward this
  dt: number;
  ascend?: boolean;   // helicopter: Space key
  descend?: boolean;  // helicopter: Shift key
}

export interface HornHonkMsg {
  type: 'horn_honk';
  vehicleId: string;
}

export interface SelectHeroMsg {
  type: 'select_hero';
  heroType: HeroType;
}

export interface HeroAbilityMsg {
  type: 'hero_ability';
  active: boolean;
}

export interface SendChatMsg {
  type: 'send_chat';
  text: string;
  target: 'team' | 'all';
}

export interface CreateRoomMsg {
  type: 'create_room';
  playerName: string;
  roomName: string;
  visibility: 'public' | 'private';
  customCode?: string;
}

export interface SubscribeLobbyMsg {
  type: 'subscribe_lobby';
}

export interface UnsubscribeLobbyMsg {
  type: 'unsubscribe_lobby';
}

export type ClientMessage =
  | JoinRoomMsg
  | SelectRoleMsg
  | ReadyMsg
  | ChangeNameMsg
  | RequestSwapMsg
  | RespondSwapMsg
  | FPSInputMsg
  | FPSShootMsg
  | FPSHitMsg
  | RTSCommandMsg
  | RTSTrainMsg
  | RTSCancelTrainMsg
  | RTSUpgradeMsg
  | SelectMapMsg
  | EnterVehicleMsg
  | ExitVehicleMsg
  | VehicleInputMsg
  | HornHonkMsg
  | SelectHeroMsg
  | HeroAbilityMsg
  | SendChatMsg
  | CreateRoomMsg
  | SubscribeLobbyMsg
  | UnsubscribeLobbyMsg;

// ===================== Server → Client =====================

export interface RoomStateMsg {
  type: 'room_state';
  roomCode: string;
  roomName: string;
  visibility: 'public' | 'private';
  players: { id: string; name: string; team: TeamId | null; role: Role | null; ready: boolean }[];
  status: 'waiting' | 'playing';
  mapId: MapId;
}

export interface LobbyRoomInfo {
  roomCode: string;
  roomName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  mapId: MapId;
}

export interface LobbyListMsg {
  type: 'lobby_list';
  rooms: LobbyRoomInfo[];
}

export interface JoinErrorMsg {
  type: 'join_error';
  reason: string;
}

export interface GameStartMsg {
  type: 'game_start';
  yourTeam: TeamId;
  yourRole: Role;
  fpsEntityId: string | null; // ID of this player's FPS entity (if role is fps)
  mapId: MapId;
  teamPlayerCount: number; // how many humans on this team
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
  playerName?: string;
  level?: number;
  killerEntityId?: string;
  killerName?: string;
  driverId?: string;
  gunnerId?: string;
  heroType?: string;
  heroAbilityActive?: boolean;
  shieldHp?: number;
  abilityCharge?: number;      // current charge (0 to max)
  abilityMaxCharge?: number;   // max charge
  abilityDepleted?: boolean;   // true = in 60s lockout
  abilityLockout?: number;     // remaining lockout seconds
}

export interface SnapshotTrainingQueue {
  baseId: string;
  queue: { elapsed: number; duration: number; unitType?: string }[];
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
  fighterLevel: number;
  harvestBoost?: Record<number, boolean>;
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

export interface PlayerGameStats {
  playerId: string;
  playerName: string;
  shotsFired: number;
  shotsHit: number;
  kills: number;
  friendlyKills: number;
  deaths: number;
  buildingsBuilt: number;
  jeepKills: number;
}

export interface GameOverMsg {
  type: 'game_over';
  winnerTeam: TeamId;
  stats?: PlayerGameStats[];
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
  fpsEntityId?: string | null;
}

export interface VehicleEnteredMsg {
  type: 'vehicle_entered';
  vehicleId: string;
  seat: 'driver' | 'gunner';
}

export interface VehicleExitedMsg {
  type: 'vehicle_exited';
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
  | VehicleEnteredMsg
  | VehicleExitedMsg
  | ErrorMsg
  | LobbyListMsg
  | JoinErrorMsg;
