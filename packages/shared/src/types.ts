export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  yaw: number;
  pitch: number;
  dt: number;
}

export type TeamId = 1 | 2;
export type Role = 'fps' | 'rts';
export type EntityId = string;

export type EntityType = 'fps_player' | 'building' | 'enemy' | 'resource_node';
export type BuildingType = 'main_base' | 'tower' | 'barracks' | 'armory';

export interface Entity {
  id: EntityId;
  type: EntityType;
  position: Vec3;
  rotation: Vec3;
  teamId: TeamId;
  hp: number;
  maxHp: number;
}

export interface FPSPlayer extends Entity {
  type: 'fps_player';
  velocity: Vec3;
  activeWeapon: string;
  unlockedWeapons: string[];
  isDead: boolean;
  respawnTimer: number;
  armor: number;
}

export interface Building extends Entity {
  type: 'building';
  buildingType: BuildingType;
  constructionProgress: number;
  isVulnerable: boolean;
}

export interface Enemy extends Entity {
  type: 'enemy';
  targetId: EntityId | null;
  damage: number;
  attackCooldown: number;
  difficultyTier: number;
}

export interface ResourceNode extends Entity {
  type: 'resource_node';
  remaining: number;
  harvestingTeam: TeamId | null;
}
