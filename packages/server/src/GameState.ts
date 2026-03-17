import { v4 as uuid } from 'uuid';
import type { Vec3, TeamId } from '@dyarchy/shared';
import {
  INITIAL_BUILDINGS,
  RESOURCE_NODES,
  TEAM_SPAWNS,
  PLAYER_HEIGHT,
  GROUND_Y,
} from '@dyarchy/shared';
import { applyMovement, vec3 } from '@dyarchy/shared';
import type { SnapshotEntity, FPSInputMsg } from '@dyarchy/shared';

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
}

export interface FPSPlayerEntity extends Entity {
  entityType: 'fps_player';
  velocity: Vec3;
  isDead: boolean;
  respawnTimer: number;
  activeWeapon: string;
  secondaryWeapon: string | null;
  armoryUnlocked: boolean;
}

export interface GruntEntity extends Entity {
  entityType: 'grunt';
  state: string;
  targetId: string | null;
  buildTargetId: string | null;
  movePoint: Vec3 | null;
  harvestTimer: number;
  carriedCrystals: number;
  attackTimer: number;
}

export interface FighterEntity extends Entity {
  entityType: 'fighter';
  state: string;
  assignedTargetId: string | null;
  currentEnemyId: string | null;
  attackTimer: number;
  movePoint: Vec3 | null;
}

export interface TrainingSlot {
  elapsed: number;
  duration: number;
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
const FIGHTER_ATTACK_RANGE = 1.5;
const FIGHTER_AGGRO_RANGE = 12;

const GRUNT_SPEED = 8;
const GRUNT_HARVEST_TIME = 5;
const GRUNT_HARVEST_AMOUNT = 10;
const GRUNT_DAMAGE = 1;
const GRUNT_ATTACK_INTERVAL = 2;
const GRUNT_ATTACK_RANGE = 2;
const GRUNT_COST = 100;
const GRUNT_TRAIN_TIME = 3;
const GRUNT_SUPPLY_COST = 1;
const MAX_TRAINING_QUEUE = 5;
const CONSTRUCTION_TIME = 10;
const BARRACKS_SUPPLY_BONUS = 5;

const BUILDING_COSTS: Record<string, number> = {
  barracks: 25, armory: 300, tower: 150,
};

// Tower turret
const TOWER_RANGE = 25;
const TOWER_DAMAGE = 10;
const TOWER_FIRE_RATE = 1.5; // seconds between shots
const TOWER_FPS_PRIORITY_RANGE = 30; // prioritize FPS player within this range

const BUILDING_RADII: Record<string, number> = {
  main_base: 5, tower: 3, barracks: 3.5, armory: 3.5, player_tower: 2.5,
};

const MOBILE_TYPES = new Set(['fighter', 'grunt', 'fps_player']);
const RESPAWN_TIME = 7;

// ===================== Game State =====================

export class GameState {
  entities = new Map<string, Entity>();
  teamResources: Record<number, number> = { 1: 1000, 2: 1000 };
  teamSupply: Record<number, { used: number; cap: number }> = {
    1: { used: 2, cap: 10 },
    2: { used: 0, cap: 10 },
  };
  trainingQueues = new Map<string, TrainingQueue>();
  towerTurrets = new Map<string, { targetId: string | null; fireCooldown: number }>();
  waveTimer = WAVE_INTERVAL;
  gameTime = 0;
  tick = 0;
  winner: TeamId | null = null;
  private fighterCounter = 0;

  constructor() {
    this.initMap();
  }

  private initMap(): void {
    for (const teamId of [1, 2] as const) {
      const buildings = INITIAL_BUILDINGS[teamId];
      this.addEntity({
        id: uuid(), entityType: 'main_base',
        position: { ...buildings.mainBase }, rotation: vec3(),
        teamId, hp: 100, maxHp: 100,
        status: 'active', constructionProgress: 1,
      });

      for (const tPos of buildings.towers) {
        const towerId = uuid();
        this.addEntity({
          id: towerId, entityType: 'tower',
          position: { ...tPos }, rotation: vec3(),
          teamId, hp: 100, maxHp: 100,
          status: 'active', constructionProgress: 1,
        });
        this.towerTurrets.set(towerId, { targetId: null, fireCooldown: 0 });
      }
    }

    for (const pos of RESOURCE_NODES) {
      this.addEntity({
        id: uuid(), entityType: 'resource_node',
        position: { ...pos }, rotation: vec3(),
        teamId: 1, hp: 100, maxHp: 100,
        status: 'active', constructionProgress: 1,
      });
    }

    // Starting grunts for team 1
    const base1 = this.getTeamBase(1);
    if (base1) {
      this.spawnGrunt(1, base1.position);
      this.spawnGrunt(1, base1.position);
    }
  }

  addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  getTeamBase(teamId: TeamId): Entity | undefined {
    for (const e of this.entities.values()) {
      if (e.entityType === 'main_base' && e.teamId === teamId) return e;
    }
    return undefined;
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
    this.updateGrunts(dt);
    this.updateTowerTurrets(dt);
    this.updateConstruction(dt);
    this.updateTraining(dt);
    this.updateFPSRespawns(dt);
    this.cleanupDead();
    this.checkWinCondition();
  }

  // ===================== FPS Player =====================

  spawnFPSPlayer(teamId: TeamId): FPSPlayerEntity {
    const spawn = TEAM_SPAWNS[teamId];
    const player: FPSPlayerEntity = {
      id: uuid(), entityType: 'fps_player',
      position: { x: spawn.x, y: GROUND_Y + PLAYER_HEIGHT, z: spawn.z },
      rotation: vec3(), teamId,
      hp: 100, maxHp: 100,
      status: 'active', constructionProgress: 1,
      velocity: vec3(), isDead: false, respawnTimer: 0,
      activeWeapon: 'pistol', secondaryWeapon: null, armoryUnlocked: false,
    };
    this.addEntity(player);
    return player;
  }

  applyFPSInput(playerId: string, input: FPSInputMsg): Vec3 | null {
    const player = this.entities.get(playerId) as FPSPlayerEntity | undefined;
    if (!player || player.isDead) return null;

    const result = applyMovement(
      { x: player.position.x, y: player.position.y - PLAYER_HEIGHT, z: player.position.z },
      player.velocity,
      {
        forward: input.keys.forward, backward: input.keys.backward,
        left: input.keys.left, right: input.keys.right,
        jump: input.keys.jump, yaw: input.yaw, pitch: input.pitch, dt: input.dt,
      },
      input.dt,
    );

    player.position = { x: result.position.x, y: result.position.y + PLAYER_HEIGHT, z: result.position.z };
    player.velocity = result.velocity;
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
      }

      // Count down respawn
      if (fps.isDead) {
        fps.respawnTimer -= dt;
        if (fps.respawnTimer <= 0) {
          const spawn = TEAM_SPAWNS[fps.teamId];
          fps.isDead = false;
          fps.hp = fps.maxHp;
          fps.position = { x: spawn.x, y: GROUND_Y + PLAYER_HEIGHT, z: spawn.z };
          fps.velocity = vec3();
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

      // Find best target: prioritize enemy FPS player, then closest enemy mobile unit
      const enemyTeam: TeamId = tower.teamId === 1 ? 2 : 1;
      let bestTarget: Entity | null = null;
      let bestDist = TOWER_RANGE;
      let foundFPS = false;

      for (const ent of this.entities.values()) {
        if (ent.teamId === tower.teamId) continue;
        if (ent.hp <= 0) continue;
        if (!MOBILE_TYPES.has(ent.entityType)) continue;

        const d = this.distXZ(tower.position, ent.position);
        if (d > TOWER_RANGE) continue;

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

      // Fire at target
      if (bestTarget && turret.fireCooldown <= 0) {
        turret.fireCooldown = TOWER_FIRE_RATE;
        bestTarget.hp -= TOWER_DAMAGE;
        if (bestTarget.hp <= 0) {
          bestTarget.hp = 0;
          turret.targetId = null;
        }

        // Point the tower's rotation toward the target (used by client for turret animation)
        const dx = bestTarget.position.x - tower.position.x;
        const dz = bestTarget.position.z - tower.position.z;
        tower.rotation = { x: 0, y: Math.atan2(dx, dz), z: turret.fireCooldown > TOWER_FIRE_RATE - 0.1 ? 1 : 0 };
        // rotation.z = 1 signals "just fired" to the client
      } else if (bestTarget) {
        // Track target even when not firing
        const dx = bestTarget.position.x - tower.position.x;
        const dz = bestTarget.position.z - tower.position.z;
        tower.rotation = { x: 0, y: Math.atan2(dx, dz), z: 0 };
      }
    }
  }

  // ===================== Grunt =====================

  spawnGrunt(teamId: TeamId, nearPos: Vec3): GruntEntity {
    const angle = Math.random() * Math.PI * 2;
    const grunt: GruntEntity = {
      id: uuid(), entityType: 'grunt',
      position: { x: nearPos.x + Math.cos(angle) * 6, y: 0, z: nearPos.z + Math.sin(angle) * 6 },
      rotation: vec3(), teamId, hp: 50, maxHp: 50,
      status: 'active', constructionProgress: 1,
      state: 'idle', targetId: null, buildTargetId: null,
      movePoint: null, harvestTimer: 0, carriedCrystals: 0, attackTimer: 0,
    };
    this.addEntity(grunt);
    return grunt;
  }

  // ===================== RTS Commands =====================

  handleRTSCommand(teamId: TeamId, cmd: { command: string; unitIds: string[]; targetPos?: Vec3; targetId?: string; buildingType?: string }): void {
    for (const unitId of cmd.unitIds) {
      const entity = this.entities.get(unitId);
      if (!entity || entity.teamId !== teamId) continue;

      if (entity.entityType === 'grunt') {
        const grunt = entity as GruntEntity;
        switch (cmd.command) {
          case 'move':
            if (cmd.targetPos) {
              grunt.state = 'moving';
              grunt.movePoint = { ...cmd.targetPos };
              grunt.targetId = null;
              grunt.buildTargetId = null;
              grunt.carriedCrystals = 0;
            }
            break;
          case 'harvest':
            if (cmd.targetId) {
              grunt.state = 'moving_to_node';
              grunt.targetId = cmd.targetId;
              grunt.buildTargetId = null;
              grunt.harvestTimer = 0;
              grunt.carriedCrystals = 0;
            }
            break;
          case 'attack':
            if (cmd.targetId) {
              grunt.state = 'moving_to_attack';
              grunt.targetId = cmd.targetId;
              grunt.buildTargetId = null;
              grunt.movePoint = null;
            }
            break;
          case 'build_at':
            if (cmd.targetId) {
              grunt.state = 'moving_to_build';
              grunt.buildTargetId = cmd.targetId;
              grunt.targetId = null;
              grunt.movePoint = null;
            }
            break;
        }
      }

      if (entity.entityType === 'fighter') {
        const fighter = entity as FighterEntity;
        switch (cmd.command) {
          case 'move':
            if (cmd.targetPos) {
              fighter.state = 'moving_to_point';
              fighter.movePoint = { ...cmd.targetPos };
              fighter.currentEnemyId = null;
            }
            break;
          case 'attack':
            if (cmd.targetId) {
              fighter.state = 'moving_to_enemy';
              fighter.currentEnemyId = cmd.targetId;
              fighter.movePoint = null;
            }
            break;
        }
      }
    }

    // Place building command (not per-unit)
    if (cmd.command === 'place_building' && cmd.buildingType && cmd.targetPos) {
      const builderGruntId = cmd.unitIds[0];
      this.placeBuildingForTeam(teamId, cmd.buildingType, cmd.targetPos, builderGruntId);
    }
  }

  placeBuildingForTeam(teamId: TeamId, buildingType: string, position: Vec3, builderGruntId?: string): string | null {
    const cost = BUILDING_COSTS[buildingType];
    if (cost === undefined) return null;
    if (this.teamResources[teamId] < cost) return null;

    this.teamResources[teamId] -= cost;

    const entityType = buildingType === 'tower' ? 'player_tower' : buildingType;
    const entity: Entity = {
      id: uuid(), entityType,
      position: { x: position.x, y: 0, z: position.z },
      rotation: vec3(), teamId,
      hp: 100, maxHp: 100,
      status: 'constructing', constructionProgress: 0,
    };
    this.addEntity(entity);

    // Send builder grunt
    if (builderGruntId) {
      const grunt = this.entities.get(builderGruntId) as GruntEntity | undefined;
      if (grunt) {
        grunt.state = 'moving_to_build';
        grunt.buildTargetId = entity.id;
        grunt.targetId = null;
        grunt.movePoint = null;
      }
    }

    return entity.id;
  }

  handleTrain(teamId: TeamId, baseId: string): void {
    const base = this.entities.get(baseId);
    if (!base || base.teamId !== teamId || base.entityType !== 'main_base') return;
    if (this.teamResources[teamId] < GRUNT_COST) return;
    if (this.teamSupply[teamId].used >= this.teamSupply[teamId].cap) return;

    let tq = this.trainingQueues.get(baseId);
    if (!tq) {
      tq = { baseId, teamId, queue: [] };
      this.trainingQueues.set(baseId, tq);
    }
    if (tq.queue.length >= MAX_TRAINING_QUEUE) return;

    tq.queue.push({ elapsed: 0, duration: GRUNT_TRAIN_TIME });
    this.teamResources[teamId] -= GRUNT_COST;
    this.teamSupply[teamId].used += GRUNT_SUPPLY_COST;
  }

  handleCancelTrain(teamId: TeamId, baseId: string, index: number): void {
    const tq = this.trainingQueues.get(baseId);
    if (!tq || tq.teamId !== teamId || index < 0 || index >= tq.queue.length) return;
    tq.queue.splice(index, 1);
    this.teamResources[teamId] += GRUNT_COST;
    this.teamSupply[teamId].used = Math.max(0, this.teamSupply[teamId].used - GRUNT_SUPPLY_COST);
  }

  // ===================== Training =====================

  private updateTraining(dt: number): void {
    for (const [, tq] of this.trainingQueues) {
      if (tq.queue.length === 0) continue;
      const current = tq.queue[0];
      current.elapsed += dt;
      if (current.elapsed >= current.duration) {
        tq.queue.shift();
        const base = this.entities.get(tq.baseId);
        if (base) {
          this.spawnGrunt(tq.teamId, base.position);
        }
      }
    }
  }

  // ===================== Construction =====================

  private updateConstruction(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.status !== 'constructing') continue;

      // Check if a grunt is building this
      let hasBuilder = false;
      for (const e of this.entities.values()) {
        if (e.entityType === 'grunt') {
          const g = e as GruntEntity;
          if (g.state === 'building' && g.buildTargetId === entity.id) {
            hasBuilder = true;
            break;
          }
        }
      }

      if (hasBuilder) {
        entity.constructionProgress += dt / CONSTRUCTION_TIME;
      }

      if (entity.constructionProgress >= 1) {
        entity.constructionProgress = 1;
        entity.status = 'active';

        if (entity.entityType === 'barracks') {
          this.teamSupply[entity.teamId].cap += BARRACKS_SUPPLY_BONUS;
        }

        // Release builders
        for (const e of this.entities.values()) {
          if (e.entityType === 'grunt') {
            const g = e as GruntEntity;
            if (g.buildTargetId === entity.id) {
              g.buildTargetId = null;
              g.state = 'idle';
            }
          }
        }
      }
    }
  }

  // ===================== Grunt AI =====================

  private updateGrunts(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.entityType !== 'grunt') continue;
      const grunt = entity as GruntEntity;
      if (grunt.hp <= 0) continue;

      switch (grunt.state) {
        case 'idle': break;

        case 'moving': {
          if (!grunt.movePoint) { grunt.state = 'idle'; break; }
          if (this.moveToward(grunt, grunt.movePoint, GRUNT_SPEED, dt)) {
            grunt.movePoint = null;
            grunt.state = 'idle';
          }
          break;
        }

        case 'moving_to_node': {
          const node = grunt.targetId ? this.entities.get(grunt.targetId) : null;
          if (!node) { grunt.state = 'idle'; grunt.targetId = null; break; }
          if (this.moveToward(grunt, node.position, GRUNT_SPEED, dt, 2)) {
            grunt.state = 'harvesting';
            grunt.harvestTimer = 0;
          }
          break;
        }

        case 'harvesting': {
          grunt.harvestTimer += dt;
          if (grunt.harvestTimer >= GRUNT_HARVEST_TIME) {
            grunt.carriedCrystals = GRUNT_HARVEST_AMOUNT;
            grunt.state = 'returning';
          }
          break;
        }

        case 'returning': {
          const base = this.getTeamBase(grunt.teamId);
          if (!base) { grunt.state = 'idle'; break; }
          if (this.moveToward(grunt, base.position, GRUNT_SPEED, dt, 3)) {
            this.teamResources[grunt.teamId] += grunt.carriedCrystals;
            grunt.carriedCrystals = 0;
            grunt.state = grunt.targetId ? 'moving_to_node' : 'idle';
          }
          break;
        }

        case 'moving_to_attack': {
          const target = grunt.targetId ? this.entities.get(grunt.targetId) : null;
          if (!target || target.hp <= 0) { grunt.state = 'idle'; grunt.targetId = null; break; }
          const range = this.attackRange(target, GRUNT_ATTACK_RANGE);
          if (this.distXZ(grunt.position, target.position) <= range) {
            grunt.state = 'attacking';
            grunt.attackTimer = 0;
          } else {
            this.moveToward(grunt, target.position, GRUNT_SPEED, dt, range - 0.5);
          }
          break;
        }

        case 'attacking': {
          const target = grunt.targetId ? this.entities.get(grunt.targetId) : null;
          if (!target || target.hp <= 0) { grunt.state = 'idle'; grunt.targetId = null; break; }
          grunt.attackTimer += dt;
          if (grunt.attackTimer >= GRUNT_ATTACK_INTERVAL) {
            grunt.attackTimer = 0;
            target.hp -= GRUNT_DAMAGE;
            if (target.hp <= 0) target.hp = 0;
          }
          break;
        }

        case 'moving_to_build': {
          const building = grunt.buildTargetId ? this.entities.get(grunt.buildTargetId) : null;
          if (!building || building.status !== 'constructing') {
            grunt.buildTargetId = null;
            grunt.state = 'idle';
            break;
          }
          if (this.distXZ(grunt.position, building.position) <= 3) {
            grunt.state = 'building';
          } else {
            this.moveToward(grunt, building.position, GRUNT_SPEED, dt, 2.5);
          }
          break;
        }

        case 'building': {
          const building = grunt.buildTargetId ? this.entities.get(grunt.buildTargetId) : null;
          if (!building || building.status !== 'constructing') {
            grunt.buildTargetId = null;
            grunt.state = 'idle';
            break;
          }
          if (this.distXZ(grunt.position, building.position) > 5) {
            grunt.state = 'idle';
            grunt.buildTargetId = null;
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

  private spawnWave(teamId: TeamId): void {
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

    for (let i = 0; i < canSpawn; i++) {
      this.fighterCounter++;
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 3;
      const target = i < canSpawn / 2 ? upper : lower;

      const fighter: FighterEntity = {
        id: uuid(), entityType: 'fighter',
        position: { x: base.position.x + Math.cos(angle) * dist, y: 0, z: base.position.z + Math.sin(angle) * dist },
        rotation: vec3(), teamId, hp: FIGHTER_HP, maxHp: FIGHTER_HP,
        status: 'active', constructionProgress: 1,
        state: 'moving_to_target', assignedTargetId: target.id,
        currentEnemyId: null, attackTimer: 0, movePoint: null,
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
      if (entity.entityType !== 'fighter') continue;
      const fighter = entity as FighterEntity;
      if (fighter.hp <= 0) continue;

      if (fighter.assignedTargetId) {
        const t = this.entities.get(fighter.assignedTargetId);
        if (!t || t.hp <= 0) fighter.assignedTargetId = this.findClosestEnemyTarget(fighter)?.id ?? null;
      }

      const effectiveTarget = fighter.assignedTargetId ? this.entities.get(fighter.assignedTargetId) : null;

      switch (fighter.state) {
        case 'idle': {
          const nearby = this.findNearbyEnemy(fighter);
          if (nearby) { fighter.currentEnemyId = nearby.id; fighter.state = 'moving_to_enemy'; }
          else if (effectiveTarget && effectiveTarget.hp > 0) fighter.state = 'moving_to_target';
          else {
            const t = this.findClosestEnemyTarget(fighter);
            if (t) { fighter.assignedTargetId = t.id; fighter.state = 'moving_to_target'; }
          }
          break;
        }

        case 'moving_to_point': {
          if (!fighter.movePoint) { fighter.state = 'idle'; break; }
          const nearby = this.findNearbyEnemy(fighter);
          if (nearby) { fighter.currentEnemyId = nearby.id; fighter.state = 'moving_to_enemy'; break; }
          if (this.moveToward(fighter, fighter.movePoint, FIGHTER_SPEED, dt)) {
            fighter.movePoint = null;
            fighter.state = 'idle';
          }
          break;
        }

        case 'moving_to_target': {
          const nearby = this.findNearbyEnemy(fighter);
          if (nearby) { fighter.currentEnemyId = nearby.id; fighter.state = 'moving_to_enemy'; break; }
          if (!effectiveTarget || effectiveTarget.hp <= 0) { fighter.state = 'idle'; break; }
          const range = this.attackRange(effectiveTarget, FIGHTER_ATTACK_RANGE);
          if (this.distXZ(fighter.position, effectiveTarget.position) <= range) {
            fighter.currentEnemyId = effectiveTarget.id;
            fighter.state = 'attacking'; fighter.attackTimer = 0;
          } else {
            this.moveToward(fighter, effectiveTarget.position, FIGHTER_SPEED, dt, range - 0.5);
          }
          break;
        }

        case 'moving_to_enemy': {
          const enemy = fighter.currentEnemyId ? this.entities.get(fighter.currentEnemyId) : null;
          if (!enemy || enemy.hp <= 0) { fighter.currentEnemyId = null; fighter.state = 'idle'; break; }
          const range = this.attackRange(enemy, FIGHTER_ATTACK_RANGE);
          if (this.distXZ(fighter.position, enemy.position) <= range) {
            fighter.state = 'attacking'; fighter.attackTimer = 0;
          } else {
            this.moveToward(fighter, enemy.position, FIGHTER_SPEED, dt, range - 0.5);
          }
          break;
        }

        case 'attacking': {
          const enemy = fighter.currentEnemyId ? this.entities.get(fighter.currentEnemyId) : null;
          if (!enemy || enemy.hp <= 0) { fighter.currentEnemyId = null; fighter.state = 'idle'; break; }
          if (!MOBILE_TYPES.has(enemy.entityType)) {
            const nearby = this.findNearbyEnemy(fighter);
            if (nearby) { fighter.currentEnemyId = nearby.id; fighter.state = 'moving_to_enemy'; break; }
          }
          const range = this.attackRange(enemy, FIGHTER_ATTACK_RANGE);
          if (this.distXZ(fighter.position, enemy.position) > range + 1) { fighter.state = 'moving_to_enemy'; break; }
          fighter.attackTimer += dt;
          if (fighter.attackTimer >= FIGHTER_ATTACK_INTERVAL) {
            fighter.attackTimer = 0;
            const dmg = MOBILE_TYPES.has(enemy.entityType) ? FIGHTER_DAMAGE_UNIT : FIGHTER_DAMAGE_BUILDING;
            enemy.hp -= dmg;
            if (enemy.hp <= 0) { enemy.hp = 0; fighter.currentEnemyId = null; fighter.state = 'idle'; }
          }
          break;
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
      if (entity.entityType === 'resource_node') continue;
      toDelete.push(id);
    }
    for (const id of toDelete) {
      // Refund supply for dead grunts
      const entity = this.entities.get(id);
      if (entity?.entityType === 'grunt') {
        this.teamSupply[entity.teamId].used = Math.max(0, this.teamSupply[entity.teamId].used - GRUNT_SUPPLY_COST);
      }
      this.entities.delete(id);
    }
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

  private findNearbyEnemy(fighter: FighterEntity): Entity | null {
    let closest: Entity | null = null;
    let closestDist = FIGHTER_AGGRO_RANGE;
    for (const e of this.entities.values()) {
      if (e.teamId === fighter.teamId || e.hp <= 0 || !MOBILE_TYPES.has(e.entityType)) continue;
      const d = this.distXZ(fighter.position, e.position);
      if (d < closestDist) { closestDist = d; closest = e; }
    }
    return closest;
  }

  private findClosestEnemyTarget(fighter: FighterEntity): Entity | null {
    const targets = this.getEnemyTargets(fighter.teamId);
    if (targets.length === 0) return null;
    let closest = targets[0];
    let cd = this.distXZ(fighter.position, closest.position);
    for (let i = 1; i < targets.length; i++) {
      const d = this.distXZ(fighter.position, targets[i].position);
      if (d < cd) { cd = d; closest = targets[i]; }
    }
    return closest;
  }

  private attackRange(target: Entity, baseRange: number): number {
    return baseRange + (BUILDING_RADII[target.entityType] ?? 0);
  }

  private moveToward(entity: Entity, target: Vec3, speed: number, dt: number, stopDist = 1.0): boolean {
    const dx = target.x - entity.position.x;
    const dz = target.z - entity.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= stopDist) return true;
    const moveDist = Math.min(speed * dt, dist - stopDist);
    entity.position.x += (dx / dist) * moveDist;
    entity.position.z += (dz / dist) * moveDist;
    return dist - moveDist <= stopDist;
  }

  private distXZ(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // ===================== Snapshot =====================

  getSnapshot(): SnapshotEntity[] {
    const result: SnapshotEntity[] = [];
    for (const e of this.entities.values()) {
      result.push({
        id: e.id, entityType: e.entityType,
        position: { ...e.position }, rotation: { ...e.rotation },
        teamId: e.teamId, hp: e.hp, maxHp: e.maxHp,
        status: e.status, constructionProgress: e.constructionProgress,
      });
    }
    return result;
  }
}
