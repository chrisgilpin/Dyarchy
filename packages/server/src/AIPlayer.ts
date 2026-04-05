import type { Vec3, TeamId, AIDifficulty, FPSInputMsg, PlayerGameStats } from '@dyarchy/shared';
import { PLAYER_HEIGHT, dist3D } from '@dyarchy/shared';
import type { GameState, Entity, FPSPlayerEntity, WorkerEntity, FootSoldierEntity, ArcherEntity, FighterEntity } from './GameState.js';

// ===================== Difficulty Presets =====================

interface DifficultyPreset {
  decisionInterval: number;  // seconds between RTS decisions
  fpsAccuracy: number;       // 0-1 chance to hit
  fpsReactionTime: number;   // seconds between FPS decisions
  workerCrystalPct: number;  // fraction of total spending on workers
  attackThreshold: number;   // min military before attacking
}

const PRESETS: Record<AIDifficulty, DifficultyPreset> = {
  easy: {
    decisionInterval: 10.0,
    fpsAccuracy: 0.25,
    fpsReactionTime: 0.8,
    workerCrystalPct: 0.10,
    attackThreshold: 8,
  },
  medium: {
    decisionInterval: 8.0,
    fpsAccuracy: 0.30,
    fpsReactionTime: 0.5,
    workerCrystalPct: 0.20,
    attackThreshold: 5,
  },
  hard: {
    decisionInterval: 5.0,
    fpsAccuracy: 0.80,
    fpsReactionTime: 0.15,
    workerCrystalPct: 0.35,
    attackThreshold: 3,
  },
};

const WORKER_COST = 100;

// AI weapon definitions
const AI_WEAPONS = {
  pistol:         { damage: 8,  range: 60,  fireRate: 4 },
  rifle:          { damage: 15, range: 100, fireRate: 3 },
  shotgun:        { damage: 48, range: 20,  fireRate: 1 },  // 8 * 6 pellets
  sniper_rifle:   { damage: 40, range: 200, fireRate: 0.333 },
  rocket_launcher:{ damage: 80, range: 100, fireRate: 0.05 },
} as const;

// Weapons available at each armory tier
const WEAPONS_BY_TIER: Record<number, (keyof typeof AI_WEAPONS)[]> = {
  0: ['pistol'],                                               // no armory
  1: ['pistol', 'rifle', 'shotgun', 'sniper_rifle'],          // armory built
  2: ['pistol', 'rifle', 'shotgun', 'sniper_rifle', 'rocket_launcher'], // armory lv2
};

// FPS engagement: enemy player must be within this distance AND within the forward FOV cone
const FPS_PLAYER_ENGAGE_RANGE = 40;
const FPS_PLAYER_FOV_COS = Math.cos(Math.PI / 3); // ~60 degree half-angle (120 degree cone)

// Building radii for placement collision checks
const PLACEMENT_RADII: Record<string, number> = {
  main_base: 5, tower: 3, barracks: 3.5, armory: 3.5, player_tower: 2.5,
  turret: 1.5, sniper_nest: 1.5, farm: 2.5, garage: 4, hero_academy: 4,
  resource_node: 3,
};

// ===================== AI Player =====================

export class AIPlayer {
  readonly teamId: TeamId;
  readonly difficulty: AIDifficulty;
  readonly preset: DifficultyPreset;
  readonly name: string;
  readonly id: string;

  controlsFPS: boolean;
  controlsRTS: boolean;
  fpsEntityId: string | null = null;

  stats: PlayerGameStats;

  // Timers
  private rtsDecisionTimer = 0;
  private fpsDecisionTimer = 0;
  private fpsFireCooldown = 0;
  private fpsTargetId: string | null = null;
  private fpsSeq = 0;

  // FPS state machine
  private fpsState: 'seek' | 'engage' | 'retreat' = 'seek';
  private lastHpSeen = 100; // track HP changes to detect being attacked
  private currentWeapon: keyof typeof AI_WEAPONS = 'pistol';
  private weaponSwitchTimer = 0;
  // Path randomness: offset that drifts over time so the bot doesn't walk a straight line
  private pathOffsetAngle = 0;
  private pathOffsetTimer = 0;
  // Sustained strafe: pick a direction and hold it for a while instead of jittering
  private strafeDir: -1 | 0 | 1 = 0; // -1=left, 0=none, 1=right
  private strafeTimer = 0;

  // RTS state
  private lastBuildAttempt = 0;
  private crystalsSpentOnWorkers = 0;
  private lastKnownCrystals = 1000; // starting crystals
  private totalCrystalsEarned = 0;
  private peakWorkerCount = 0;
  private workerRecoveryMode = false;
  // Stalled goal: a building/upgrade that's been wanted but not completed, with escalating priority
  private stalledGoal: { label: string; cost: number; firstSeen: number } | null = null;
  private savingsLock = false; // true = no military spending until stalledGoal is resolved

  constructor(teamId: TeamId, difficulty: AIDifficulty, controlsFPS: boolean, controlsRTS: boolean) {
    this.teamId = teamId;
    this.difficulty = difficulty;
    this.preset = PRESETS[difficulty];
    this.controlsFPS = controlsFPS;
    this.controlsRTS = controlsRTS;

    const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
    this.name = `Bot (${diffLabel})`;
    this.id = `ai_${teamId}_${Date.now()}`;

    this.stats = {
      playerId: this.id,
      playerName: this.name,
      shotsFired: 0, shotsHit: 0, kills: 0,
      friendlyKills: 0, deaths: 0, buildingsBuilt: 0, jeepKills: 0,
      playerKills: 0, cpuUnitsKilled: 0, buildingsDestroyed: 0, crystalsCollected: 0, upgradeCount: 0,
    };
  }

  update(dt: number, state: GameState): void {
    if (this.controlsRTS) {
      this.rtsDecisionTimer += dt;
      if (this.rtsDecisionTimer >= this.preset.decisionInterval) {
        this.rtsDecisionTimer = 0;
        this.updateRTS(state);
      }
    }

    if (this.controlsFPS && this.fpsEntityId) {
      this.updateFPS(dt, state);
    }
  }

  // ===================== RTS Brain =====================

  private updateRTS(state: GameState): void {
    this.rtsEconomy(state);
    this.rtsBuildings(state);
    this.rtsMilitary(state);
    this.rtsUpgrades(state);
    this.rtsCombat(state);
  }

  private rtsEconomy(state: GameState): void {
    const workers = state.getEntitiesByType('worker', this.teamId) as WorkerEntity[];
    const workerCount = workers.filter(w => w.hp > 0).length;

    // If all crystal nodes are depleted, cull excess workers to free supply for military
    const allNodesDead = ![...state.entities.values()].some(
      e => e.entityType === 'resource_node' && e.hp > 0,
    );
    if (allNodesDead && workerCount > 6) {
      // Find a military unit to kill excess workers
      const military = [
        ...state.getEntitiesByType('foot_soldier', this.teamId),
        ...state.getEntitiesByType('archer', this.teamId),
      ].filter(u => u.hp > 0);
      const idleWorkers = workers.filter(w => w.hp > 0 && (w.state === 'idle' || w.state === 'moving'));
      if (military.length > 0 && idleWorkers.length > 0) {
        // Command one military unit to kill one idle worker
        const attacker = military[0];
        const victim = idleWorkers[0];
        state.handleRTSCommand(this.teamId, {
          command: 'force_attack', unitIds: [attacker.id], targetId: victim.id,
        });
      }
    }

    // Track peak worker count and detect losses
    if (workerCount > this.peakWorkerCount) this.peakWorkerCount = workerCount;
    if (!this.workerRecoveryMode && this.peakWorkerCount > 0
        && workerCount < this.peakWorkerCount * 0.8) {
      this.workerRecoveryMode = true;
    }
    if (this.workerRecoveryMode && workerCount >= this.peakWorkerCount * 0.5) {
      this.workerRecoveryMode = false;
    }

    // Track income to derive total spending
    const currentCrystals = state.teamResources[this.teamId];
    if (currentCrystals > this.lastKnownCrystals) {
      this.totalCrystalsEarned += currentCrystals - this.lastKnownCrystals;
    }
    this.lastKnownCrystals = currentCrystals;

    // Send idle workers to harvest
    const idleWorkers = workers.filter(w => w.state === 'idle' || w.state === 'moving');
    if (idleWorkers.length > 0) {
      const nodes = [...state.entities.values()].filter(
        e => e.entityType === 'resource_node' && e.hp > 0,
      );
      for (const worker of idleWorkers) {
        let nearest: Entity | null = null;
        let nearestDist = Infinity;
        for (const node of nodes) {
          const d = this.distXZ(worker.position, node.position);
          if (d < nearestDist) { nearestDist = d; nearest = node; }
        }
        if (nearest) {
          state.handleRTSCommand(this.teamId, {
            command: 'harvest', unitIds: [worker.id], targetId: nearest.id,
          });
        }
      }
    }

    // Worker training based on ratio of worker spending to total spending.
    // Target: workerCrystalPct of all expenditure. Range: 10%-50%.
    // totalSpent = startingCrystals + totalEarned - currentCrystals
    const startingCrystals = 1000;
    const totalSpent = startingCrystals + this.totalCrystalsEarned - currentCrystals;
    const workerRatio = totalSpent > 0 ? this.crystalsSpentOnWorkers / totalSpent : 0;

    // Train if ratio is below target (self-balancing: spending on other things lowers ratio)
    // Hard floor at 10%: always train if ratio is very low
    // Hard ceiling at 50%: never train if ratio is very high
    const belowTarget = workerRatio < this.preset.workerCrystalPct;
    const belowFloor = workerRatio < 0.10;
    const aboveCeiling = workerRatio > 0.50;
    const shouldTrain = this.workerRecoveryMode || (!aboveCeiling && (belowTarget || belowFloor));

    if (shouldTrain && currentCrystals >= WORKER_COST) {
      // Find a base whose training queue isn't blocked by an upgrade
      const bases = state.getEntitiesByType('main_base', this.teamId)
        .filter(b => b.status === 'active' && b.hp > 0);
      for (const base of bases) {
        const tq = state.trainingQueues.get(base.id);
        const blocked = tq?.queue.some(s => s.unitType.startsWith('upgrade_'));
        if (blocked) continue;
        if ((tq?.queue.length ?? 0) >= 5) continue;
        if (state.teamSupply[this.teamId].used >= state.teamSupply[this.teamId].cap) break;
        state.handleTrain(this.teamId, base.id, 'worker');
        this.crystalsSpentOnWorkers += WORKER_COST;
        break;
      }
    }
  }

  private rtsBuildings(state: GameState): void {
    const interval = this.preset.decisionInterval * 2;
    if (state.gameTime - this.lastBuildAttempt < interval) return;

    const myBuildings = [...state.entities.values()].filter(
      e => e.teamId === this.teamId && e.hp > 0 && e.status !== undefined
        && !['worker', 'fighter', 'foot_soldier', 'archer', 'fps_player', 'jeep', 'helicopter', 'resource_node'].includes(e.entityType),
    );

    const has = (type: string) => myBuildings.some(b => b.entityType === type);
    const countOf = (type: string) => myBuildings.filter(b => b.entityType === type).length;
    const resources = state.teamResources[this.teamId];
    const supply = state.teamSupply[this.teamId];

    // Find a worker to build
    const workers = state.getEntitiesByType('worker', this.teamId) as WorkerEntity[];
    const freeWorker = workers.find(w =>
      w.state !== 'building' && w.state !== 'moving_to_build' && w.hp > 0,
    );
    if (!freeWorker) return;

    // Only build 2nd barracks if resource-rich (can sustain parallel training)
    const wantSecondBarracks = has('barracks') && countOf('barracks') < 2
      && resources > 800 && supply.cap - supply.used >= 4;

    // Expansion HQ: only if there's an unguarded crystal field far from current bases
    const wantExpansion = this.shouldExpand(state);

    // Build priority order — farms jump to top when supply is nearly full
    const supplyLeft = supply.cap - supply.used;
    const needFarmUrgent = supplyLeft <= 2;

    const buildList: { type: string; condition: boolean; minRes: number; pos?: Vec3 }[] = [];

    // Urgent farm takes absolute priority
    if (needFarmUrgent) {
      buildList.push({ type: 'farm', condition: true, minRes: 24 });
    }

    buildList.push(
      { type: 'barracks', condition: !has('barracks'), minRes: 150 },
      { type: 'farm', condition: supplyLeft < 4, minRes: 24 },
      { type: 'armory', condition: !has('armory') && resources > 400, minRes: 300 },
      { type: 'hero_academy', condition: !has('hero_academy') && state.gameTime > 120, minRes: 400 },
    );

    // Expansion: high priority once nearby crystal fields are depleting
    if (wantExpansion) {
      const expansionNode = this.findExpansionNode(state);
      if (expansionNode) {
        const nearbyDefense = myBuildings.some(
          b => (b.entityType === 'player_tower' || b.entityType === 'turret')
            && this.distXZ(b.position, expansionNode.position) < 20,
        );
        if (!nearbyDefense) {
          buildList.push({
            type: 'tower', condition: true, minRes: 500,
            pos: { x: expansionNode.position.x + 5, y: 0, z: expansionNode.position.z + 5 },
          });
        } else {
          buildList.push({
            type: 'main_base', condition: true, minRes: 1000,
            pos: { x: expansionNode.position.x, y: 0, z: expansionNode.position.z + 10 },
          });
        }
      }
    }

    buildList.push(
      { type: 'farm', condition: supplyLeft < 6, minRes: 24 },
      { type: 'garage', condition: !has('garage') && state.gameTime > 180, minRes: 300 },
      { type: 'tower', condition: countOf('player_tower') < 2 && state.gameTime > 90, minRes: 500 },
      { type: 'barracks', condition: wantSecondBarracks, minRes: 150 },
    );

    let built = false;
    for (const item of buildList) {
      if (!item.condition) continue;
      if (resources >= item.minRes) {
        let pos: Vec3 | null;
        if (item.pos) {
          pos = this.findBuildPositionNear(state, item.type, item.pos);
        } else if (item.type === 'tower') {
          pos = this.findTowerPosition(state);
        } else {
          pos = this.findBuildPosition(state, item.type);
        }
        if (pos) {
          state.placeBuildingForTeam(this.teamId, item.type, pos, freeWorker.id);
          this.lastBuildAttempt = state.gameTime;
          this.stats.buildingsBuilt++;
          built = true;
          // Clear stalled goal if this was it
          if (this.stalledGoal?.label === item.type) {
            this.stalledGoal = null;
            this.savingsLock = false;
          }
          break;
        }
      } else {
        // Can't afford the first priority building — track as potentially stalled
        const label = item.type;
        if (!this.stalledGoal || this.stalledGoal.label !== label) {
          this.stalledGoal = { label, cost: item.minRes, firstSeen: state.gameTime };
          this.savingsLock = false;
        } else if (state.gameTime - this.stalledGoal.firstSeen > 30) {
          // Stalled for 30+ seconds — activate savings lock
          this.savingsLock = true;
        }
        break; // don't check lower priority items
      }
    }
    // If nothing in the build list is wanted, clear stalled state
    if (built || !buildList.some(b => b.condition)) {
      if (built && this.stalledGoal) {
        // Keep stalled goal if it wasn't the one built
      } else if (!buildList.some(b => b.condition)) {
        this.stalledGoal = null;
        this.savingsLock = false;
      }
    }
  }

  /** Check if we should expand: our nearby crystal fields are running dry (<=10% HP). */
  private shouldExpand(state: GameState): boolean {
    const baseCount = state.getEntitiesByType('main_base', this.teamId)
      .filter(b => b.hp > 0).length;
    if (baseCount >= 2) return false;

    // Check if the crystal nodes our workers are mining are depleted
    const myBases = state.getEntitiesByType('main_base', this.teamId).filter(b => b.hp > 0);
    if (myBases.length === 0) return false;

    // Find nodes near our bases (within 50 units) — these are the ones we're using
    const nearbyNodes = [...state.entities.values()].filter(e => {
      if (e.entityType !== 'resource_node') return false;
      return myBases.some(b => this.distXZ(b.position, e.position) < 50);
    });

    if (nearbyNodes.length === 0) return true; // no nodes at all, definitely expand

    // If all nearby nodes are at 10% or less of max HP, it's time to expand
    const allDepleting = nearbyNodes.every(n => n.hp <= n.maxHp * 0.10);
    if (!allDepleting) return false;

    // Must have a viable expansion target
    return this.findExpansionNode(state) !== null;
  }

  /** Find the best crystal node to expand toward — high HP, far from current bases. */
  private findExpansionNode(state: GameState): Entity | null {
    const myBases = state.getEntitiesByType('main_base', this.teamId).filter(b => b.hp > 0);
    const nodes = [...state.entities.values()].filter(
      e => e.entityType === 'resource_node' && e.hp > 0,
    );
    let bestNode: Entity | null = null;
    let bestScore = -Infinity;
    for (const node of nodes) {
      const minBaseDist = Math.min(...myBases.map(b => this.distXZ(b.position, node.position)));
      if (minBaseDist < 30) continue; // too close to an existing base, not worth expanding for
      // Score: prefer high HP nodes that are moderately far (not too far to be dangerous)
      const hpScore = node.hp / node.maxHp; // 0-1, higher = more resources left
      const distScore = Math.min(1, minBaseDist / 100); // normalize distance
      const score = hpScore * 2 + distScore; // weight HP more than distance
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }
    return bestNode;
  }

  /** Returns the crystal cost of the next priority building the AI wants but can't yet afford. 0 if none. */
  private nextBuildingSavingsTarget(state: GameState): number {
    const myBuildings = [...state.entities.values()].filter(
      e => e.teamId === this.teamId && e.hp > 0 && e.status !== undefined
        && !['worker', 'fighter', 'foot_soldier', 'archer', 'fps_player', 'jeep', 'helicopter', 'resource_node'].includes(e.entityType),
    );
    const has = (type: string) => myBuildings.some(b => b.entityType === type);
    const countOf = (type: string) => myBuildings.filter(b => b.entityType === type).length;
    const supply = state.teamSupply[this.teamId];
    const supplyLeft = supply.cap - supply.used;
    const resources = state.teamResources[this.teamId];

    const checks: { cond: boolean; cost: number }[] = [
      { cond: !has('barracks'), cost: 150 },
      { cond: supplyLeft < 4, cost: 24 },
      { cond: !has('armory'), cost: 300 },
      { cond: !has('hero_academy') && state.gameTime > 120, cost: 400 },
      { cond: this.shouldExpand(state), cost: 500 }, // tower or HQ for expansion
      { cond: !has('garage') && state.gameTime > 180, cost: 300 },
    ];
    for (const c of checks) {
      if (c.cond && resources < c.cost) return c.cost;
    }
    return 0;
  }

  private rtsMilitary(state: GameState): void {
    // Hard lock: a building/upgrade has been stalled for 30+ seconds — save all crystals for it
    if (this.savingsLock) return;

    // Soft gate: don't train military if we need to save crystals for a priority building
    const savingsTarget = this.nextBuildingSavingsTarget(state);
    if (savingsTarget > 0 && state.teamResources[this.teamId] < savingsTarget + 100) return;

    const barracks = state.getEntitiesByType('barracks', this.teamId)
      .filter(b => b.status === 'active' && b.hp > 0);
    const garages = state.getEntitiesByType('garage', this.teamId)
      .filter(b => b.status === 'active' && b.hp > 0);

    for (const b of barracks) {
      const tq = state.trainingQueues.get(b.id);
      if ((tq?.queue.length ?? 0) < 3) {
        if ((b.level ?? 1) >= 2 && Math.random() < 0.4) {
          state.handleTrain(this.teamId, b.id, 'archer');
        } else {
          state.handleTrain(this.teamId, b.id, 'foot_soldier');
        }
      }
    }

    // Only build vehicles if none alive on the map (replace when destroyed)
    const hasJeep = state.getEntitiesByType('jeep', this.teamId).some(j => j.hp > 0);
    const hasHeli = state.getEntitiesByType('helicopter', this.teamId).some(h => h.hp > 0);
    // Also check if one is currently in training
    const trainingVehicle = (type: string) => {
      for (const g of garages) {
        const tq = state.trainingQueues.get(g.id);
        if (tq?.queue.some(s => s.unitType === type)) return true;
      }
      return false;
    };

    for (const g of garages) {
      const tq = state.trainingQueues.get(g.id);
      if ((tq?.queue.length ?? 0) >= 2) continue;
      // 50/50 chance of jeep or helicopter
      const wantHeli = Math.random() < 0.5;
      if (wantHeli && !hasHeli && !trainingVehicle('helicopter')) {
        state.handleTrain(this.teamId, g.id, 'helicopter');
      } else if (!hasJeep && !trainingVehicle('jeep')) {
        state.handleTrain(this.teamId, g.id, 'jeep');
      } else if (!hasHeli && !trainingVehicle('helicopter')) {
        state.handleTrain(this.teamId, g.id, 'helicopter');
      }
    }
  }

  private rtsUpgrades(state: GameState): void {
    // Don't spend on upgrades while savings-locked for a stalled building
    if (this.savingsLock && this.stalledGoal) return;

    // Don't consider any upgrades until barracks and armory are both built
    const hasBarracks = state.getEntitiesByType('barracks', this.teamId)
      .some(b => b.status === 'active' && b.hp > 0);
    const hasArmory = state.getEntitiesByType('armory', this.teamId)
      .some(b => b.status === 'active' && b.hp > 0);
    if (!hasBarracks || !hasArmory) return;

    const resources = state.teamResources[this.teamId];

    // Helper: try upgrade, return true if queued
    const tryUpgrade = (buildingId: string, type: string): boolean => {
      // Check training queue isn't already upgrading this building
      const tq = state.trainingQueues.get(buildingId);
      if (tq?.queue.some(s => s.unitType.startsWith('upgrade_'))) return false;
      state.handleUpgrade(this.teamId, buildingId, type);
      return true;
    };

    // Prioritize crystal harvest upgrade once we have 6+ workers
    const workerCount = state.getEntitiesByType('worker', this.teamId).filter(w => w.hp > 0).length;
    if (!state.harvestBoost[this.teamId] && workerCount >= 6) {
      for (const b of state.getEntitiesByType('main_base', this.teamId)) {
        if (b.status === 'active' && b.hp > 0 && resources >= 400) {
          if (tryUpgrade(b.id, 'harvest_boost')) return;
        }
      }
    }

    // Barracks level 2
    for (const b of state.getEntitiesByType('barracks', this.teamId)) {
      if (b.status === 'active' && b.hp > 0 && (b.level ?? 1) < 2 && resources >= 500) {
        if (tryUpgrade(b.id, 'barracks_level2')) return;
      }
    }

    // Armory level 2
    for (const b of state.getEntitiesByType('armory', this.teamId)) {
      if (b.status === 'active' && b.hp > 0 && (b.level ?? 1) < 2 && resources >= 500) {
        if (tryUpgrade(b.id, 'armory_level2')) return;
      }
    }

    // HQ level 2
    for (const b of state.getEntitiesByType('main_base', this.teamId)) {
      if (b.status === 'active' && b.hp > 0 && (b.level ?? 1) < 2 && resources >= 1000) {
        if (tryUpgrade(b.id, 'base_upgrade')) return;
      }
    }

    // Harvest boost (fallback if < 6 workers)
    if (!state.harvestBoost[this.teamId]) {
      for (const b of state.getEntitiesByType('main_base', this.teamId)) {
        if (b.status === 'active' && b.hp > 0 && resources >= 400) {
          if (tryUpgrade(b.id, 'harvest_boost')) return;
        }
      }
    }

    // Hero Academy upgrades
    const academies = state.getEntitiesByType('hero_academy', this.teamId)
      .filter(b => b.status === 'active' && b.hp > 0);
    if (academies.length > 0) {
      const a = academies[0];
      if ((state.heroHpLevel[this.teamId] ?? 0) < 3) { if (tryUpgrade(a.id, 'hero_hp')) return; }
      if ((state.heroDmgLevel[this.teamId] ?? 0) < 3) { if (tryUpgrade(a.id, 'hero_damage')) return; }
      if (!state.heroRegen[this.teamId]) { if (tryUpgrade(a.id, 'hero_regen')) return; }
    }

    // Armory rockets (level 3)
    for (const b of state.getEntitiesByType('armory', this.teamId)) {
      if (b.status === 'active' && b.hp > 0 && (b.level ?? 1) === 2 && resources >= 400) {
        if (tryUpgrade(b.id, 'armory_rockets')) return;
      }
    }

    // Tower global upgrade (from main base)
    const towers = [...state.entities.values()].filter(
      e => (e.entityType === 'tower' || e.entityType === 'player_tower' || e.entityType === 'turret')
        && e.teamId === this.teamId && e.hp > 0,
    );
    if (towers.length > 0) {
      const maxTowerLvl = Math.max(...towers.map(t => t.level ?? 1));
      if (maxTowerLvl < 3) {
        for (const b of state.getEntitiesByType('main_base', this.teamId)) {
          if (b.status === 'active' && b.hp > 0) {
            if (tryUpgrade(b.id, 'tower_global_upgrade')) return;
          }
        }
      }
    }
  }

  private rtsCombat(state: GameState): void {
    const isEnemy = (e: { teamId: TeamId }) => e.teamId !== this.teamId;

    const military = [
      ...state.getEntitiesByType('foot_soldier', this.teamId),
      ...state.getEntitiesByType('archer', this.teamId),
    ].filter(u => u.hp > 0);

    // Defend: rally military if enemies near base
    const myBase = state.getTeamBase(this.teamId);
    if (myBase) {
      const nearbyEnemies = [...state.entities.values()].filter(
        e => isEnemy(e) && e.hp > 0
          && ['fps_player', 'fighter', 'foot_soldier', 'archer', 'jeep', 'helicopter'].includes(e.entityType)
          && this.distXZ(e.position, myBase.position) < 30,
      );

      if (nearbyEnemies.length > 0) {
        const idle = this.getIdleMilitary(military);
        for (const unit of idle) {
          state.handleRTSCommand(this.teamId, {
            command: 'attack', unitIds: [unit.id], targetId: nearbyEnemies[0].id,
          });
        }
        return;
      }
    }

    // Attack: find enemy towers first, then HQ
    if (military.length >= this.preset.attackThreshold) {
      const target = this.findAttackTarget(state, myBase);
      if (target) {
        const idle = this.getIdleMilitary(military);
        for (const unit of idle) {
          state.handleRTSCommand(this.teamId, {
            command: 'attack', unitIds: [unit.id], targetId: target.id,
          });
        }
      }
    }
  }

  private findAttackTarget(state: GameState, myBase: Entity | undefined): Entity | null {
    const enemyTowers = [...state.entities.values()].filter(
      e => e.teamId !== this.teamId && e.hp > 0
        && (e.entityType === 'tower' || e.entityType === 'player_tower'),
    );

    if (enemyTowers.length > 0) {
      // Attack nearest enemy tower to our base
      let nearest = enemyTowers[0];
      let minDist = Infinity;
      const ref = myBase?.position ?? state.mapConfig.teamSpawns[this.teamId]!;
      for (const t of enemyTowers) {
        const d = this.distXZ(t.position, ref);
        if (d < minDist) { minDist = d; nearest = t; }
      }
      return nearest;
    }

    // All towers down — attack nearest enemy HQ
    let nearestBase: Entity | null = null;
    let minBaseDist = Infinity;
    const ref = myBase?.position ?? state.mapConfig.teamSpawns[this.teamId]!;
    for (const e of state.entities.values()) {
      if (e.entityType === 'main_base' && e.teamId !== this.teamId && e.hp > 0) {
        const d = this.distXZ(e.position, ref);
        if (d < minBaseDist) { minBaseDist = d; nearestBase = e; }
      }
    }
    return nearestBase;
  }

  private getIdleMilitary(units: Entity[]): Entity[] {
    return units.filter(u => {
      if (u.entityType === 'foot_soldier' || u.entityType === 'archer') {
        const fs = u as FootSoldierEntity | ArcherEntity;
        return fs.state === 'idle' || fs.state === 'guarding';
      }
      if (u.entityType === 'fighter') {
        return (u as FighterEntity).state === 'idle';
      }
      return false;
    });
  }

  // ===================== FPS Brain =====================

  private updateFPS(dt: number, state: GameState): void {
    const fps = state.entities.get(this.fpsEntityId!) as FPSPlayerEntity | undefined;
    if (!fps) return;

    if (fps.isDead) {
      this.selectHeroType(state, fps);
      return;
    }

    this.fpsDecisionTimer += dt;
    this.fpsFireCooldown = Math.max(0, this.fpsFireCooldown - dt);

    // Detect taking damage — switch to attacker if being hit
    if (fps.hp < this.lastHpSeen && fps.lastDamagedBy) {
      const attacker = state.entities.get(fps.lastDamagedBy);
      if (attacker && attacker.hp > 0 && attacker.teamId !== this.teamId) {
        this.fpsState = 'engage';
        this.fpsTargetId = attacker.id;
      }
    }
    this.lastHpSeen = fps.hp;

    // Only retreat if team has regen (otherwise fight to the death)
    if (state.heroRegen[this.teamId]) {
      if (fps.hp < 30 && this.fpsState !== 'retreat') {
        this.fpsState = 'retreat';
        this.fpsTargetId = null;
      } else if (fps.hp >= 50 && this.fpsState === 'retreat') {
        this.fpsState = 'seek';
      }
    }

    // Decision tick
    if (this.fpsDecisionTimer >= this.preset.fpsReactionTime) {
      this.fpsDecisionTimer = 0;
      this.fpsDecision(state, fps);
    }

    // Movement every tick
    this.fpsMove(dt, state, fps);
  }

  private fpsDecision(state: GameState, fps: FPSPlayerEntity): void {
    if (this.fpsState === 'retreat' && state.heroRegen[this.teamId]) {
      this.fpsTargetId = null;
      return;
    }

    // Periodically swap weapons based on armory tier
    this.maybeSwapWeapon(state);

    const isEnemy = (e: { teamId: TeamId }) => e.teamId !== this.teamId;
    const target = this.findFPSTarget(state, fps);

    if (target) {
      const dist = dist3D(fps.position, target.position);
      if (dist <= this.getWeaponRange()) {
        this.fpsState = 'engage';
        this.fpsTargetId = target.id;
        if (this.fpsFireCooldown <= 0) {
          this.fpsShoot(state, fps, target);
        }
      } else {
        this.fpsState = 'seek';
        this.fpsTargetId = target.id;
      }
    } else {
      this.fpsState = 'seek';
      this.fpsTargetId = null;
    }
  }

  private findFPSTarget(state: GameState, fps: FPSPlayerEntity): Entity | null {
    // If currently being attacked, prioritize the attacker until they're dead
    if (fps.lastDamagedBy) {
      const attacker = state.entities.get(fps.lastDamagedBy);
      if (attacker && attacker.hp > 0 && attacker.teamId !== this.teamId) {
        const dist = dist3D(fps.position, attacker.position);
        if (dist <= this.getWeaponRange()) return attacker;
      }
    }

    const weaponRange = this.getWeaponRange();
    const candidates: { entity: Entity; priority: number; dist: number }[] = [];

    for (const e of state.entities.values()) {
      if (e.teamId === this.teamId || e.hp <= 0) continue;

      let priority: number;
      // Base priority: towers → HQ → soldiers → fighters
      if (e.entityType === 'tower' || e.entityType === 'player_tower') priority = 1;
      else if (e.entityType === 'main_base') priority = 2;
      else if (e.entityType === 'fps_player') {
        if ((e as FPSPlayerEntity).isDead) continue;
        // Enemy FPS player becomes top priority only if close AND in front (visible)
        const d = dist3D(fps.position, e.position);
        if (d <= FPS_PLAYER_ENGAGE_RANGE && this.isInFrontOf(fps, e.position)) {
          priority = 0;
        } else {
          priority = 5; // low priority — not visible or too far
        }
      }
      else if (e.entityType === 'foot_soldier' || e.entityType === 'archer') priority = 3;
      else if (e.entityType === 'fighter') priority = 4;
      else continue;

      // Must have line-of-sight to the target
      if (!state.hasLineOfSight(fps.position, e.position, 1.5, fps.id, e.id)) continue;
      candidates.push({ entity: e, priority, dist: dist3D(fps.position, e.position) });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aIn = a.dist <= weaponRange;
      const bIn = b.dist <= weaponRange;
      if (aIn && bIn) {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.dist - b.dist;
      }
      if (aIn) return -1;
      if (bIn) return 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.dist - b.dist;
    });

    return candidates[0].entity;
  }

  private fpsShoot(state: GameState, fps: FPSPlayerEntity, target: Entity): void {
    const weapon = AI_WEAPONS[this.currentWeapon];
    this.stats.shotsFired++;
    this.fpsFireCooldown = 1 / weapon.fireRate;

    // Terrain blocks the shot — can't shoot through hills
    if (!state.hasLineOfSight(fps.position, target.position, 1.5, fps.id, target.id)) return;

    if (Math.random() < this.preset.fpsAccuracy) {
      this.stats.shotsHit++;

      let damage: number = weapon.damage;
      // Apply Hero Academy damage multiplier (not for vehicle weapons)
      const dmgLevel = state.heroDmgLevel[this.teamId] ?? 0;
      if (dmgLevel > 0) {
        const MULT = [1.25, 2.0, 3.0];
        damage = Math.round(damage * MULT[dmgLevel - 1]);
      }

      state.applyDamage(target, damage, fps.id);
    }
  }

  /** Get the effective range of the current weapon. */
  private getWeaponRange(): number {
    return AI_WEAPONS[this.currentWeapon].range;
  }

  /** Pick a random weapon from what's available based on armory tier. */
  private maybeSwapWeapon(state: GameState): void {
    this.weaponSwitchTimer -= this.preset.fpsReactionTime;
    if (this.weaponSwitchTimer > 0) return;
    this.weaponSwitchTimer = 8 + Math.random() * 12; // switch every 8-20 seconds

    const armories = state.getEntitiesByType('armory', this.teamId)
      .filter(a => a.status === 'active' && a.hp > 0);
    let tier = 0;
    if (armories.length > 0) {
      tier = Math.max(...armories.map(a => a.level ?? 1));
    }

    const available = WEAPONS_BY_TIER[Math.min(tier, 2)] ?? WEAPONS_BY_TIER[0];
    this.currentWeapon = available[Math.floor(Math.random() * available.length)];
  }

  private fpsMove(dt: number, state: GameState, fps: FPSPlayerEntity): void {
    const isEnemy = (e: { teamId: TeamId }) => e.teamId !== this.teamId;
    let targetPos: Vec3;

    if (this.fpsState === 'retreat') {
      const myBase = state.getTeamBase(this.teamId);
      targetPos = myBase ? myBase.position : state.mapConfig.teamSpawns[this.teamId]!;
    } else if (this.fpsTargetId) {
      const target = state.entities.get(this.fpsTargetId);
      if (target && target.hp > 0) {
        targetPos = target.position;
      } else {
        targetPos = this.nearestEnemyBasePos(state, fps.position);
      }
    } else {
      targetPos = this.nearestEnemyBasePos(state, fps.position);
    }

    const dx = targetPos.x - fps.position.x;
    const dz = targetPos.z - fps.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let forward = dist > 3;
    let left = false;
    let right = false;
    let yawOffset = 0;

    const weaponRange = this.getWeaponRange();

    if (this.fpsState === 'engage' && dist < weaponRange) {
      // Sustained strafe: pick a direction and hold for 1-3 seconds
      forward = dist > 15;
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 1 + Math.random() * 2;
        const roll = Math.random();
        if (roll < 0.3) this.strafeDir = -1;
        else if (roll < 0.6) this.strafeDir = 1;
        else this.strafeDir = 0;
      }
      if (this.strafeDir === -1) left = true;
      else if (this.strafeDir === 1) right = true;
    } else if (this.fpsState === 'seek' && dist > 20) {
      // Add randomness to path while seeking — drift the heading periodically
      this.pathOffsetTimer -= dt;
      if (this.pathOffsetTimer <= 0) {
        this.pathOffsetTimer = 2 + Math.random() * 3; // change every 2-5 seconds
        this.pathOffsetAngle = (Math.random() - 0.5) * 0.8; // up to ~23 degrees each way
      }
      yawOffset = this.pathOffsetAngle;
    }

    // applyMovement forward = (-sinYaw, -cosYaw), so negate to face target
    const yaw = Math.atan2(-dx, -dz) + yawOffset;

    const input: FPSInputMsg = {
      type: 'fps_input',
      seq: this.fpsSeq++,
      keys: { forward, backward: false, left, right, jump: false },
      yaw,
      pitch: 0,
      dt,
    };

    state.applyFPSInput(fps.id, input);
  }

  private selectHeroType(state: GameState, fps: FPSPlayerEntity): void {
    if (fps.heroType) return;
    // Requires Hero Academy
    const hasAcademy = state.getEntitiesByType('hero_academy', this.teamId)
      .some(a => a.hp > 0 && a.status === 'active');
    if (!hasAcademy) return;

    const roll = Math.random();
    if (roll < 0.4) fps.heroType = 'tank';
    else if (roll < 0.7) fps.heroType = 'healer';
    else fps.heroType = 'mechanic';
  }

  // ===================== Plan Debug =====================

  /** Evaluate what the RTS brain would do next (dry-run, no side effects). Returns up to 5 descriptions. */
  getPlannedActions(state: GameState): string[] {
    if (!this.controlsRTS) return [];
    const actions: string[] = [];
    const resources = state.teamResources[this.teamId];
    const supply = state.teamSupply[this.teamId];
    const isEnemy = (e: { teamId: TeamId }) => e.teamId !== this.teamId;

    // 1. Economy
    const workers = state.getEntitiesByType('worker', this.teamId) as WorkerEntity[];
    const idleWorkers = workers.filter(w => w.state === 'idle' || w.state === 'moving');
    if (idleWorkers.length > 0) {
      actions.push(`Send ${idleWorkers.length} idle worker${idleWorkers.length > 1 ? 's' : ''} to harvest`);
    }
    const totalSpent = 1000 + this.totalCrystalsEarned - resources;
    const workerRatio = totalSpent > 0 ? this.crystalsSpentOnWorkers / totalSpent : 0;
    const pct = Math.round(workerRatio * 100);
    const target = Math.round(this.preset.workerCrystalPct * 100);
    if (this.workerRecoveryMode) {
      actions.push(`RECOVER workers (${workers.length}/${this.peakWorkerCount} peak)`);
    } else {
      actions.push(`Workers: ${workers.length} (${pct}%/${target}% spend ratio)`);
    }

    // 2. Buildings
    const myBuildings = [...state.entities.values()].filter(
      e => e.teamId === this.teamId && e.hp > 0
        && !['worker', 'fighter', 'foot_soldier', 'archer', 'fps_player', 'jeep', 'helicopter', 'resource_node'].includes(e.entityType),
    );
    const has = (type: string) => myBuildings.some(b => b.entityType === type);
    const countOf = (type: string) => myBuildings.filter(b => b.entityType === type).length;

    const wantSecondBarracks = has('barracks') && countOf('barracks') < 2
      && resources > 800 && supply.cap - supply.used >= 4;

    const buildChecks: { type: string; label: string; cond: boolean; minRes: number }[] = [
      { type: 'barracks', label: 'Build Barracks', cond: !has('barracks'), minRes: 150 },
      { type: 'farm', label: `Build Farm (supply ${supply.used}/${supply.cap})`, cond: supply.cap - supply.used < 3 && countOf('farm') < 4, minRes: 24 },
      { type: 'armory', label: 'Build Armory', cond: !has('armory') && resources > 400, minRes: 300 },
      { type: 'hero_academy', label: 'Build Hero Academy', cond: !has('hero_academy') && state.gameTime > 120, minRes: 400 },
      { type: 'garage', label: 'Build Garage', cond: !has('garage') && state.gameTime > 180, minRes: 300 },
      { type: 'tower', label: 'Build Tower', cond: countOf('player_tower') < 2 && state.gameTime > 60, minRes: 500 },
      { type: 'barracks', label: 'Build 2nd Barracks (resource-rich)', cond: wantSecondBarracks, minRes: 150 },
    ];
    if (this.shouldExpand(state)) {
      const expNode = this.findExpansionNode(state);
      const defended = expNode && myBuildings.some(
        b => (b.entityType === 'player_tower' || b.entityType === 'turret')
          && this.distXZ(b.position, expNode.position) < 20,
      );
      if (expNode && !defended) {
        buildChecks.push({ type: 'tower', label: 'Secure expansion crystal field with tower', cond: true, minRes: 500 });
      } else if (expNode) {
        buildChecks.push({ type: 'main_base', label: 'Build Expansion HQ near crystals', cond: true, minRes: 1000 });
      }
    }
    for (const b of buildChecks) {
      if (b.cond && resources >= b.minRes) {
        actions.push(b.label);
        break;
      }
      if (b.cond && resources < b.minRes) {
        actions.push(`${b.label} (need ${b.minRes - resources} more crystals)`);
        break;
      }
    }

    // 3. Military
    const barracks = state.getEntitiesByType('barracks', this.teamId).filter(b => b.status === 'active' && b.hp > 0);
    const garages = state.getEntitiesByType('garage', this.teamId).filter(b => b.status === 'active' && b.hp > 0);
    if (barracks.length > 0) {
      const unitType = barracks.some(b => (b.level ?? 1) >= 2) ? 'foot soldiers/archers' : 'foot soldiers';
      actions.push(`Train ${unitType} from ${barracks.length} barracks`);
    }
    if (garages.length > 0) {
      const hasJeep = state.getEntitiesByType('jeep', this.teamId).some(j => j.hp > 0);
      const hasHeli = state.getEntitiesByType('helicopter', this.teamId).some(h => h.hp > 0);
      if (!hasJeep || !hasHeli) {
        const need = [!hasJeep ? 'jeep' : '', !hasHeli ? 'helicopter' : ''].filter(Boolean).join(' + ');
        actions.push(`Replace destroyed ${need}`);
      } else {
        actions.push('Vehicles active (no training needed)');
      }
    }

    // 4. Upgrades
    const upgradeChecks: { label: string; cond: boolean }[] = [];
    for (const b of state.getEntitiesByType('barracks', this.teamId)) {
      if (b.status === 'active' && (b.level ?? 1) < 2) {
        upgradeChecks.push({ label: `Upgrade Barracks to Lv2 (${resources >= 500 ? 'ready' : 'need ' + (500 - resources) + ' crystals'})`, cond: true });
        break;
      }
    }
    for (const b of state.getEntitiesByType('main_base', this.teamId)) {
      if (b.status === 'active' && (b.level ?? 1) < 2) {
        upgradeChecks.push({ label: `Upgrade HQ to Lv2 (${resources >= 1000 ? 'ready' : 'need ' + (1000 - resources) + ' crystals'})`, cond: true });
        break;
      }
    }
    const academies = state.getEntitiesByType('hero_academy', this.teamId).filter(b => b.status === 'active' && b.hp > 0);
    if (academies.length > 0) {
      const hpLvl = state.heroHpLevel[this.teamId] ?? 0;
      const dmgLvl = state.heroDmgLevel[this.teamId] ?? 0;
      if (hpLvl < 3) upgradeChecks.push({ label: `Hero HP upgrade (Lv${hpLvl}→${hpLvl + 1})`, cond: true });
      if (dmgLvl < 3) upgradeChecks.push({ label: `Hero Damage upgrade (Lv${dmgLvl}→${dmgLvl + 1})`, cond: true });
      if (!state.heroRegen[this.teamId]) upgradeChecks.push({ label: 'Hero Regen upgrade', cond: true });
    }
    if (!state.harvestBoost[this.teamId]) {
      upgradeChecks.push({ label: 'Harvest Boost', cond: true });
    }
    if (upgradeChecks.length > 0) {
      actions.push(`Next upgrade: ${upgradeChecks[0].label}`);
    }

    // 5. Combat
    const military = [
      ...state.getEntitiesByType('foot_soldier', this.teamId),
      ...state.getEntitiesByType('archer', this.teamId),
    ].filter(u => u.hp > 0);
    const myBase = state.getTeamBase(this.teamId);
    if (myBase) {
      const nearbyEnemies = [...state.entities.values()].filter(
        e => isEnemy(e) && e.hp > 0
          && ['fps_player', 'fighter', 'foot_soldier', 'archer', 'jeep', 'helicopter'].includes(e.entityType)
          && this.distXZ(e.position, myBase.position) < 30,
      );
      if (nearbyEnemies.length > 0) {
        actions.push(`DEFEND: ${nearbyEnemies.length} enemies near base`);
      } else if (military.length >= this.preset.attackThreshold) {
        const target = this.findAttackTarget(state, myBase);
        if (target) {
          const label = target.entityType === 'main_base' ? 'enemy HQ' : 'enemy tower';
          actions.push(`ATTACK ${label} with ${military.length} units`);
        }
      } else {
        actions.push(`Build army (${military.length}/${this.preset.attackThreshold} for attack)`);
      }
    }

    // Show stalled goal if active
    if (this.stalledGoal) {
      const wait = Math.round(state.gameTime - this.stalledGoal.firstSeen);
      const lock = this.savingsLock ? ' SAVING' : '';
      actions.push(`Stalled: ${this.stalledGoal.label} (${this.stalledGoal.cost} crystals, ${wait}s)${lock}`);
    }

    return actions.slice(0, 5);
  }

  // ===================== Helpers =====================

  private findBuildPosition(state: GameState, buildingType: string): Vec3 | null {
    const base = state.getTeamBase(this.teamId);
    if (!base) return null;
    return this.findBuildPositionNear(state, buildingType, base.position);
  }

  /** Find a tower position biased toward the enemy HQ.
   *  75% chance: placed between our closest-to-enemy building and the enemy HQ,
   *  within 40 units of that building. 25% chance: normal placement near our base. */
  private findTowerPosition(state: GameState): Vec3 | null {
    const isEnemy = (e: { teamId: TeamId }) => e.teamId !== this.teamId;
    const myBase = state.getTeamBase(this.teamId);
    const nearestEnemy = this.findNearestEnemyBase(state, myBase?.position ?? state.mapConfig.teamSpawns[this.teamId]!);
    if (!nearestEnemy || Math.random() > 0.75) {
      // 25% chance: normal placement near own base
      return this.findBuildPosition(state, 'tower');
    }

    // Find our building closest to the enemy HQ
    let closestBuilding: Entity | null = null;
    let closestDist = Infinity;
    for (const e of state.entities.values()) {
      if (e.teamId !== this.teamId || e.hp <= 0) continue;
      if (['worker', 'fighter', 'foot_soldier', 'archer', 'fps_player', 'jeep', 'helicopter', 'resource_node'].includes(e.entityType)) continue;
      const d = this.distXZ(e.position, nearestEnemy.position);
      if (d < closestDist) { closestDist = d; closestBuilding = e; }
    }
    if (!closestBuilding) return this.findBuildPosition(state, 'tower');

    // Place tower between that building and the enemy HQ, within 40 units
    const dx = nearestEnemy.position.x - closestBuilding.position.x;
    const dz = nearestEnemy.position.z - closestBuilding.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1) return this.findBuildPosition(state, 'tower');

    // Normalized direction toward enemy
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // Try positions along this direction with some random lateral offset
    const maxForward = Math.min(40, dist - 10); // don't place on top of enemy base
    if (maxForward < 5) return this.findBuildPosition(state, 'tower');

    for (let attempt = 0; attempt < 20; attempt++) {
      const fwd = 10 + Math.random() * (maxForward - 10);
      const lateral = (Math.random() - 0.5) * 20;
      const x = closestBuilding.position.x + dirX * fwd + (-dirZ) * lateral;
      const z = closestBuilding.position.z + dirZ * fwd + dirX * lateral;

      // Clamp to map bounds
      const hW = state.mapConfig.width / 2 - 5;
      const hD = state.mapConfig.depth / 2 - 5;
      const cx = Math.max(-hW, Math.min(hW, x));
      const cz = Math.max(-hD, Math.min(hD, z));

      // Check collision
      const radius = PLACEMENT_RADII['tower'] ?? 3;
      let valid = true;
      for (const e of state.entities.values()) {
        const eRadius = PLACEMENT_RADII[e.entityType];
        if (eRadius === undefined) continue;
        const minDist = Math.max(radius + eRadius + 1, 5);
        const edx = cx - e.position.x;
        const edz = cz - e.position.z;
        if (Math.sqrt(edx * edx + edz * edz) < minDist) {
          valid = false;
          break;
        }
      }
      if (valid) return { x: cx, y: 0, z: cz };
    }

    return this.findBuildPosition(state, 'tower');
  }

  private findBuildPositionNear(state: GameState, buildingType: string, center: Vec3): Vec3 | null {
    const radius = PLACEMENT_RADII[buildingType] ?? 3;
    const hW = state.mapConfig.width / 2 - 5;
    const hD = state.mapConfig.depth / 2 - 5;

    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 15;
      const x = Math.max(-hW, Math.min(hW, center.x + Math.cos(angle) * d));
      const z = Math.max(-hD, Math.min(hD, center.z + Math.sin(angle) * d));

      let valid = true;
      for (const e of state.entities.values()) {
        const eRadius = PLACEMENT_RADII[e.entityType];
        if (eRadius === undefined) continue;
        const minDist = Math.max(radius + eRadius + 1, 5);
        const edx = x - e.position.x;
        const edz = z - e.position.z;
        if (Math.sqrt(edx * edx + edz * edz) < minDist) {
          valid = false;
          break;
        }
      }

      if (valid) return { x, y: 0, z };
    }

    return null;
  }

  /** Check if targetPos is within the forward-facing cone of the FPS entity (3D). */
  private isInFrontOf(fps: FPSPlayerEntity, targetPos: Vec3): boolean {
    const dx = targetPos.x - fps.position.x;
    const dy = targetPos.y - fps.position.y;
    const dz = targetPos.z - fps.position.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return true; // on top of us

    // Bot's look direction from its yaw and pitch
    const yaw = fps.rotation.y;
    const pitch = fps.rotation.x;
    const lookX = -Math.sin(yaw) * Math.cos(pitch);
    const lookY = -Math.sin(pitch);
    const lookZ = -Math.cos(yaw) * Math.cos(pitch);

    // Dot product of normalized toTarget and 3D look direction
    const dot = (dx / len) * lookX + (dy / len) * lookY + (dz / len) * lookZ;
    return dot >= FPS_PLAYER_FOV_COS;
  }

  private distXZ(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Find nearest enemy base entity. */
  private findNearestEnemyBase(state: GameState, fromPos: Vec3): Entity | null {
    let nearest: Entity | null = null;
    let minDist = Infinity;
    for (const e of state.entities.values()) {
      if (e.entityType === 'main_base' && e.teamId !== this.teamId && e.hp > 0) {
        const d = this.distXZ(e.position, fromPos);
        if (d < minDist) { minDist = d; nearest = e; }
      }
    }
    return nearest;
  }

  /** Get position of the nearest enemy base, fallback to own spawn. */
  private nearestEnemyBasePos(state: GameState, fromPos: Vec3): Vec3 {
    const base = this.findNearestEnemyBase(state, fromPos);
    return base ? base.position : state.mapConfig.teamSpawns[this.teamId]!;
  }
}
