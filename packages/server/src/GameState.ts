import { v4 as uuid } from 'uuid';
import type { Vec3, TeamId } from '@dyarchy/shared';
import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  GROUND_Y,
  HERO_ABILITY_MAX_CHARGE,
  HERO_ABILITY_RECHARGE_MULT,
  HERO_DEPLETED_LOCKOUT,
  SHIELD_MAX_HP,
  SHIELD_RADIUS,
  HEAL_AURA_RADIUS,
  REPAIR_AURA_RADIUS,
  AURA_HEAL_RATE,
  AURA_TICK_INTERVAL,
  HELI_HP,
  HELI_COST,
  HELI_TRAIN_TIME,
  HELI_SUPPLY_COST,
  HELI_MAX_SPEED,
  HELI_ACCELERATION,
  HELI_BRAKE_FORCE,
  HELI_REVERSE_MAX,
  HELI_TURN_RATE,
  HELI_FRICTION,
  HELI_ASCEND_SPEED,
  HELI_DESCEND_SPEED,
  HELI_HOVER_DRIFT,
  HELI_MAX_ALTITUDE,
  HELI_COLLISION_RADIUS,
  HELI_TURRET_FIRE_RATE,
  HELI_TURRET_DAMAGE,
  HELI_TURRET_RANGE,
} from '@dyarchy/shared';
import { applyMovement, vec3 } from '@dyarchy/shared';
import type { SnapshotEntity, FPSInputMsg, MapId } from '@dyarchy/shared';
import { type MapConfig, getMapConfig, MEADOW_MAP, HeightmapGrid, dist3D } from '@dyarchy/shared';

// ===================== Entity Types =====================

export interface Entity {
  id: string;
  entityType: string;
  position: Vec3;
  rotation: Vec3;
  teamId: TeamId;
  hp: number;
  maxHp: number;
  status: 'active' | 'constructing';
  constructionProgress: number;
  level?: number;
  layerId: number; // 0 = surface, >0 = underground tunnel layer
}

export interface FPSPlayerEntity extends Entity {
  entityType: 'fps_player';
  velocity: Vec3;
  isDead: boolean;
  respawnTimer: number;
  activeWeapon: string;
  secondaryWeapon: string | null;
  armoryUnlocked: boolean;
  lastDamagedBy: string | null;
  rtsMoveTarget: Vec3 | null; // set by RTS player commands
  // Hero system
  heroType: string | null;
  heroAbilityActive: boolean;
  heroAbilityCharge: number;       // 0 to HERO_ABILITY_MAX_CHARGE
  heroAbilityDepleted: boolean;    // fully depleted = 60s lockout
  heroAbilityLockout: number;      // remaining lockout timer
  shieldHp: number;
  auraTickTimer: number;
  lastDamageTime: number; // game time when last damaged (for regen delay)
}

export interface WorkerEntity extends Entity {
  entityType: 'worker';
  state: string;
  targetId: string | null;
  buildTargetId: string | null;
  buildQueue: string[]; // queued building IDs to construct after current
  movePoint: Vec3 | null;
  harvestTimer: number;
  carriedCrystals: number;
  attackTimer: number;
  followTargetId: string | null;
}

export interface FighterEntity extends Entity {
  entityType: 'fighter';
  state: string;
  assignedTargetId: string | null;
  currentEnemyId: string | null;
  attackTimer: number;
  movePoint: Vec3 | null;
  followTargetId: string | null;
}

export interface FootSoldierEntity extends Entity {
  entityType: 'foot_soldier';
  state: string;
  assignedTargetId: string | null;
  currentEnemyId: string | null;
  attackTimer: number;
  movePoint: Vec3 | null;
  guardPosition: Vec3;
  followTargetId: string | null;
}

export interface ArcherEntity extends Entity {
  entityType: 'archer';
  state: string;
  assignedTargetId: string | null;
  currentEnemyId: string | null;
  attackTimer: number;
  movePoint: Vec3 | null;
  guardPosition: Vec3;
  followTargetId: string | null;
}

export interface JeepEntity extends Entity {
  entityType: 'jeep';
  velocity: Vec3;
  heading: number;        // yaw in radians
  speed: number;          // signed speed along heading
  onGround: boolean;
  driverId: string | null;
  gunnerId: string | null;
  rtsMoveTarget: Vec3 | null;
  // 180-turn overshoot state
  uturnOvershoot: number;        // remaining overshoot radians (0 = inactive)
  uturnOvershootDir: number;     // +1 or -1
  collisionCooldown: number;     // seconds until next building collision damage
}

export interface HelicopterEntity extends Entity {
  entityType: 'helicopter';
  velocity: Vec3;
  heading: number;
  speed: number;          // horizontal speed along heading
  driverId: string | null;
  rtsMoveTarget: Vec3 | null;
  collisionCooldown: number;
  inputThisTick: boolean; // true if applyHelicopterInput was called this tick
}

export interface TrainingSlot {
  elapsed: number;
  duration: number;
  unitType: 'worker' | 'foot_soldier' | 'archer' | 'jeep' | 'helicopter' | 'upgrade_base' | 'upgrade_barracks' | 'upgrade_armory' | 'upgrade_armory_l3' | 'upgrade_tower' | 'upgrade_harvest' | 'upgrade_hero_hp' | 'upgrade_hero_dmg' | 'upgrade_hero_regen';
}

export interface TrainingQueue {
  baseId: string;
  teamId: TeamId;
  queue: TrainingSlot[];
}

// ===================== Constants =====================

const WAVE_INTERVAL = 30;
const FIGHTERS_PER_WAVE = 10;
const MAX_FIGHTERS_PER_TEAM = 30;
const FIGHTER_HP = 30;
const FIGHTER_SPEED = 5;
const FIGHTER_DAMAGE_UNIT = 5;
const FIGHTER_DAMAGE_BUILDING = 1;
const FIGHTER_ATTACK_INTERVAL = 1;
const FIGHTER_ATTACK_RANGE = 2.8;
const FIGHTER_AGGRO_RANGE = 12;

const WORKER_SPEED = 8;
const WORKER_HARVEST_TIME = 5;
const WORKER_HARVEST_AMOUNT = 10;
const WORKER_DAMAGE = 1;
const WORKER_ATTACK_INTERVAL = 2;
const WORKER_ATTACK_RANGE = 2.8;
const WORKER_COST = 100;
const WORKER_TRAIN_TIME = 3;
const WORKER_SUPPLY_COST = 1;
const MAX_TRAINING_QUEUE = 5;
const CONSTRUCTION_TIME = 10;
const FARM_SUPPLY_BONUS = 5;

const REPAIR_RATE = 10; // HP per second per worker repairing

const BUILDING_COSTS: Record<string, number> = {
  barracks: 150, armory: 300, tower: 500, turret: 200, sniper_nest: 250, farm: 24, garage: 300, main_base: 1000, hero_academy: 400,
};

// Hero Academy upgrade costs per level
const HERO_HP_COSTS = [200, 500, 1000];
const HERO_HP_MULT = [1.25, 2.0, 3.0]; // multiplier at each level
const HERO_DMG_COSTS = [200, 500, 1000];
const HERO_DMG_MULT = [1.25, 2.0, 3.0];
const HERO_REGEN_COST = 1000;
const HERO_REGEN_DELAY = 7; // seconds without damage before regen starts
const HERO_REGEN_RATE = 0.02; // 2% maxHp per second

const BUILDING_CONSTRUCTION_TIME: Record<string, number> = {
  garage: CONSTRUCTION_TIME * 2, // 20s
  main_base: CONSTRUCTION_TIME * 2, // 20s
  hero_academy: CONSTRUCTION_TIME * 1.5, // 15s
};

// Tower turret
const TOWER_RANGE = 25;
const TOWER_DAMAGE = 4;
const TOWER_FIRE_RATE = 1.5; // seconds between shots
const TOWER_FPS_PRIORITY_RANGE = 30; // prioritize FPS player within this range

const BUILDING_RADII: Record<string, number> = {
  main_base: 5, tower: 3, barracks: 3.5, armory: 3.5, player_tower: 2.5, turret: 1.5, sniper_nest: 1.5, farm: 2.5, garage: 4, hero_academy: 4,
};

// Collision boxes for FPS player vs buildings (must match client-side values)
const BUILDING_COLLISION: Record<string, { hx: number; hy: number; hz: number; cy: number }> = {
  main_base: { hx: 4, hy: 3, hz: 4, cy: 3 },
  tower: { hx: 2, hy: 4, hz: 2, cy: 4 },
  barracks: { hx: 3, hy: 2, hz: 3, cy: 2 },
  armory: { hx: 3, hy: 2, hz: 3, cy: 2 },
  player_tower: { hx: 2.5, hy: 4, hz: 2.5, cy: 4 },
  turret: { hx: 1.5, hy: 1.5, hz: 1.5, cy: 1 },
  // sniper_nest has no solid collision — it's an open structure with a ladder
  farm: { hx: 2.5, hy: 2, hz: 2.5, cy: 2 },
  garage: { hx: 3.5, hy: 2.5, hz: 3, cy: 2.5 },
  hero_academy: { hx: 3.5, hy: 3, hz: 3.5, cy: 3 },
};

const FOOT_SOLDIER_HP = 60;
const FOOT_SOLDIER_SPEED = 6;
const FOOT_SOLDIER_DAMAGE = 8; // matches pistol damage
const FOOT_SOLDIER_ATTACK_INTERVAL = 0.8;
const FOOT_SOLDIER_ATTACK_RANGE = 2.8;
const FOOT_SOLDIER_AGGRO_RANGE = 8;
const FOOT_SOLDIER_COST = 100;
const FOOT_SOLDIER_TRAIN_TIME = 5;
const FOOT_SOLDIER_SUPPLY_COST = 1;
const BARRACKS_UPGRADE_COST = 500;

const ARCHER_HP = 40;
const ARCHER_SPEED = 5;
const ARCHER_DAMAGE = 12;
const ARCHER_ATTACK_INTERVAL = 1.5;
const ARCHER_ATTACK_RANGE = 25; // reduced range
const ARCHER_AGGRO_RANGE = 40;
const ARCHER_COST = 150;
const ARCHER_TRAIN_TIME = 6;
const ARCHER_SUPPLY_COST = 1;

// Jeep vehicle
const JEEP_HP = 200;
const JEEP_COST = 500;
const JEEP_TRAIN_TIME = 10;
const JEEP_SUPPLY_COST = 3;
const JEEP_MAX_SPEED = 35;
const JEEP_ACCELERATION = 20;
const JEEP_BRAKE_FORCE = 25;
const JEEP_REVERSE_MAX = 10;
const JEEP_TURN_RATE = 2.2;       // rad/s at full steering
const JEEP_FRICTION = 17.5;        // coast-to-stop drag (~2s from max speed)
const JEEP_LATERAL_GRIP = 4.0;     // how fast lateral velocity decays (lower = more drift)
const JEEP_DRIFT_SPEED_MIN = 15;   // minimum speed to trigger fishtail drift
const JEEP_DRIFT_ANGLE_THRESHOLD = 20 * Math.PI / 180; // 20 degrees — triggers drift mode
const JEEP_DRIFT_GRIP = 1.2;      // reduced lateral grip during drift (more sliding)
const JEEP_SHARP_TURN_THRESHOLD = 60 * Math.PI / 180; // 60 degrees — over-rotate on really sharp turns
const JEEP_GRAVITY = -25;
const JEEP_COLLISION_RADIUS = 2.5;
const JEEP_DAMAGE_SPEED_MIN = 8;   // minimum speed to deal damage
const JEEP_DAMAGE_MULTIPLIER = 5;  // damage = speed * multiplier
const JEEP_UTURN_SPEED_MIN = 30;   // minimum speed to trigger 180-turn overshoot
const JEEP_UTURN_ANGLE_MIN = 160 * Math.PI / 180;  // 160 degrees
const JEEP_UTURN_ANGLE_MAX = 190 * Math.PI / 180;  // 190 degrees
const JEEP_UTURN_OVERSHOOT = 15 * Math.PI / 180;   // 15 degrees overshoot
const JEEP_UTURN_CORRECTION_RATE = 3.0;             // rad/s to correct back

const MOBILE_TYPES = new Set(['fighter', 'worker', 'fps_player', 'foot_soldier', 'archer', 'jeep', 'helicopter']);
const RESPAWN_TIME = 7;

type StaticObstacle = { cx: number; cz: number; hx: number; hz: number; hy: number; cy: number };

function buildStaticObstacles(config: MapConfig): StaticObstacle[] {
  const obstacles: StaticObstacle[] = [];
  for (const pos of config.obstacles) {
    obstacles.push({ cx: pos.x, cz: pos.z, hx: 1.5, hz: 1.5, hy: 1.5, cy: 1.5 });
  }
  for (const veg of config.vegetation) {
    if (veg.type === 'tree') {
      obstacles.push({ cx: veg.pos.x, cz: veg.pos.z, hx: 1.5, hz: 1.5, hy: 4, cy: 3 });
    } else {
      obstacles.push({ cx: veg.pos.x, cz: veg.pos.z, hx: 1.2, hz: 1.2, hy: 1, cy: 1 });
    }
  }
  for (const t of config.edgeTrees) {
    obstacles.push({ cx: t.x, cz: t.z, hx: 1.5, hz: 1.5, hy: 4, cy: 3 });
  }
  return obstacles;
}

// ===================== Game State =====================

export class GameState {
  entities = new Map<string, Entity>();
  teamResources: Record<number, number> = { 1: 1000, 2: 1000 };
  teamSupply: Record<number, { used: number; cap: number }> = {
    1: { used: 2, cap: 10 },
    2: { used: 2, cap: 10 },
  };
  trainingQueues = new Map<string, TrainingQueue>();
  towerTurrets = new Map<string, { targetId: string | null; fireCooldown: number }>();
  waveTimer = 90; // first wave at 1.5 minutes
  wavesDisabled: Record<number, boolean> = { 1: false, 2: false };
  unitsFrozen = false;
  instantBuild = false;
  turboJeep = false;
  harvestBoost: Record<number, boolean> = { 1: false, 2: false };
  // Hero Academy upgrades per team
  heroHpLevel: Record<number, number> = { 1: 0, 2: 0 };    // 0-3
  heroDmgLevel: Record<number, number> = { 1: 0, 2: 0 };   // 0-3
  heroRegen: Record<number, boolean> = { 1: false, 2: false };
  // Armory level 3 (independent from rockets) unlocks unit upgrades
  armoryLevel3: Record<number, boolean> = { 1: false, 2: false };
  // unitUpgradeLevel tracks per-team unit upgrade tier (0, 1, 2)
  unitUpgradeLevel: Record<number, number> = { 1: 0, 2: 0 };
  // Maps resource_node ID → closest main_base ID, per team
  private nodeBaseAssignment: Record<number, Map<string, string>> = { 1: new Map(), 2: new Map() };
  gameTime = 0;
  tick = 0;
  winner: TeamId | null = null;
  private fighterCounter = 0;
  readonly mapConfig: MapConfig;
  readonly heightmap: HeightmapGrid;
  private readonly staticObstacles: StaticObstacle[];
  private readonly mapBounds: { halfW: number; halfD: number };

  constructor(mapId: MapId = 'meadow') {
    this.mapConfig = getMapConfig(mapId);
    this.heightmap = new HeightmapGrid(this.mapConfig);
    this.staticObstacles = buildStaticObstacles(this.mapConfig);
    this.mapBounds = { halfW: this.mapConfig.width / 2, halfD: this.mapConfig.depth / 2 };
    this.initMap();
  }

  private initMap(): void {
    for (const teamId of [1, 2] as const) {
      const buildings = this.mapConfig.initialBuildings[teamId];
      const baseId = uuid();
      this.addEntity({
        id: baseId, entityType: 'main_base',
        position: { x: buildings.mainBase.x, y: this.heightmap.getHeight(buildings.mainBase.x, buildings.mainBase.z), z: buildings.mainBase.z }, rotation: vec3(),
        teamId, hp: 100, maxHp: 100,
        status: 'active', constructionProgress: 1,
      });
      // HQ has a turret with 75% more range than standard towers
      this.towerTurrets.set(baseId, { targetId: null, fireCooldown: 0 });

      for (const tPos of buildings.towers) {
        const towerId = uuid();
        this.addEntity({
          id: towerId, entityType: 'tower',
          position: { x: tPos.x, y: this.heightmap.getHeight(tPos.x, tPos.z), z: tPos.z }, rotation: vec3(),
          teamId, hp: 400, maxHp: 400,
          status: 'active', constructionProgress: 1,
        });
        this.towerTurrets.set(towerId, { targetId: null, fireCooldown: 0 });
      }
    }

    for (const pos of this.mapConfig.resourceNodes) {
      this.addEntity({
        id: uuid(), entityType: 'resource_node',
        position: { x: pos.x, y: this.heightmap.getHeight(pos.x, pos.z), z: pos.z }, rotation: vec3(),
        teamId: 1, hp: 3000, maxHp: 3000,
        status: 'active', constructionProgress: 1,
      });
    }

    // Starting workers for both teams
    for (const teamId of [1, 2] as const) {
      const base = this.getTeamBase(teamId);
      if (base) {
        this.spawnWorker(teamId, base.position);
        this.spawnWorker(teamId, base.position);
      }
    }
    this.reassignCrystalNodes();
  }

  addEntity(entity: Omit<Entity, 'layerId'> & { layerId?: number }): void {
    const e = entity as Entity;
    if (e.layerId === undefined) e.layerId = 0;
    this.entities.set(e.id, e);
  }

  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  /** Assign each crystal node to the closest alive HQ for each team. */
  reassignCrystalNodes(): void {
    for (const teamId of [1, 2] as const) {
      const bases = [...this.entities.values()].filter(
        e => e.entityType === 'main_base' && e.teamId === teamId && e.hp > 0 && e.status === 'active',
      );
      const map = new Map<string, string>();
      for (const node of this.entities.values()) {
        if (node.entityType !== 'resource_node' || node.hp <= 0) continue;
        let closestBase: Entity | undefined;
        let closestDist = Infinity;
        for (const base of bases) {
          const d = this.distXZ(node.position, base.position);
          if (d < closestDist) { closestDist = d; closestBase = base; }
        }
        if (closestBase) map.set(node.id, closestBase.id);
      }
      this.nodeBaseAssignment[teamId] = map;
    }
  }

  /** Get the base a worker should return crystals to, based on the node they're mining. */
  getReturnBase(worker: WorkerEntity): Entity | undefined {
    const nodeId = worker.targetId;
    if (nodeId) {
      const baseId = this.nodeBaseAssignment[worker.teamId]?.get(nodeId);
      if (baseId) {
        const base = this.entities.get(baseId);
        if (base && base.hp > 0 && base.status === 'active') return base;
      }
    }
    // Fallback: closest base
    return this.getTeamBase(worker.teamId, worker.position);
  }

  getTeamBase(teamId: TeamId, nearPos?: Vec3): Entity | undefined {
    let closest: Entity | undefined;
    let closestDist = Infinity;
    for (const e of this.entities.values()) {
      if (e.entityType === 'main_base' && e.teamId === teamId && e.hp > 0 && e.status === 'active') {
        if (!nearPos) return e; // no position preference — return first
        const d = this.distXZ(e.position, nearPos);
        if (d < closestDist) { closestDist = d; closest = e; }
      }
    }
    return closest;
  }

  getEntitiesByType(type: string, teamId?: TeamId): Entity[] {
    const result: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.entityType === type && (teamId === undefined || e.teamId === teamId)) result.push(e);
    }
    return result;
  }

  // ===================== Full Tick =====================

  updateAll(dt: number): void {
    this.gameTime += dt;
    this.tick++;
    this.updateWaves(dt);
    this.updateFighters(dt);
    this.updateWorkers(dt);
    this.separateUnits();
    this.updateTowerTurrets(dt);
    this.updateConstruction(dt);
    this.updateTraining(dt);
    this.updateFPSRespawns(dt);
    this.updateHeroAbilities(dt);
    this.updateFPSRtsMoves(dt);
    this.updateVehicles(dt);
    this.updatePortalTransitions();
    this.cleanupDead();
    this.checkWinCondition();
  }

  /** Move FPS players toward their RTS-assigned move targets at walking speed */
  private updateFPSRtsMoves(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'fps_player') continue;
      const fps = entity as FPSPlayerEntity;
      if (!fps.rtsMoveTarget || fps.isDead) continue;

      const dx = fps.rtsMoveTarget.x - fps.position.x;
      const dz = fps.rtsMoveTarget.z - fps.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 1) {
        // Arrived
        fps.rtsMoveTarget = null;
        fps.velocity = { x: 0, y: 0, z: 0 };
      } else {
        // Walk toward target at PLAYER_SPEED
        const speed = 12; // matches PLAYER_SPEED from shared constants
        const moveDist = Math.min(speed * dt, dist);
        fps.position.x += (dx / dist) * moveDist;
        fps.position.z += (dz / dist) * moveDist;
        // Keep Y at player height
        fps.position.y = PLAYER_HEIGHT;
      }
    }
  }

  /** Push overlapping mobile units apart so they don't stack on top of each other.
   *  Only separates same-team units — enemies are allowed to get close for combat. */
  /** Apply upgrade to ALL buildings of a type on a team + future builds */
  private applyGlobalUpgrade(teamId: TeamId, entityType: string, targetLevel: number): void {
    // Also match player_tower when upgrading tower-type buildings
    const towerTypes = new Set(['tower', 'player_tower', 'turret']);
    const matchTypes = towerTypes.has(entityType) ? towerTypes : new Set([entityType]);

    for (const ent of this.entities.values()) {
      if (ent.teamId !== teamId || !matchTypes.has(ent.entityType)) continue;
      if (ent.hp <= 0) continue;
      const oldLevel = ent.level ?? 1;
      if (oldLevel >= targetLevel) continue;
      ent.level = targetLevel;
      // Tower upgrade: first upgrade doubles HP
      if (towerTypes.has(ent.entityType) && oldLevel === 1 && targetLevel >= 2) {
        ent.maxHp *= 2;
        ent.hp = ent.maxHp;
      } else if (towerTypes.has(ent.entityType)) {
        ent.hp = ent.maxHp; // heal to full on subsequent upgrades
      }
    }
  }

  private separateUnits(): void {
    const SAME_TEAM_RADIUS = 1.2;
    const ENEMY_RADIUS = 0.5; // smaller — just prevent exact overlap

    // Collect IDs of FPS players inside vehicles — they should be skipped entirely
    const inVehicleIds = new Set<string>();
    for (const e of this.entities.values()) {
      if (e.entityType === 'jeep') {
        const j = e as JeepEntity;
        if (j.driverId) inVehicleIds.add(j.driverId);
        if (j.gunnerId) inVehicleIds.add(j.gunnerId);
      } else if (e.entityType === 'helicopter') {
        const h = e as HelicopterEntity;
        if (h.driverId) inVehicleIds.add(h.driverId);
      }
    }

    const mobiles: Entity[] = [];
    for (const e of this.entities.values()) {
      if (!MOBILE_TYPES.has(e.entityType) || e.hp <= 0) continue;
      // Skip FPS players who are inside a vehicle (their position is managed by the vehicle)
      if (inVehicleIds.has(e.id)) continue;
      // Skip helicopters and jeeps — vehicles shouldn't be pushed by unit separation
      if (e.entityType === 'helicopter' || e.entityType === 'jeep') continue;
      mobiles.push(e);
    }

    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < mobiles.length; i++) {
        const a = mobiles[i];
        for (let j = i + 1; j < mobiles.length; j++) {
          const b = mobiles[j];

          // Skip separation between a jeep and its own passengers (shouldn't be in list, but guard)
          if (a.entityType === 'jeep' && inVehicleIds.has(b.id)) continue;
          if (b.entityType === 'jeep' && inVehicleIds.has(a.id)) continue;
          // Entities on different layers don't collide
          if (a.layerId !== b.layerId) continue;

          const sameTeam = a.teamId === b.teamId;
          const radius = sameTeam ? SAME_TEAM_RADIUS : ENEMY_RADIUS;
          const minDist = radius * 2;

          const dx = a.position.x - b.position.x;
          const dz = a.position.z - b.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist < minDist && dist > 0.001) {
            const overlap = minDist - dist;
            const nx = dx / dist;
            const nz = dz / dist;
            const push = overlap * 0.5;
            a.position.x += nx * push;
            a.position.z += nz * push;
            b.position.x -= nx * push;
            b.position.z -= nz * push;
          } else if (dist <= 0.001) {
            const angle = Math.random() * Math.PI * 2;
            a.position.x += Math.cos(angle) * 0.5;
            a.position.z += Math.sin(angle) * 0.5;
          }
        }
      }
    }

    // Push mobile units out of buildings (skip workers building/repairing their target)
    for (const mobile of mobiles) {
      if (mobile.entityType === 'fps_player') continue; // FPS has its own collision in applyFPSInput

      // Check if this worker needs to reach a specific building (build, repair, or return crystals)
      const workerExemptIds = new Set<string>();
      if (mobile.entityType === 'worker') {
        const w = mobile as WorkerEntity;
        if ((w.state === 'building' || w.state === 'moving_to_build') && w.buildTargetId) {
          workerExemptIds.add(w.buildTargetId);
        }
        if ((w.state === 'repairing' || w.state === 'moving_to_repair') && w.targetId) {
          workerExemptIds.add(w.targetId);
        }
        // Workers returning crystals need to reach their assigned base
        if (w.state === 'returning') {
          const base = this.getReturnBase(w);
          if (base) workerExemptIds.add(base.id);
        }
      }

      for (const building of this.entities.values()) {
        const col = BUILDING_COLLISION[building.entityType];
        if (!col || building.hp <= 0) continue;
        // Don't push worker away from buildings they need to reach
        if (workerExemptIds.has(building.id)) continue;
        const overlapX = (1.0 + col.hx) - Math.abs(mobile.position.x - building.position.x);
        const overlapZ = (1.0 + col.hz) - Math.abs(mobile.position.z - building.position.z);
        if (overlapX > 0 && overlapZ > 0) {
          if (overlapX < overlapZ) {
            mobile.position.x += mobile.position.x > building.position.x ? overlapX : -overlapX;
          } else {
            mobile.position.z += mobile.position.z > building.position.z ? overlapZ : -overlapZ;
          }
        }
      }
      // Also push out of static obstacles (trees, rocks, cover)
      for (const obs of this.staticObstacles) {
        const overlapX = (1.0 + obs.hx) - Math.abs(mobile.position.x - obs.cx);
        const overlapZ = (1.0 + obs.hz) - Math.abs(mobile.position.z - obs.cz);
        if (overlapX > 0 && overlapZ > 0) {
          if (overlapX < overlapZ) {
            mobile.position.x += mobile.position.x > obs.cx ? overlapX : -overlapX;
          } else {
            mobile.position.z += mobile.position.z > obs.cz ? overlapZ : -overlapZ;
          }
        }
      }
    }
  }

  // ===================== FPS Player =====================

  spawnFPSPlayer(teamId: TeamId): FPSPlayerEntity {
    const spawn = this.mapConfig.teamSpawns[teamId];
    const player: FPSPlayerEntity = {
      id: uuid(), entityType: 'fps_player',
      position: { x: spawn.x, y: this.heightmap.getHeight(spawn.x, spawn.z) + PLAYER_HEIGHT, z: spawn.z },
      rotation: vec3(), teamId,
      hp: 100, maxHp: 100,
      status: 'active', constructionProgress: 1,
      velocity: vec3(), isDead: false, respawnTimer: 0,
      activeWeapon: 'pistol', secondaryWeapon: null, armoryUnlocked: false,
      lastDamagedBy: null,
      rtsMoveTarget: null,
      heroType: null, heroAbilityActive: false, heroAbilityCharge: HERO_ABILITY_MAX_CHARGE,
      heroAbilityDepleted: false, heroAbilityLockout: 0, shieldHp: 0, auraTickTimer: 0,
      lastDamageTime: -999,
      layerId: 0,
    };
    this.addEntity(player);
    return player;
  }

  applyFPSInput(playerId: string, input: FPSInputMsg): Vec3 | null {
    const player = this.entities.get(playerId) as FPSPlayerEntity | undefined;
    if (!player || player.isDead) return null;

    // Ground height at current position (terrain for surface, tunnel floor for underground)
    const terrainY = this.getEntityGroundY(player);

    // Check if player is on a sniper nest platform — use platform as ground level
    const PLAT_H = 9.5;
    let platformOffset = 0;
    const playerFeetY = player.position.y - PLAYER_HEIGHT;
    for (const ent of this.entities.values()) {
      if (ent.entityType !== 'sniper_nest' || ent.hp <= 0) continue;
      const dx = player.position.x - ent.position.x;
      const dz = player.position.z - ent.position.z;
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2 && playerFeetY >= terrainY + PLAT_H - 1 && playerFeetY <= terrainY + PLAT_H + 3) {
        platformOffset = PLAT_H;
        break;
      }
    }

    const groundY = terrainY + platformOffset;

    // Enemy tank shield slow: 66% reduction to movement speed
    const fpsShieldSlow = this.isInsideEnemyShield(player) ? 0.34 : 1;
    const effectiveDt = input.dt * fpsShieldSlow;

    const result = applyMovement(
      { x: player.position.x, y: player.position.y - PLAYER_HEIGHT, z: player.position.z },
      player.velocity,
      {
        forward: input.keys.forward, backward: input.keys.backward,
        left: input.keys.left, right: input.keys.right,
        jump: input.keys.jump, yaw: input.yaw, pitch: input.pitch, dt: effectiveDt,
      },
      effectiveDt,
      this.mapBounds,
      groundY,
    );

    let newX = result.position.x;
    let newZ = result.position.z;

    // Apply building collision (matching client-side FPSController collision)
    for (const entity of this.entities.values()) {
      const col = BUILDING_COLLISION[entity.entityType];
      if (!col || entity.hp <= 0) continue;

      const overlapX = (PLAYER_RADIUS + col.hx) - Math.abs(newX - entity.position.x);
      const overlapZ = (PLAYER_RADIUS + col.hz) - Math.abs(newZ - entity.position.z);
      const overlapY = (PLAYER_HEIGHT + col.hy) - Math.abs(result.position.y + PLAYER_HEIGHT / 2 - col.cy);

      if (overlapX > 0 && overlapZ > 0 && overlapY > 0) {
        if (overlapX < overlapZ) newX += newX > entity.position.x ? overlapX : -overlapX;
        else newZ += newZ > entity.position.z ? overlapZ : -overlapZ;
      }
    }

    // Apply static obstacle collision (trees, rocks, cover cubes)
    for (const obs of this.staticObstacles) {
      const overlapX = (PLAYER_RADIUS + obs.hx) - Math.abs(newX - obs.cx);
      const overlapZ = (PLAYER_RADIUS + obs.hz) - Math.abs(newZ - obs.cz);
      const overlapY = (PLAYER_HEIGHT + obs.hy) - Math.abs(result.position.y + PLAYER_HEIGHT / 2 - obs.cy);

      if (overlapX > 0 && overlapZ > 0 && overlapY > 0) {
        if (overlapX < overlapZ) newX += newX > obs.cx ? overlapX : -overlapX;
        else newZ += newZ > obs.cz ? overlapZ : -overlapZ;
      }
    }

    // Snap to terrain at new position (handles walking uphill/downhill)
    const newTerrainY = this.getEntityGroundY(player, newX, newZ);
    let newY = result.position.y;
    let vy = result.velocity.y;
    if (result.onGround || newY < newTerrainY) {
      newY = newTerrainY + platformOffset;
      if (vy < 0) vy = 0;
    }

    player.position = { x: newX, y: newY + PLAYER_HEIGHT, z: newZ };
    player.velocity = { ...result.velocity, y: vy };
    player.rotation = { x: input.pitch, y: input.yaw, z: 0 };
    return player.position;
  }

  private updateFPSRespawns(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'fps_player') continue;
      const fps = entity as FPSPlayerEntity;

      // Detect death: HP dropped to 0 but not yet marked dead
      if (fps.hp <= 0 && !fps.isDead) {
        fps.isDead = true;
        fps.respawnTimer = RESPAWN_TIME;
        fps.hp = 0;
        // Reset hero state on death
        fps.heroType = null;
        fps.heroAbilityActive = false;
        fps.heroAbilityCharge = HERO_ABILITY_MAX_CHARGE;
        fps.heroAbilityDepleted = false;
        fps.heroAbilityLockout = 0;
        fps.shieldHp = 0;
        fps.auraTickTimer = 0;
        // Eject from vehicle on death
        this.exitVehicle(fps.id);
      }

      // Auto health regen (Hero Academy upgrade)
      if (!fps.isDead && fps.hp > 0 && fps.hp < fps.maxHp && this.heroRegen[fps.teamId]) {
        if (this.gameTime - fps.lastDamageTime >= HERO_REGEN_DELAY) {
          fps.hp = Math.min(fps.maxHp, Math.ceil(fps.hp + fps.maxHp * HERO_REGEN_RATE * dt));
        }
      }

      // Count down respawn
      if (fps.isDead) {
        fps.respawnTimer -= dt;
        if (fps.respawnTimer <= 0) {
          const spawn = this.mapConfig.teamSpawns[fps.teamId];
          fps.isDead = false;
          // Apply Hero Academy HP multiplier
          const hpLevel = this.heroHpLevel[fps.teamId] ?? 0;
          fps.maxHp = Math.round(100 * (hpLevel > 0 ? HERO_HP_MULT[hpLevel - 1] : 1));
          fps.hp = fps.maxHp;
          fps.position = { x: spawn.x, y: this.heightmap.getHeight(spawn.x, spawn.z) + PLAYER_HEIGHT, z: spawn.z };
          fps.velocity = vec3();
          fps.lastDamageTime = -999;
        }
      }
    }
  }

  // ===================== Hero Abilities =====================

  deactivateHeroAbility(fps: FPSPlayerEntity, depleted = false): void {
    fps.heroAbilityActive = false;
    fps.shieldHp = 0;
    fps.auraTickTimer = 0;
    if (depleted) {
      fps.heroAbilityDepleted = true;
      fps.heroAbilityCharge = 0;
      fps.heroAbilityLockout = HERO_DEPLETED_LOCKOUT;
    }
    // If not depleted, charge stays where it is and will recharge slowly
  }

  private updateHeroAbilities(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'fps_player') continue;
      const fps = entity as FPSPlayerEntity;
      if (fps.isDead || !fps.heroType) continue;

      if (fps.heroAbilityActive) {
        // Drain charge while active
        fps.heroAbilityCharge -= dt;

        // Deactivate if charge depleted or player entered vehicle
        if (fps.heroAbilityCharge <= 0 || this.getPlayerVehicle(fps.id)) {
          const depleted = fps.heroAbilityCharge <= 0;
          this.deactivateHeroAbility(fps, depleted);
          continue;
        }

        // Healer aura
        if (fps.heroType === 'healer') {
          fps.auraTickTimer -= dt;
          if (fps.auraTickTimer <= 0) {
            fps.auraTickTimer = AURA_TICK_INTERVAL;
            for (const other of this.entities.values()) {
              if (other.teamId !== fps.teamId || other.hp <= 0 || other.hp >= other.maxHp) continue;
              if (other.layerId !== fps.layerId) continue;
              if (!MOBILE_TYPES.has(other.entityType) || other.entityType === 'jeep') continue;
              const dx = other.position.x - fps.position.x;
              const dz = other.position.z - fps.position.z;
              if (Math.sqrt(dx * dx + dz * dz) <= HEAL_AURA_RADIUS) {
                other.hp = Math.min(other.maxHp, other.hp + Math.ceil(other.maxHp * AURA_HEAL_RATE));
              }
            }
          }
        }

        // Mechanic aura
        if (fps.heroType === 'mechanic') {
          fps.auraTickTimer -= dt;
          if (fps.auraTickTimer <= 0) {
            fps.auraTickTimer = AURA_TICK_INTERVAL;
            for (const other of this.entities.values()) {
              if (other.entityType !== 'jeep' || other.teamId !== fps.teamId) continue;
              if (other.hp <= 0 || other.hp >= other.maxHp) continue;
              if (other.layerId !== fps.layerId) continue;
              const dx = other.position.x - fps.position.x;
              const dz = other.position.z - fps.position.z;
              if (Math.sqrt(dx * dx + dz * dz) <= REPAIR_AURA_RADIUS) {
                other.hp = Math.min(other.maxHp, other.hp + Math.ceil(other.maxHp * AURA_HEAL_RATE));
              }
            }
          }
        }
      } else if (fps.heroAbilityDepleted) {
        // 60s lockout after full depletion
        fps.heroAbilityLockout -= dt;
        if (fps.heroAbilityLockout <= 0) {
          fps.heroAbilityDepleted = false;
          fps.heroAbilityLockout = 0;
          // Charge starts recharging from 0
        }
      } else if (fps.heroAbilityCharge < HERO_ABILITY_MAX_CHARGE) {
        // Recharge at 3x slower rate (drains at 1/s, recharges at 1/3 per second)
        fps.heroAbilityCharge += dt / HERO_ABILITY_RECHARGE_MULT;
        if (fps.heroAbilityCharge > HERO_ABILITY_MAX_CHARGE) {
          fps.heroAbilityCharge = HERO_ABILITY_MAX_CHARGE;
        }
      }
    }
  }

  // ===================== Tower Turrets =====================

  private updateTowerTurrets(dt: number): void {
    for (const [towerId, turret] of this.towerTurrets) {
      const tower = this.entities.get(towerId);
      if (!tower || tower.hp <= 0 || tower.status !== 'active') {
        turret.targetId = null;
        continue;
      }

      turret.fireCooldown = Math.max(0, turret.fireCooldown - dt);

      // HQ turret has 75% more range; tower levels also affect range
      const isHQ = tower.entityType === 'main_base';
      const tLvl = tower.level ?? 1;
      const levelMult = tLvl >= 3 ? 2.0 : tLvl >= 2 ? 1.2 : 1;
      const baseMult = isHQ ? 1.75 : 1;
      const towerRange = TOWER_RANGE * levelMult * baseMult;

      // Find best target: prioritize enemy FPS player, then closest enemy mobile unit
      const enemyTeam: TeamId = tower.teamId === 1 ? 2 : 1;
      let bestTarget: Entity | null = null;
      let bestDist = towerRange;
      let foundFPS = false;

      for (const ent of this.entities.values()) {
        if (ent.teamId === tower.teamId) continue;
        if (ent.hp <= 0) continue;
        if (ent.layerId !== tower.layerId) continue;
        if (!MOBILE_TYPES.has(ent.entityType)) continue;

        const d = dist3D(tower.position, ent.position);
        if (d > towerRange) continue;
        // Terrain must not block line-of-sight (tower eye height ~4 units)
        if (!this.hasLineOfSight(tower.position, ent.position, 4)) continue;

        // FPS player gets priority
        if (ent.entityType === 'fps_player' && d <= TOWER_FPS_PRIORITY_RANGE) {
          const fpsEnt = ent as FPSPlayerEntity;
          if (!fpsEnt.isDead) {
            if (!foundFPS || d < bestDist) {
              bestTarget = ent;
              bestDist = d;
              foundFPS = true;
            }
          }
          continue;
        }

        // Only consider non-FPS if we haven't found an FPS target
        if (!foundFPS && d < bestDist) {
          bestTarget = ent;
          bestDist = d;
        }
      }

      turret.targetId = bestTarget?.id ?? null;

      // Turrets fire slower (0.5x rate) but hit harder (2x damage)
      const isTurretEntity = tower.entityType === 'turret';
      const fireRate = isTurretEntity ? TOWER_FIRE_RATE * 2 : TOWER_FIRE_RATE; // turret: half speed = double interval

      // Fire at target (50% hit chance)
      if (bestTarget && turret.fireCooldown <= 0) {
        turret.fireCooldown = fireRate;
        const hit = Math.random() < 0.5;

        if (hit) {
          const towerLevel = tower.level ?? 1;
          let damage = TOWER_DAMAGE;
          if (towerLevel >= 3) damage *= 2; // level 3: double damage
          else if (towerLevel >= 2) damage = Math.round(damage * 1.5); // level 2: +50%
          this.applyDamage(bestTarget, damage, towerId);
          if (bestTarget.hp <= 0) {
            turret.targetId = null;
          }
        }

        const dx = bestTarget.position.x - tower.position.x;
        const dz = bestTarget.position.z - tower.position.z;
        // rotation.z = 1 signals "just fired", rotation.x = 1 signals "miss" for debris effect
        tower.rotation = { x: hit ? 0 : 1, y: Math.atan2(dx, dz), z: 1 };
      } else if (bestTarget) {
        // Track target even when not firing
        const dx = bestTarget.position.x - tower.position.x;
        const dz = bestTarget.position.z - tower.position.z;
        tower.rotation = { x: 0, y: Math.atan2(dx, dz), z: 0 };
      } else {
        // No target — clear firing flag
        tower.rotation = { ...tower.rotation, x: 0, z: 0 };
      }

      // Dual gun: fire at a second different target if upgraded
      if ((tower as any).dualGun && bestTarget && turret.fireCooldown <= TOWER_FIRE_RATE * 0.9) {
        // Find second best target (different from primary)
        let secondTarget: Entity | null = null;
        let secondDist = towerRange;
        for (const ent of this.entities.values()) {
          if (ent.teamId === tower.teamId || ent.hp <= 0 || !MOBILE_TYPES.has(ent.entityType)) continue;
          if (ent.layerId !== tower.layerId) continue;
          if (ent.id === bestTarget.id) continue; // different from primary
          const d = dist3D(tower.position, ent.position);
          if (d >= secondDist) continue;
          if (!this.hasLineOfSight(tower.position, ent.position, 4)) continue;
          secondDist = d; secondTarget = ent;
        }
        if (secondTarget && turret.fireCooldown <= 0) {
          const hit2 = Math.random() < 0.5;
          if (hit2) {
            const towerLevel = tower.level ?? 1;
            let dmg2 = TOWER_DAMAGE;
            if (towerLevel >= 3) dmg2 *= 2;
            else if (towerLevel >= 2) dmg2 = Math.round(dmg2 * 1.5);
            secondTarget.hp -= dmg2;
            if (secondTarget.entityType === 'fps_player') {
              (secondTarget as FPSPlayerEntity).lastDamagedBy = towerId;
            }
            if (secondTarget.hp <= 0) secondTarget.hp = 0;
          }
        }
      }
    }
  }

  // ===================== Worker =====================

  spawnWorker(teamId: TeamId, nearPos: Vec3): WorkerEntity {
    const angle = Math.random() * Math.PI * 2;
    const worker: WorkerEntity = {
      id: uuid(), entityType: 'worker',
      position: { x: nearPos.x + Math.cos(angle) * 6, y: this.heightmap.getHeight(nearPos.x + Math.cos(angle) * 6, nearPos.z + Math.sin(angle) * 6), z: nearPos.z + Math.sin(angle) * 6 },
      rotation: vec3(), teamId, hp: 50, maxHp: 50,
      status: 'active', constructionProgress: 1,
      state: 'idle', targetId: null, buildTargetId: null, buildQueue: [],
      movePoint: null, harvestTimer: 0, carriedCrystals: 0, attackTimer: 0,
      followTargetId: null, layerId: 0,
    };
    this.addEntity(worker);
    return worker;
  }

  // ===================== RTS Commands =====================

  handleRTSCommand(teamId: TeamId, cmd: { command: string; unitIds: string[]; targetPos?: Vec3; targetId?: string; buildingType?: string }): void {
    for (const unitId of cmd.unitIds) {
      const entity = this.entities.get(unitId);
      if (!entity || entity.teamId !== teamId) continue;

      if (entity.entityType === 'worker') {
        const worker = entity as WorkerEntity;

        // Cancel queued (not-yet-started) buildings when given non-build orders
        const isNonBuildCmd = cmd.command !== 'build_at' && cmd.command !== 'repair';
        if (isNonBuildCmd && worker.buildQueue.length > 0) {
          for (const queuedId of worker.buildQueue) {
            const queued = this.entities.get(queuedId);
            if (queued && queued.status === 'constructing' && queued.constructionProgress === 0) {
              // Refund 100% for buildings that haven't started
              const cost = BUILDING_COSTS[queued.entityType] ?? 0;
              this.teamResources[teamId] += cost;
              this.entities.delete(queuedId);
            }
          }
          worker.buildQueue = [];
        }

        switch (cmd.command) {
          case 'move':
            if (cmd.targetPos) {
              worker.state = 'moving';
              worker.movePoint = { ...cmd.targetPos };
              worker.targetId = null;
              worker.buildTargetId = null;
              worker.carriedCrystals = 0;
              worker.followTargetId = null;
            }
            break;
          case 'harvest':
            if (cmd.targetId) {
              worker.state = 'moving_to_node';
              worker.targetId = cmd.targetId;
              worker.buildTargetId = null;
              worker.harvestTimer = 0;
              worker.carriedCrystals = 0;
              worker.followTargetId = null;
            }
            break;
          case 'attack':
          case 'force_attack':
            if (cmd.targetId) {
              worker.state = 'moving_to_attack';
              worker.targetId = cmd.targetId;
              worker.buildTargetId = null;
              worker.movePoint = null;
              worker.followTargetId = null;
            }
            break;
          case 'follow':
            if (cmd.targetId) {
              worker.state = 'following';
              worker.followTargetId = cmd.targetId;
              worker.targetId = null;
              worker.buildTargetId = null;
              worker.movePoint = null;
              worker.carriedCrystals = 0;
            }
            break;
          case 'build_at':
            if (cmd.targetId) {
              worker.state = 'moving_to_build';
              worker.buildTargetId = cmd.targetId;
              worker.targetId = null;
              worker.movePoint = null;
            }
            break;
          case 'repair':
            if (cmd.targetId) {
              const target = this.entities.get(cmd.targetId);
              if (target && target.teamId === teamId && target.status === 'active'
                  && target.hp < target.maxHp && !MOBILE_TYPES.has(target.entityType)) {
                worker.state = 'moving_to_repair';
                worker.targetId = cmd.targetId;
                worker.buildTargetId = null;
                worker.movePoint = null;
              }
            }
            break;
        }
      }

      if (entity.entityType === 'fighter' || entity.entityType === 'foot_soldier' || entity.entityType === 'archer') {
        const fighter = entity as FighterEntity | FootSoldierEntity | ArcherEntity;
        switch (cmd.command) {
          case 'move':
            if (cmd.targetPos) {
              fighter.state = 'moving_to_point';
              fighter.movePoint = { ...cmd.targetPos };
              fighter.currentEnemyId = null;
              fighter.assignedTargetId = null;
              fighter.followTargetId = null;
              // Update guard position for player-trained units when commanded to move
              if (entity.entityType === 'foot_soldier') {
                (fighter as FootSoldierEntity).guardPosition = { ...cmd.targetPos };
              }
              if (entity.entityType === 'archer') {
                (fighter as ArcherEntity).guardPosition = { ...cmd.targetPos };
              }
            }
            break;
          case 'attack':
          case 'force_attack': // force_attack allows targeting same-team units
            if (cmd.targetId) {
              fighter.state = 'moving_to_enemy';
              fighter.currentEnemyId = cmd.targetId;
              fighter.assignedTargetId = cmd.targetId;
              fighter.movePoint = null;
              fighter.followTargetId = null;
            }
            break;
          case 'follow':
            if (cmd.targetId) {
              fighter.state = 'following';
              fighter.followTargetId = cmd.targetId;
              fighter.currentEnemyId = null;
              fighter.assignedTargetId = null;
              fighter.movePoint = null;
            }
            break;
        }
      }

      // Jeep can be commanded by RTS when no driver
      if (entity.entityType === 'jeep') {
        const jeep = entity as JeepEntity;
        if (!jeep.driverId && cmd.command === 'move' && cmd.targetPos) {
          jeep.rtsMoveTarget = { ...cmd.targetPos };
        }
      }

      // Helicopter can be commanded by RTS when no driver
      if (entity.entityType === 'helicopter') {
        const heli = entity as HelicopterEntity;
        if (!heli.driverId && cmd.command === 'move' && cmd.targetPos) {
          heli.rtsMoveTarget = { ...cmd.targetPos };
        }
      }

      // FPS player can be commanded via RTS (solo play) — walk to target, not teleport
      if (entity.entityType === 'fps_player') {
        const fps = entity as FPSPlayerEntity;
        if (cmd.command === 'move' && cmd.targetPos) {
          fps.rtsMoveTarget = { x: cmd.targetPos.x, y: PLAYER_HEIGHT, z: cmd.targetPos.z };
        }
      }
    }

    // Place building command (not per-unit)
    if (cmd.command === 'place_building' && cmd.buildingType && cmd.targetPos) {
      const builderWorkerId = cmd.unitIds[0];
      this.placeBuildingForTeam(teamId, cmd.buildingType, cmd.targetPos, builderWorkerId);
    }

    // Cancel all buildings assigned to a worker: 50% refund for in-progress, 100% for queued
    if (cmd.command === 'cancel_worker_builds') {
      for (const uid of cmd.unitIds) {
        const worker = this.entities.get(uid);
        if (!worker || worker.entityType !== 'worker' || worker.teamId !== teamId) continue;
        const w = worker as WorkerEntity;
        // Cancel current build target
        if (w.buildTargetId) {
          const building = this.entities.get(w.buildTargetId);
          if (building && building.status === 'constructing') {
            const cost = BUILDING_COSTS[building.entityType] ?? 0;
            this.teamResources[teamId] += Math.floor(cost * 0.5);
            this.entities.delete(w.buildTargetId);
          }
          w.buildTargetId = null;
        }
        // Cancel queued buildings — 100% refund
        for (const qid of w.buildQueue) {
          const building = this.entities.get(qid);
          if (building && building.status === 'constructing' && building.constructionProgress === 0) {
            const cost = BUILDING_COSTS[building.entityType] ?? 0;
            this.teamResources[teamId] += cost;
            this.entities.delete(qid);
          }
        }
        w.buildQueue = [];
        w.state = 'idle';
      }
    }

    // Cancel a constructing building — refund 50%
    if (cmd.command === 'cancel_build' && cmd.targetId) {
      const building = this.entities.get(cmd.targetId);
      if (building && building.teamId === teamId && building.status === 'constructing') {
        const cost = BUILDING_COSTS[building.entityType] ?? 0;
        this.teamResources[teamId] += Math.floor(cost * 0.5);
        // Release any workers building this
        for (const e of this.entities.values()) {
          if (e.entityType !== 'worker') continue;
          const w = e as WorkerEntity;
          if (w.buildTargetId === cmd.targetId) {
            w.buildTargetId = null;
            w.state = 'idle';
          }
          w.buildQueue = w.buildQueue.filter(id => id !== cmd.targetId);
        }
        this.entities.delete(cmd.targetId);
      }
    }
  }

  placeBuildingForTeam(teamId: TeamId, buildingType: string, position: Vec3, builderWorkerId?: string): string | null {
    const cost = BUILDING_COSTS[buildingType];
    if (cost === undefined) return null;
    if (this.teamResources[teamId] < cost) return null;

    this.teamResources[teamId] -= cost;

    const entityType = buildingType === 'tower' ? 'player_tower' : buildingType;

    // Inherit team's highest level for this building type
    const towerTypes = new Set(['tower', 'player_tower', 'turret']);
    const matchTypes = towerTypes.has(entityType) ? towerTypes : new Set([entityType]);
    let inheritLevel = 1;
    for (const ent of this.entities.values()) {
      if (ent.teamId === teamId && matchTypes.has(ent.entityType) && (ent.level ?? 1) > inheritLevel) {
        inheritLevel = ent.level ?? 1;
      }
    }

    let hp = 100, maxHp = 100;
    // Apply HP scaling from inherited level (towers get double HP at level 2+)
    if (towerTypes.has(entityType) && inheritLevel >= 2) { maxHp = 200; hp = 200; }

    const entity: Entity = {
      id: uuid(), entityType,
      position: { x: position.x, y: this.heightmap.getHeight(position.x, position.z), z: position.z },
      rotation: vec3(), teamId,
      hp, maxHp,
      status: 'constructing', constructionProgress: 0,
      level: inheritLevel > 1 ? inheritLevel : undefined,
      layerId: 0,
    };
    this.addEntity(entity);

    // Send builder worker (or queue if already building)
    if (builderWorkerId) {
      const worker = this.entities.get(builderWorkerId) as WorkerEntity | undefined;
      if (worker) {
        const isBusy = worker.state === 'moving_to_build' || worker.state === 'building';
        if (isBusy && worker.buildTargetId) {
          // Worker is already building — add to their queue
          worker.buildQueue.push(entity.id);
        } else {
          worker.state = 'moving_to_build';
          worker.buildTargetId = entity.id;
          worker.buildQueue = [];
          worker.targetId = null;
          worker.movePoint = null;
        }
      }
    }

    return entity.id;
  }

  handleTrain(teamId: TeamId, baseId: string, unitType: string = 'worker'): void {
    const building = this.entities.get(baseId);
    if (!building || building.teamId !== teamId) return;
    if (this.teamSupply[teamId].used >= this.teamSupply[teamId].cap) return;

    let tq = this.trainingQueues.get(baseId);
    if (!tq) {
      tq = { baseId, teamId, queue: [] };
      this.trainingQueues.set(baseId, tq);
    }
    if (tq.queue.length >= MAX_TRAINING_QUEUE) return;
    // Block training while an upgrade is in progress
    if (tq.queue.some(s => s.unitType.startsWith('upgrade_'))) return;

    if (building.entityType === 'main_base' && unitType === 'worker') {
      if (this.teamResources[teamId] < WORKER_COST) return;
      tq.queue.push({ elapsed: 0, duration: WORKER_TRAIN_TIME, unitType: 'worker' });
      this.teamResources[teamId] -= WORKER_COST;
      this.teamSupply[teamId].used += WORKER_SUPPLY_COST;
    } else if (building.entityType === 'barracks' && unitType === 'foot_soldier') {
      // Foot soldiers available at barracks tier 1
      if (building.status !== 'active') return;
      if (this.teamResources[teamId] < FOOT_SOLDIER_COST) return;
      tq.queue.push({ elapsed: 0, duration: FOOT_SOLDIER_TRAIN_TIME, unitType: 'foot_soldier' });
      this.teamResources[teamId] -= FOOT_SOLDIER_COST;
      this.teamSupply[teamId].used += FOOT_SOLDIER_SUPPLY_COST;
    } else if (building.entityType === 'garage' && unitType === 'jeep') {
      if (building.status !== 'active') return;
      if (this.teamResources[teamId] < JEEP_COST) return;
      if (this.teamSupply[teamId].used + JEEP_SUPPLY_COST > this.teamSupply[teamId].cap) return;
      tq.queue.push({ elapsed: 0, duration: JEEP_TRAIN_TIME, unitType: 'jeep' });
      this.teamResources[teamId] -= JEEP_COST;
      this.teamSupply[teamId].used += JEEP_SUPPLY_COST;
    } else if (building.entityType === 'garage' && unitType === 'helicopter') {
      if (building.status !== 'active') return;
      if (this.teamResources[teamId] < HELI_COST) return;
      if (this.teamSupply[teamId].used + HELI_SUPPLY_COST > this.teamSupply[teamId].cap) return;
      tq.queue.push({ elapsed: 0, duration: HELI_TRAIN_TIME, unitType: 'helicopter' });
      this.teamResources[teamId] -= HELI_COST;
      this.teamSupply[teamId].used += HELI_SUPPLY_COST;
    } else if (building.entityType === 'barracks' && unitType === 'archer') {
      // Archers require barracks tier 2
      if ((building.level ?? 1) < 2) return;
      if (building.status !== 'active') return;
      if (this.teamResources[teamId] < ARCHER_COST) return;
      if (this.teamSupply[teamId].used >= this.teamSupply[teamId].cap) return;
      tq.queue.push({ elapsed: 0, duration: ARCHER_TRAIN_TIME, unitType: 'archer' });
      this.teamResources[teamId] -= ARCHER_COST;
      this.teamSupply[teamId].used += ARCHER_SUPPLY_COST;
    }
  }

  handleCancelTrain(teamId: TeamId, baseId: string, index: number): void {
    const tq = this.trainingQueues.get(baseId);
    if (!tq || tq.teamId !== teamId || index < 0 || index >= tq.queue.length) return;
    const slot = tq.queue[index];
    tq.queue.splice(index, 1);
    const refund = slot.unitType === 'helicopter' ? HELI_COST : slot.unitType === 'jeep' ? JEEP_COST : slot.unitType === 'archer' ? ARCHER_COST : slot.unitType === 'foot_soldier' ? FOOT_SOLDIER_COST : WORKER_COST;
    const supplyCost = slot.unitType === 'helicopter' ? HELI_SUPPLY_COST : slot.unitType === 'jeep' ? JEEP_SUPPLY_COST : slot.unitType === 'archer' ? ARCHER_SUPPLY_COST : slot.unitType === 'foot_soldier' ? FOOT_SOLDIER_SUPPLY_COST : WORKER_SUPPLY_COST;
    this.teamResources[teamId] += refund;
    this.teamSupply[teamId].used = Math.max(0, this.teamSupply[teamId].used - supplyCost);
  }

  handleUpgrade(teamId: TeamId, buildingId: string, upgradeType: string): void {
    const building = this.entities.get(buildingId);
    if (!building || building.teamId !== teamId || building.status !== 'active') return;

    let tq = this.trainingQueues.get(buildingId);
    if (!tq) {
      tq = { baseId: buildingId, teamId, queue: [] };
      this.trainingQueues.set(buildingId, tq);
    }
    // Don't allow if already upgrading
    if (tq.queue.some(s => s.unitType.startsWith('upgrade_'))) return;

    if (upgradeType === 'barracks_level2' && building.entityType === 'barracks') {
      if ((building.level ?? 1) >= 2) return;
      if (this.teamResources[teamId] < BARRACKS_UPGRADE_COST) return;
      this.teamResources[teamId] -= BARRACKS_UPGRADE_COST;
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_barracks' });
    } else if (upgradeType === 'base_upgrade' && building.entityType === 'main_base') {
      if ((building.level ?? 1) >= 2) return;
      if (this.teamResources[teamId] < 1000) return;
      this.teamResources[teamId] -= 1000;
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_base' });
    } else if (upgradeType === 'armory_level2' && building.entityType === 'armory') {
      if ((building.level ?? 1) >= 2) return;
      if (this.teamResources[teamId] < 500) return;
      this.teamResources[teamId] -= 500;
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_armory' });
    } else if (upgradeType === 'armory_rockets' && building.entityType === 'armory') {
      if ((building.level ?? 1) < 2) return; // must be level 2 first
      if ((building.level ?? 1) >= 3) return;
      if (this.teamResources[teamId] < 400) return;
      this.teamResources[teamId] -= 400;
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_armory' });
      // Level 3 = rockets upgraded (completion sets level)
    } else if (upgradeType === 'armory_level3' && building.entityType === 'armory') {
      if ((building.level ?? 1) < 2) return; // must be level 2 first
      if (this.armoryLevel3[teamId]) return; // already done
      if (this.teamResources[teamId] < 600) return;
      this.teamResources[teamId] -= 600;
      // Use a distinct unitType so completion can set the flag
      tq.queue.push({ elapsed: 0, duration: 15, unitType: 'upgrade_armory_l3' as any });
    } else if (upgradeType === 'unit_upgrade' && building.entityType === 'barracks') {
      // Unit upgrades (requires armory level 3 flag)
      if (!this.armoryLevel3[teamId]) return;
      const curUnitLvl = this.unitUpgradeLevel[teamId] ?? 0;
      if (curUnitLvl >= 2) return; // max level 2
      const cost = curUnitLvl === 0 ? 250 : 750;
      if (this.teamResources[teamId] < cost) return;
      this.teamResources[teamId] -= cost;
      tq.queue.push({ elapsed: 0, duration: 12, unitType: 'upgrade_barracks' });
      // unitUpgradeLevel is incremented on completion
    } else if (upgradeType === 'tower_upgrade') {
      const towerTypes = new Set(['tower', 'player_tower', 'turret']);
      if (!towerTypes.has(building.entityType)) return;
      if ((building.level ?? 1) >= 3) return; // max level 3
      const cost = (building.level ?? 1) >= 2 ? 500 : 300; // level 2: 300, level 3: 500
      if (this.teamResources[teamId] < cost) return;
      this.teamResources[teamId] -= cost;
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_tower' });
    } else if (upgradeType === 'tower_global_upgrade') {
      // Global tower upgrade from main base — upgrades ALL towers on the team
      if (building.entityType !== 'main_base') return;
      const teamTowers = [...this.entities.values()].filter(
        e => (e.entityType === 'tower' || e.entityType === 'player_tower' || e.entityType === 'turret')
          && e.teamId === teamId && e.hp > 0,
      );
      const maxLevel = Math.max(...teamTowers.map(t => t.level ?? 1), 1);
      if (maxLevel >= 3) return;
      const cost = maxLevel >= 2 ? 800 : 400; // global level 2: 400, global level 3: 800
      if (this.teamResources[teamId] < cost) return;
      this.teamResources[teamId] -= cost;
      // Upgrade all towers
      for (const t of teamTowers) {
        t.level = Math.min(3, (t.level ?? 1) + 1);
      }
    } else if (upgradeType === 'tower_dual_gun') {
      // Individual tower dual-gun upgrade
      const towerTypes = new Set(['tower', 'player_tower', 'turret']);
      if (!towerTypes.has(building.entityType)) return;
      if ((building as any).dualGun) return; // already has dual guns
      if (this.teamResources[teamId] < 300) return;
      this.teamResources[teamId] -= 300;
      (building as any).dualGun = true;
    } else if (upgradeType === 'hero_hp' && building.entityType === 'hero_academy') {
      const lvl = this.heroHpLevel[teamId] ?? 0;
      if (lvl >= 3) return;
      const cost = HERO_HP_COSTS[lvl];
      if (this.teamResources[teamId] < cost) return;
      this.teamResources[teamId] -= cost;
      tq.queue.push({ elapsed: 0, duration: 15, unitType: 'upgrade_hero_hp' });
    } else if (upgradeType === 'hero_damage' && building.entityType === 'hero_academy') {
      const lvl = this.heroDmgLevel[teamId] ?? 0;
      if (lvl >= 3) return;
      const cost = HERO_DMG_COSTS[lvl];
      if (this.teamResources[teamId] < cost) return;
      this.teamResources[teamId] -= cost;
      tq.queue.push({ elapsed: 0, duration: 15, unitType: 'upgrade_hero_dmg' });
    } else if (upgradeType === 'hero_regen' && building.entityType === 'hero_academy') {
      if (this.heroRegen[teamId]) return;
      if (this.teamResources[teamId] < HERO_REGEN_COST) return;
      this.teamResources[teamId] -= HERO_REGEN_COST;
      tq.queue.push({ elapsed: 0, duration: 15, unitType: 'upgrade_hero_regen' });
    } else if (upgradeType === 'harvest_boost' && building.entityType === 'main_base') {
      if (this.harvestBoost[teamId]) return; // already upgraded
      if (this.teamResources[teamId] < 400) return;
      this.teamResources[teamId] -= 400;
      tq.queue.push({ elapsed: 0, duration: 8, unitType: 'upgrade_harvest' });
    }
  }

  spawnFootSoldier(teamId: TeamId, nearPos: Vec3): FootSoldierEntity {
    const angle = Math.random() * Math.PI * 2;
    const sx = nearPos.x + Math.cos(angle) * 6, sz = nearPos.z + Math.sin(angle) * 6;
    const spawnPos = { x: sx, y: this.heightmap.getHeight(sx, sz), z: sz };
    const uLvl = this.unitUpgradeLevel[teamId] ?? 0;
    const hpMult = uLvl >= 2 ? 2.5 : uLvl >= 1 ? 1.25 : 1;
    const baseHp = Math.round(FOOT_SOLDIER_HP * hpMult);
    const fs: FootSoldierEntity = {
      id: uuid(), entityType: 'foot_soldier',
      position: { ...spawnPos },
      rotation: vec3(), teamId, hp: baseHp, maxHp: baseHp,
      status: 'active', constructionProgress: 1,
      state: 'idle', assignedTargetId: null, currentEnemyId: null,
      attackTimer: 0, movePoint: null,
      guardPosition: { ...spawnPos }, followTargetId: null, layerId: 0,
    };
    this.addEntity(fs);
    return fs;
  }

  spawnArcher(teamId: TeamId, nearPos: Vec3): ArcherEntity {
    const angle = Math.random() * Math.PI * 2;
    const sx = nearPos.x + Math.cos(angle) * 6, sz = nearPos.z + Math.sin(angle) * 6;
    const spawnPos = { x: sx, y: this.heightmap.getHeight(sx, sz), z: sz };
    const uLvl = this.unitUpgradeLevel[teamId] ?? 0;
    const hpMult = uLvl >= 2 ? 2.5 : uLvl >= 1 ? 1.25 : 1;
    const baseHp = Math.round(ARCHER_HP * hpMult);
    const archer: ArcherEntity = {
      id: uuid(), entityType: 'archer',
      position: { ...spawnPos },
      rotation: vec3(), teamId, hp: baseHp, maxHp: baseHp,
      status: 'active', constructionProgress: 1,
      state: 'idle', assignedTargetId: null, currentEnemyId: null,
      attackTimer: 0, movePoint: null,
      guardPosition: { ...spawnPos }, followTargetId: null, layerId: 0,
    };
    this.addEntity(archer);
    return archer;
  }

  spawnJeep(teamId: TeamId, nearPos: Vec3): JeepEntity {
    const angle = Math.random() * Math.PI * 2;
    const jeep: JeepEntity = {
      id: uuid(), entityType: 'jeep',
      position: { x: nearPos.x + Math.cos(angle) * 8, y: this.heightmap.getHeight(nearPos.x + Math.cos(angle) * 8, nearPos.z + Math.sin(angle) * 8), z: nearPos.z + Math.sin(angle) * 8 },
      rotation: vec3(), teamId, hp: JEEP_HP, maxHp: JEEP_HP,
      status: 'active', constructionProgress: 1,
      velocity: vec3(), heading: angle, speed: 0, onGround: true,
      driverId: null, gunnerId: null, rtsMoveTarget: null,
      uturnOvershoot: 0, uturnOvershootDir: 0, collisionCooldown: 0, layerId: 0,
    };
    this.addEntity(jeep);
    return jeep;
  }

  spawnHelicopter(teamId: TeamId, nearPos: Vec3): HelicopterEntity {
    const angle = Math.random() * Math.PI * 2;
    const heli: HelicopterEntity = {
      id: uuid(), entityType: 'helicopter',
      position: { x: nearPos.x + Math.cos(angle) * 12, y: this.heightmap.getHeight(nearPos.x + Math.cos(angle) * 12, nearPos.z + Math.sin(angle) * 12), z: nearPos.z + Math.sin(angle) * 12 },
      rotation: vec3(), teamId, hp: HELI_HP, maxHp: HELI_HP,
      status: 'active', constructionProgress: 1,
      velocity: vec3(), heading: angle, speed: 0,
      driverId: null, rtsMoveTarget: null, collisionCooldown: 0,
      inputThisTick: false, layerId: 0,
    };
    this.addEntity(heli);
    return heli;
  }

  // ===================== Vehicle Enter/Exit =====================

  enterVehicle(fpsEntityId: string, vehicleId: string, seat: 'driver' | 'gunner'): boolean {
    const vehicle = this.entities.get(vehicleId);
    const fps = this.entities.get(fpsEntityId) as FPSPlayerEntity | undefined;
    if (!vehicle || !fps || fps.isDead) return false;
    if (vehicle.teamId !== fps.teamId) return false;

    // Check proximity (within 5 units)
    const dx = fps.position.x - vehicle.position.x;
    const dz = fps.position.z - vehicle.position.z;
    if (dx * dx + dz * dz > 25) return false;

    if (vehicle.entityType === 'jeep') {
      const jeep = vehicle as JeepEntity;
      if (seat === 'driver') {
        if (jeep.driverId) return false;
        jeep.driverId = fpsEntityId;
        jeep.rtsMoveTarget = null;
      } else {
        if (jeep.gunnerId) return false;
        jeep.gunnerId = fpsEntityId;
      }
      return true;
    } else if (vehicle.entityType === 'helicopter') {
      const heli = vehicle as HelicopterEntity;
      if (seat !== 'driver') return false; // helicopter is driver-only
      if (heli.driverId) return false;
      heli.driverId = fpsEntityId;
      heli.rtsMoveTarget = null;
      return true;
    }
    return false;
  }

  exitVehicle(fpsEntityId: string): { vehicleId: string; exitPos: Vec3 } | null {
    for (const entity of this.entities.values()) {
      if (entity.entityType === 'jeep') {
        const jeep = entity as JeepEntity;
        let wasIn = false;
        if (jeep.driverId === fpsEntityId) { jeep.driverId = null; wasIn = true; }
        if (jeep.gunnerId === fpsEntityId) { jeep.gunnerId = null; wasIn = true; }
        if (wasIn) {
          const sideAngle = jeep.heading + Math.PI / 2;
          const exitPos = {
            x: jeep.position.x + Math.cos(sideAngle) * 3,
            y: jeep.position.y,
            z: jeep.position.z + Math.sin(sideAngle) * 3,
          };
          return { vehicleId: jeep.id, exitPos };
        }
      } else if (entity.entityType === 'helicopter') {
        const heli = entity as HelicopterEntity;
        if (heli.driverId === fpsEntityId) {
          heli.driverId = null;
          // Exit below helicopter
          const exitPos = {
            x: heli.position.x,
            y: 0, // ground level
            z: heli.position.z,
          };
          return { vehicleId: heli.id, exitPos };
        }
      }
    }
    return null;
  }

  getPlayerVehicle(fpsEntityId: string): { jeep: JeepEntity | HelicopterEntity; seat: 'driver' | 'gunner' } | null {
    for (const entity of this.entities.values()) {
      if (entity.entityType === 'jeep') {
        const jeep = entity as JeepEntity;
        if (jeep.driverId === fpsEntityId) return { jeep, seat: 'driver' };
        if (jeep.gunnerId === fpsEntityId) return { jeep, seat: 'gunner' };
      } else if (entity.entityType === 'helicopter') {
        const heli = entity as HelicopterEntity;
        if (heli.driverId === fpsEntityId) return { jeep: heli, seat: 'driver' };
      }
    }
    return null;
  }

  fpsInvincible = false;
  /** Callback when jeep turret hits — (driverId, targetId) */
  onJeepTurretHit: ((driverId: string, targetId: string) => void) | null = null;
  /** Callback when an entity is killed — (killedEntity, sourceEntityId) */
  onEntityKill: ((killed: Entity, sourceId: string) => void) | null = null;
  /** Callback when a building finishes construction — (buildingEntity) */
  onBuildingBuilt: ((building: Entity) => void) | null = null;
  /** Callback when a hero upgrade completes — (teamId, upgradeType) */
  onHeroUpgrade: ((teamId: TeamId, upgradeType: string) => void) | null = null;
  /** Callback when crystals are deposited — (teamId, amount) */
  onCrystalsDeposited: ((teamId: TeamId, amount: number) => void) | null = null;
  /** Callback when an upgrade completes — (teamId) */
  onUpgradeComplete: ((teamId: TeamId) => void) | null = null;

  /** Apply damage to an entity, redirecting 80% to the jeep if the target is inside one. */
  applyDamage(target: Entity, damage: number, sourceId: string): void {
    if (target.entityType === 'fps_player' && this.fpsInvincible) return;
    // Tank shield sphere: protects ALL friendly units inside the sphere
    // Damage from outside the shield is absorbed; damage from inside passes through
    {
      const source = this.entities.get(sourceId);
      if (source && source.teamId !== target.teamId) {
        // Find any active tank shield on the target's team that covers this target
        for (const ent of this.entities.values()) {
          if (ent.entityType !== 'fps_player') continue;
          const tank = ent as FPSPlayerEntity;
          if (tank.teamId !== target.teamId) continue;
          if (tank.layerId !== target.layerId) continue;
          if (!tank.heroAbilityActive || tank.heroType !== 'tank' || tank.shieldHp <= 0) continue;

          // Is the target inside this tank's shield sphere? (true 3D sphere)
          const targetDist = dist3D(target.position, tank.position);
          if (targetDist > SHIELD_RADIUS) continue;

          // Is the source OUTSIDE the shield sphere?
          const sourceDist = dist3D(source.position, tank.position);
          if (sourceDist <= SHIELD_RADIUS) continue; // source inside shield, damage passes through

          // Shield absorbs the damage
          const absorbed = Math.min(damage, tank.shieldHp);
          tank.shieldHp -= absorbed;
          damage -= absorbed;
          if (tank.shieldHp <= 0) this.deactivateHeroAbility(tank, true);
          if (damage <= 0) return;
          break; // only one shield can absorb per hit
        }
      }
    }
    if (target.entityType === 'fps_player') {
      const vehicle = this.getPlayerVehicle(target.id);
      if (vehicle) {
        if (vehicle.jeep.entityType === 'helicopter') {
          // Helicopter: no damage reduction for pilot, full damage to heli
          vehicle.jeep.hp -= damage;
          if (vehicle.jeep.hp < 0) vehicle.jeep.hp = 0;
          if (vehicle.jeep.hp <= 0) {
            this.destroyHelicopter(vehicle.jeep as HelicopterEntity, sourceId);
          }
        } else {
          // Jeep: player takes 20% damage, jeep takes full damage
          const playerDmg = Math.max(1, Math.floor(damage * 0.2));
          target.hp -= playerDmg;
          if (target.hp < 0) target.hp = 0;
          vehicle.jeep.hp -= damage;
          if (vehicle.jeep.hp < 0) vehicle.jeep.hp = 0;
          if (vehicle.jeep.hp <= 0) {
            this.destroyJeep(vehicle.jeep as JeepEntity, sourceId);
          }
        }
        (target as FPSPlayerEntity).lastDamagedBy = sourceId;
        return;
      }
      (target as FPSPlayerEntity).lastDamagedBy = sourceId;
      (target as FPSPlayerEntity).lastDamageTime = this.gameTime;
    }
    target.hp -= damage;
    if (target.hp < 0) target.hp = 0;
    if (target.hp <= 0) {
      this.onEntityKill?.(target, sourceId);
      // Destroy vehicles when HP reaches 0 from direct hit
      if (target.entityType === 'jeep') {
        this.destroyJeep(target as JeepEntity, sourceId);
      }
      if (target.entityType === 'helicopter') {
        this.destroyHelicopter(target as HelicopterEntity, sourceId);
      }
    }
  }

  /** Kill all occupants and deal splash damage when a jeep is destroyed. */
  private destroyJeep(jeep: JeepEntity, sourceId: string): void {
    if (jeep.driverId) {
      const driver = this.entities.get(jeep.driverId) as FPSPlayerEntity | undefined;
      if (driver && driver.hp > 0) {
        driver.hp = 0;
        driver.lastDamagedBy = sourceId;
      }
    }
    if (jeep.gunnerId) {
      const gunner = this.entities.get(jeep.gunnerId) as FPSPlayerEntity | undefined;
      if (gunner && gunner.hp > 0) {
        gunner.hp = 0;
        gunner.lastDamagedBy = sourceId;
      }
    }

    // Splash damage to nearby entities
    const SPLASH_RADIUS = 12;
    const SPLASH_DAMAGE = 60;
    for (const entity of this.entities.values()) {
      if (entity.id === jeep.id) continue;
      if (entity.hp <= 0) continue;
      if (entity.layerId !== jeep.layerId) continue;
      // Skip occupants (already killed above)
      if (entity.id === jeep.driverId || entity.id === jeep.gunnerId) continue;
      const dist = dist3D(entity.position, jeep.position);
      if (dist >= SPLASH_RADIUS) continue;
      // Linear falloff: full damage at center, zero at edge
      const falloff = 1 - dist / SPLASH_RADIUS;
      const damage = Math.floor(SPLASH_DAMAGE * falloff);
      if (damage <= 0) continue;
      this.applyDamage(entity, damage, sourceId);
    }
  }

  private destroyHelicopter(heli: HelicopterEntity, sourceId: string): void {
    // Kill pilot instantly
    if (heli.driverId) {
      const driver = this.entities.get(heli.driverId) as FPSPlayerEntity | undefined;
      if (driver && driver.hp > 0) {
        driver.hp = 0;
        driver.lastDamagedBy = sourceId;
      }
    }

    // Splash damage to nearby entities
    const SPLASH_RADIUS = 12;
    const SPLASH_DAMAGE = 60;
    for (const entity of this.entities.values()) {
      if (entity.id === heli.id || entity.hp <= 0) continue;
      if (entity.layerId !== heli.layerId) continue;
      if (entity.id === heli.driverId) continue;
      const dist = dist3D(entity.position, heli.position);
      if (dist >= SPLASH_RADIUS) continue;
      const falloff = 1 - dist / SPLASH_RADIUS;
      const damage = Math.floor(SPLASH_DAMAGE * falloff);
      if (damage <= 0) continue;
      this.applyDamage(entity, damage, sourceId);
    }
  }

  // ===================== Vehicle Physics =====================

  applyVehicleInput(vehicleId: string, forward: boolean, backward: boolean, cameraYaw: number, dt: number): void {
    const jeep = this.entities.get(vehicleId) as JeepEntity | undefined;
    if (!jeep || jeep.entityType !== 'jeep' || jeep.hp <= 0) return;

    const maxSpeed = this.turboJeep ? JEEP_MAX_SPEED * 3 : JEEP_MAX_SPEED;
    const reverseMax = this.turboJeep ? JEEP_REVERSE_MAX * 3 : JEEP_REVERSE_MAX;

    // Acceleration / braking
    if (forward) {
      if (jeep.speed < 0) {
        // Braking from reverse
        jeep.speed += JEEP_BRAKE_FORCE * dt;
        if (jeep.speed > 0) jeep.speed = 0;
      } else if (jeep.speed < maxSpeed) {
        jeep.speed += JEEP_ACCELERATION * dt;
        if (jeep.speed > maxSpeed) jeep.speed = maxSpeed;
      }
    } else if (backward) {
      if (jeep.speed > 0) {
        // Braking from forward
        jeep.speed -= JEEP_BRAKE_FORCE * dt;
        if (jeep.speed < 0) jeep.speed = 0;
      } else if (jeep.speed > -reverseMax) {
        jeep.speed -= JEEP_ACCELERATION * 0.5 * dt;
        if (jeep.speed < -reverseMax) jeep.speed = -reverseMax;
      }
    } else {
      // No input — friction slows down
      const drag = JEEP_FRICTION * dt;
      if (Math.abs(jeep.speed) < drag) jeep.speed = 0;
      else jeep.speed -= Math.sign(jeep.speed) * drag;
    }

    // Steering: auto-steer toward camera yaw direction (only when actively driving)
    const absSpeed = Math.abs(jeep.speed);
    const isThrottling = forward || backward;
    if (isThrottling && absSpeed > 0.3) {
      const desiredHeading = cameraYaw;
      let headingDiff = desiredHeading - jeep.heading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;

      // Turn rate scales with speed (smoother at higher speeds)
      const turnFactor = Math.min(1, absSpeed / 10);
      const maxTurn = JEEP_TURN_RATE * turnFactor * dt;
      const steerStrength = 2.5; // how aggressively it chases the camera direction
      const turn = Math.max(-maxTurn, Math.min(maxTurn, headingDiff * steerStrength * dt));
      jeep.heading += turn;
    }

    // Compute world velocity from heading + speed
    const cosH = Math.cos(jeep.heading);
    const sinH = Math.sin(jeep.heading);
    const targetVx = -sinH * jeep.speed;
    const targetVz = -cosH * jeep.speed;

    // Determine if drifting: large angle change at high speed
    let headingDiff = cameraYaw - jeep.heading;
    while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
    while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
    const absDiff = Math.abs(headingDiff);
    const isDrifting = isThrottling && absSpeed > JEEP_DRIFT_SPEED_MIN && absDiff > JEEP_DRIFT_ANGLE_THRESHOLD;
    const isSharpTurn = isDrifting && absDiff > JEEP_SHARP_TURN_THRESHOLD;
    const grip = isDrifting ? JEEP_DRIFT_GRIP : JEEP_LATERAL_GRIP;

    // Detect 180-turn at high speed: trigger overshoot when turn begins
    if (jeep.uturnOvershoot === 0 && absSpeed > JEEP_UTURN_SPEED_MIN
        && absDiff >= JEEP_UTURN_ANGLE_MIN && absDiff <= JEEP_UTURN_ANGLE_MAX) {
      jeep.uturnOvershoot = JEEP_UTURN_OVERSHOOT;
      jeep.uturnOvershootDir = headingDiff > 0 ? 1 : -1;
    }

    if (isDrifting) {
      // Faster turning during drift — fishtail effect
      let driftMultiplier = 1.8;
      let chaseStrength = 4;

      if (isSharpTurn) {
        // Really sharp turn: over-rotate past the target, then correct back
        // Higher multiplier causes the heading to overshoot, creating a whip/fishtail
        driftMultiplier = 2.5;
        chaseStrength = 6;
      }

      const maxDriftTurn = JEEP_TURN_RATE * driftMultiplier * dt;
      const driftTurn = Math.max(-maxDriftTurn, Math.min(maxDriftTurn, headingDiff * chaseStrength * dt));
      jeep.heading += driftTurn;
    }

    // 180-turn overshoot: once the main turn is nearly complete, inject extra rotation
    if (jeep.uturnOvershoot > 0) {
      if (absDiff < 20 * Math.PI / 180) {
        // Turn is nearly done — apply the overshoot past the target
        const overshootStep = JEEP_UTURN_OVERSHOOT * 4 * dt; // apply quickly
        const apply = Math.min(overshootStep, jeep.uturnOvershoot);
        jeep.heading += apply * jeep.uturnOvershootDir;
        jeep.uturnOvershoot -= apply;
      }
      // If the player has straightened out (absDiff small) and overshoot is spent,
      // the normal steering will correct back to the camera direction
    }

    // Lateral grip: blend current velocity toward heading direction
    jeep.velocity.x += (targetVx - jeep.velocity.x) * Math.min(1, grip * dt);
    jeep.velocity.z += (targetVz - jeep.velocity.z) * Math.min(1, grip * dt);
  }

  applyHelicopterInput(vehicleId: string, forward: boolean, backward: boolean, cameraYaw: number, ascend: boolean, descend: boolean, dt: number, strafeLeft = false, strafeRight = false): void {
    const heli = this.entities.get(vehicleId) as HelicopterEntity | undefined;
    if (!heli || heli.entityType !== 'helicopter' || heli.hp <= 0) return;
    heli.inputThisTick = true;

    // Horizontal acceleration / braking (simpler than jeep — no drift)
    if (forward) {
      if (heli.speed < 0) {
        heli.speed += HELI_BRAKE_FORCE * dt;
        if (heli.speed > 0) heli.speed = 0;
      } else if (heli.speed < HELI_MAX_SPEED) {
        heli.speed += HELI_ACCELERATION * dt;
        if (heli.speed > HELI_MAX_SPEED) heli.speed = HELI_MAX_SPEED;
      }
    } else if (backward) {
      if (heli.speed > 0) {
        heli.speed -= HELI_BRAKE_FORCE * dt;
        if (heli.speed < 0) heli.speed = 0;
      } else if (heli.speed > -HELI_REVERSE_MAX) {
        heli.speed -= HELI_ACCELERATION * 0.5 * dt;
        if (heli.speed < -HELI_REVERSE_MAX) heli.speed = -HELI_REVERSE_MAX;
      }
    } else {
      const drag = HELI_FRICTION * dt;
      if (Math.abs(heli.speed) < drag) heli.speed = 0;
      else heli.speed -= Math.sign(heli.speed) * drag;
    }

    // Steering toward camera yaw
    const absSpeed = Math.abs(heli.speed);
    const isThrottling = forward || backward;
    if (isThrottling && absSpeed > 0.3) {
      let headingDiff = cameraYaw - heli.heading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      const turnFactor = Math.min(1, absSpeed / 8);
      const maxTurn = HELI_TURN_RATE * turnFactor * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, headingDiff * 2.0 * dt));
      heli.heading += turn;
    }

    // Steer toward camera yaw when strafing (so strafing is relative to view)
    if ((strafeLeft || strafeRight) && !isThrottling) {
      let headingDiff = cameraYaw - heli.heading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      const maxTurn = HELI_TURN_RATE * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, headingDiff * 3.0 * dt));
      heli.heading += turn;
    }

    // Turn in place when hovering (no throttle, no strafe) — allows spinning without movement
    if (!isThrottling && !strafeLeft && !strafeRight) {
      let headingDiff = cameraYaw - heli.heading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      if (Math.abs(headingDiff) > 0.02) {
        const maxTurn = HELI_TURN_RATE * 0.8 * dt; // slightly slower than moving turn
        const turn = Math.max(-maxTurn, Math.min(maxTurn, headingDiff * 3.0 * dt));
        heli.heading += turn;
      }
    }

    // Compute horizontal velocity (forward/back along heading + strafe perpendicular)
    const cosH = Math.cos(heli.heading);
    const sinH = Math.sin(heli.heading);
    const strafeSpeed = (strafeLeft ? -1 : strafeRight ? 1 : 0) * HELI_MAX_SPEED * 0.6;
    heli.velocity.x = -sinH * heli.speed + cosH * strafeSpeed;
    heli.velocity.z = -cosH * heli.speed - sinH * strafeSpeed;

    // Vertical control
    if (ascend) {
      heli.velocity.y = HELI_ASCEND_SPEED;
    } else if (descend) {
      heli.velocity.y = -HELI_DESCEND_SPEED;
    } else {
      // Hover drift only when airborne; no drift on ground
      const hInputTerrainY = this.heightmap.getHeight(heli.position.x, heli.position.z);
      heli.velocity.y = heli.position.y > hInputTerrainY + 0.1 ? HELI_HOVER_DRIFT : 0;
    }
  }

  private updateVehicles(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'jeep') continue;
      const jeep = entity as JeepEntity;
      if (jeep.hp <= 0) continue;

      // RTS auto-drive when no driver
      if (!jeep.driverId && jeep.rtsMoveTarget) {
        const dx = jeep.rtsMoveTarget.x - jeep.position.x;
        const dz = jeep.rtsMoveTarget.z - jeep.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 3) {
          jeep.rtsMoveTarget = null;
          jeep.speed *= 0.5; // slow down on arrival
        } else {
          // Steer toward target
          const targetHeading = Math.atan2(-dx, -dz);
          let headingDiff = targetHeading - jeep.heading;
          while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
          while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
          const steerAmount = Math.min(1, Math.max(-1, headingDiff * 2));
          const absSpeed = Math.abs(jeep.speed);
          const turnFactor = Math.min(1, absSpeed / 5);
          jeep.heading += steerAmount * JEEP_TURN_RATE * turnFactor * dt;

          // Throttle toward target
          if (Math.abs(headingDiff) < Math.PI / 3) {
            if (jeep.speed < JEEP_MAX_SPEED * 0.7) jeep.speed += JEEP_ACCELERATION * dt;
          } else {
            // Slow down to turn
            jeep.speed *= (1 - 2 * dt);
          }

          // Update velocity
          const cosH = Math.cos(jeep.heading);
          const sinH = Math.sin(jeep.heading);
          jeep.velocity.x += (-sinH * jeep.speed - jeep.velocity.x) * Math.min(1, JEEP_LATERAL_GRIP * dt);
          jeep.velocity.z += (-cosH * jeep.speed - jeep.velocity.z) * Math.min(1, JEEP_LATERAL_GRIP * dt);
        }
      }

      // Gravity
      if (!jeep.onGround) {
        jeep.velocity.y += JEEP_GRAVITY * dt;
      }

      // Integrate position
      jeep.position.x += jeep.velocity.x * dt;
      jeep.position.y += jeep.velocity.y * dt;
      jeep.position.z += jeep.velocity.z * dt;

      // Ground collision (terrain-aware)
      const jeepTerrainY = this.heightmap.getHeight(jeep.position.x, jeep.position.z);
      if (jeep.position.y < jeepTerrainY) {
        jeep.position.y = jeepTerrainY;
        jeep.velocity.y = 0;
        jeep.onGround = true;
      } else {
        jeep.onGround = jeep.position.y <= jeepTerrainY + 0.1;
      }

      // Map bounds
      const halfW = this.mapBounds.halfW;
      const halfD = this.mapBounds.halfD;
      jeep.position.x = Math.max(-halfW + 2, Math.min(halfW - 2, jeep.position.x));
      jeep.position.z = Math.max(-halfD + 2, Math.min(halfD - 2, jeep.position.z));

      // Store heading in rotation.y for snapshot
      jeep.rotation.y = jeep.heading;

      // Collision with buildings — jeep takes damage and bounces off
      const vehicleSpeed = Math.sqrt(jeep.velocity.x * jeep.velocity.x + jeep.velocity.z * jeep.velocity.z);
      jeep.collisionCooldown = Math.max(0, jeep.collisionCooldown - dt);
      for (const building of this.entities.values()) {
        if (building.hp <= 0) continue;
        const radius = BUILDING_RADII[building.entityType];
        if (radius === undefined) continue;
        const bdx = jeep.position.x - building.position.x;
        const bdz = jeep.position.z - building.position.z;
        const bDist = Math.sqrt(bdx * bdx + bdz * bdz);
        const collisionDist = radius + JEEP_COLLISION_RADIUS;
        if (bDist < collisionDist) {
          // Push jeep out of building regardless of speed/cooldown
          const pushX = bDist > 0.1 ? bdx / bDist : 1;
          const pushZ = bDist > 0.1 ? bdz / bDist : 0;
          jeep.position.x = building.position.x + pushX * collisionDist;
          jeep.position.z = building.position.z + pushZ * collisionDist;

          // Only deal damage at meaningful speed and off cooldown
          if (vehicleSpeed > 10 && jeep.collisionCooldown <= 0) {
            const impactDmg = Math.min(20, Math.round(vehicleSpeed * 1.0));
            jeep.hp -= impactDmg;
            jeep.collisionCooldown = 1.0; // 1 second between building damage ticks
            jeep.speed *= -0.3; // bounce
            if (jeep.hp <= 0) { jeep.hp = 0; this.destroyJeep(jeep, building.id); break; }
          } else if (vehicleSpeed > 3) {
            jeep.speed *= 0.5; // slow down on gentle bump, no damage
          }
          break;
        }
      }
      if (jeep.hp <= 0) continue;

      // Collision with mobile units — 3 tiers based on speed
      if (vehicleSpeed > 1) {
        // Jeep's forward direction (normalized)
        const jeepDirX = vehicleSpeed > 0.1 ? jeep.velocity.x / vehicleSpeed : 0;
        const jeepDirZ = vehicleSpeed > 0.1 ? jeep.velocity.z / vehicleSpeed : 0;

        for (const other of this.entities.values()) {
          if (other.id === jeep.id || other.hp <= 0) continue;
          if (other.entityType === 'jeep' || other.entityType === 'helicopter') continue;
          if (!MOBILE_TYPES.has(other.entityType)) continue;
          // Don't damage own team's FPS player if they're close (entering)
          if (other.entityType === 'fps_player' && other.teamId === jeep.teamId) continue;

          const odx = other.position.x - jeep.position.x;
          const odz = other.position.z - jeep.position.z;
          const oDist = Math.sqrt(odx * odx + odz * odz);
          if (oDist < JEEP_COLLISION_RADIUS + 1.0) {
            // Tank shield sphere vs jeep: if enemy unit is inside an active tank shield, destroy the jeep
            if (other.teamId !== jeep.teamId && vehicleSpeed > 10) {
              let shieldBlocked = false;
              for (const ent of this.entities.values()) {
                if (ent.entityType !== 'fps_player') continue;
                const tank = ent as FPSPlayerEntity;
                if (tank.teamId !== other.teamId) continue;
                if (!tank.heroAbilityActive || tank.heroType !== 'tank' || tank.shieldHp <= 0) continue;
                // Is the collision target inside this shield?
                const tdx2 = other.position.x - tank.position.x;
                const tdz2 = other.position.z - tank.position.z;
                if (Math.sqrt(tdx2 * tdx2 + tdz2 * tdz2) <= SHIELD_RADIUS) {
                  // Jeep is hitting from outside the shield — destroy it
                  const jdx = jeep.position.x - tank.position.x;
                  const jdz = jeep.position.z - tank.position.z;
                  if (Math.sqrt(jdx * jdx + jdz * jdz) > SHIELD_RADIUS) {
                    this.destroyJeep(jeep, tank.id);
                    this.deactivateHeroAbility(tank, true);
                    shieldBlocked = true;
                    break;
                  }
                }
              }
              if (shieldBlocked) break;
            }

            // Determine push-aside direction: perpendicular to jeep's heading
            // Pick the side the unit is on relative to the jeep's forward vector
            const cross = jeepDirX * odz - jeepDirZ * odx; // cross product sign
            const sideX = cross >= 0 ? -jeepDirZ : jeepDirZ;
            const sideZ = cross >= 0 ? jeepDirX : -jeepDirX;

            let dmgToUnit = 0;
            if (vehicleSpeed <= 10) {
              // Nudge out of the way, no damage
              other.position.x += (sideX * 3 + jeepDirX * 2);
              other.position.z += (sideZ * 3 + jeepDirZ * 2);
            } else if (vehicleSpeed <= 15) {
              dmgToUnit = Math.floor(other.maxHp * 0.15);
              other.hp -= dmgToUnit;
              if (other.hp < 0) other.hp = 0;
              const bounceStrength = vehicleSpeed * 0.4;
              other.position.x += (jeepDirX * bounceStrength * 0.7 + sideX * bounceStrength * 0.5);
              other.position.z += (jeepDirZ * bounceStrength * 0.7 + sideZ * bounceStrength * 0.5);
            } else if (vehicleSpeed <= 20) {
              dmgToUnit = Math.floor(other.maxHp * 0.30);
              other.hp -= dmgToUnit;
              if (other.hp < 0) other.hp = 0;
              const bounceStrength = vehicleSpeed * 0.5;
              other.position.x += (jeepDirX * bounceStrength * 0.7 + sideX * bounceStrength * 0.5);
              other.position.z += (jeepDirZ * bounceStrength * 0.7 + sideZ * bounceStrength * 0.5);
            } else if (vehicleSpeed <= 25) {
              dmgToUnit = Math.floor(other.maxHp * 0.50);
              other.hp -= dmgToUnit;
              if (other.hp < 0) other.hp = 0;
              const bounceStrength = vehicleSpeed * 0.7;
              other.position.x += (jeepDirX * bounceStrength * 0.7 + sideX * bounceStrength * 0.5);
              other.position.z += (jeepDirZ * bounceStrength * 0.7 + sideZ * bounceStrength * 0.5);
            } else {
              dmgToUnit = other.hp; // instant kill
              other.hp = 0;
              const launchStrength = vehicleSpeed * 1.2;
              other.position.x += jeepDirX * launchStrength + sideX * 2;
              other.position.z += jeepDirZ * launchStrength + sideZ * 2;
            }

            // Fire kill callback for vehicle collision kills
            if (other.hp <= 0 && dmgToUnit > 0) {
              this.onEntityKill?.(other, jeep.id);
            }

            // Jeep takes 10% of damage dealt to unit, capped at 20
            if (dmgToUnit > 0) {
              const selfDmg = Math.min(20, Math.round(dmgToUnit * 0.1));
              jeep.hp -= selfDmg;
              if (jeep.hp <= 0) { jeep.hp = 0; this.destroyJeep(jeep, other.id); }
            }

            // Track killer for fps_player
            if (other.entityType === 'fps_player') {
              (other as FPSPlayerEntity).lastDamagedBy = jeep.id;
            }
          }
        }
      }
      if (jeep.hp <= 0) continue; // jeep destroyed by unit collision

      // Move passengers with vehicle
      if (jeep.driverId) {
        const driver = this.entities.get(jeep.driverId);
        if (driver) {
          driver.position = { ...jeep.position, y: jeep.position.y + 1.5 };
        }
      }
      if (jeep.gunnerId) {
        const gunner = this.entities.get(jeep.gunnerId);
        if (gunner) {
          gunner.position = { ...jeep.position, y: jeep.position.y + 2.5 };
        }
      }

      // Auto-turret: fires when FPS player is driving (same stats as player_tower)
      if (jeep.driverId) {
        // Use towerTurrets map for jeep turret state
        let turret = this.towerTurrets.get(jeep.id);
        if (!turret) {
          turret = { targetId: null, fireCooldown: 0 };
          this.towerTurrets.set(jeep.id, turret);
        }
        turret.fireCooldown = Math.max(0, turret.fireCooldown - dt);

        // Find closest enemy within player_tower range (25 units)
        const enemyTeam: TeamId = jeep.teamId === 1 ? 2 : 1;
        let bestTarget: Entity | null = null;
        let bestDist = TOWER_RANGE;
        for (const ent of this.entities.values()) {
          if (ent.teamId === jeep.teamId || ent.hp <= 0) continue;
          if (ent.layerId !== jeep.layerId) continue;
          if (!MOBILE_TYPES.has(ent.entityType)) continue;
          const d = dist3D(jeep.position, ent.position);
          if (d < bestDist) { bestDist = d; bestTarget = ent; }
        }
        turret.targetId = bestTarget?.id ?? null;

        if (bestTarget && turret.fireCooldown <= 0) {
          turret.fireCooldown = TOWER_FIRE_RATE;
          const hit = Math.random() < 0.5;
          if (hit) {
            // Jeep turret: 0.3x multiplier (3x player_tower)
            const damage = Math.max(1, Math.round(TOWER_DAMAGE * 0.3));
            this.applyDamage(bestTarget, damage, jeep.id);
            if (jeep.driverId) this.onJeepTurretHit?.(jeep.driverId, bestTarget.id);
          }
          // Signal fired: z=1, x encodes turret angle for client
          const tdx = bestTarget.position.x - jeep.position.x;
          const tdz = bestTarget.position.z - jeep.position.z;
          const turretAngle = Math.atan2(tdx, tdz);
          // Encode: rotation.y stays as heading, use x for turret aim angle (radians)
          jeep.rotation = { x: turretAngle, y: jeep.heading, z: 1 };
        } else {
          jeep.rotation = { x: 0, y: jeep.heading, z: 0 };
        }
      } else {
        // No driver — remove turret state
        this.towerTurrets.delete(jeep.id);
      }
    }

    // ---- Helicopter updates ----
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'helicopter') continue;
      const heli = entity as HelicopterEntity;
      if (heli.hp <= 0) continue;

      // RTS auto-drive when no driver (ground-level only)
      if (!heli.driverId && heli.rtsMoveTarget) {
        const dx = heli.rtsMoveTarget.x - heli.position.x;
        const dz = heli.rtsMoveTarget.z - heli.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 3) {
          heli.rtsMoveTarget = null;
          heli.speed *= 0.5;
        } else {
          const targetHeading = Math.atan2(-dx, -dz);
          let headingDiff = targetHeading - heli.heading;
          while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
          while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
          const steerAmount = Math.min(1, Math.max(-1, headingDiff * 2));
          const absSpeed = Math.abs(heli.speed);
          const turnFactor = Math.min(1, absSpeed / 5);
          heli.heading += steerAmount * HELI_TURN_RATE * turnFactor * dt;
          if (Math.abs(headingDiff) < Math.PI / 3) {
            if (heli.speed < HELI_MAX_SPEED * 0.7) heli.speed += HELI_ACCELERATION * dt;
          } else {
            heli.speed *= (1 - 2 * dt);
          }
          const cosH = Math.cos(heli.heading);
          const sinH = Math.sin(heli.heading);
          heli.velocity.x = -sinH * heli.speed;
          heli.velocity.z = -cosH * heli.speed;
        }
      }

      // Apply friction when a driver is present but not sending input this tick
      if (heli.driverId && !heli.inputThisTick) {
        const drag = HELI_FRICTION * dt;
        if (Math.abs(heli.speed) < drag) heli.speed = 0;
        else heli.speed -= Math.sign(heli.speed) * drag;
        const cosH = Math.cos(heli.heading);
        const sinH = Math.sin(heli.heading);
        heli.velocity.x = -sinH * heli.speed;
        heli.velocity.z = -cosH * heli.speed;
        // Hover drift only when airborne; stationary on ground
        const driftTerrainY = this.heightmap.getHeight(heli.position.x, heli.position.z);
        heli.velocity.y = heli.position.y > driftTerrainY + 0.1 ? HELI_HOVER_DRIFT : 0;
      }
      // When no driver at all and not RTS-moving, zero out velocity
      if (!heli.driverId && !heli.rtsMoveTarget) {
        const drag = HELI_FRICTION * dt;
        if (Math.abs(heli.speed) < drag) heli.speed = 0;
        else heli.speed -= Math.sign(heli.speed) * drag;
        heli.velocity.x = 0;
        heli.velocity.z = 0;
        const idleTerrainY = this.heightmap.getHeight(heli.position.x, heli.position.z);
        heli.velocity.y = heli.position.y > idleTerrainY + 0.1 ? HELI_HOVER_DRIFT : 0;
      }
      heli.inputThisTick = false;

      // Integrate position
      heli.position.x += heli.velocity.x * dt;
      heli.position.y += heli.velocity.y * dt;
      heli.position.z += heli.velocity.z * dt;

      // Ground clamp + altitude cap (terrain-aware)
      const heliTerrainY = this.heightmap.getHeight(heli.position.x, heli.position.z);
      if (heli.position.y > heliTerrainY + HELI_MAX_ALTITUDE) {
        heli.position.y = heliTerrainY + HELI_MAX_ALTITUDE;
        if (heli.velocity.y > 0) heli.velocity.y = 0;
      }
      if (heli.position.y < heliTerrainY) {
        heli.position.y = heliTerrainY;
        if (heli.velocity.y < 0) heli.velocity.y = 0;
      }

      // Map bounds
      const halfW = this.mapBounds.halfW;
      const halfD = this.mapBounds.halfD;
      heli.position.x = Math.max(-halfW + 2, Math.min(halfW - 2, heli.position.x));
      heli.position.z = Math.max(-halfD + 2, Math.min(halfD - 2, heli.position.z));

      // Store heading in rotation.y
      heli.rotation.y = heli.heading;

      // Building collision (only when close to ground)
      if (heli.position.y < heliTerrainY + 6) {
        const vehicleSpeed = Math.sqrt(heli.velocity.x * heli.velocity.x + heli.velocity.z * heli.velocity.z);
        heli.collisionCooldown = Math.max(0, heli.collisionCooldown - dt);
        for (const building of this.entities.values()) {
          if (building.hp <= 0) continue;
          const radius = BUILDING_RADII[building.entityType];
          if (radius === undefined) continue;
          const bdx = heli.position.x - building.position.x;
          const bdz = heli.position.z - building.position.z;
          const bDist = Math.sqrt(bdx * bdx + bdz * bdz);
          const collisionDist = radius + HELI_COLLISION_RADIUS;
          if (bDist < collisionDist) {
            const pushX = bDist > 0.1 ? bdx / bDist : 1;
            const pushZ = bDist > 0.1 ? bdz / bDist : 0;
            heli.position.x = building.position.x + pushX * collisionDist;
            heli.position.z = building.position.z + pushZ * collisionDist;
            if (vehicleSpeed > 10 && heli.collisionCooldown <= 0) {
              const impactDmg = Math.min(20, Math.round(vehicleSpeed * 1.0));
              heli.hp -= impactDmg;
              heli.collisionCooldown = 1.0;
              heli.speed *= -0.3;
              if (heli.hp <= 0) { heli.hp = 0; this.destroyHelicopter(heli, building.id); break; }
            } else if (vehicleSpeed > 3) {
              heli.speed *= 0.5;
            }
            break;
          }
        }
      }
      if (heli.hp <= 0) continue;

      // Move pilot with helicopter
      if (heli.driverId) {
        const driver = this.entities.get(heli.driverId);
        if (driver) {
          driver.position = { ...heli.position, y: heli.position.y + 1.5 };
        }
      }

      // Player-controlled gun — no auto-turret, pilot aims with mouse
      // Damage is handled via fps_hit messages from the client
      heli.rotation = { x: 0, y: heli.heading, z: 0 };
      this.towerTurrets.delete(heli.id);
    }
  }

  // ===================== Training =====================

  private updateTraining(dt: number): void {
    for (const [, tq] of this.trainingQueues) {
      if (tq.queue.length === 0) continue;
      const current = tq.queue[0];
      if (this.instantBuild) current.elapsed = current.duration;
      else current.elapsed += dt;
      if (current.elapsed >= current.duration) {
        const isUpgrade = current.unitType.startsWith('upgrade_');
        tq.queue.shift();
        if (isUpgrade) this.onUpgradeComplete?.(tq.teamId);
        const base = this.entities.get(tq.baseId);
        if (base) {
          if (current.unitType === 'foot_soldier') {
            this.spawnFootSoldier(tq.teamId, base.position);
          } else if (current.unitType === 'archer') {
            this.spawnArcher(tq.teamId, base.position);
          } else if (current.unitType === 'jeep') {
            this.spawnJeep(tq.teamId, base.position);
          } else if (current.unitType === 'helicopter') {
            this.spawnHelicopter(tq.teamId, base.position);
          } else if (current.unitType === 'upgrade_barracks') {
            const barracksLvl = base.level ?? 1;
            if (barracksLvl < 2) {
              this.applyGlobalUpgrade(tq.teamId, 'barracks', 2);
            } else {
              // Unit upgrade completion (barracks already level 2+)
              this.unitUpgradeLevel[tq.teamId] = Math.min(2, (this.unitUpgradeLevel[tq.teamId] ?? 0) + 1);
            }
          } else if (current.unitType === 'upgrade_base') {
            this.applyGlobalUpgrade(tq.teamId, 'main_base', 2);
          } else if (current.unitType === 'upgrade_harvest') {
            this.harvestBoost[tq.teamId] = true;
          } else if (current.unitType === 'upgrade_armory') {
            const newLvl = (base.level ?? 1) + 1;
            this.applyGlobalUpgrade(tq.teamId, 'armory', newLvl);
          } else if (current.unitType === 'upgrade_armory_l3') {
            this.armoryLevel3[tq.teamId] = true;
          } else if (current.unitType === 'upgrade_tower') {
            const newLevel = Math.min(3, (base.level ?? 1) + 1);
            this.applyGlobalUpgrade(tq.teamId, base.entityType, newLevel);
          } else if (current.unitType === 'upgrade_hero_hp') {
            const lvl = (this.heroHpLevel[tq.teamId] ?? 0) + 1;
            this.heroHpLevel[tq.teamId] = Math.min(3, lvl);
            // Immediately update living FPS player's maxHp
            for (const e of this.entities.values()) {
              if (e.entityType === 'fps_player' && e.teamId === tq.teamId) {
                const fps = e as FPSPlayerEntity;
                const newMax = Math.round(100 * HERO_HP_MULT[lvl - 1]);
                const ratio = fps.maxHp > 0 ? fps.hp / fps.maxHp : 1;
                fps.maxHp = newMax;
                if (!fps.isDead) fps.hp = Math.round(newMax * ratio);
              }
            }
            this.onHeroUpgrade?.(tq.teamId, 'hero_hp');
          } else if (current.unitType === 'upgrade_hero_dmg') {
            this.heroDmgLevel[tq.teamId] = Math.min(3, (this.heroDmgLevel[tq.teamId] ?? 0) + 1);
            this.onHeroUpgrade?.(tq.teamId, 'hero_damage');
          } else if (current.unitType === 'upgrade_hero_regen') {
            this.heroRegen[tq.teamId] = true;
            this.onHeroUpgrade?.(tq.teamId, 'hero_regen');
          } else {
            this.spawnWorker(tq.teamId, base.position);
          }
        }
      }
    }
  }

  // ===================== Construction =====================

  private updateConstruction(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.status !== 'constructing') continue;

      // Check if a worker is building this
      let hasBuilder = false;
      for (const e of this.entities.values()) {
        if (e.entityType === 'worker') {
          const g = e as WorkerEntity;
          if (g.state === 'building' && g.buildTargetId === entity.id) {
            hasBuilder = true;
            break;
          }
        }
      }

      if (hasBuilder) {
        if (this.instantBuild) {
          entity.constructionProgress = 1;
        } else {
          const buildTime = BUILDING_CONSTRUCTION_TIME[entity.entityType] ?? CONSTRUCTION_TIME;
          entity.constructionProgress += dt / buildTime;
        }
      }

      if (entity.constructionProgress >= 1) {
        entity.constructionProgress = 1;
        entity.status = 'active';
        this.onBuildingBuilt?.(entity);

        if (entity.entityType === 'farm') {
          this.teamSupply[entity.teamId].cap += FARM_SUPPLY_BONUS;
        }

        // Register turret for shooting AI
        if (entity.entityType === 'turret' || entity.entityType === 'player_tower' || entity.entityType === 'main_base') {
          this.towerTurrets.set(entity.id, { targetId: null, fireCooldown: 0 });
        }

        // Reassign crystal nodes when a new HQ is built
        if (entity.entityType === 'main_base') {
          this.reassignCrystalNodes();
        }

        // Release builders or advance to next queued building
        for (const e of this.entities.values()) {
          if (e.entityType === 'worker') {
            const g = e as WorkerEntity;
            if (g.buildTargetId === entity.id) {
              const nextId = g.buildQueue.shift();
              if (nextId) {
                const nextBuilding = this.entities.get(nextId);
                if (nextBuilding && nextBuilding.status === 'constructing') {
                  g.buildTargetId = nextId;
                  g.state = 'moving_to_build';
                } else {
                  // Queued building was destroyed or already done — clear queue
                  g.buildTargetId = null;
                  g.buildQueue = [];
                  g.state = 'idle';
                }
              } else {
                g.buildTargetId = null;
                g.state = 'idle';
              }
            }
          }
        }
      }
    }
  }

  // ===================== Worker AI =====================

  private updateWorkers(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'worker') continue;
      const worker = entity as WorkerEntity;
      if (worker.hp <= 0) continue;

      // When frozen, only allow player-commanded movement states
      const playerCmdStates = new Set(['moving', 'moving_to_node', 'moving_to_build', 'moving_to_attack', 'moving_to_repair', 'following']);
      if (this.unitsFrozen && !playerCmdStates.has(worker.state)) continue;

      switch (worker.state) {
        case 'idle': break;

        case 'moving': {
          if (!worker.movePoint) { worker.state = 'idle'; break; }
          if (this.moveToward(worker, worker.movePoint, WORKER_SPEED, dt)) {
            worker.movePoint = null;
            worker.state = 'idle';
          }
          break;
        }

        case 'moving_to_node': {
          const node = worker.targetId ? this.entities.get(worker.targetId) : null;
          if (!node || node.hp <= 0) { worker.state = 'idle'; worker.targetId = null; break; }
          // Check distance directly — if close enough, start harvesting even if moveToward
          // didn't return true (wall-following can prevent convergence)
          const nodeDist = this.distXZ(worker.position, node.position);
          if (nodeDist <= 3) {
            worker.state = 'harvesting';
            worker.harvestTimer = 0;
          } else {
            this.moveToward(worker, node.position, WORKER_SPEED, dt, 2);
          }
          break;
        }

        case 'harvesting': {
          const hNode = worker.targetId ? this.entities.get(worker.targetId) : null;
          if (!hNode || hNode.hp <= 0) {
            worker.state = 'idle'; worker.targetId = null; break;
          }
          worker.harvestTimer += dt;
          if (worker.harvestTimer >= WORKER_HARVEST_TIME) {
            const harvest = Math.min(WORKER_HARVEST_AMOUNT, hNode.hp);
            worker.carriedCrystals = harvest;
            hNode.hp -= harvest;
            if (hNode.hp <= 0) hNode.hp = 0; // will be cleaned up
            worker.state = 'returning';
          }
          break;
        }

        case 'returning': {
          const base = this.getReturnBase(worker);
          if (!base) { worker.state = 'idle'; break; }
          // Check distance directly — deposit if close enough
          const baseDist = this.distXZ(worker.position, base.position);
          if (baseDist <= 5) {
            const crystals = this.harvestBoost[worker.teamId] ? worker.carriedCrystals * 2 : worker.carriedCrystals;
            this.teamResources[worker.teamId] += crystals;
            this.onCrystalsDeposited?.(worker.teamId, crystals);
            worker.carriedCrystals = 0;
            worker.state = worker.targetId ? 'moving_to_node' : 'idle';
          } else {
            this.moveToward(worker, base.position, WORKER_SPEED, dt, 3);
          }
          break;
        }

        case 'moving_to_attack': {
          const target = worker.targetId ? this.entities.get(worker.targetId) : null;
          if (!target || target.hp <= 0) { worker.state = 'idle'; worker.targetId = null; break; }
          const range = this.attackRange(target, WORKER_ATTACK_RANGE);
          if (this.distXZ(worker.position, target.position) <= range) {
            worker.state = 'attacking';
            worker.attackTimer = 0;
          } else {
            this.moveToward(worker, target.position, WORKER_SPEED, dt, range - 0.5);
          }
          break;
        }

        case 'attacking': {
          const target = worker.targetId ? this.entities.get(worker.targetId) : null;
          if (!target || target.hp <= 0) { worker.state = 'idle'; worker.targetId = null; break; }
          worker.attackTimer += dt;
          if (worker.attackTimer >= WORKER_ATTACK_INTERVAL) {
            worker.attackTimer = 0;
            target.hp -= WORKER_DAMAGE;
            if (target.hp <= 0) target.hp = 0;
          }
          break;
        }

        case 'moving_to_build': {
          const building = worker.buildTargetId ? this.entities.get(worker.buildTargetId) : null;
          if (!building || building.status !== 'constructing') {
            // Current target gone — try next in queue
            const nextId = worker.buildQueue.shift();
            const nextBuilding = nextId ? this.entities.get(nextId) : null;
            if (nextBuilding && nextBuilding.status === 'constructing') {
              worker.buildTargetId = nextId!;
              break;
            }
            worker.buildTargetId = null;
            worker.buildQueue = [];
            worker.state = 'idle';
            break;
          }
          if (this.distXZ(worker.position, building.position) <= 3) {
            worker.state = 'building';
          } else {
            this.moveToward(worker, building.position, WORKER_SPEED, dt, 2.5);
          }
          break;
        }

        case 'building': {
          const building = worker.buildTargetId ? this.entities.get(worker.buildTargetId) : null;
          if (!building || building.status !== 'constructing') {
            // Current target gone — try next in queue
            const nextId = worker.buildQueue.shift();
            const nextBuilding = nextId ? this.entities.get(nextId) : null;
            if (nextBuilding && nextBuilding.status === 'constructing') {
              worker.buildTargetId = nextId!;
              worker.state = 'moving_to_build';
              break;
            }
            worker.buildTargetId = null;
            worker.buildQueue = [];
            worker.state = 'idle';
            break;
          }
          if (this.distXZ(worker.position, building.position) > 5) {
            worker.state = 'idle';
            worker.buildTargetId = null;
          }
          break;
        }

        case 'moving_to_repair': {
          const building = worker.targetId ? this.entities.get(worker.targetId) : null;
          if (!building || building.hp <= 0 || building.hp >= building.maxHp || building.status !== 'active') {
            worker.targetId = null;
            worker.state = 'idle';
            break;
          }
          if (this.distXZ(worker.position, building.position) <= 3) {
            worker.state = 'repairing';
          } else {
            this.moveToward(worker, building.position, WORKER_SPEED, dt, 2.5);
          }
          break;
        }

        case 'repairing': {
          const building = worker.targetId ? this.entities.get(worker.targetId) : null;
          if (!building || building.hp <= 0 || building.hp >= building.maxHp || building.status !== 'active') {
            worker.targetId = null;
            worker.state = 'idle';
            break;
          }
          if (this.distXZ(worker.position, building.position) > 5) {
            worker.state = 'idle';
            worker.targetId = null;
            break;
          }
          building.hp = Math.min(building.maxHp, building.hp + REPAIR_RATE * dt);
          break;
        }

        case 'following': {
          const followTarget = worker.followTargetId ? this.entities.get(worker.followTargetId) : null;
          if (!followTarget || followTarget.hp <= 0) {
            worker.followTargetId = null;
            worker.state = 'idle';
            break;
          }
          const fDist = this.distXZ(worker.position, followTarget.position);
          if (fDist > 3) {
            this.moveToward(worker, followTarget.position, WORKER_SPEED, dt, 2.5);
          }
          break;
        }
      }
    }
  }

  // ===================== Fighter Waves =====================

  private updateWaves(dt: number): void {
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.spawnWave(1);
      this.spawnWave(2);
      this.waveTimer = WAVE_INTERVAL;
    }
  }

  /** Get the wave scaling multiplier — 15% stronger every 2 minutes */
  private getWaveStrengthMultiplier(): number {
    const intervals = Math.floor(this.gameTime / 120); // every 2 minutes
    return Math.pow(1.15, intervals);
  }

  /** Get the wave speed multiplier — 10% faster every 2 minutes */
  private getWaveSpeedMultiplier(): number {
    const intervals = Math.floor(this.gameTime / 120);
    return Math.pow(1.10, intervals);
  }

  private spawnWave(teamId: TeamId): void {
    if (this.wavesDisabled[teamId]) return;
    const teamFighters = this.getEntitiesByType('fighter', teamId);
    const canSpawn = Math.min(FIGHTERS_PER_WAVE, MAX_FIGHTERS_PER_TEAM - teamFighters.length);
    if (canSpawn <= 0) return;

    const base = this.getTeamBase(teamId);
    if (!base) return;

    const enemyTargets = this.getEnemyTargets(teamId);
    if (enemyTargets.length === 0) return;

    const sorted = [...enemyTargets].sort((a, b) => a.position.z - b.position.z);
    const upper = sorted[0];
    const lower = sorted[sorted.length - 1] ?? sorted[0];

    const hpMult = this.getWaveStrengthMultiplier();
    const scaledHP = Math.round(FIGHTER_HP * hpMult);

    for (let i = 0; i < canSpawn; i++) {
      this.fighterCounter++;
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 3;
      const target = i < canSpawn / 2 ? upper : lower;

      const fighter: FighterEntity = {
        id: uuid(), entityType: 'fighter',
        position: { x: base.position.x + Math.cos(angle) * dist, y: this.heightmap.getHeight(base.position.x + Math.cos(angle) * dist, base.position.z + Math.sin(angle) * dist), z: base.position.z + Math.sin(angle) * dist },
        rotation: vec3(), teamId, hp: scaledHP, maxHp: scaledHP,
        status: 'active', constructionProgress: 1,
        state: 'moving_to_target', assignedTargetId: target.id,
        currentEnemyId: null, attackTimer: 0, movePoint: null, followTargetId: null, layerId: 0,
      };
      this.addEntity(fighter);
    }
  }

  private getEnemyTargets(teamId: TeamId): Entity[] {
    const enemyTeam: TeamId = teamId === 1 ? 2 : 1;
    const towers = [...this.entities.values()].filter(
      e => e.entityType === 'tower' && e.teamId === enemyTeam && e.hp > 0,
    );
    if (towers.length > 0) return towers;
    return [...this.entities.values()].filter(
      e => e.entityType === 'main_base' && e.teamId === enemyTeam && e.hp > 0,
    );
  }

  // ===================== Fighter AI =====================

  updateFighters(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'fighter' && entity.entityType !== 'foot_soldier' && entity.entityType !== 'archer') continue;
      const fighter = entity as FighterEntity | FootSoldierEntity;
      if (fighter.hp <= 0) continue;

      // Per-type stats
      const isFS = entity.entityType === 'foot_soldier';
      const isArcher = entity.entityType === 'archer';
      const isPlayerUnit = isFS || isArcher;
      // Fighter wave scaling (player-trained units are not scaled)
      const unitUpLvl = isPlayerUnit ? (this.unitUpgradeLevel[entity.teamId] ?? 0) : 0;
      const unitDmgMult = unitUpLvl >= 2 ? 1.25 * 2.0 : unitUpLvl >= 1 ? 1.25 : 1; // Lv1: +25%, Lv2: +25% then +100%
      const unitHpMult = unitUpLvl >= 2 ? 1.25 * 2.0 : unitUpLvl >= 1 ? 1.25 : 1;
      const unitSpdMult = unitUpLvl >= 1 ? 1.25 : 1; // Only Lv1 adds speed
      const strengthMult = isPlayerUnit ? unitDmgMult : this.getWaveStrengthMultiplier();
      const speedMult = isPlayerUnit ? unitSpdMult : this.getWaveSpeedMultiplier();
      // Enemy tank shield slow: 66% reduction to speed and attack rate
      const shieldSlow = this.isInsideEnemyShield(entity) ? 0.34 : 1;
      const speed = (isArcher ? ARCHER_SPEED : isFS ? FOOT_SOLDIER_SPEED : FIGHTER_SPEED) * speedMult * shieldSlow;
      const atkRange = isArcher ? ARCHER_ATTACK_RANGE : isFS ? FOOT_SOLDIER_ATTACK_RANGE : FIGHTER_ATTACK_RANGE;
      const atkInterval = (isArcher ? ARCHER_ATTACK_INTERVAL : isFS ? FOOT_SOLDIER_ATTACK_INTERVAL : FIGHTER_ATTACK_INTERVAL) / shieldSlow;
      const dmgUnit = Math.round((isArcher ? ARCHER_DAMAGE : isFS ? FOOT_SOLDIER_DAMAGE : FIGHTER_DAMAGE_UNIT) * strengthMult);
      const dmgBldg = Math.round((isArcher ? ARCHER_DAMAGE : isFS ? FOOT_SOLDIER_DAMAGE : FIGHTER_DAMAGE_BUILDING) * strengthMult);

      const aggroRange = isArcher ? ARCHER_AGGRO_RANGE : isFS ? FOOT_SOLDIER_AGGRO_RANGE : FIGHTER_AGGRO_RANGE;

      // When frozen, only allow player-commanded movement (moving_to_point)
      if (this.unitsFrozen && fighter.state !== 'moving_to_point') continue;

      // Check if the player-assigned target is still alive; clear if dead
      if (fighter.assignedTargetId) {
        const t = this.entities.get(fighter.assignedTargetId);
        if (!t || t.hp <= 0) {
          fighter.assignedTargetId = null;
          // For auto-spawned fighters (not player units), find a new strategic target
          if (!isPlayerUnit) {
            fighter.assignedTargetId = this.findClosestEnemyTarget(fighter)?.id ?? null;
          }
        }
      }

      const effectiveTarget = fighter.assignedTargetId ? this.entities.get(fighter.assignedTargetId) : null;
      // Only player-trained units (foot_soldier, archer) get locked onto their assigned target.
      // Auto-spawned fighters use assignedTargetId for strategic routing but still aggro freely.
      const hasPlayerCommand = isPlayerUnit && !!fighter.assignedTargetId && !!effectiveTarget && effectiveTarget.hp > 0;

      switch (fighter.state) {
        case 'idle': {
          // If unit has a player-assigned target, go straight to it — no distractions
          if (hasPlayerCommand) {
            fighter.currentEnemyId = effectiveTarget!.id;
            fighter.state = 'moving_to_enemy';
            break;
          }

          // Check for nearby enemies (within aggro range)
          const nearby = this.findNearbyEnemyInRange(fighter, aggroRange);
          if (nearby) { fighter.currentEnemyId = nearby.id; fighter.state = 'moving_to_enemy'; break; }

          if (isPlayerUnit) {
            // Player-trained units: return to guard position if far from it
            const gu = fighter as FootSoldierEntity | ArcherEntity;
            if (gu.guardPosition && this.distXZ(gu.position, gu.guardPosition) > 2) {
              gu.movePoint = { ...gu.guardPosition };
              gu.state = 'moving_to_point';
            }
          } else {
            // Fighters: seek out enemy targets
            if (effectiveTarget && effectiveTarget.hp > 0) fighter.state = 'moving_to_target';
            else {
              const t = this.findClosestEnemyTarget(fighter);
              if (t) { fighter.assignedTargetId = t.id; fighter.state = 'moving_to_target'; }
            }
          }
          break;
        }

        case 'moving_to_point': {
          if (!fighter.movePoint) { fighter.state = 'idle'; break; }
          // Player-commanded move: don't auto-aggro during movement, obey the command
          // Auto-spawned fighters (not player units) can still aggro while moving
          if (!isPlayerUnit) {
            const nearby2 = this.findNearbyEnemyInRange(fighter, aggroRange);
            if (nearby2) { fighter.currentEnemyId = nearby2.id; fighter.state = 'moving_to_enemy'; break; }
          }
          if (this.moveToward(fighter, fighter.movePoint, speed, dt)) {
            fighter.movePoint = null;
            fighter.state = 'idle';
            // Arrived at destination — now check for nearby enemies to auto-engage
            const nearbyAtDest = this.findNearbyEnemyInRange(fighter, aggroRange);
            if (nearbyAtDest) {
              fighter.currentEnemyId = nearbyAtDest.id;
              fighter.state = 'moving_to_enemy';
            }
          }
          break;
        }

        case 'moving_to_target': {
          // Only auto-aggro if NOT player-commanded
          if (!hasPlayerCommand) {
            const nearby3 = this.findNearbyEnemyInRange(fighter, aggroRange);
            if (nearby3) { fighter.currentEnemyId = nearby3.id; fighter.state = 'moving_to_enemy'; break; }
          }
          if (!effectiveTarget || effectiveTarget.hp <= 0) { fighter.state = 'idle'; break; }
          const range = this.attackRange(effectiveTarget, atkRange);
          if (dist3D(fighter.position, effectiveTarget.position) <= range) {
            fighter.currentEnemyId = effectiveTarget.id;
            fighter.state = 'attacking'; fighter.attackTimer = 0;
          } else {
            this.moveToward(fighter, effectiveTarget.position, speed, dt, range - 0.5);
          }
          break;
        }

        case 'moving_to_enemy': {
          const enemy = fighter.currentEnemyId ? this.entities.get(fighter.currentEnemyId) : null;
          if (!enemy || enemy.hp <= 0) {
            fighter.currentEnemyId = null;
            // If player-assigned target still alive, snap back to it
            if (hasPlayerCommand) {
              fighter.currentEnemyId = effectiveTarget!.id;
              break;
            }
            fighter.state = 'idle';
            break;
          }
          const range = this.attackRange(enemy, atkRange);
          if (dist3D(fighter.position, enemy.position) <= range) {
            fighter.state = 'attacking'; fighter.attackTimer = 0;
          } else {
            this.moveToward(fighter, enemy.position, speed, dt, range - 0.5);
          }
          break;
        }

        case 'attacking': {
          const enemy = fighter.currentEnemyId ? this.entities.get(fighter.currentEnemyId) : null;
          if (!enemy || enemy.hp <= 0) {
            // Target dead — clear commanded target and go idle
            fighter.currentEnemyId = null;
            if (fighter.assignedTargetId === enemy?.id) fighter.assignedTargetId = null;
            fighter.state = 'idle';
            break;
          }
          // Ground melee units can't hit targets more than 4 units above/below them
          const heightDiff = Math.abs(enemy.position.y - fighter.position.y);
          if (!isArcher && heightDiff > 4) {
            fighter.currentEnemyId = null;
            fighter.state = 'idle';
            break;
          }
          // Never auto-switch away from a player-commanded target
          const isCommandedTarget = fighter.assignedTargetId === fighter.currentEnemyId;
          if (!isCommandedTarget && !MOBILE_TYPES.has(enemy.entityType)) {
            const nearby4 = this.findNearbyEnemyInRange(fighter, aggroRange);
            if (nearby4) { fighter.currentEnemyId = nearby4.id; fighter.state = 'moving_to_enemy'; break; }
          }
          const range = this.attackRange(enemy, atkRange);
          if (dist3D(fighter.position, enemy.position) > range + 1) { fighter.state = 'moving_to_enemy'; break; }
          fighter.attackTimer += dt;
          if (fighter.attackTimer >= atkInterval) {
            fighter.attackTimer = 0;

            // Archer accuracy: 100% at close range, decreasing with distance
            let hits = true;
            if (isArcher) {
              const eDist = dist3D(fighter.position, enemy.position);
              const hitChance = Math.max(0.2, 1 - (eDist / ARCHER_ATTACK_RANGE) * 0.8);
              hits = Math.random() < hitChance;
            }

            if (hits) {
              const dmg = MOBILE_TYPES.has(enemy.entityType) ? dmgUnit : dmgBldg;
              this.applyDamage(enemy, dmg, fighter.id);
              if (enemy.hp <= 0) {
                fighter.currentEnemyId = null;
                if (fighter.assignedTargetId === enemy.id) fighter.assignedTargetId = null;
                fighter.state = 'idle';
              }
            }
          }
          break;
        }

        case 'following': {
          const followTarget = fighter.followTargetId ? this.entities.get(fighter.followTargetId) : null;
          if (!followTarget || followTarget.hp <= 0) {
            fighter.followTargetId = null;
            fighter.state = 'idle';
            break;
          }

          // Check for nearby enemies — attack them, then return to following
          const nearbyFollow = this.findNearbyEnemyInRange(fighter, aggroRange);
          if (nearbyFollow) {
            fighter.currentEnemyId = nearbyFollow.id;
            fighter.state = 'moving_to_enemy';
            break;
          }

          // Move toward the follow target, keeping ~3 units behind
          const followDist = this.distXZ(fighter.position, followTarget.position);
          if (followDist > 3) {
            this.moveToward(fighter, followTarget.position, speed, dt, 2.5);
          }
          break;
        }
      }

      // After combat ends (unit goes idle), return to following if follow target is alive
      if (fighter.state === 'idle' && fighter.followTargetId) {
        const ft = this.entities.get(fighter.followTargetId);
        if (ft && ft.hp > 0) {
          fighter.state = 'following';
        } else {
          fighter.followTargetId = null;
        }
      }
    }
  }

  // ===================== Cleanup =====================

  cleanupDead(): void {
    const toDelete: string[] = [];
    for (const [id, entity] of this.entities) {
      if (entity.hp > 0) continue;
      if (entity.entityType === 'fps_player') continue;
      // Resource nodes: remove when depleted (hp=0)
      // if (entity.entityType === 'resource_node') continue; // now depletable
      toDelete.push(id);
    }
    let toReassign = false;
    for (const id of toDelete) {
      const entity = this.entities.get(id);
      // Jeep destroyed: ensure occupants are killed
      if (entity?.entityType === 'jeep') {
        this.destroyJeep(entity as JeepEntity, '');
      }
      if (entity?.entityType === 'helicopter') {
        this.destroyHelicopter(entity as HelicopterEntity, '');
      }
      // Refund supply for dead workers/foot soldiers
      if (entity?.entityType === 'worker') {
        this.teamSupply[entity.teamId].used = Math.max(0, this.teamSupply[entity.teamId].used - WORKER_SUPPLY_COST);
      }
      if (entity?.entityType === 'foot_soldier') {
        this.teamSupply[entity.teamId].used = Math.max(0, this.teamSupply[entity.teamId].used - FOOT_SOLDIER_SUPPLY_COST);
      }
      if (entity?.entityType === 'archer') {
        this.teamSupply[entity.teamId].used = Math.max(0, this.teamSupply[entity.teamId].used - ARCHER_SUPPLY_COST);
      }
      if (entity?.entityType === 'jeep') {
        this.teamSupply[entity.teamId].used = Math.max(0, this.teamSupply[entity.teamId].used - JEEP_SUPPLY_COST);
      }
      if (entity?.entityType === 'helicopter') {
        this.teamSupply[entity.teamId].used = Math.max(0, this.teamSupply[entity.teamId].used - HELI_SUPPLY_COST);
      }
      // Reduce supply cap when a completed farm is destroyed
      if (entity?.entityType === 'farm' && entity.status === 'active') {
        this.teamSupply[entity.teamId].cap = Math.max(0, this.teamSupply[entity.teamId].cap - FARM_SUPPLY_BONUS);
      }
      // Reassign crystal nodes when an HQ is destroyed
      if (entity?.entityType === 'main_base') {
        // Defer until after deletion loop
        toReassign = true;
      }
      this.entities.delete(id);
    }
    if (toReassign) this.reassignCrystalNodes();
  }

  checkWinCondition(): void {
    for (const teamId of [1, 2] as const) {
      const hasBuildings = [...this.entities.values()].some(
        e => (e.entityType === 'tower' || e.entityType === 'main_base')
          && e.teamId === teamId && e.hp > 0,
      );
      if (!hasBuildings) {
        this.winner = teamId === 1 ? 2 : 1;
        return;
      }
    }
  }

  // ===================== Helpers =====================

  private findNearbyEnemy(fighter: Entity): Entity | null {
    return this.findNearbyEnemyInRange(fighter, FIGHTER_AGGRO_RANGE);
  }

  private findNearbyEnemyInRange(unit: Entity, range: number): Entity | null {
    let closest: Entity | null = null;
    let closestDist = range;
    const unitIsGround = unit.entityType !== 'helicopter' && unit.entityType !== 'fps_player';
    for (const e of this.entities.values()) {
      if (e.teamId === unit.teamId || e.hp <= 0 || !MOBILE_TYPES.has(e.entityType)) continue;
      if (e.layerId !== unit.layerId) continue;
      // Ground units can't target things more than 4 units above them (melee)
      if (unitIsGround && Math.abs(e.position.y - unit.position.y) > 4) continue;
      const d = dist3D(unit.position, e.position);
      if (d >= closestDist) continue;
      // Must have line-of-sight through terrain
      if (!this.hasLineOfSight(unit.position, e.position)) continue;
      // Limit fighters targeting a single FPS player: if 3+ nearby fighters are
      // already targeting this FPS player, skip them so they continue to towers/HQ
      if (e.entityType === 'fps_player' && unit.entityType === 'fighter') {
        if (this.isFPSTargetSaturated(e.id, unit.id)) continue;
      }
      closestDist = d;
      closest = e;
    }
    return closest;
  }

  /** Returns true if enough fighters are already targeting this FPS player. */
  private isFPSTargetSaturated(fpsId: string, excludeUnitId: string): boolean {
    let count = 0;
    for (const e of this.entities.values()) {
      if (e.id === excludeUnitId) continue;
      if (e.entityType !== 'fighter' || e.hp <= 0) continue;
      const f = e as FighterEntity;
      if (f.currentEnemyId === fpsId) count++;
      if (count >= 3) return true;
    }
    return false;
  }

  private findClosestEnemyTarget(fighter: Entity): Entity | null {
    const targets = this.getEnemyTargets(fighter.teamId);
    if (targets.length === 0) return null;
    let closest = targets[0];
    let cd = dist3D(fighter.position, closest.position);
    for (let i = 1; i < targets.length; i++) {
      const d = dist3D(fighter.position, targets[i].position);
      if (d < cd) { cd = d; closest = targets[i]; }
    }
    return closest;
  }

  private attackRange(target: Entity, baseRange: number): number {
    return baseRange + (BUILDING_RADII[target.entityType] ?? 0);
  }

  // Wall-follow state: committed direction persists until the wall ends
  private wallFollowDir = new Map<string, { dx: number; dz: number; reverseCount: number }>();

  private moveToward(entity: Entity, target: Vec3, speed: number, dt: number, stopDist = 1.0): boolean {
    const dx = target.x - entity.position.x;
    const dz = target.z - entity.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= stopDist) return true;

    // Build exempt set for workers approaching buildings they need to reach
    const exempt = new Set<string>();
    if (entity.entityType === 'worker') {
      const w = entity as WorkerEntity;
      if (w.buildTargetId) exempt.add(w.buildTargetId);
      if (w.targetId) exempt.add(w.targetId);
      if (w.state === 'returning') {
        const base = this.getReturnBase(w);
        if (base) exempt.add(base.id);
      }
    }

    const dirX = dx / dist;
    const dirZ = dz / dist;
    const moveDist = Math.min(speed * dt, dist - stopDist);

    // First: can we go directly toward the target?
    const directX = entity.position.x + dirX * moveDist;
    const directZ = entity.position.z + dirZ * moveDist;
    const directBlocked = this.isPositionBlocked(directX, directZ, entity.id, exempt);

    if (!directBlocked) {
      // Direct path is clear — move and clear any wall-follow state
      entity.position.x = directX;
      entity.position.z = directZ;
      entity.position.y = this.getEntityGroundY(entity, directX, directZ);
      this.wallFollowDir.delete(entity.id);
      return this.distXZ(entity.position, target) <= stopDist;
    }

    // Direct path blocked. Are we already wall-following?
    let wf = this.wallFollowDir.get(entity.id);

    if (!wf) {
      // Start wall-following: pick a perpendicular direction
      const perpX1 = -dirZ, perpZ1 = dirX;
      const perpX2 = dirZ, perpZ2 = -dirX;
      const step = moveDist * 2;

      const b1 = this.isPositionBlocked(entity.position.x + perpX1 * step, entity.position.z + perpZ1 * step, entity.id, exempt);
      const b2 = this.isPositionBlocked(entity.position.x + perpX2 * step, entity.position.z + perpZ2 * step, entity.id, exempt);

      if (!b1 && !b2) {
        // Both open — pick closer to target
        const d1 = (target.x - (entity.position.x + perpX1 * step)) ** 2 + (target.z - (entity.position.z + perpZ1 * step)) ** 2;
        const d2 = (target.x - (entity.position.x + perpX2 * step)) ** 2 + (target.z - (entity.position.z + perpZ2 * step)) ** 2;
        wf = d1 < d2 ? { dx: perpX1, dz: perpZ1, reverseCount: 0 } : { dx: perpX2, dz: perpZ2, reverseCount: 0 };
      } else if (!b1) {
        wf = { dx: perpX1, dz: perpZ1, reverseCount: 0 };
      } else if (!b2) {
        wf = { dx: perpX2, dz: perpZ2, reverseCount: 0 };
      } else {
        // Both perpendiculars blocked — try 8 compass directions
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          const ax = Math.cos(a), az = Math.sin(a);
          if (!this.isPositionBlocked(entity.position.x + ax * step, entity.position.z + az * step, entity.id, exempt)) {
            wf = { dx: ax, dz: az, reverseCount: 0 };
            break;
          }
        }
        if (!wf) {
          // Truly stuck — random nudge
          entity.position.x += (Math.random() - 0.5) * 3;
          entity.position.z += (Math.random() - 0.5) * 3;
          entity.position.y = this.getEntityGroundY(entity);
          return false;
        }
      }
      this.wallFollowDir.set(entity.id, wf);
    }

    // Execute wall-follow: move in committed direction
    const wfStep = moveDist * 1.5;
    const wfX = entity.position.x + wf.dx * wfStep;
    const wfZ = entity.position.z + wf.dz * wfStep;

    if (!this.isPositionBlocked(wfX, wfZ, entity.id, exempt)) {
      entity.position.x = wfX;
      entity.position.z = wfZ;
      entity.position.y = this.getEntityGroundY(entity, wfX, wfZ);
    } else {
      // Wall-follow direction blocked (hit a corner) — reverse direction
      wf.dx = -wf.dx;
      wf.dz = -wf.dz;
      wf.reverseCount++;

      // If we've reversed too many times, we're oscillating — try a diagonal escape
      if (wf.reverseCount > 3) {
        // Try combining wall-follow with a bit of the target direction
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          const ax = Math.cos(a), az = Math.sin(a);
          const escX = entity.position.x + ax * wfStep * 2;
          const escZ = entity.position.z + az * wfStep * 2;
          if (!this.isPositionBlocked(escX, escZ, entity.id, exempt)) {
            entity.position.x = escX;
            entity.position.z = escZ;
            entity.position.y = this.getEntityGroundY(entity, escX, escZ);
            wf.dx = ax;
            wf.dz = az;
            wf.reverseCount = 0;
            break;
          }
        }
      }
    }

    return this.distXZ(entity.position, target) <= stopDist;
  }

  /** Check if a position would be inside any building or static obstacle */
  private isPositionBlocked(x: number, z: number, entityId: string, exempt?: Set<string>): boolean {
    const UNIT_R = 1.0;
    for (const building of this.entities.values()) {
      const col = BUILDING_COLLISION[building.entityType];
      if (!col || building.hp <= 0 || building.id === entityId) continue;
      if (exempt?.has(building.id)) continue;
      if (Math.abs(x - building.position.x) < UNIT_R + col.hx &&
          Math.abs(z - building.position.z) < UNIT_R + col.hz) {
        return true;
      }
    }
    for (const obs of this.staticObstacles) {
      if (Math.abs(x - obs.cx) < UNIT_R + obs.hx &&
          Math.abs(z - obs.cz) < UNIT_R + obs.hz) {
        return true;
      }
    }
    return false;
  }

  private distXZ(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Returns true if the entity is inside an enemy tank's active shield sphere. */
  isInsideEnemyShield(entity: Entity): boolean {
    for (const ent of this.entities.values()) {
      if (ent.entityType !== 'fps_player') continue;
      const tank = ent as FPSPlayerEntity;
      if (tank.teamId === entity.teamId) continue;
      if (tank.layerId !== entity.layerId) continue;
      if (!tank.heroAbilityActive || tank.heroType !== 'tank' || tank.shieldHp <= 0) continue;
      if (dist3D(entity.position, tank.position) <= SHIELD_RADIUS) return true;
    }
    return false;
  }

  /**
   * Full line-of-sight check: terrain + buildings + static obstacles.
   * Use this instead of heightmap.hasLineOfSight directly.
   */
  hasLineOfSight(from: Vec3, to: Vec3, eyeHeight: number = 1.5): boolean {
    // First check terrain occlusion (cheap)
    if (!this.heightmap.hasLineOfSight(from, to, eyeHeight)) return false;

    // Then check building/obstacle occlusion along the ray
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);
    if (distXZ < 2) return true;

    const fromY = from.y + eyeHeight;
    const toY = to.y + eyeHeight;

    // Check dynamic buildings (alive only)
    for (const building of this.entities.values()) {
      const col = BUILDING_COLLISION[building.entityType];
      if (!col || building.hp <= 0) continue;
      // Quick XZ bounding check: is the building anywhere near the ray?
      if (!this.rayIntersectsAABB(from.x, from.z, dx, dz, distXZ, fromY, toY,
        building.position.x, building.position.z, col.hx, col.hz, col.hy, col.cy + building.position.y)) continue;
      return false;
    }

    // Check static obstacles (trees, rocks, cover)
    for (const obs of this.staticObstacles) {
      if (!this.rayIntersectsAABB(from.x, from.z, dx, dz, distXZ, fromY, toY,
        obs.cx, obs.cz, obs.hx, obs.hz, obs.hy, obs.cy)) continue;
      return false;
    }

    return true;
  }

  /** Check if a ray (from→to in XZ) passes through an AABB and the ray height is below the top. */
  private rayIntersectsAABB(
    fx: number, fz: number, dx: number, dz: number, dist: number,
    fromY: number, toY: number,
    cx: number, cz: number, hx: number, hz: number, hy: number, cy: number,
  ): boolean {
    // Project ray onto the AABB's XZ footprint using parametric t
    const invDist = 1 / dist;
    const ndx = dx * invDist;
    const ndz = dz * invDist;

    // Slab intersection in X
    let tMinX: number, tMaxX: number;
    if (Math.abs(ndx) < 0.0001) {
      if (Math.abs(fx - cx) > hx) return false;
      tMinX = 0; tMaxX = dist;
    } else {
      const t1 = ((cx - hx) - fx) / ndx;
      const t2 = ((cx + hx) - fx) / ndx;
      tMinX = Math.min(t1, t2);
      tMaxX = Math.max(t1, t2);
    }

    // Slab intersection in Z
    let tMinZ: number, tMaxZ: number;
    if (Math.abs(ndz) < 0.0001) {
      if (Math.abs(fz - cz) > hz) return false;
      tMinZ = 0; tMaxZ = dist;
    } else {
      const t1 = ((cz - hz) - fz) / ndz;
      const t2 = ((cz + hz) - fz) / ndz;
      tMinZ = Math.min(t1, t2);
      tMaxZ = Math.max(t1, t2);
    }

    const tEnter = Math.max(tMinX, tMinZ, 0);
    const tExit = Math.min(tMaxX, tMaxZ, dist);
    if (tEnter >= tExit) return false;

    // Check if ray Y at the intersection segment is below the obstacle's top
    const tMid = (tEnter + tExit) * 0.5;
    const rayYAtMid = fromY + (toY - fromY) * (tMid / dist);
    const obsTop = cy + hy;
    const obsBottom = cy - hy;
    return rayYAtMid >= obsBottom && rayYAtMid <= obsTop;
  }

  /** Get the ground Y for an entity based on its layer (surface = terrain, underground = tunnel floor). */
  getEntityGroundY(entity: Entity, x?: number, z?: number): number {
    if (entity.layerId === 0) {
      return this.heightmap.getHeight(x ?? entity.position.x, z ?? entity.position.z);
    }
    // Underground: find the tunnel with this layer ID
    const tunnels = this.mapConfig.tunnels;
    if (tunnels) {
      for (const t of tunnels) {
        if (t.id === entity.layerId) return t.floorY;
      }
    }
    return 0;
  }

  // ===================== Portal / Tunnel Transitions =====================

  private updatePortalTransitions(): void {
    const tunnels = this.mapConfig.tunnels;
    if (!tunnels || tunnels.length === 0) return;

    for (const entity of this.entities.values()) {
      if (entity.hp <= 0) continue;
      // Only mobile entities can transition through portals
      if (!MOBILE_TYPES.has(entity.entityType) && entity.entityType !== 'fps_player') continue;

      for (const tunnel of tunnels) {
        for (const portal of tunnel.portals) {
          // XZ distance only — portals trigger at any height
          const dx = entity.position.x - portal.position.x;
          const dz = entity.position.z - portal.position.z;
          const distSq = dx * dx + dz * dz;

          if (distSq < portal.radius * portal.radius && entity.layerId !== portal.targetLayer) {
            // Only transition if entity is on the portal's source layer
            // (portals connect two layers; source is whichever layer the entity is currently on)
            const isOnSourceLayer =
              (entity.layerId === 0 && portal.targetLayer === tunnel.id) ||
              (entity.layerId === tunnel.id && portal.targetLayer === 0);
            if (!isOnSourceLayer) continue;

            entity.layerId = portal.targetLayer;
            // Compute correct Y: terrain height for surface, floorY for underground
            const targetY = portal.targetLayer === 0
              ? this.heightmap.getHeight(portal.targetPosition.x, portal.targetPosition.z)
              : tunnel.floorY;
            entity.position = { x: portal.targetPosition.x, y: targetY, z: portal.targetPosition.z };
            // Reset velocity for FPS players
            if (entity.entityType === 'fps_player') {
              (entity as FPSPlayerEntity).velocity = { x: 0, y: 0, z: 0 };
            }
            break;
          }
        }
      }
    }
  }

  // ===================== Snapshot =====================

  getSnapshot(): SnapshotEntity[] {
    const result: SnapshotEntity[] = [];
    for (const e of this.entities.values()) {
      const rotation = { ...e.rotation };
      // Encode worker carrying state in rotation.z (unused for workers)
      if (e.entityType === 'worker') {
        const w = e as WorkerEntity;
        rotation.z = (w.carriedCrystals > 0 || w.state === 'returning') ? 1 : 0;
      }
      const se: SnapshotEntity = {
        id: e.id, entityType: e.entityType,
        position: { ...e.position }, rotation,
        teamId: e.teamId, hp: e.hp, maxHp: e.maxHp,
        status: e.status, constructionProgress: e.constructionProgress,
      };
      if (e.level !== undefined) se.level = e.level;
      if (e.layerId !== 0) se.layerId = e.layerId;
      if (e.entityType === 'fps_player') {
        const fps = e as FPSPlayerEntity;
        if (fps.heroType) se.heroType = fps.heroType;
        se.heroAbilityActive = fps.heroAbilityActive;
        se.shieldHp = fps.shieldHp;
        se.abilityCharge = fps.heroAbilityCharge;
        se.abilityMaxCharge = HERO_ABILITY_MAX_CHARGE;
        se.abilityDepleted = fps.heroAbilityDepleted;
        se.abilityLockout = fps.heroAbilityLockout;
      }
      if (e.entityType === 'jeep') {
        const j = e as JeepEntity;
        se.driverId = j.driverId ?? undefined;
        se.gunnerId = j.gunnerId ?? undefined;
      }
      if (e.entityType === 'helicopter') {
        const h = e as HelicopterEntity;
        se.driverId = h.driverId ?? undefined;
      }
      result.push(se);
    }
    return result;
  }
}
