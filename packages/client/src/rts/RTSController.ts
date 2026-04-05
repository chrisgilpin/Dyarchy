import * as THREE from 'three';
import type { TeamId } from '@dyarchy/shared';
import { RTSCamera } from './RTSCamera.js';
import { Selection } from './Selection.js';
import { BuildPanel, type BuildingChoice, BUILDING_COSTS } from './BuildPanel.js';
import { InfoPanel } from './InfoPanel.js';
import { FogOfWar } from './FogOfWar.js';
import { Minimap } from './Minimap.js';
import { SoundManager } from '../audio/SoundManager.js';
// getTerrainHeight accessed via this.sceneManager.terrainHeight
import type { SceneManager, SceneEntity } from '../renderer/SceneManager.js';
import { FlameEffect } from '../renderer/FlameEffect.js';
// MeshFactory imports removed — server creates all entities in online mode

const GRID_SIZE = 4;
const STARTING_CRYSTALS = 1000;
const STARTING_SUPPLY_CAP = 10;
const FARM_SUPPLY_BONUS = 5;
const CONSTRUCTION_TIME = 10;

const WORKER_TRAIN_TIME = 3;
const WORKER_SPEED = 8;
const WORKER_HARVEST_TIME = 5;
const WORKER_HARVEST_AMOUNT = 10;
const WORKER_SUPPLY_COST = 1;

// Fighter wave constants
const WAVE_INTERVAL = 30; // seconds between waves
const FIGHTERS_PER_WAVE = 10; // per base
const MAX_FIGHTERS_PER_TEAM = 30;
const FIGHTER_SPEED = 5;
const FIGHTER_HP = 30;
const FIGHTER_DAMAGE_UNIT = 5; // damage vs mobile units
const FIGHTER_DAMAGE_BUILDING = 1; // damage vs buildings/towers
const FIGHTER_ATTACK_INTERVAL = 1; // seconds between attacks
const FIGHTER_AGGRO_RANGE = 12; // detect enemies within this range
const FIGHTER_ATTACK_RANGE = 2.8; // melee range vs units

const BUILDING_SIZES: Record<BuildingChoice, { w: number; h: number; d: number }> = {
  farm: { w: 5, h: 3, d: 5 },
  barracks: { w: 5, h: 4, d: 5 },
  armory: { w: 5, h: 4, d: 5 },
  tower: { w: 4, h: 8, d: 4 },
  turret: { w: 3, h: 2, d: 3 },
  sniper_nest: { w: 3, h: 10, d: 3 },
  garage: { w: 7, h: 5, d: 6 },
  main_base: { w: 8, h: 8, d: 8 },
  hero_academy: { w: 7, h: 7, d: 7 },
};

const BASE_UPGRADE_COST = 1000;

const BUILDING_LABELS: Record<BuildingChoice, string> = {
  farm: 'Farm',
  barracks: 'Barracks',
  armory: 'Armory',
  tower: 'Tower',
  turret: 'Turret',
  sniper_nest: 'Sniper Nest',
  garage: 'Garage',
  main_base: 'HQ',
  hero_academy: 'Hero Academy',
};

interface ConstructingBuilding {
  entity: SceneEntity;
  type: BuildingChoice;
  elapsed: number;
  duration: number;
  wireframe: THREE.LineSegments;
  barBg: THREE.Mesh;
  barFill: THREE.Mesh;
  queueLabel: THREE.Sprite | null;
}

const REPAIR_RATE = 10; // HP per second per worker repairing

const FOOT_SOLDIER_HP = 60;
const FOOT_SOLDIER_SPEED = 6;
const FOOT_SOLDIER_DAMAGE = 8; // matches pistol damage
const FOOT_SOLDIER_ATTACK_INTERVAL = 0.8;
const FOOT_SOLDIER_ATTACK_RANGE = 2.8;
const FOOT_SOLDIER_COST = 100;
const FOOT_SOLDIER_TRAIN_TIME = 5;
const FOOT_SOLDIER_SUPPLY_COST = 1;
const BARRACKS_UPGRADE_COST = 500;

const ARCHER_HP = 40;
const ARCHER_SPEED = 5;
const ARCHER_DAMAGE = 12;
const ARCHER_ATTACK_INTERVAL = 1.5;
const ARCHER_ATTACK_RANGE = 25;
const ARCHER_AGGRO_RANGE = 40;
const ARCHER_COST = 150;
const ARCHER_TRAIN_TIME = 6;
const ARCHER_SUPPLY_COST = 1;

const BUILDING_RADII_MAP: Record<string, number> = {
  main_base: 5, tower: 3, barracks: 3.5, armory: 3.5, player_tower: 2.5, turret: 1.5, sniper_nest: 1.5,
};
const WORKER_DAMAGE = 1; // very weak attack
const WORKER_ATTACK_INTERVAL = 2; // seconds between attacks
const WORKER_ATTACK_RANGE = 2.8;

const WORKER_COST = 100;
const MAX_TRAINING_QUEUE = 5;

interface TrainingQueue {
  baseEntity: SceneEntity;
  queue: { elapsed: number; duration: number; unitType?: string }[];
  // 3D progress bar meshes
  barBg: THREE.Mesh | null;
  barFill: THREE.Mesh | null;
}

const FOOT_SOLDIER_AGGRO_RANGE = 8;

export class RTSController {
  readonly rtsCamera: RTSCamera;
  readonly selection: Selection;
  readonly buildPanel: BuildPanel;
  readonly infoPanel: InfoPanel;

  private sceneManager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ghost: THREE.Mesh | null = null;
  private activeBuildType: BuildingChoice | null = null;
  private builderWorkerId: string | null = null;
  // Client-side worker build queue: workerId → ordered list of build positions
  private workerBuildQueues = new Map<string, THREE.Vector3[]>();
  private buildQueueLines: THREE.Line[] = [];
  private crystals = STARTING_CRYSTALS;
  private supplyCap = STARTING_SUPPLY_CAP;
  private supplyUsed = 0;
  onBuildingComplete: ((buildingType: string) => void) | null = null;

  // Online mode callbacks — send commands to server
  onServerCommand: ((cmd: { command: string; unitIds: string[]; targetPos?: { x: number; y: number; z: number }; targetId?: string; buildingType?: string }) => void) | null = null;
  onServerTrain: ((baseId: string) => void) | null = null;
  onServerCancelTrain: ((baseId: string, index: number) => void) | null = null;
  onServerBuild: ((buildingType: string, position: { x: number; y: number; z: number }, builderWorkerId?: string) => void) | null = null;
  onServerUpgrade: ((buildingId: string, upgradeType: string) => void) | null = null;
  onServerTrainUnit: ((baseId: string, unitType: string) => void) | null = null;
  onServerMessage: ((msg: any) => void) | null = null;

  /** Which team the local player is on (1=blue, 2=red) */
  localTeamId: TeamId = 1;
  teamPlayerCount = 1; // how many humans on this team (1 = solo, FPS controllable via RTS)

  private constructing: ConstructingBuilding[] = [];
  private trainingQueues: Map<string, TrainingQueue> = new Map(); // keyed by base entity id

  private waveTimer = WAVE_INTERVAL;
  private gameTime = 0;
  private lastFighterLevel = 0;
  onFighterLevelUp: ((level: number) => void) | null = null;

  private barracksLevels = new Map<string, number>();
  private towerLevels = new Map<string, number>();
  private towerDualGuns = new Set<string>();

  // Fog of war
  private fog: FogOfWar;

  // Warning toast
  private warningEl: HTMLDivElement;
  private warningTimer = 0;

  // Idle worker indicator
  private idleWorkerHud: HTMLDivElement;
  private idleWorkerCycleIndex = 0;

  // Control groups (Ctrl+1-9 to bind, 1-9 to recall)
  private controlGroups = new Map<number, string[]>();
  private lastGroupRecallNum = -1;
  private lastGroupRecallTime = 0;
  private groupBarEl: HTMLDivElement;

  // Building damage flames
  private flameEffects = new Map<string, FlameEffect>();

  // Minimap
  private minimap: Minimap;

  // Track resource nodes for depletion warnings
  private knownResourceNodes = new Set<string>();
  // Track known worker/foot_soldier IDs for rally point auto-commands
  private knownUnitIds = new Set<string>();

  // Rally points per building (where spawned units auto-move to)
  private rallyPoints = new Map<string, { position: THREE.Vector3; targetEntityId: string | null }>();
  private rallyLines = new Map<string, THREE.Line>();

  private hudContainer: HTMLDivElement;
  private crystalHud: HTMLDivElement;
  private supplyHud: HTMLDivElement;
  private waveHud: HTMLDivElement;
  private fighterHud: HTMLDivElement;

  constructor(sceneManager: SceneManager, canvas: HTMLCanvasElement) {
    this.sceneManager = sceneManager;
    this.canvas = canvas;
    this.rtsCamera = new RTSCamera(sceneManager.mapConfig.width, sceneManager.mapConfig.depth);
    this.rtsCamera.terrainHeight = sceneManager.terrainHeight;
    this.selection = new Selection(this.rtsCamera, sceneManager.scene, sceneManager.terrainHeight);
    this.buildPanel = new BuildPanel();
    this.infoPanel = new InfoPanel();

    this.selection.setOnChange(() => {
      if (this.selection.selected.size > 0) SoundManager.instance().unitSelected();
      this.updateInfoPanel();
    });

    // Fighters are autonomous — not selectable by the RTS player
    this.selection.selectFilter = (s) => {
      return !(s.entityType === 'fighter' && s.teamId === this.localTeamId);
    };

    this.infoPanel.setCallbacks({
      onUpgradeBase: () => this.upgradeBase(),
      onUpgradeHarvest: () => this.upgradeHarvest(),
      onUpgradeArmory: () => this.upgradeArmory(),
      onUpgradeArmoryLevel3: () => this.upgradeArmoryLevel3(),
      onUpgradeUnits: (barracksId) => this.upgradeUnits(barracksId),
      onTrainWorker: () => this.trainWorker(),
      onCancelTraining: (baseId, index) => this.cancelTraining(baseId, index),
      onTrainFootSoldier: (barracksId) => this.trainFootSoldier(barracksId),
      onUpgradeBarracks: (barracksId) => this.upgradeBarracks(barracksId),
      onUpgradeTower: (towerId) => this.upgradeTower(towerId),
      onUpgradeTowerDual: (towerId) => this.upgradeTowerDual(towerId),
      onTrainArcher: (barracksId) => this.trainArcher(barracksId),
      onTrainJeep: (garageId) => this.trainJeep(garageId),
      onTrainHelicopter: (garageId) => this.trainHelicopter(garageId),
      onUpgradeHeroHp: (buildingId) => this.onServerUpgrade?.(buildingId, 'hero_hp'),
      onUpgradeHeroDmg: (buildingId) => this.onServerUpgrade?.(buildingId, 'hero_damage'),
      onUpgradeHeroRegen: (buildingId) => this.onServerUpgrade?.(buildingId, 'hero_regen'),
      onPlaceBuilding: (type) => this.startPlacement(type),
      onCancelBuild: (buildingId) => {
        this.onServerCommand?.({ command: 'cancel_build', unitIds: [], targetId: buildingId });
      },
      getShortestQueueId: (ids) => {
        let bestId = ids[0];
        let bestLen = Infinity;
        for (const id of ids) {
          const tq = this.trainingQueues.get(id);
          const len = tq?.queue.length ?? 0;
          if (len < bestLen) { bestLen = len; bestId = id; }
        }
        return bestId;
      },
    });

    // HUD container
    this.hudContainer = document.createElement('div');
    this.hudContainer.id = 'rts-hud';
    this.hudContainer.style.cssText = `
      position: fixed;
      top: 16px;
      left: 20px;
      display: none;
      flex-direction: column;
      gap: 8px;
      z-index: 15;
      font-family: system-ui, sans-serif;
    `;

    const hudStyle = (color: string) => `
      padding: 10px 18px;
      background: rgba(0,0,0,0.7);
      color: ${color};
      font-size: 18px;
      font-weight: bold;
      border-radius: 6px;
    `;

    this.crystalHud = document.createElement('div');
    this.crystalHud.style.cssText = hudStyle('#f0c040');

    this.supplyHud = document.createElement('div');
    this.supplyHud.style.cssText = hudStyle('#8cf');

    this.waveHud = document.createElement('div');
    this.waveHud.style.cssText = hudStyle('#f88');

    this.fighterHud = document.createElement('div');
    this.fighterHud.style.cssText = hudStyle('#8f8');

    this.hudContainer.appendChild(this.crystalHud);
    this.hudContainer.appendChild(this.supplyHud);
    this.hudContainer.appendChild(this.fighterHud);
    this.hudContainer.appendChild(this.waveHud);
    document.body.appendChild(this.hudContainer);

    // Idle worker indicator
    this.idleWorkerHud = document.createElement('div');
    this.idleWorkerHud.style.cssText = `
      position: fixed; bottom: 80px; right: 20px;
      padding: 8px 16px; background: rgba(0,0,0,0.7); color: #f0c040;
      font-family: system-ui, sans-serif; font-size: 14px; font-weight: bold;
      border-radius: 6px; z-index: 15; display: none; cursor: pointer;
    `;
    this.idleWorkerHud.addEventListener('click', () => this.cycleIdleWorker());
    document.body.appendChild(this.idleWorkerHud);

    // Fog of war
    this.fog = new FogOfWar(sceneManager.scene, this.localTeamId, sceneManager.mapConfig.width, sceneManager.mapConfig.depth, sceneManager.terrainHeight);

    // Warning toast
    this.warningEl = document.createElement('div');
    this.warningEl.style.cssText = `
      position: fixed; top: 40%; left: 50%; transform: translateX(-50%);
      padding: 10px 24px; background: rgba(200,50,0,0.8); color: #fff;
      font-family: system-ui, sans-serif; font-size: 16px; font-weight: bold;
      border-radius: 8px; z-index: 16; display: none; pointer-events: none;
      transition: opacity 0.5s;
    `;
    document.body.appendChild(this.warningEl);

    // Minimap
    this.minimap = new Minimap(sceneManager.mapConfig.width, sceneManager.mapConfig.depth);
    this.minimap.localTeamId = this.localTeamId;
    this.minimap.onClickWorld = (x, z) => {
      this.rtsCamera.centerX = x;
      this.rtsCamera.centerZ = z;
    };

    // Control group bar
    this.groupBarEl = document.createElement('div');
    this.groupBarEl.id = 'control-group-bar';
    this.groupBarEl.style.cssText = `
      position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
      display: none; gap: 4px; z-index: 15; font-family: system-ui, sans-serif;
    `;
    document.body.appendChild(this.groupBarEl);
  }

  enable(): void {
    this.rtsCamera.enable();
    this.selection.enable();
    // Build panel starts hidden — shown only when a worker is selected
    this.buildPanel.enable({
      onSelect: (type) => this.startPlacement(type),
      onCancel: () => this.cancelPlacement(),
    });
    this.buildPanel.setCrystals(this.crystals);
    this.buildPanel.hide();
    this.hudContainer.style.display = 'flex';
    this.groupBarEl.style.display = 'flex';
    this.minimap.localTeamId = this.localTeamId;
    this.minimap.show();
    this.updateHud();
    this.updateGroupBar();

    this.selection.setSelectables(this.sceneManager.entities);

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('click', this.onClickPlace);
    document.addEventListener('contextmenu', this.onRightClick);
    document.addEventListener('keydown', this.onKeyDown);
  }

  disable(): void {
    this.rtsCamera.disable();
    this.selection.disable();
    this.buildPanel.disable();
    this.infoPanel.hide();
    this.cancelPlacement();
    this.hudContainer.style.display = 'none';
    this.groupBarEl.style.display = 'none';
    this.minimap.hide();
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('click', this.onClickPlace);
    document.removeEventListener('contextmenu', this.onRightClick);
    document.removeEventListener('keydown', this.onKeyDown);
  }

  /** Clean up all DOM elements and 3D objects for restart */
  destroy(): void {
    this.disable();
    this.hudContainer.remove();
    // Build panel, info panel, selection box are appended to body
    document.getElementById('build-panel')?.remove();
    document.getElementById('info-panel')?.remove();
    // Clean up health bars
    for (const [, bar] of this.healthBars) {
      this.sceneManager.scene.remove(bar.bg);
      this.sceneManager.scene.remove(bar.fill);
    }
    this.healthBars.clear();
    // Clean up training bars
    for (const [, tq] of this.trainingQueues) {
      if (tq.barBg) this.sceneManager.scene.remove(tq.barBg);
      if (tq.barFill) this.sceneManager.scene.remove(tq.barFill);
    }
    // Clean up flames
    for (const [, flame] of this.flameEffects) flame.destroy();
    this.flameEffects.clear();
    // Clean up fog and DOM
    this.fog.destroy();
    this.warningEl.remove();
    this.idleWorkerHud.remove();
    this.groupBarEl.remove();
    this.minimap.destroy();
  }

  getWaveTimer(): number {
    return this.waveTimer;
  }

  /** Active camera for billboarding health bars. Set by main loop. */
  activeCamera: THREE.Camera | null = null;
  /** FPS player entity ID — health bar hidden in FPS mode */
  fpsPlayerEntityId: string | null = null;
  /** The layer the local player is on (0 = surface, >0 = underground) */
  localLayerId = 0;
  /** Whether the player is currently in FPS mode */
  isFPSMode = false;
  /** Whether the game has ended (winner declared) */
  gameOver = false;

  /** Visual-only tick for online mode — no game logic, just rendering helpers */
  tickVisuals(dt: number): void {
    this.separateUnits(dt);
    this.updateFogOfWar();
    this.updateHealthBars();
    this.updateUnitPips();
    this.updateUnitAnimations(dt);
    this.updateBuildingFlames(dt);
    this.updateRallyLines();
    this.updateBuildQueueLines();
    this.updateMinimap();
    this.updateWarning(dt);
    this.selection.update(dt);

    // Sync crystals to info panel every frame for dynamic button updates (#4)
    this.infoPanel.crystals = this.crystals;

    // Real-time InfoPanel refresh for selected entity (HP, construction progress, training)
    if (this.selection.selected.size > 1) {
      // Multi-selection: dynamically update group health bar (#6)
      const items = this.selection.getSelected();
      this.infoPanel.refreshGroupStats(items);
    } else if (this.selection.selected.size === 1) {
      const sel = this.selection.getSelected()[0];
      if (sel) {
        // Refresh HP bar and construction status every frame
        if (this.infoPanel.refreshStats(sel)) {
          // Building just completed — full rebuild to show action buttons
          this.updateInfoPanel();
        }

        // Update training queue display for production buildings
        if (sel.teamId === this.localTeamId) {
          const tq = this.trainingQueues.get(sel.id);
          const statusEl = this.infoPanel.getStatusElement();
          if (tq && tq.queue.length > 0 && statusEl) {
            const first = tq.queue[0];
            const pct = Math.round((first.elapsed / first.duration) * 100);
            const label = first.unitType?.startsWith('upgrade_') ? 'Upgrading'
              : first.unitType === 'foot_soldier' ? 'Training Foot Soldier'
              : first.unitType === 'archer' ? 'Training Archer'
              : first.unitType === 'jeep' ? 'Training Jeep'
              : 'Training Worker';
            statusEl.textContent = `${label}... ${pct}%` + (tq.queue.length > 1 ? ` (${tq.queue.length} in queue)` : '');
            statusEl.style.display = 'block';
            const defaultType = sel.entityType === 'barracks' ? 'foot_soldier'
              : sel.entityType === 'garage' ? 'jeep' : 'worker';
            this.infoPanel.updateQueue({
              baseId: sel.id,
              slots: tq.queue.map((q, i) => ({
                unitType: q.unitType ?? defaultType,
                progress: i === 0 ? q.elapsed / q.duration : null,
              })),
              maxSlots: MAX_TRAINING_QUEUE,
            });
          } else if (statusEl && sel.status !== 'constructing') {
            statusEl.style.display = 'none';
          }
        }
      }
    }
  }

  /** Apply server snapshot data to HUD and local state (online mode) */
  setFromSnapshot(snapshot: import('@dyarchy/shared').SnapshotMsg): void {
    // Keep subsystems in sync with team
    this.fog.teamId = this.localTeamId;
    this.infoPanel.localTeamId = this.localTeamId;
    const t = this.localTeamId;
    this.crystals = snapshot.teamResources[t] ?? 0;
    this.supplyCap = snapshot.teamSupply[t]?.cap ?? 10;
    this.supplyUsed = snapshot.teamSupply[t]?.used ?? 0;
    this.waveTimer = snapshot.waveTimer;
    this.buildPanel.setCrystals(this.crystals);

    // Sync training queues from server
    const serverQueues = snapshot.trainingQueues?.[t] ?? [];
    // Update local training queue map to match server
    const serverBaseIds = new Set<string>();
    for (const stq of serverQueues) {
      serverBaseIds.add(stq.baseId);
      let tq = this.trainingQueues.get(stq.baseId);
      const base = this.sceneManager.entities.find(e => e.id === stq.baseId);
      if (!tq && base) {
        tq = { baseEntity: base, queue: [], barBg: null, barFill: null };
        this.trainingQueues.set(stq.baseId, tq);
      }
      if (tq) {
        tq.queue = stq.queue.map(s => ({ elapsed: s.elapsed, duration: s.duration, unitType: s.unitType }));
        this.updateTrainingBar(tq);
      }
    }
    // Remove queues no longer on server
    for (const [baseId, tq] of this.trainingQueues) {
      if (!serverBaseIds.has(baseId)) {
        tq.queue = [];
        this.updateTrainingBar(tq);
        this.trainingQueues.delete(baseId);
      }
    }

    // Sync building levels from server
    for (const se of snapshot.entities) {
      if (se.entityType === 'barracks' && se.level && se.level >= 2) {
        const prevLevel = this.barracksLevels.get(se.id) ?? 1;
        this.barracksLevels.set(se.id, se.level);
        if (se.level > prevLevel) {
          const ent = this.sceneManager.entities.find(e => e.id === se.id);
          if (ent) this.addUpgradeFlag(ent, se.level);
        }
      }
      const towerTypes = new Set(['tower', 'player_tower', 'turret']);
      if (towerTypes.has(se.entityType) && se.level && se.level >= 2) {
        const prevLevel = this.towerLevels.get(se.id) ?? 1;
        this.towerLevels.set(se.id, se.level);
        if (se.level > prevLevel) {
          const ent = this.sceneManager.entities.find(e => e.id === se.id);
          if (ent) this.addUpgradeFlag(ent, se.level);
        }
      }
      if (se.entityType === 'main_base' && se.teamId === t && se.level && se.level >= 2) {
        if (!this.buildPanel.baseUpgraded) {
          this.buildPanel.baseUpgraded = true;
          this.infoPanel.baseUpgraded = true;
          this.updateInfoPanel();
        }
      }
      // Detect harvest boost from snapshot
      if (snapshot.harvestBoost?.[t] && !this.infoPanel.harvestBoosted) {
        this.infoPanel.harvestBoosted = true;
        this.updateInfoPanel();
      }
      if (se.entityType === 'armory' && se.teamId === t && se.level && se.level >= 2) {
        if (!this.infoPanel.armoryLevel2) {
          this.infoPanel.armoryLevel2 = true;
          this.onBuildingComplete?.('armory_level2');
          const armEnt = this.sceneManager.entities.find(e => e.id === se.id);
          if (armEnt) this.addUpgradeFlag(armEnt, 2);
          this.updateInfoPanel();
        }
        if (se.level >= 3 && !this.infoPanel.armoryRocketUpgrade) {
          this.infoPanel.armoryRocketUpgrade = true;
          this.onBuildingComplete?.('armory_rockets');
          this.updateInfoPanel();
        }
        // armoryLevel3 is now tracked as a team flag, synced below
      }
    }
    // Sync hero academy upgrade levels
    if (snapshot.heroHpLevel) this.infoPanel.heroHpLevel = snapshot.heroHpLevel[t] ?? 0;
    if (snapshot.heroDmgLevel) this.infoPanel.heroDmgLevel = snapshot.heroDmgLevel[t] ?? 0;
    if (snapshot.heroRegen?.[t]) this.infoPanel.heroRegenUnlocked = true;
    if ((snapshot as any).unitUpgradeLevel) this.infoPanel.unitUpgradeLevel = (snapshot as any).unitUpgradeLevel[t] ?? 0;
    if ((snapshot as any).armoryLevel3?.[t] && !this.infoPanel.armoryLevel3) {
      this.infoPanel.armoryLevel3 = true;
      this.updateInfoPanel();
    }
    // Check if expansion HQ requires main HQ upgrade
    const myHQs = this.sceneManager.entities.filter(e => e.entityType === 'main_base' && e.teamId === this.localTeamId && e.hp > 0);
    this.infoPanel.needsHQUpgradeForExpansion = myHQs.length > 0 && !this.infoPanel.baseUpgraded;

    this.infoPanel.barracksLevels = this.barracksLevels;

    // Detect depleted resource nodes — only warn if our workers were nearby
    const currentNodes = new Set(snapshot.entities.filter(e => e.entityType === 'resource_node').map(e => e.id));
    for (const id of this.knownResourceNodes) {
      if (!currentNodes.has(id)) {
        // Check if any of our workers were near this node (likely mining it)
        const nodeEntity = this.sceneManager.entities.find(e => e.id === id);
        if (nodeEntity) {
          const ourWorkerNearby = snapshot.entities.some(e =>
            e.entityType === 'worker' && e.teamId === t &&
            Math.sqrt((e.position.x - nodeEntity.mesh.position.x) ** 2 +
                       (e.position.z - nodeEntity.mesh.position.z) ** 2) < 5,
          );
          if (ourWorkerNearby) {
            this.showWarning('A 💎 Field has been depleted!');
          }
        }
      }
    }
    this.knownResourceNodes = currentNodes;

    // Auto-command newly spawned units to rally points
    if (this.onServerCommand) {
      const friendlyUnits = snapshot.entities.filter(
        e => e.teamId === t && (e.entityType === 'worker' || e.entityType === 'foot_soldier' || e.entityType === 'archer' || e.entityType === 'jeep'),
      );
      for (const unit of friendlyUnits) {
        if (!this.knownUnitIds.has(unit.id)) {
          // New unit — check if any base/barracks with a rally point is nearby
          for (const [buildingId, rally] of this.rallyPoints) {
            const building = snapshot.entities.find(e => e.id === buildingId);
            if (!building || building.teamId !== t) continue;
            // Check if unit spawned near this building (within 10 units)
            const dx = unit.position.x - building.position.x;
            const dz = unit.position.z - building.position.z;
            if (Math.sqrt(dx * dx + dz * dz) < 10) {
              if (rally.targetEntityId) {
                // Check what the target entity is
                const targetEnt = snapshot.entities.find(e => e.id === rally.targetEntityId);
                if (targetEnt?.entityType === 'resource_node' && unit.entityType === 'worker') {
                  this.onServerCommand({ command: 'harvest', unitIds: [unit.id], targetId: rally.targetEntityId });
                } else if (targetEnt && RTSController.MOBILE_TYPES.has(targetEnt.entityType as any)) {
                  // Follow a unit
                  this.onServerCommand({ command: 'follow', unitIds: [unit.id], targetId: rally.targetEntityId });
                } else {
                  this.onServerCommand({ command: 'move', unitIds: [unit.id], targetPos: { x: rally.position.x, y: 0, z: rally.position.z } });
                }
              } else {
                this.onServerCommand({ command: 'move', unitIds: [unit.id], targetPos: { x: rally.position.x, y: 0, z: rally.position.z } });
              }
              break;
            }
          }
        }
      }
      this.knownUnitIds = new Set(friendlyUnits.map(u => u.id));
    }

    // Prune dead entities from control groups
    for (const [num, ids] of this.controlGroups) {
      const alive = ids.filter(id => this.sceneManager.entities.some(e => e.id === id && e.hp > 0));
      if (alive.length === 0) this.controlGroups.delete(num);
      else this.controlGroups.set(num, alive);
    }
    this.updateGroupBar();

    // Sync construction progress bars for constructing entities
    this.syncConstructionBars();

    this.updateHud();
    this.selection.setSelectables(this.sceneManager.entities);
  }

  /** Create/update/remove construction wireframes and progress bars for online mode */
  private syncConstructionBars(): void {
    const scene = this.sceneManager.scene;
    const activeIds = new Set<string>();

    for (const entity of this.sceneManager.entities) {
      if (entity.status !== 'constructing') continue;
      // Only show construction bars for own team's buildings
      if (entity.teamId !== this.localTeamId) continue;
      activeIds.add(entity.id);

      let cb = this.constructing.find(c => c.entity.id === entity.id);
      if (!cb) {
        // Create wireframe + progress bar for this constructing entity
        const size = { w: 5, h: 4, d: 5 }; // approximate
        const pos = entity.mesh.position;

        const wireBoxGeo = new THREE.BoxGeometry(size.w, size.h, size.d);
        wireBoxGeo.translate(0, size.h / 2, 0);
        const wireGeo = new THREE.EdgesGeometry(wireBoxGeo);
        const wireMat = new THREE.LineBasicMaterial({ color: 0xffaa00 });
        const wireframe = new THREE.LineSegments(wireGeo, wireMat);
        wireframe.position.set(pos.x, 0, pos.z);
        scene.add(wireframe);

        const barY = size.h + 0.5;
        const barBgGeo = new THREE.PlaneGeometry(4, 0.5);
        const barBgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
        const barBg = new THREE.Mesh(barBgGeo, barBgMat);
        barBg.position.set(pos.x, barY, pos.z);
        barBg.rotation.x = -Math.PI * 0.3;
        scene.add(barBg);

        const barFillGeo = new THREE.PlaneGeometry(4, 0.5);
        const barFillMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide });
        const barFill = new THREE.Mesh(barFillGeo, barFillMat);
        barFill.position.set(pos.x - 2, barY, pos.z);
        barFill.rotation.x = -Math.PI * 0.3;
        barFill.scale.set(0.001, 1, 1);
        scene.add(barFill);

        cb = { entity, type: 'barracks' as any, elapsed: 0, duration: CONSTRUCTION_TIME, wireframe, barBg, barFill, queueLabel: null };
        this.constructing.push(cb);
      }

      // Update progress bar
      const progress = entity.constructionProgress;
      const barWidth = 4 * progress;
      cb.barFill.scale.set(progress || 0.001, 1, 1);
      cb.barFill.position.x = entity.mesh.position.x - 2 + barWidth / 2;
      cb.wireframe.position.set(entity.mesh.position.x, 0, entity.mesh.position.z);
      cb.barBg.position.set(entity.mesh.position.x, cb.barBg.position.y, entity.mesh.position.z);

      // Fade building mesh: 80% transparent at 0% progress → fully opaque at 100%
      const opacity = 0.2 + 0.8 * progress;
      RTSController.setMeshOpacity(entity.mesh, opacity);

      // Queue number label: find this building's position in the builder's queue
      const queueIndex = this.getBuildQueueIndex(entity);
      if (queueIndex > 0) {
        if (!cb.queueLabel) {
          cb.queueLabel = this.createQueueLabel(queueIndex);
          scene.add(cb.queueLabel);
        } else {
          this.updateQueueLabelText(cb.queueLabel, queueIndex);
        }
        cb.queueLabel.position.set(
          entity.mesh.position.x,
          entity.mesh.position.y + 3,
          entity.mesh.position.z,
        );
      } else if (cb.queueLabel) {
        scene.remove(cb.queueLabel);
        cb.queueLabel.material.dispose();
        cb.queueLabel = null;
      }
    }

    // Remove construction visuals for entities that are no longer constructing
    this.constructing = this.constructing.filter(cb => {
      if (activeIds.has(cb.entity.id)) return true;
      // Building completed — restore full opacity
      RTSController.setMeshOpacity(cb.entity.mesh, 1);
      scene.remove(cb.wireframe);
      cb.wireframe.geometry.dispose();
      scene.remove(cb.barBg);
      cb.barBg.geometry.dispose();
      scene.remove(cb.barFill);
      cb.barFill.geometry.dispose();
      if (cb.queueLabel) {
        scene.remove(cb.queueLabel);
        cb.queueLabel.material.dispose();
      }
      return false;
    });
  }

  /** Get the 1-based queue position of a constructing building, or 0 if it's actively being built. */
  private getBuildQueueIndex(entity: SceneEntity): number {
    for (const [, queue] of this.workerBuildQueues) {
      for (let i = 0; i < queue.length; i++) {
        const pos = queue[i];
        if (Math.abs(entity.mesh.position.x - pos.x) < 1 && Math.abs(entity.mesh.position.z - pos.z) < 1) {
          // Index 0 = currently being built (or next), show number only for queued ones
          return i + 1;
        }
      }
    }
    return 0;
  }

  private createQueueLabel(num: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffaa00';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 32, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2, 2, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  private updateQueueLabelText(sprite: THREE.Sprite, num: number): void {
    const mat = sprite.material as THREE.SpriteMaterial;
    const tex = mat.map as THREE.CanvasTexture;
    const canvas = tex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffaa00';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 32, 32);
    tex.needsUpdate = true;
  }

  setCameraCenter(x: number, z: number): void {
    this.rtsCamera.centerX = x;
    this.rtsCamera.centerZ = z;
  }

  updateCamera(dt: number): void {
    this.rtsCamera.update(dt);
  }

  getCamera(): THREE.Camera {
    return this.rtsCamera.camera;
  }

  /** Get the ground-level center point the RTS camera is looking at */
  getViewCenter(): { x: number; z: number } {
    return { x: this.rtsCamera.centerX, z: this.rtsCamera.centerZ };
  }

  // ===================== Control Groups =====================

  private recallGroup(num: number): void {
    const group = this.controlGroups.get(num);
    if (!group || group.length === 0) return;
    this.selection.clearSelection();
    for (const id of group) this.selection.selected.add(id);
    this.selection.updateHighlights();
    this.updateInfoPanel();
    this.updateGroupBar();
  }

  private jumpCameraToGroup(num: number): void {
    const group = this.controlGroups.get(num);
    if (!group || group.length === 0) return;
    let sumX = 0, sumZ = 0, count = 0;
    for (const id of group) {
      const ent = this.sceneManager.entities.find(e => e.id === id);
      if (ent) { sumX += ent.mesh.position.x; sumZ += ent.mesh.position.z; count++; }
    }
    if (count > 0) this.setCameraCenter(sumX / count, sumZ / count);
  }

  private updateGroupBar(): void {
    this.groupBarEl.innerHTML = '';
    const selectedIds = this.selection.selected;
    for (const [num, ids] of [...this.controlGroups.entries()].sort((a, b) => a[0] - b[0])) {
      if (ids.length === 0) continue;

      // Determine if group is buildings or units
      const hasBuilding = ids.some(id => {
        const ent = this.sceneManager.entities.find(e => e.id === id);
        return ent && !RTSController.MOBILE_TYPES.has(ent.entityType as any);
      });
      const icon = hasBuilding ? '\u{1F3E0}' : '\u2694';

      // Check if this group matches the current selection
      const isActive = ids.length === selectedIds.size && ids.every(id => selectedIds.has(id));

      const box = document.createElement('div');
      box.style.cssText = `
        width: 48px; height: 48px; background: rgba(0,0,0,0.7);
        border: 1px solid ${isActive ? '#4af' : '#555'}; border-radius: 4px; cursor: pointer;
        text-align: center; font-size: 11px; color: #ccc; position: relative;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        user-select: none;
      `;

      const numLabel = document.createElement('div');
      numLabel.style.cssText = 'position: absolute; top: 2px; left: 4px; font-size: 10px; color: #888;';
      numLabel.textContent = String(num);
      box.appendChild(numLabel);

      const content = document.createElement('div');
      content.style.cssText = 'font-size: 13px; line-height: 1.2;';
      content.textContent = `${icon} ${ids.length}`;
      box.appendChild(content);

      box.addEventListener('click', () => {
        const now = performance.now();
        if (this.lastGroupRecallNum === num && now - this.lastGroupRecallTime < 400) {
          this.jumpCameraToGroup(num);
          this.lastGroupRecallNum = -1;
        } else {
          this.recallGroup(num);
          this.lastGroupRecallNum = num;
          this.lastGroupRecallTime = now;
        }
      });

      this.groupBarEl.appendChild(box);
    }
  }

  // ===================== Info Panel =====================

  private updateInfoPanel(): void {
    this.infoPanel.barracksLevels = this.barracksLevels;
    this.infoPanel.towerLevels = this.towerLevels;
    this.infoPanel.towerDualGuns = this.towerDualGuns;
    this.infoPanel.crystals = this.crystals;
    const items = this.selection.getSelected();

    // Hide build panel when no worker is selected
    const hasWorkerSelected = items.some(
      s => s.entityType === 'worker' && s.teamId === this.localTeamId,
    );
    if (!hasWorkerSelected) {
      this.buildPanel.hide();
      if (this.activeBuildType) this.cancelPlacement();
    }

    if (items.length === 1) {
      const item = items[0];
      // Building with training queue
      const tq = this.trainingQueues.get(item.id);
      const isUpgrading = tq?.queue.some(q => q.unitType?.startsWith('upgrade_')) ?? false;

      const buildQueueInfo = (defaultType: string) => ({
        baseId: item.id,
        slots: (tq?.queue ?? []).map((q, i) => ({
          unitType: q.unitType ?? defaultType,
          progress: i === 0 ? q.elapsed / q.duration : null,
        })),
        maxSlots: MAX_TRAINING_QUEUE,
      });

      const getTrainingStatus = () => {
        if (!tq || tq.queue.length === 0) return undefined;
        const first = tq.queue[0];
        const pct = Math.round((first.elapsed / first.duration) * 100);
        if (first.unitType?.startsWith('upgrade_')) return `Upgrading... ${pct}%`;
        if (first.unitType === 'foot_soldier') return `Training Foot Soldier... ${pct}%`;
        return `Training Worker... ${pct}%`;
      };

      if (item.entityType === 'main_base' && item.teamId === this.localTeamId && item.status === 'active') {
        this.infoPanel.show(items, getTrainingStatus(), buildQueueInfo('worker'), isUpgrading);
        return;
      }

      if (item.entityType === 'barracks' && item.teamId === this.localTeamId && item.status === 'active') {
        const level = this.barracksLevels.get(item.id) ?? 1;
        const status = getTrainingStatus() ?? (level >= 2 ? 'Level 2' : undefined);
        this.infoPanel.show(items, status, buildQueueInfo('foot_soldier'), isUpgrading);
        return;
      }

      if (item.entityType === 'armory' && item.teamId === this.localTeamId && item.status === 'active') {
        const status = getTrainingStatus() ?? (this.infoPanel.armoryLevel2 ? 'Level 2' : undefined);
        this.infoPanel.show(items, status, buildQueueInfo('upgrade_armory'), isUpgrading);
        return;
      }

      const TOWER_ENTITY_TYPES = new Set(['tower', 'player_tower', 'turret']);
      if (TOWER_ENTITY_TYPES.has(item.entityType) && item.teamId === this.localTeamId && item.status === 'active') {
        const towerLevel = this.towerLevels.get(item.id) ?? 1;
        const status = getTrainingStatus() ?? (towerLevel >= 2 ? 'Upgraded' : undefined);
        this.infoPanel.show(items, status, buildQueueInfo('upgrade_tower'), isUpgrading);
        return;
      }
    }
    this.infoPanel.show(items);
  }

  private updateMinimap(): void {
    if (this.isFPSMode) return; // minimap only in RTS mode
    const cam = this.rtsCamera.camera;
    const aspect = window.innerWidth / window.innerHeight;
    const zoom = (cam.right - cam.left) / 2 / aspect; // recover zoom from projection
    // Ortho camera viewport in world units
    const viewHalfW = zoom * aspect;
    // The camera is pitched, so the ground footprint depth is stretched
    // For top-down (90°) it equals zoom; for lower angles it's larger.
    // Approximate: the viewport center-to-edge on Z ≈ zoom / sin(pitch)
    // But since we use lookAt, the vertical extent maps to Z via the pitch angle.
    // Simpler: just use zoom as the half-depth (good enough for minimap rectangle)
    const viewHalfH = zoom;
    this.minimap.update(
      this.sceneManager.entities,
      this.rtsCamera.centerX,
      this.rtsCamera.centerZ,
      viewHalfW,
      viewHalfH,
      (x, z) => this.fog.isVisible(x, z),
      (x, z) => this.fog.isExplored(x, z),
    );
  }

  private updateIdleWorkerIndicator(): void {
    if (this.isFPSMode) { this.idleWorkerHud.style.display = 'none'; return; }

    const workerCount = this.sceneManager.entities.filter(
      e => e.entityType === 'worker' && e.teamId === this.localTeamId && e.hp > 0,
    ).length;
    if (workerCount > 0) {
      this.idleWorkerHud.textContent = `Workers: ${workerCount} (click to find)`;
      this.idleWorkerHud.style.display = 'block';
    } else {
      this.idleWorkerHud.style.display = 'none';
    }
  }

  private cycleIdleWorker(): void {
    const gruntEntities = this.sceneManager.entities.filter(
      e => e.entityType === 'worker' && e.teamId === this.localTeamId && e.hp > 0,
    );
    if (gruntEntities.length === 0) return;

    this.idleWorkerCycleIndex = this.idleWorkerCycleIndex % gruntEntities.length;
    const entity = gruntEntities[this.idleWorkerCycleIndex];

    // Select the worker
    this.selection.clearSelection();
    this.selection.selected.add(entity.id);
    this.selection.updateHighlights();
    this.updateInfoPanel();

    // Pan camera to it
    this.rtsCamera.centerX = entity.mesh.position.x;
    this.rtsCamera.centerZ = entity.mesh.position.z;

    this.idleWorkerCycleIndex++;
  }

  private updateWarning(dt: number): void {
    if (this.warningTimer > 0) {
      this.warningTimer -= dt;
      if (this.warningTimer <= 0.5) {
        this.warningEl.style.opacity = String(Math.max(0, this.warningTimer / 0.5));
      }
      if (this.warningTimer <= 0) {
        this.warningEl.style.display = 'none';
      }
    }
  }

  private showWarning(msg: string): void {
    this.warningEl.textContent = msg;
    this.warningEl.style.display = 'block';
    this.warningEl.style.opacity = '1';
    this.warningTimer = 3;
  }

  /** Add a "Level 2" flag to a building mesh */
  private levelFlags = new Map<string, THREE.Group>();

  private addUpgradeFlag(entity: SceneEntity, level: number = 2): void {
    // Remove old flag if exists
    const oldFlag = this.levelFlags.get(entity.id);
    if (oldFlag) {
      entity.mesh.remove(oldFlag);
    }

    const flagGroup = new THREE.Group();

    // Pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 3, 4),
      new THREE.MeshLambertMaterial({ color: 0xcccccc }),
    );
    pole.position.set(0, 6, 0);
    flagGroup.add(pole);

    // Flag with large level number using canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = level >= 3 ? '#ff4400' : '#ffdd00';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 90px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${level}`, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.8),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    flag.position.set(0.9, 7, 0);
    flagGroup.add(flag);

    entity.mesh.add(flagGroup);
    this.levelFlags.set(entity.id, flagGroup);
  }

  // ===================== Base Upgrade =====================

  private upgradeBase(): void {
    if (this.crystals < BASE_UPGRADE_COST) return;
    if (this.buildPanel.baseUpgraded) return;

    const base = this.sceneManager.entities.find(e => e.entityType === 'main_base' && e.teamId === this.localTeamId);
    if (!base) return;

    if (this.onServerUpgrade) {
      this.onServerUpgrade(base.id, 'base_upgrade');
      let tq = this.trainingQueues.get(base.id);
      if (!tq) {
        tq = { baseEntity: base, queue: [], barBg: null, barFill: null };
        this.trainingQueues.set(base.id, tq);
      }
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_base' });
      this.updateInfoPanel();
    }
  }

  private upgradeHarvest(): void {
    if (this.crystals < 400) return;
    if (this.infoPanel.harvestBoosted) return;

    const base = this.sceneManager.entities.find(e => e.entityType === 'main_base' && e.teamId === this.localTeamId);
    if (!base) return;

    if (this.onServerUpgrade) {
      this.onServerUpgrade(base.id, 'harvest_boost');
      let tq = this.trainingQueues.get(base.id);
      if (!tq) {
        tq = { baseEntity: base, queue: [], barBg: null, barFill: null };
        this.trainingQueues.set(base.id, tq);
      }
      tq.queue.push({ elapsed: 0, duration: 8, unitType: 'upgrade_harvest' });
      this.updateInfoPanel();
    }
  }

  private upgradeArmory(): void {
    const armory = this.sceneManager.entities.find(e => e.entityType === 'armory' && e.teamId === this.localTeamId);
    if (!armory) return;

    // If already level 2, this is the rocket cooldown upgrade
    if (this.infoPanel.armoryLevel2) {
      if (this.infoPanel.armoryRocketUpgrade) return;
      if (this.crystals < 400) { this.showWarning('Not enough 💎 (need 400)'); return; }

      if (this.onServerUpgrade) {
        this.onServerUpgrade(armory.id, 'armory_rockets');
        let tq = this.trainingQueues.get(armory.id);
        if (!tq) { tq = { baseEntity: armory, queue: [], barBg: null, barFill: null }; this.trainingQueues.set(armory.id, tq); }
        tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_armory' });
        this.updateInfoPanel();
      }
      return;
    }

    if (this.crystals < 500) { this.showWarning('Not enough 💎 (need 500)'); return; }
    if (this.onServerUpgrade) {
      this.onServerUpgrade(armory.id, 'armory_level2');
      let tq = this.trainingQueues.get(armory.id);
      if (!tq) {
        tq = { baseEntity: armory, queue: [], barBg: null, barFill: null };
        this.trainingQueues.set(armory.id, tq);
      }
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_armory' });
      this.updateInfoPanel();
    }
  }

  private upgradeArmoryLevel3(): void {
    if (this.crystals < 600) { this.showWarning('Not enough 💎 (need 600)'); return; }
    const armory = this.sceneManager.entities.find(e => e.entityType === 'armory' && e.teamId === this.localTeamId);
    if (!armory) return;
    if (this.onServerUpgrade) {
      this.onServerUpgrade(armory.id, 'armory_level3');
      let tq = this.trainingQueues.get(armory.id);
      if (!tq) { tq = { baseEntity: armory, queue: [], barBg: null, barFill: null }; this.trainingQueues.set(armory.id, tq); }
      tq.queue.push({ elapsed: 0, duration: 15, unitType: 'upgrade_armory' });
      this.updateInfoPanel();
    }
  }

  private upgradeUnits(barracksId: string): void {
    const uLvl = this.infoPanel.unitUpgradeLevel;
    const cost = uLvl === 0 ? 250 : 750;
    if (this.crystals < cost) { this.showWarning(`Not enough 💎 (need ${cost})`); return; }
    if (this.onServerUpgrade) {
      this.onServerUpgrade(barracksId, 'unit_upgrade');
      let tq = this.trainingQueues.get(barracksId);
      const barracks = this.sceneManager.entities.find(e => e.id === barracksId);
      if (!tq && barracks) { tq = { baseEntity: barracks, queue: [], barBg: null, barFill: null }; this.trainingQueues.set(barracksId, tq); }
      if (tq) tq.queue.push({ elapsed: 0, duration: 12, unitType: 'upgrade_barracks' });
      this.updateInfoPanel();
    }
  }

  // ===================== Worker Training =====================

  private trainWorker(): void {
    if (this.supplyUsed >= this.supplyCap) {
      this.showWarning('Supply cap reached! Build more Barracks');
      return;
    }
    if (this.crystals < WORKER_COST) {
      this.showWarning(`Not enough 💎 (need ${WORKER_COST})`);
      return;
    }

    const selected = this.selection.getSelected();
    const sel = selected.find(s => s.entityType === 'main_base' && s.teamId === this.localTeamId);
    if (!sel) return;

    const base = this.sceneManager.entities.find(e => e.id === sel.id);
    if (!base) return;

    if (this.onServerTrain) {
      this.onServerTrain(base.id);
      // Optimistically add to local queue so UI updates immediately
      let tq = this.trainingQueues.get(base.id);
      if (!tq) {
        tq = { baseEntity: base, queue: [], barBg: null, barFill: null };
        this.trainingQueues.set(base.id, tq);
      }
      tq.queue.push({ elapsed: 0, duration: WORKER_TRAIN_TIME, unitType: 'worker' });
      this.updateInfoPanel();
    }
  }

  private cancelTraining(baseId: string, index: number): void {
    if (this.onServerCancelTrain) {
      this.onServerCancelTrain(baseId, index);
    }
  }

  private updateTrainingBar(tq: TrainingQueue): void {
    const scene = this.sceneManager.scene;
    const pos = tq.baseEntity.mesh.position;

    if (tq.queue.length === 0) {
      // Remove bar
      if (tq.barBg) { scene.remove(tq.barBg); tq.barBg.geometry.dispose(); tq.barBg = null; }
      if (tq.barFill) { scene.remove(tq.barFill); tq.barFill.geometry.dispose(); tq.barFill = null; }
      return;
    }

    const barY = pos.y + 4.5;

    // Create bar if needed
    if (!tq.barBg) {
      const bgGeo = new THREE.PlaneGeometry(4, 0.5);
      const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
      tq.barBg = new THREE.Mesh(bgGeo, bgMat);
      tq.barBg.rotation.x = -Math.PI * 0.3;
      scene.add(tq.barBg);
    }
    if (!tq.barFill) {
      const fillGeo = new THREE.PlaneGeometry(4, 0.5);
      const fillMat = new THREE.MeshBasicMaterial({ color: 0x44cc44, side: THREE.DoubleSide });
      tq.barFill = new THREE.Mesh(fillGeo, fillMat);
      tq.barFill.rotation.x = -Math.PI * 0.3;
      scene.add(tq.barFill);
    }

    // Update bar positions and fill
    tq.barBg.position.set(pos.x, barY, pos.z);
    const current = tq.queue[0];
    const progress = Math.min(current.elapsed / current.duration, 1);
    const barWidth = 4 * progress;
    tq.barFill.scale.set(progress || 0.001, 1, 1);
    tq.barFill.position.set(pos.x - 2 + barWidth / 2, barY, pos.z);
  }


  private static readonly MOBILE_TYPES = new Set(['fighter', 'worker', 'fps_player', 'foot_soldier', 'archer', 'jeep']);

  // ===================== Movement helpers =====================

  private moveToward(mesh: THREE.Mesh, target: THREE.Vector3, dt: number, speed: number, stopDist = 1.0): boolean {
    const dx = target.x - mesh.position.x;
    const dz = target.z - mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= stopDist) return true;

    const step = speed * dt;
    const moveDist = Math.min(step, dist - stopDist);

    mesh.position.x += (dx / dist) * moveDist;
    mesh.position.z += (dz / dist) * moveDist;
    return dist - moveDist <= stopDist;
  }

  private distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // ===================== Unit Pips (always-visible markers) =====================

  private unitPips = new Map<string, THREE.Mesh>();

  private static readonly PIP_COLORS: Record<string, { 1: number; 2: number }> = {
    worker:      { 1: 0x4488dd, 2: 0xdd4444 },
    fighter:    { 1: 0x2266cc, 2: 0xcc2222 },
    fps_player: { 1: 0x00ffff, 2: 0xff4466 },
    foot_soldier: { 1: 0x55ccff, 2: 0xff7755 },
    archer: { 1: 0x44dd88, 2: 0xdd8844 },
  };

  /** Render small colored dots above crystal fields.
   *  Only shown in RTS view — in FPS mode the pips are hidden. */
  private updateUnitPips(): void {
    const scene = this.sceneManager.scene;
    const showPips = !this.isFPSMode;
    const activeIds = new Set<string>();

    for (const entity of this.sceneManager.entities) {
      if (entity.entityType !== 'resource_node') continue;
      if (entity.hp <= 0) continue;

      activeIds.add(entity.id);

      let pip = this.unitPips.get(entity.id);
      if (!pip) {
        const geo = new THREE.CircleGeometry(0.5, 8);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x66ddff,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.85,
        });
        pip = new THREE.Mesh(geo, mat);
        pip.rotation.x = -Math.PI / 2;
        pip.renderOrder = 999;
        scene.add(pip);
        this.unitPips.set(entity.id, pip);
      }

      pip.visible = showPips && entity.mesh.visible;
      const pos = entity.mesh.position;
      pip.position.set(pos.x, pos.y + 1.5, pos.z);
    }

    // Remove pips for entities that no longer exist
    for (const [id, pip] of this.unitPips) {
      if (!activeIds.has(id)) {
        scene.remove(pip);
        pip.geometry.dispose();
        (pip.material as THREE.Material).dispose();
        this.unitPips.delete(id);
      }
    }
  }

  // ===================== Unit Animations =====================

  private animTime = 0;
  private prevPositions = new Map<string, { x: number; z: number }>();

  private towerFlashTimers = new Map<string, number>();

  private combatSoundTimer = 0;
  private archerFireTimers = new Map<string, number>(); // cooldown per archer to avoid arrow spam

  private updateUnitAnimations(dt: number): void {
    this.animTime += dt;

    // Decrement archer fire cooldown timers
    for (const [id, t] of this.archerFireTimers) {
      if (t - dt <= 0) this.archerFireTimers.delete(id);
      else this.archerFireTimers.set(id, t - dt);
    }

    // Combat sounds
    this.combatSoundTimer -= dt;
    if (this.combatSoundTimer <= 0) {
      this.combatSoundTimer = 0.4;
      this.playCombatSounds();
    }

    // Animate all mobile entities based on position deltas (online mode)
    for (const entity of this.sceneManager.entities) {
      if (RTSController.MOBILE_TYPES.has(entity.entityType) && entity.hp > 0) {
        // Read prev position BEFORE updateFacing overwrites it
        const prevBeforeFacing = this.prevPositions.get(entity.id);
        const curPos = entity.mesh.position;
        const moveDelta = prevBeforeFacing
          ? (curPos.x - prevBeforeFacing.x) ** 2 + (curPos.z - prevBeforeFacing.z) ** 2
          : 0;

        this.updateFacing(entity);

        const isMoving = moveDelta > 0.0001;

        // Detect attacking: unit is stationary and near an enemy
        let isAttacking = false;
        const atkDetectRange = entity.entityType === 'archer' ? ARCHER_ATTACK_RANGE * ARCHER_ATTACK_RANGE : 9;
        if (!isMoving) {
          // For archers: find the enemy that best matches the archer's facing direction
          // (the server rotates archers toward their actual target)
          let bestTarget: SceneEntity | null = null;
          if (entity.entityType === 'archer') {
            const facingX = Math.sin(entity.mesh.rotation.y);
            const facingZ = Math.cos(entity.mesh.rotation.y);
            let bestScore = -Infinity;
            for (const other of this.sceneManager.entities) {
              if (other.teamId === entity.teamId || other.hp <= 0) continue;
              const adx = other.mesh.position.x - entity.mesh.position.x;
              const adz = other.mesh.position.z - entity.mesh.position.z;
              const d2 = adx * adx + adz * adz;
              if (d2 >= atkDetectRange || d2 < 0.01) continue;
              // Dot product with facing direction — higher = more aligned
              const len = Math.sqrt(d2);
              const dot = (adx / len) * facingX + (adz / len) * facingZ;
              if (dot > bestScore) { bestScore = dot; bestTarget = other; }
            }
          } else {
            // Melee units: closest enemy in range
            let bestDist = atkDetectRange;
            for (const other of this.sceneManager.entities) {
              if (other.teamId === entity.teamId || other.hp <= 0) continue;
              const adx = entity.mesh.position.x - other.mesh.position.x;
              const adz = entity.mesh.position.z - other.mesh.position.z;
              const d2 = adx * adx + adz * adz;
              if (d2 < bestDist) { bestDist = d2; bestTarget = other; }
            }
          }
          if (bestTarget) {
            isAttacking = true;
            // Face toward the attack target (archers and melee)
            const tdx = bestTarget.mesh.position.x - entity.mesh.position.x;
            const tdz = bestTarget.mesh.position.z - entity.mesh.position.z;
            if (tdx * tdx + tdz * tdz > 0.01) {
              entity.mesh.rotation.y = Math.atan2(tdx, tdz);
            }
            if (entity.entityType === 'archer') {
              this.trySpawnArrow(entity, bestTarget);
            }
          }
        }

        this.animateUnit(entity.mesh, isMoving, isAttacking, dt);

        // Worker crystal bag: rotation.z = 1 means carrying
        if (entity.entityType === 'worker') {
          this.setCrystalBagVisible(entity.mesh, entity.rotation.z > 0.5);
        }
      }

      // Tower turret rotation and muzzle flash
      if (entity.entityType === 'tower' || entity.entityType === 'player_tower' || entity.entityType === 'turret' || entity.entityType === 'main_base') {
        this.animateTowerTurret(entity, dt);
      }

      // Jeep turret animation (when driven by FPS player)
      if (entity.entityType === 'jeep' && entity.rotation.z > 0.5) {
        this.animateJeepTurret(entity, dt);
      }
    }
  }

  private animateTowerTurret(entity: SceneEntity, dt: number): void {
    // Find the turret group, secondary barrel, and muzzle flash
    const found: { turret: THREE.Object3D | null; flash: THREE.Object3D | null; secondary: THREE.Object3D | null } = {
      turret: null, flash: null, secondary: null,
    };
    entity.mesh.traverse((child) => {
      if (child.name === 'turret') found.turret = child;
      if (child.name === 'muzzle_flash') found.flash = child;
      if (child.name === 'barrel_secondary') found.secondary = child;
    });
    if (!found.turret) return;

    // Primary gun: rotate whole turret to face primary target
    found.turret.rotation.y = entity.rotation.y;

    // Secondary gun: find a different target and aim independently
    if (found.secondary && this.towerDualGuns.has(entity.id)) {
      const primaryAngle = entity.rotation.y;
      const towerPos = entity.mesh.position;
      const TOWER_RANGE_SQ = 25 * 25; // base range squared

      // Find nearest enemy that isn't the primary target
      let secondAngle: number | null = null;
      let bestDist = Infinity;
      for (const ent of this.sceneManager.entities) {
        if (ent.teamId === entity.teamId || ent.hp <= 0) continue;
        if (ent.entityType === 'resource_node') continue;
        const dx = ent.mesh.position.x - towerPos.x;
        const dz = ent.mesh.position.z - towerPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > TOWER_RANGE_SQ) continue;
        const angle = Math.atan2(dx, dz);
        // Skip if this is the same target as the primary (within 0.1 rad)
        let diff = angle - primaryAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 0.1) continue;
        if (d2 < bestDist) {
          bestDist = d2;
          secondAngle = angle;
        }
      }

      if (secondAngle !== null) {
        // Rotate secondary barrel relative to turret group (which already rotated to primaryAngle)
        found.secondary.rotation.y = secondAngle - primaryAngle;
      } else {
        // No second target — counter-rotate to stay stationary in world space
        found.secondary.rotation.y = -primaryAngle;
      }
    }

    // Muzzle flash: rotation.z = 1 means "just fired"
    let timer = this.towerFlashTimers.get(entity.id) ?? 0;
    if (entity.rotation.z > 0.5 && timer <= 0) {
      timer = 0.5;
      this.towerFlashTimers.set(entity.id, timer);
      SoundManager.instance().towerFire(entity.mesh.position.x, entity.mesh.position.z);

      // Spawn debris at estimated impact point
      const angle = entity.rotation.y;
      const range = 15;
      const isMiss = entity.rotation.x > 0.5;
      const missOffset = isMiss ? (Math.random() - 0.5) * 6 : 0;
      const impactX = entity.mesh.position.x + Math.sin(angle) * range + missOffset;
      const impactZ = entity.mesh.position.z + Math.cos(angle) * range + missOffset;
      this.spawnDebrisEffect(impactX, impactZ);
    }

    if (found.flash) {
      if (timer > 0) {
        timer -= dt;
        this.towerFlashTimers.set(entity.id, timer);
      }
      found.flash.visible = timer > 0;
    }
  }

  private animateJeepTurret(entity: SceneEntity, dt: number): void {
    const found: { turret: THREE.Object3D | null; flash: THREE.Object3D | null } = { turret: null, flash: null };
    entity.mesh.traverse((child) => {
      if (child.name === 'turret') found.turret = child;
      if (child.name === 'muzzle_flash') found.flash = child;
    });
    if (!found.turret) return;

    // rotation.x = turret aim angle (world space), rotation.y = vehicle heading
    // Turret rotation is relative to vehicle, so subtract heading. Add π to flip 180°
    // because the turret model faces backward (+Z) in local space.
    found.turret.rotation.y = entity.rotation.x - entity.rotation.y + Math.PI;

    // Muzzle flash
    let timer = this.towerFlashTimers.get(entity.id) ?? 0;
    if (entity.rotation.z > 0.5 && timer <= 0) {
      timer = 0.5;
      this.towerFlashTimers.set(entity.id, timer);
      SoundManager.instance().towerFire(entity.mesh.position.x, entity.mesh.position.z);
    }

    if (found.flash) {
      if (timer > 0) {
        timer -= dt;
        this.towerFlashTimers.set(entity.id, timer);
      }
      found.flash.visible = timer > 0;
    }
  }

  /** Scan all entities to find active combat and play sounds */
  private playCombatSounds(): void {
    const sm = SoundManager.instance();
    const entities = this.sceneManager.entities;
    const MELEE_RANGE = 4;

    // Collect all fighters and grunts by team
    const teamMobile = new Map<number, { x: number; z: number; type: string }[]>();
    for (const ent of entities) {
      if (ent.hp <= 0) continue;
      if (!RTSController.MOBILE_TYPES.has(ent.entityType)) continue;
      const entry = { x: ent.mesh.position.x, z: ent.mesh.position.z, type: ent.entityType };
      if (!teamMobile.has(ent.teamId)) teamMobile.set(ent.teamId, []);
      teamMobile.get(ent.teamId)!.push(entry);
    }

    // Find combat hotspots: any unit from different teams within melee range
    let playedFighter = false;
    let playedWorker = false;
    const teamIds = [...teamMobile.keys()];

    for (let i = 0; i < teamIds.length; i++) {
      for (let j = i + 1; j < teamIds.length; j++) {
        const groupA = teamMobile.get(teamIds[i])!;
        const groupB = teamMobile.get(teamIds[j])!;
        for (const a of groupA) {
          for (const b of groupB) {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        if (dx * dx + dz * dz < MELEE_RANGE * MELEE_RANGE) {
          const cx = (a.x + b.x) / 2;
          const cz = (a.z + b.z) / 2;
          if ((a.type === 'fighter' || b.type === 'fighter') && !playedFighter) {
            sm.fighterAttack(cx, cz);
            playedFighter = true;
          }
          if ((a.type === 'worker' || b.type === 'worker') && !playedWorker) {
            sm.workerAttack(cx, cz);
            playedWorker = true;
          }
          if (playedFighter && playedWorker) return;
        }
      }
    }
    }
    }
  }

  /** Spawn a debris/explosion effect at a world position */
  private spawnDebrisEffect(worldX: number, worldZ: number): void {
    const scene = this.sceneManager.scene;
    const terrainY = this.sceneManager.terrainHeight(worldX, worldZ);
    const debrisCount = 6 + Math.floor(Math.random() * 4);
    const particles: THREE.Mesh[] = [];
    const velocities: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i < debrisCount; i++) {
      const size = 0.15 + Math.random() * 0.25;
      const geo = new THREE.BoxGeometry(size, size, size);
      const color = Math.random() < 0.5 ? 0x887755 : 0xaa9966; // dirt/rock colors
      const mat = new THREE.MeshLambertMaterial({ color });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.set(worldX, terrainY + 0.2, worldZ);
      particle.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      scene.add(particle);
      particles.push(particle);
      velocities.push({
        x: (Math.random() - 0.5) * 8,
        y: 3 + Math.random() * 5,
        z: (Math.random() - 0.5) * 8,
      });
    }

    // Animate particles over ~0.6 seconds then remove
    let elapsed = 0;
    const animate = () => {
      elapsed += 0.016; // ~60fps
      if (elapsed > 0.6) {
        for (const p of particles) {
          scene.remove(p);
          p.geometry.dispose();
          (p.material as THREE.Material).dispose();
        }
        return;
      }
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const v = velocities[i];
        v.y -= 15 * 0.016; // gravity
        p.position.x += v.x * 0.016;
        p.position.y += v.y * 0.016;
        p.position.z += v.z * 0.016;
        p.rotation.x += 3 * 0.016;
        p.rotation.z += 2 * 0.016;
        // Fade out
        const mat = p.material as THREE.MeshLambertMaterial;
        mat.transparent = true;
        mat.opacity = Math.max(0, 1 - elapsed / 0.6);
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Update facing direction for a mobile unit based on movement */
  private updateFacing(entity: SceneEntity): void {
    // Jeep rotation is managed by server heading in SnapshotRenderer
    if (entity.entityType === 'jeep') return;
    const prev = this.prevPositions.get(entity.id);
    const pos = entity.mesh.position;
    if (prev) {
      const dx = pos.x - prev.x;
      const dz = pos.z - prev.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 0.001) {
        // Smoothly rotate toward movement direction
        const targetAngle = Math.atan2(dx, dz);
        let current = entity.mesh.rotation.y;
        // Shortest angle difference
        let diff = targetAngle - current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        entity.mesh.rotation.y += diff * 0.15; // smooth lerp
      }
    }
    this.prevPositions.set(entity.id, { x: pos.x, z: pos.z });
  }

  /** Spawn an arrow projectile from an archer toward its target */
  private trySpawnArrow(archer: SceneEntity, target: SceneEntity): void {
    // Rate limit: one arrow per attack interval
    const timer = this.archerFireTimers.get(archer.id) ?? 0;
    if (timer > 0) return;
    this.archerFireTimers.set(archer.id, ARCHER_ATTACK_INTERVAL);

    const scene = this.sceneManager.scene;
    const startPos = archer.mesh.position.clone();
    startPos.y += 1.5; // fire from chest height
    const targetPos = target.mesh.position.clone();
    targetPos.y += 1; // aim at target center

    const dir = targetPos.clone().sub(startPos).normalize();
    const totalDist = startPos.distanceTo(targetPos);

    // Arrow mesh: thin cylinder (shaft) + small cone (head)
    const arrowGroup = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.8, 4),
      new THREE.MeshLambertMaterial({ color: 0x885533 }),
    );
    shaft.rotation.x = Math.PI / 2;
    arrowGroup.add(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.15, 4),
      new THREE.MeshLambertMaterial({ color: 0x888888 }),
    );
    head.rotation.x = -Math.PI / 2;
    head.position.z = -0.45;
    arrowGroup.add(head);

    // Fletching (small colored fins)
    for (const rot of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(
        new THREE.PlaneGeometry(0.08, 0.15),
        new THREE.MeshBasicMaterial({ color: 0xcc4444, side: THREE.DoubleSide }),
      );
      fin.rotation.y = rot;
      fin.position.z = 0.35;
      arrowGroup.add(fin);
    }

    arrowGroup.position.copy(startPos);
    arrowGroup.lookAt(targetPos);
    scene.add(arrowGroup);

    const ARROW_SPEED = 30;
    let traveled = 0;

    const animate = () => {
      const step = ARROW_SPEED * 0.016;
      arrowGroup.position.add(dir.clone().multiplyScalar(step));
      traveled += step;

      if (traveled >= totalDist || traveled > ARCHER_ATTACK_RANGE + 5) {
        // Arrow reached target or max range — remove
        scene.remove(arrowGroup);
        return;
      }

      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  private setCrystalBagVisible(mesh: THREE.Object3D, visible: boolean): void {
    let visualGroup: THREE.Group | undefined;
    for (const child of mesh.children) {
      if ((child as any).isGroup) { visualGroup = child as THREE.Group; break; }
    }
    if (!visualGroup) return;
    for (const child of visualGroup.children) {
      if (child.name === 'crystal_bag') { child.visible = visible; return; }
    }
  }

  private animateUnit(mesh: THREE.Object3D, moving: boolean, attacking: boolean, _dt: number): void {
    // The visual group is the first Group child of the hitbox mesh
    // groupToMesh creates: Mesh(hitbox) → Group(visual) → [named parts]
    let visualGroup: THREE.Group | undefined;
    for (const child of mesh.children) {
      if ((child as any).isGroup) { visualGroup = child as THREE.Group; break; }
    }
    if (!visualGroup) return;

    // Find named parts by searching all children
    let legL: THREE.Object3D | undefined;
    let legR: THREE.Object3D | undefined;
    let weapon: THREE.Object3D | undefined;
    for (const child of visualGroup.children) {
      if (child.name === 'leg_l') legL = child;
      if (child.name === 'leg_r') legR = child;
      if (child.name === 'weapon') weapon = child;
    }

    if (moving) {
      const t = this.animTime * 10;
      // Body bob
      visualGroup.position.y = Math.abs(Math.sin(t)) * 0.06;
      visualGroup.rotation.z = Math.sin(t) * 0.03;
      visualGroup.rotation.x = 0;
      // Leg swing
      if (legL) legL.rotation.x = Math.sin(t) * 0.6;
      if (legR) legR.rotation.x = -Math.sin(t) * 0.6;
      // Reset weapon
      if (weapon) weapon.rotation.x = 0;
    } else if (attacking) {
      const t = this.animTime * 6;
      const swing = Math.sin(t);

      // Body lunges forward
      visualGroup.position.y = 0;
      visualGroup.rotation.z = 0;
      visualGroup.rotation.x = -Math.max(0, swing) * 0.15;

      // Weapon overhead swing down
      if (weapon) weapon.rotation.x = -Math.max(0, swing) * 1.5;

      // Legs brace
      if (legL) legL.rotation.x = Math.max(0, swing) * 0.25;
      if (legR) legR.rotation.x = -Math.max(0, swing) * 0.15;
    } else {
      // Idle: gentle breathing
      visualGroup.position.y = Math.sin(this.animTime * 2) * 0.02;
      visualGroup.rotation.z = 0;
      visualGroup.rotation.x = 0;
      if (legL) legL.rotation.x = 0;
      if (legR) legR.rotation.x = 0;
      if (weapon) weapon.rotation.x = 0;
    }
  }

  /** Building radii for attack range calculation — units stop at the edge */
  private static readonly BUILDING_RADII: Record<string, number> = {
    main_base: 5, tower: 3, barracks: 3.5, armory: 3.5, player_tower: 2.5, turret: 1.5,
  };

  /** Get effective attack range for a target — adds building radius so units stay at edge */
  private attackRange(target: SceneEntity, baseRange: number): number {
    const radius = RTSController.BUILDING_RADII[target.entityType] ?? 0;
    return baseRange + radius;
  }

  // ===================== Unit separation =====================

  private static readonly UNIT_RADIUS = 1.2;
  private static readonly SEPARATION_FORCE = 30;

  private separateUnits(_dt: number): void {
    const allMobile = this.sceneManager.entities.filter(
      e => RTSController.MOBILE_TYPES.has(e.entityType) && e.hp > 0,
    );

    // Run multiple iterations for stronger separation
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < allMobile.length; i++) {
        const a = allMobile[i];
        for (let j = i + 1; j < allMobile.length; j++) {
          const b = allMobile[j];
          // Only separate same-team units with full radius; enemies get minimal separation
          const sameTeam = a.teamId === b.teamId;
          const radius = sameTeam ? RTSController.UNIT_RADIUS : 0.5;
          const minDist = radius * 2;

          const dx = a.mesh.position.x - b.mesh.position.x;
          const dz = a.mesh.position.z - b.mesh.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist < minDist && dist > 0.001) {
            // Hard push: immediately resolve half the overlap each iteration
            const overlap = minDist - dist;
            const nx = dx / dist;
            const nz = dz / dist;
            const push = overlap * 0.5;

            a.mesh.position.x += nx * push;
            a.mesh.position.z += nz * push;
            b.mesh.position.x -= nx * push;
            b.mesh.position.z -= nz * push;
          } else if (dist <= 0.001) {
            // Exactly overlapping — nudge randomly
            const angle = Math.random() * Math.PI * 2;
            a.mesh.position.x += Math.cos(angle) * 0.5;
            a.mesh.position.z += Math.sin(angle) * 0.5;
          }
        }
      }
    }
  }

  // ===================== Fog of War =====================

  private static readonly RTS_UNIT_SCALE = 3.5;

  private updateFogOfWar(): void {
    // Only show fog in RTS mode
    if (this.isFPSMode) {
      this.fog.hide();
      // Show all entities in FPS mode except local FPS player's own mesh
      // Reset unit scale to 1x for FPS view
      for (const entity of this.sceneManager.entities) {
        entity.mesh.visible = entity.id !== this.fpsPlayerEntityId;
        if (RTSController.MOBILE_TYPES.has(entity.entityType)) {
          entity.mesh.scale.setScalar(1);
        }
      }
      return;
    }

    this.fog.show();
    this.fog.update(this.sceneManager.entities, this.localLayerId);

    // Hide/show entities based on fog visibility
    // Scale mobile units 3x in RTS view for visibility
    for (const entity of this.sceneManager.entities) {
      // Scale mobile units up in RTS view (visual only)
      if (entity.entityType === 'jeep') {
        entity.mesh.scale.setScalar(1.5);
      } else if (RTSController.MOBILE_TYPES.has(entity.entityType)) {
        entity.mesh.scale.setScalar(RTSController.RTS_UNIT_SCALE);
      }

      // Always show own team entities and resource nodes
      if (entity.teamId === this.localTeamId || entity.entityType === 'resource_node') {
        entity.mesh.visible = true;
        continue;
      }

      const pos = entity.mesh.position;
      if (this.fog.isVisible(pos.x, pos.z)) {
        // In visible area — show
        entity.mesh.visible = true;
      } else if (this.fog.isExplored(pos.x, pos.z)) {
        // In explored but not visible area — show buildings, hide mobile units
        const isMobile = RTSController.MOBILE_TYPES.has(entity.entityType);
        entity.mesh.visible = !isMobile;
      } else {
        // Unexplored — hide everything
        entity.mesh.visible = false;
      }
    }
  }

  // ===================== Health bars =====================

  private healthBars = new Map<string, { bg: THREE.Mesh; fill: THREE.Mesh }>();

  private static readonly BUILDING_BAR_HEIGHTS: Record<string, number> = {
    main_base: 8, tower: 10, barracks: 4.5, armory: 5, player_tower: 9, turret: 3, sniper_nest: 11, farm: 4,
  };

  /** Call every tick to update floating health bars above damaged entities */
  private updateHealthBars(): void {
    const scene = this.sceneManager.scene;
    const cam = this.activeCamera;

    for (const entity of this.sceneManager.entities) {
      // Hide all health bars in FPS mode
      const hideFPS = this.isFPSMode;
      const isHiddenByFog = !entity.mesh.visible;
      const isDamaged = entity.hp < entity.maxHp && entity.hp > 0 && !hideFPS && !isHiddenByFog;
      const existing = this.healthBars.get(entity.id);

      if (!isDamaged) {
        if (existing) {
          scene.remove(existing.bg);
          existing.bg.geometry.dispose();
          scene.remove(existing.fill);
          existing.fill.geometry.dispose();
          this.healthBars.delete(entity.id);
        }
        continue;
      }

      const isBuilding = !RTSController.MOBILE_TYPES.has(entity.entityType) && entity.entityType !== 'resource_node';
      const barWidth = isBuilding ? 5 : 1.5;
      const barHeight = 0.3;
      const yOffset = RTSController.BUILDING_BAR_HEIGHTS[entity.entityType] ?? (isBuilding ? 8 : 1.8);

      if (!existing) {
        const bgGeo = new THREE.PlaneGeometry(barWidth, barHeight);
        const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
        const bg = new THREE.Mesh(bgGeo, bgMat);
        scene.add(bg);

        const fillGeo = new THREE.PlaneGeometry(barWidth, barHeight);
        const fillMat = new THREE.MeshBasicMaterial({ color: 0x44cc44, side: THREE.DoubleSide });
        const fill = new THREE.Mesh(fillGeo, fillMat);
        scene.add(fill);

        this.healthBars.set(entity.id, { bg, fill });
      }

      const bar = this.healthBars.get(entity.id)!;
      const pos = entity.mesh.position;
      const pct = Math.max(0, entity.hp / entity.maxHp);

      bar.bg.position.set(pos.x, yOffset, pos.z);
      const fillWidth = barWidth * pct;
      bar.fill.scale.set(pct || 0.001, 1, 1);
      bar.fill.position.set(pos.x - (barWidth - fillWidth) / 2, yOffset, pos.z);

      // Billboard: face the active camera
      if (cam) {
        bar.bg.lookAt(cam.position);
        bar.fill.lookAt(cam.position);
      }

      const fillMat = bar.fill.material as THREE.MeshBasicMaterial;
      if (pct > 0.5) fillMat.color.setHex(0x44cc44);
      else if (pct > 0.25) fillMat.color.setHex(0xcccc44);
      else fillMat.color.setHex(0xcc4444);
    }

    // Clean up bars for entities that no longer exist
    for (const [id, bar] of this.healthBars) {
      if (!this.sceneManager.entities.some(e => e.id === id)) {
        scene.remove(bar.bg);
        bar.bg.geometry.dispose();
        scene.remove(bar.fill);
        bar.fill.geometry.dispose();
        this.healthBars.delete(id);
      }
    }
  }

  private trainFootSoldier(barracksId: string): void {
    const barracks = this.sceneManager.entities.find(e => e.id === barracksId);
    if (!barracks || barracks.entityType !== 'barracks' || barracks.teamId !== this.localTeamId) return;
    // Foot soldiers available at barracks tier 1 (no level requirement)
    if (this.crystals < FOOT_SOLDIER_COST) { this.showWarning('Not enough 💎'); return; }
    if (this.supplyUsed >= this.supplyCap) { this.showWarning('Supply cap reached'); return; }

    if (this.onServerTrainUnit) {
      this.onServerTrainUnit(barracksId, 'foot_soldier');
      // Optimistically add to local queue so UI updates immediately
      const barracksEntity = this.sceneManager.entities.find(e => e.id === barracksId);
      if (barracksEntity) {
        let tq = this.trainingQueues.get(barracksId);
        if (!tq) {
          tq = { baseEntity: barracksEntity, queue: [], barBg: null, barFill: null };
          this.trainingQueues.set(barracksId, tq);
        }
        tq.queue.push({ elapsed: 0, duration: FOOT_SOLDIER_TRAIN_TIME, unitType: 'foot_soldier' });
      }
      this.updateInfoPanel();
    }
  }

  private trainArcher(barracksId: string): void {
    const barracks = this.sceneManager.entities.find(e => e.id === barracksId);
    if (!barracks || barracks.entityType !== 'barracks' || barracks.teamId !== this.localTeamId) return;
    const level = this.barracksLevels.get(barracksId) ?? 1;
    if (level < 2) return;
    if (this.crystals < ARCHER_COST) { this.showWarning('Not enough 💎'); return; }
    if (this.supplyUsed >= this.supplyCap) { this.showWarning('Supply cap reached'); return; }

    if (this.onServerTrainUnit) {
      this.onServerTrainUnit(barracksId, 'archer');
      const barracksEntity = this.sceneManager.entities.find(e => e.id === barracksId);
      if (barracksEntity) {
        let tq = this.trainingQueues.get(barracksId);
        if (!tq) { tq = { baseEntity: barracksEntity, queue: [], barBg: null, barFill: null }; this.trainingQueues.set(barracksId, tq); }
        tq.queue.push({ elapsed: 0, duration: ARCHER_TRAIN_TIME, unitType: 'archer' });
      }
      this.updateInfoPanel();
    }
  }

  private trainJeep(garageId: string): void {
    const garage = this.sceneManager.entities.find(e => e.id === garageId);
    if (!garage || garage.entityType !== 'garage' || garage.teamId !== this.localTeamId) return;
    if (this.crystals < 500) { this.showWarning('Not enough 💎'); return; }
    if (this.supplyUsed + 3 > this.supplyCap) { this.showWarning('Not enough supply'); return; }

    if (this.onServerTrainUnit) {
      this.onServerTrainUnit(garageId, 'jeep');
      const garageEntity = this.sceneManager.entities.find(e => e.id === garageId);
      if (garageEntity) {
        let tq = this.trainingQueues.get(garageId);
        if (!tq) { tq = { baseEntity: garageEntity, queue: [], barBg: null, barFill: null }; this.trainingQueues.set(garageId, tq); }
        tq.queue.push({ elapsed: 0, duration: 10, unitType: 'jeep' });
      }
      this.updateInfoPanel();
      return;
    }
  }

  private trainHelicopter(garageId: string): void {
    const garage = this.sceneManager.entities.find(e => e.id === garageId);
    if (!garage || garage.entityType !== 'garage' || garage.teamId !== this.localTeamId) return;
    if (this.crystals < 400) { this.showWarning('Not enough 💎'); return; }
    if (this.supplyUsed + 3 > this.supplyCap) { this.showWarning('Not enough supply'); return; }

    if (this.onServerTrainUnit) {
      this.onServerTrainUnit(garageId, 'helicopter');
      const garageEntity = this.sceneManager.entities.find(e => e.id === garageId);
      if (garageEntity) {
        let tq = this.trainingQueues.get(garageId);
        if (!tq) { tq = { baseEntity: garageEntity, queue: [], barBg: null, barFill: null }; this.trainingQueues.set(garageId, tq); }
        tq.queue.push({ elapsed: 0, duration: 12, unitType: 'helicopter' });
      }
      this.updateInfoPanel();
      return;
    }
  }

  private upgradeBarracks(barracksId: string): void {
    const barracks = this.sceneManager.entities.find(e => e.id === barracksId);
    if (!barracks || barracks.entityType !== 'barracks') return;
    if ((this.barracksLevels.get(barracksId) ?? 1) >= 2) return;
    if (this.crystals < BARRACKS_UPGRADE_COST) { this.showWarning('Not enough 💎 (need 500)'); return; }

    if (this.onServerUpgrade) {
      this.onServerUpgrade(barracksId, 'barracks_level2');
      // Optimistically add upgrade slot to local queue so UI updates immediately
      let tq = this.trainingQueues.get(barracksId);
      if (!tq && barracks) {
        tq = { baseEntity: barracks, queue: [], barBg: null, barFill: null };
        this.trainingQueues.set(barracksId, tq);
      }
      if (tq) tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_barracks' });
      this.updateInfoPanel();
    }
  }

  private upgradeTower(towerId: string): void {
    const tower = this.sceneManager.entities.find(e => e.id === towerId);
    if (!tower) return;
    const currentLevel = this.towerLevels.get(towerId) ?? 1;
    if (currentLevel >= 3) return;
    const cost = currentLevel >= 2 ? 500 : 300;
    if (this.crystals < cost) { this.showWarning(`Not enough 💎 (need ${cost})`); return; }

    if (this.onServerUpgrade) {
      this.onServerUpgrade(towerId, 'tower_upgrade');
      let tq = this.trainingQueues.get(towerId);
      if (!tq) {
        tq = { baseEntity: tower, queue: [], barBg: null, barFill: null };
        this.trainingQueues.set(towerId, tq);
      }
      tq.queue.push({ elapsed: 0, duration: 10, unitType: 'upgrade_tower' });
      this.updateInfoPanel();
    }
  }

  private upgradeTowerDual(towerId: string): void {
    const tower = this.sceneManager.entities.find(e => e.id === towerId);
    if (!tower) return;
    if (this.towerDualGuns.has(towerId)) return;
    if (this.crystals < 300) { this.showWarning('Not enough 💎 (need 300)'); return; }

    if (this.onServerUpgrade) {
      this.onServerUpgrade(towerId, 'tower_dual_gun');
      this.towerDualGuns.add(towerId);
      // Add a second gun barrel to the mesh
      this.addDualGunBarrel(tower);
      this.updateInfoPanel();
    }
  }

  private addDualGunBarrel(entity: SceneEntity): void {
    let turretGroup: THREE.Object3D | null = null;
    entity.mesh.traverse((child) => {
      if (child.name === 'turret') turretGroup = child;
    });
    if (!turretGroup) return;
    // Don't add if already has a second barrel
    if ((turretGroup as THREE.Object3D).getObjectByName('barrel_secondary')) return;

    const barrelGroup = new THREE.Group();
    barrelGroup.name = 'barrel_secondary';
    barrelGroup.rotation.x = 0.2;
    barrelGroup.position.y = 0.35; // offset above the primary barrel

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 3.0, 6),
      new THREE.MeshLambertMaterial({ color: 0x444444 }),
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, 1.5);
    barrelGroup.add(barrel);

    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.7, 6),
      new THREE.MeshLambertMaterial({ color: 0x555555 }),
    );
    housing.rotation.x = Math.PI / 2;
    housing.position.set(0, 0, 0.35);
    barrelGroup.add(housing);

    (turretGroup as THREE.Object3D).add(barrelGroup);
  }

  // ===================== Ping Beacon (RTS → FPS communication) =====================

  spawnPingBeacon(pos: THREE.Vector3): void {
    const scene = this.sceneManager.scene;
    const terrainY = this.sceneManager.terrainHeight(pos.x, pos.z);

    // Beam of light from sky
    const beamGeo = new THREE.CylinderGeometry(0.3, 1.5, 40, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(pos.x, terrainY + 20, pos.z);
    beam.renderOrder = 997;
    scene.add(beam);

    // Ground ring pulse
    const ringGeo = new THREE.RingGeometry(1.5, 2.0, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, terrainY + 0.2, pos.z);
    ring.renderOrder = 998;
    scene.add(ring);

    let elapsed = 0;
    const animate = () => {
      elapsed += 0.016;
      // Pulse the beam opacity
      const pulse = 0.15 + Math.sin(elapsed * 6) * 0.15;
      beamMat.opacity = pulse;
      // Expand and fade the ring
      const ringScale = 1 + Math.sin(elapsed * 4) * 0.3;
      ring.scale.set(ringScale, ringScale, 1);
      ringMat.opacity = Math.max(0, 0.8 - elapsed * 0.2);

      if (elapsed < 4) {
        requestAnimationFrame(animate);
      } else {
        scene.remove(beam);
        scene.remove(ring);
        beamGeo.dispose(); beamMat.dispose();
        ringGeo.dispose(); ringMat.dispose();
      }
    };
    requestAnimationFrame(animate);
    SoundManager.instance().unitCommand();
  }

  // ===================== Rally Point Lines =====================

  private updateRallyLine(buildingId: string, from: THREE.Vector3, to: THREE.Vector3): void {
    // Remove old line
    const oldLine = this.rallyLines.get(buildingId);
    if (oldLine) {
      this.sceneManager.scene.remove(oldLine);
      oldLine.geometry.dispose();
      (oldLine.material as THREE.Material).dispose();
    }

    const points = [
      new THREE.Vector3(from.x, from.y + 1, from.z),
      new THREE.Vector3(to.x, this.sceneManager.terrainHeight(to.x, to.z) + 0.5, to.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.6 });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    this.sceneManager.scene.add(line);
    this.rallyLines.set(buildingId, line);
  }

  private static readonly TOWER_RANGE_VALUE = 25;
  private rangeCircle: THREE.Mesh | null = null;

  /** Update rally line visibility and position (track unit targets) */
  private updateRallyLines(): void {
    const selected = this.selection.getSelected();
    const selectedId = selected.length === 1 ? selected[0].id : null;
    for (const [id, line] of this.rallyLines) {
      line.visible = id === selectedId;

      // Update line endpoint if the rally target is a moving entity
      if (line.visible) {
        const rally = this.rallyPoints.get(id);
        if (rally?.targetEntityId) {
          const targetEnt = this.sceneManager.entities.find(e => e.id === rally.targetEntityId);
          if (targetEnt && targetEnt.hp > 0) {
            rally.position.copy(targetEnt.mesh.position);
            const positions = (line.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
            positions.setXYZ(1, targetEnt.mesh.position.x,
              this.sceneManager.terrainHeight(targetEnt.mesh.position.x, targetEnt.mesh.position.z) + 0.5,
              targetEnt.mesh.position.z);
            positions.needsUpdate = true;
          } else {
            // Target died — clear rally
            this.rallyPoints.delete(id);
            this.sceneManager.scene.remove(line);
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
            this.rallyLines.delete(id);
          }
        }
      }
    }

    // Show range circle for selected tower/turret or archer(s)
    const TOWER_TYPES = new Set(['tower', 'player_tower', 'turret']);
    const sel = selected.length === 1 ? selected[0] : null;
    let showRange = false;
    let rangeValue = 0;
    let rangeCenterX = 0;
    let rangeCenterZ = 0;
    let rangeColor = 0xff4444;

    // Tower range (includes HQ turret)
    const TURRET_TYPES = new Set([...TOWER_TYPES, 'main_base']);
    if (sel && TURRET_TYPES.has(sel.entityType) && sel.teamId === this.localTeamId) {
      const tLvl = this.towerLevels.get(sel.id) ?? 1;
      const levelMult = tLvl >= 3 ? 2.0 : tLvl >= 2 ? 1.2 : 1;
      const baseMult = sel.entityType === 'main_base' ? 1.75 : 1;
      rangeValue = RTSController.TOWER_RANGE_VALUE * levelMult * baseMult;
      rangeCenterX = sel.mesh.position.x;
      rangeCenterZ = sel.mesh.position.z;
      rangeColor = 0xff4444;
      showRange = true;
    }

    // Archer range — show for single or multiple selected archers
    const selectedArchers = selected.filter(s => (s.entityType === 'archer' || s.entityType === 'foot_soldier') && s.entityType === 'archer' && s.teamId === this.localTeamId);
    if (!showRange && selectedArchers.length > 0) {
      rangeValue = ARCHER_ATTACK_RANGE;
      // Center on the first archer's position
      rangeCenterX = selectedArchers[0].mesh.position.x;
      rangeCenterZ = selectedArchers[0].mesh.position.z;
      rangeColor = 0x44dd88;
      showRange = true;
    }

    if (showRange) {
      if (this.rangeCircle) {
        this.sceneManager.scene.remove(this.rangeCircle);
        this.rangeCircle.geometry.dispose();
        (this.rangeCircle.material as THREE.Material).dispose();
      }
      const geo = new THREE.RingGeometry(rangeValue - 0.3, rangeValue, 64);
      const mat = new THREE.MeshBasicMaterial({
        color: rangeColor, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
      });
      this.rangeCircle = new THREE.Mesh(geo, mat);
      this.rangeCircle.rotation.x = -Math.PI / 2;
      this.rangeCircle.renderOrder = 996;
      this.sceneManager.scene.add(this.rangeCircle);
      const rangeY = this.sceneManager.terrainHeight(rangeCenterX, rangeCenterZ) + 0.3;
      this.rangeCircle.position.set(rangeCenterX, rangeY, rangeCenterZ);
      this.rangeCircle.visible = true;
    } else if (this.rangeCircle) {
      this.rangeCircle.visible = false;
    }
  }

  // ===================== Building Damage Flames =====================

  private static readonly FLAME_HEIGHTS: Record<string, number> = {
    main_base: 6, tower: 7, barracks: 3, armory: 3.5, player_tower: 7, turret: 2, sniper_nest: 9, farm: 3,
  };

  /** Draw lines showing worker build queue order. Only visible when that worker is selected. */
  private updateBuildQueueLines(): void {
    // Remove old lines
    for (const line of this.buildQueueLines) {
      this.sceneManager.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.buildQueueLines = [];

    // Prune completed positions from queues
    for (const [workerId, queue] of this.workerBuildQueues) {
      // Remove positions where the building is no longer constructing
      while (queue.length > 0) {
        const pos = queue[0];
        const building = this.sceneManager.entities.find(
          e => e.status === 'constructing'
            && Math.abs(e.mesh.position.x - pos.x) < 1
            && Math.abs(e.mesh.position.z - pos.z) < 1,
        );
        if (building) break; // still constructing — keep it and the rest
        queue.shift(); // completed or destroyed — remove
      }
      if (queue.length === 0) this.workerBuildQueues.delete(workerId);
    }

    // Only draw for selected workers
    const selected = this.selection.getSelected();
    for (const sel of selected) {
      if (sel.entityType !== 'worker') continue;
      const queue = this.workerBuildQueues.get(sel.id);
      if (!queue || queue.length < 2) continue;

      // Draw lines connecting queued build sites in order
      const points: THREE.Vector3[] = [];
      for (const pos of queue) {
        const y = this.sceneManager.terrainHeight(pos.x, pos.z) + 0.5;
        points.push(new THREE.Vector3(pos.x, y, pos.z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.7,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 998;
      this.sceneManager.scene.add(line);
      this.buildQueueLines.push(line);
    }
  }

  private updateBuildingFlames(dt: number): void {
    const activeIds = new Set<string>();

    for (const entity of this.sceneManager.entities) {
      if (RTSController.MOBILE_TYPES.has(entity.entityType)) continue;
      if (entity.entityType === 'resource_node') continue;

      const isDamaged = entity.hp < entity.maxHp && entity.hp > 0 && entity.status === 'active';

      if (isDamaged) {
        activeIds.add(entity.id);
        let flame = this.flameEffects.get(entity.id);
        if (!flame) {
          const spread = entity.entityType === 'main_base' ? 4 : 2.5;
          const baseY = RTSController.FLAME_HEIGHTS[entity.entityType] ?? 3;
          flame = new FlameEffect(this.sceneManager.scene, entity.mesh.position, spread, baseY);
          this.flameEffects.set(entity.id, flame);
        }
        // Intensity scales from 0 (nearly full HP) to 1 (nearly dead)
        flame.setIntensity(1 - entity.hp / entity.maxHp);
        flame.update(dt);
      }
    }

    // Remove flames for entities that no longer qualify
    for (const [id, flame] of this.flameEffects) {
      if (!activeIds.has(id)) {
        flame.destroy();
        this.flameEffects.delete(id);
      }
    }
  }

  // ===================== Right-click commands =====================

  private onRightClick = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.activeBuildType) {
      this.cancelPlacement();
      return;
    }

    const selected = this.selection.getSelected();

    const worldPos = this.rtsCamera.screenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;

    // No selection: ping location for FPS player (local + send to server for teammate)
    if (selected.length === 0) {
      this.spawnPingBeacon(new THREE.Vector3(worldPos.x, 0, worldPos.z));
      this.onServerMessage?.({ type: 'ping', x: worldPos.x, z: worldPos.z });
      return;
    }

    const clickedEntity = this.sceneManager.entities.find(ent => {
      if (ent.hp <= 0) return false;
      const dx = ent.mesh.position.x - worldPos.x;
      const dz = ent.mesh.position.z - worldPos.z;
      return Math.sqrt(dx * dx + dz * dz) < 3;
    });

    const mobileTypes = new Set(['worker', 'fighter', 'foot_soldier', 'archer', 'jeep']);
    // FPS player only controllable via RTS if solo on team
    if (this.teamPlayerCount <= 1) mobileTypes.add('fps_player');
    const selectedMobileIds = selected.filter(s => mobileTypes.has(s.entityType)).map(s => s.id);
    const selectedWorkerIds = selected.filter(s => s.entityType === 'worker').map(s => s.id);
    const selectedFighterIds = selected.filter(s => s.entityType === 'fighter').map(s => s.id);
    const selectedFootSoldierIds = selected.filter(s => s.entityType === 'foot_soldier' || s.entityType === 'archer').map(s => s.id);

    // Rally point: if a production building is selected, set rally point instead of commanding units
    const PRODUCTION_TYPES = new Set(['main_base', 'barracks', 'garage']);
    const selectedBuilding = selected.length === 1 && PRODUCTION_TYPES.has(selected[0].entityType) && selected[0].teamId === this.localTeamId
      ? selected[0] : null;
    if (selectedBuilding) {
      const isResource = clickedEntity?.entityType === 'resource_node';
      const isFriendlyUnit = clickedEntity && clickedEntity.teamId === this.localTeamId
        && RTSController.MOBILE_TYPES.has(clickedEntity.entityType) && clickedEntity.hp > 0;
      const rallyPos = clickedEntity ? clickedEntity.mesh.position.clone() : new THREE.Vector3(worldPos.x, 0, worldPos.z);
      this.rallyPoints.set(selectedBuilding.id, {
        position: rallyPos,
        targetEntityId: (isResource || isFriendlyUnit) && clickedEntity ? clickedEntity.id : null,
      });
      this.updateRallyLine(selectedBuilding.id, selectedBuilding.mesh.position, rallyPos);
      const marker = isResource ? 'harvest' : isFriendlyUnit ? 'move' : 'move';
      this.selection.showActionMarker(rallyPos, marker, clickedEntity?.entityType);
      SoundManager.instance().unitCommand();
      return;
    }

    if (selectedMobileIds.length === 0) return;

    const isEnemy = clickedEntity && clickedEntity.teamId !== this.localTeamId && clickedEntity.entityType !== 'resource_node' && clickedEntity.hp > 0;
    const isResource = clickedEntity?.entityType === 'resource_node';
    const isConstructing = clickedEntity && clickedEntity.status === 'constructing' && clickedEntity.teamId === this.localTeamId;
    const isDamagedFriendly = clickedEntity && clickedEntity.teamId === this.localTeamId
      && clickedEntity.status === 'active' && clickedEntity.hp < clickedEntity.maxHp && clickedEntity.hp > 0
      && !RTSController.MOBILE_TYPES.has(clickedEntity.entityType) && clickedEntity.entityType !== 'resource_node';
    // Follow: right-click on a friendly mobile unit that isn't one of the selected units
    const isFriendlyMobile = clickedEntity && clickedEntity.teamId === this.localTeamId
      && RTSController.MOBILE_TYPES.has(clickedEntity.entityType) && clickedEntity.hp > 0
      && !selectedMobileIds.includes(clickedEntity.id);

    // Send all commands to server
    if (this.onServerCommand) {
      // Force attack mode: click a friendly unit to attack it
      if (this.infoPanel.forceAttackMode && clickedEntity && clickedEntity.teamId === this.localTeamId
          && clickedEntity.hp > 0 && this.infoPanel.forceAttackUnitIds.length > 0) {
        this.onServerCommand({ command: 'force_attack', unitIds: this.infoPanel.forceAttackUnitIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'attack', clickedEntity.entityType);
        this.infoPanel.forceAttackMode = false;
        this.infoPanel.forceAttackUnitIds = [];
        this.updateInfoPanel();
        return;
      }
      // Cancel force attack mode on any other click
      if (this.infoPanel.forceAttackMode) {
        this.infoPanel.forceAttackMode = false;
        this.infoPanel.forceAttackUnitIds = [];
      }
      if (isFriendlyMobile && clickedEntity) {
        // Follow a friendly unit
        this.onServerCommand({ command: 'follow', unitIds: selectedMobileIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'move', clickedEntity.entityType);
      } else if (selectedWorkerIds.length > 0 && isDamagedFriendly && clickedEntity) {
        this.onServerCommand({ command: 'repair', unitIds: selectedWorkerIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'move', clickedEntity.entityType);
      } else if (selectedWorkerIds.length > 0 && isConstructing && clickedEntity) {
        this.onServerCommand({ command: 'build_at', unitIds: selectedWorkerIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'move', clickedEntity.entityType);
      } else if (selectedWorkerIds.length > 0 && isResource && clickedEntity) {
        this.onServerCommand({ command: 'harvest', unitIds: selectedWorkerIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'harvest', clickedEntity.entityType);
      } else if (isEnemy && clickedEntity) {
        this.onServerCommand({ command: 'attack', unitIds: selectedMobileIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'attack', clickedEntity.entityType);
      } else {
        const tp = { x: worldPos.x, y: 0, z: worldPos.z };
        this.onServerCommand({ command: 'move', unitIds: selectedMobileIds, targetPos: tp });
        this.selection.showActionMarker(new THREE.Vector3(tp.x, 0, tp.z), 'move');
      }
      this.updateInfoPanel();
    }
  };

  // ===================== Keyboard shortcuts =====================

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && this.activeBuildType) {
      this.cancelPlacement();
      return;
    }

    // Escape with worker selected: cancel in-progress and queued buildings
    if (e.code === 'Escape') {
      const selected = this.selection.getSelected();
      const workers = selected.filter(s => s.entityType === 'worker' && s.teamId === this.localTeamId);
      if (workers.length > 0) {
        for (const w of workers) {
          // Cancel queued buildings for this worker (server handles refunds)
          this.onServerCommand?.({ command: 'cancel_worker_builds', unitIds: [w.id], targetId: '' });
        }
        return;
      }
    }

    // Route hotkeys through InfoPanel's sub-menu system
    if (this.infoPanel.handleHotkey(e.code)) return;

    const selected = this.selection.getSelected();

    // Control groups: Ctrl+1-9 to assign, 1-9 to recall
    const digit = e.code.match(/^Digit([1-9])$/);
    if (digit) {
      const num = parseInt(digit[1]);
      if (e.ctrlKey || e.metaKey) {
        // Assign current selection to group
        e.preventDefault();
        const ids = selected.map(s => s.id);
        if (ids.length > 0) this.controlGroups.set(num, ids);
        this.updateGroupBar();
      } else {
        // Recall or double-tap camera jump
        const now = performance.now();
        if (this.lastGroupRecallNum === num && now - this.lastGroupRecallTime < 400) {
          this.jumpCameraToGroup(num);
          this.lastGroupRecallNum = -1;
        } else {
          this.recallGroup(num);
          this.lastGroupRecallNum = num;
          this.lastGroupRecallTime = now;
        }
      }
    }
  };

  // ===================== Building Placement =====================

  private startPlacement(type: BuildingChoice): void {
    this.cancelPlacement();
    this.activeBuildType = type;

    // Remember which worker is building
    const selected = this.selection.getSelected();
    const workerSel = selected.find(s => s.entityType === 'worker' && s.teamId === this.localTeamId);
    this.builderWorkerId = workerSel?.id ?? null;

    // Suppress selection clicks during placement
    this.selection.suppressClicks = true;

    const size = BUILDING_SIZES[type];
    const geo = new THREE.BoxGeometry(size.w, size.h, size.d);
    geo.translate(0, size.h / 2, 0); // shift geometry so bottom sits at y=0
    const mat = new THREE.MeshLambertMaterial({
      color: 0x00ff00, transparent: true, opacity: 0.4,
    });
    this.ghost = new THREE.Mesh(geo, mat);
    this.ghost.position.set(0, 0, 0);
    this.sceneManager.scene.add(this.ghost);
    this.canvas.style.cursor = 'crosshair';
  }

  private cancelPlacement(): void {
    if (this.ghost) {
      this.sceneManager.scene.remove(this.ghost);
      this.ghost.geometry.dispose();
      (this.ghost.material as THREE.Material).dispose();
      this.ghost = null;
    }
    this.activeBuildType = null;
    this.builderWorkerId = null;
    this.buildPanel.clearActive();
    this.canvas.style.cursor = 'default';
    this.selection.suppressClicks = false;
  }

  private spendCrystals(amount: number): void {
    this.crystals -= amount;
    this.buildPanel.setCrystals(this.crystals);
    this.updateHud();
  }

  private updateHud(): void {
    this.crystalHud.textContent = `💎 ${this.crystals}`;
    this.supplyHud.textContent = `Supply: ${this.supplyUsed} / ${this.supplyCap}`;

    const teamFighters = this.sceneManager.entities.filter(
      e => e.entityType === 'fighter' && e.teamId === this.localTeamId && e.hp > 0,
    ).length;
    this.fighterHud.textContent = `Fighters: ${teamFighters} / ${MAX_FIGHTERS_PER_TEAM}`;

    const secs = Math.max(0, Math.ceil(this.waveTimer));
    this.waveHud.textContent = `Next wave: ${secs}s`;
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.ghost || !this.activeBuildType) return;

    const worldPos = this.rtsCamera.screenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;

    const snappedX = Math.round(worldPos.x / GRID_SIZE) * GRID_SIZE;
    const snappedZ = Math.round(worldPos.z / GRID_SIZE) * GRID_SIZE;

    this.ghost.position.set(snappedX, this.sceneManager.terrainHeight(snappedX, snappedZ), snappedZ);
  };

  /** Set opacity on all materials in a mesh hierarchy */
  private static setMeshOpacity(mesh: THREE.Object3D, opacity: number): void {
    mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
        if (mat && 'opacity' in mat) {
          mat.transparent = opacity < 1;
          mat.opacity = opacity;
        }
      }
    });
  }

  private onClickPlace = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (!this.ghost || !this.activeBuildType) return;

    const type = this.activeBuildType;
    const cost = BUILDING_COSTS[type];

    if (this.crystals < cost) {
      this.cancelPlacement();
      return;
    }

    const pos = this.ghost.position.clone();

    if (this.onServerBuild) {
      this.onServerBuild(type, { x: pos.x, y: pos.y, z: pos.z }, this.builderWorkerId ?? undefined);
      SoundManager.instance().buildingPlaced(pos.x, pos.z);

      // Track build position in worker's queue for visualization
      if (this.builderWorkerId) {
        let queue = this.workerBuildQueues.get(this.builderWorkerId);
        if (!queue) {
          queue = [];
          this.workerBuildQueues.set(this.builderWorkerId, queue);
        }
        queue.push(pos.clone());
      }

      if (e.shiftKey) {
        // Shift held — stay in placement mode for build queuing (max 4)
        const queue = this.workerBuildQueues.get(this.builderWorkerId ?? '');
        if (queue && queue.length >= 4) {
          this.cancelPlacement();
        } else {
          this.spendCrystals(cost);
        }
      } else {
        this.cancelPlacement();
      }
    }
  };
}
