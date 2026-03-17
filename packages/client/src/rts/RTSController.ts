import * as THREE from 'three';
import { RTSCamera } from './RTSCamera.js';
import { Selection } from './Selection.js';
import { BuildPanel, type BuildingChoice, BUILDING_COSTS } from './BuildPanel.js';
import { InfoPanel } from './InfoPanel.js';
import { FogOfWar } from './FogOfWar.js';
import { SoundManager } from '../audio/SoundManager.js';
import type { SceneManager, SceneEntity } from '../renderer/SceneManager.js';
import {
  createGrunt, createFighter, createBarracks, createArmory, createPlayerTower,
} from '../renderer/MeshFactory.js';

const GRID_SIZE = 4;
const STARTING_CRYSTALS = 1000;
const STARTING_SUPPLY_CAP = 10;
const BARRACKS_SUPPLY_BONUS = 5;
const CONSTRUCTION_TIME = 10;

const GRUNT_TRAIN_TIME = 3;
const GRUNT_SPEED = 8;
const GRUNT_HARVEST_TIME = 5;
const GRUNT_HARVEST_AMOUNT = 10;
const GRUNT_SUPPLY_COST = 1;

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
const FIGHTER_ATTACK_RANGE = 1.5; // melee range vs units

const BUILDING_SIZES: Record<BuildingChoice, { w: number; h: number; d: number }> = {
  barracks: { w: 5, h: 4, d: 5 },
  armory: { w: 5, h: 4, d: 5 },
  tower: { w: 4, h: 8, d: 4 },
};

const BUILDING_LABELS: Record<BuildingChoice, string> = {
  barracks: 'Barracks',
  armory: 'Armory',
  tower: 'Tower',
};

interface ConstructingBuilding {
  entity: SceneEntity;
  type: BuildingChoice;
  elapsed: number;
  duration: number;
  wireframe: THREE.LineSegments;
  barBg: THREE.Mesh;
  barFill: THREE.Mesh;
}

type GruntState = 'idle' | 'moving' | 'moving_to_node' | 'harvesting' | 'returning' | 'moving_to_attack' | 'attacking' | 'moving_to_build' | 'building';

const GRUNT_DAMAGE = 1; // very weak attack
const GRUNT_ATTACK_INTERVAL = 2; // seconds between attacks
const GRUNT_ATTACK_RANGE = 2;

const GRUNT_COST = 100;
const MAX_TRAINING_QUEUE = 5;

interface TrainingQueue {
  baseEntity: SceneEntity;
  queue: { elapsed: number; duration: number }[];
  // 3D progress bar meshes
  barBg: THREE.Mesh | null;
  barFill: THREE.Mesh | null;
}

interface Grunt {
  entity: SceneEntity;
  state: GruntState;
  targetNode: SceneEntity | null;
  attackTarget: SceneEntity | null;
  buildTarget: SceneEntity | null;
  homeBase: SceneEntity;
  harvestTimer: number;
  carriedCrystals: number;
  movePoint: THREE.Vector3 | null;
  attackTimer: number;
}

type FighterState = 'moving_to_target' | 'moving_to_enemy' | 'attacking' | 'idle' | 'moving_to_point';

interface Fighter {
  entity: SceneEntity;
  teamId: 1 | 2;
  state: FighterState;
  assignedTarget: SceneEntity | null; // tower they're headed to
  currentEnemy: SceneEntity | null; // enemy they're fighting
  attackTimer: number;
  /** Player override: right-click on enemy entity */
  playerTarget: SceneEntity | null;
  /** Player override: right-click on ground */
  movePoint: THREE.Vector3 | null;
}

export class RTSController {
  readonly rtsCamera: RTSCamera;
  readonly selection: Selection;
  readonly buildPanel: BuildPanel;
  readonly infoPanel: InfoPanel;

  private sceneManager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ghost: THREE.Mesh | null = null;
  private activeBuildType: BuildingChoice | null = null;
  private builderGrunt: Grunt | null = null;
  private builderGruntId: string | null = null; // works in both online and offline
  private crystals = STARTING_CRYSTALS;
  private supplyCap = STARTING_SUPPLY_CAP;
  private supplyUsed = 0;
  private _gameOver: { winner: 1 | 2 } | null = null;
  onBuildingComplete: ((buildingType: string) => void) | null = null;

  // Online mode callbacks — send commands to server
  onServerCommand: ((cmd: { command: string; unitIds: string[]; targetPos?: { x: number; y: number; z: number }; targetId?: string; buildingType?: string }) => void) | null = null;
  onServerTrain: ((baseId: string) => void) | null = null;
  onServerCancelTrain: ((baseId: string, index: number) => void) | null = null;
  onServerBuild: ((buildingType: string, position: { x: number; y: number; z: number }, builderGruntId?: string) => void) | null = null;

  private constructing: ConstructingBuilding[] = [];
  private trainingQueues: Map<string, TrainingQueue> = new Map(); // keyed by base entity id
  private grunts: Grunt[] = [];
  private gruntCounter = 0;

  // Fighter wave system
  private fighters: Fighter[] = [];
  private fighterCounter = 0;
  private waveTimer = WAVE_INTERVAL;

  // Fog of war
  private fog: FogOfWar;

  private hudContainer: HTMLDivElement;
  private crystalHud: HTMLDivElement;
  private supplyHud: HTMLDivElement;
  private waveHud: HTMLDivElement;
  private fighterHud: HTMLDivElement;

  constructor(sceneManager: SceneManager, canvas: HTMLCanvasElement) {
    this.sceneManager = sceneManager;
    this.canvas = canvas;
    this.rtsCamera = new RTSCamera();
    this.selection = new Selection(this.rtsCamera, sceneManager.scene);
    this.buildPanel = new BuildPanel();
    this.infoPanel = new InfoPanel();

    this.selection.setOnChange(() => {
      if (this.selection.selected.size > 0) SoundManager.instance().unitSelected();
      this.updateInfoPanel();
    });

    this.infoPanel.setCallbacks({
      onTrainGrunt: () => this.trainGrunt(),
      onCancelTraining: (baseId, index) => this.cancelTraining(baseId, index),
    });

    // HUD container
    this.hudContainer = document.createElement('div');
    this.hudContainer.id = 'rts-hud';
    this.hudContainer.style.cssText = `
      position: fixed;
      top: 16px;
      right: 20px;
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

    // Fog of war
    this.fog = new FogOfWar(sceneManager.scene, 1);

    // Spawn 2 starting grunts for team 1
    const playerBase = this.sceneManager.entities.find(
      e => e.entityType === 'main_base' && e.teamId === 1,
    );
    if (playerBase) {
      this.spawnGrunt(playerBase);
      this.spawnGrunt(playerBase);
      this.supplyUsed += GRUNT_SUPPLY_COST * 2;
    }
  }

  enable(): void {
    this.rtsCamera.enable();
    this.selection.enable();
    // Build panel starts hidden — shown only when a grunt is selected
    this.buildPanel.enable({
      onSelect: (type) => this.startPlacement(type),
      onCancel: () => this.cancelPlacement(),
    });
    this.buildPanel.setCrystals(this.crystals);
    this.buildPanel.hide();
    this.hudContainer.style.display = 'flex';
    this.updateHud();

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
    // Clean up fog
    this.fog.destroy();
  }

  get gameOver(): { winner: 1 | 2 } | null {
    return this._gameOver;
  }

  /** Active camera for billboarding health bars. Set by main loop. */
  activeCamera: THREE.Camera | null = null;
  /** FPS player entity ID — health bar hidden in FPS mode */
  fpsPlayerEntityId: string | null = null;
  /** Whether the player is currently in FPS mode */
  isFPSMode = false;

  /** Full tick for offline mode — runs all game logic */
  tick(dt: number): void {
    if (this._gameOver) return;

    this.updateConstruction(dt);
    this.updateTraining(dt);
    this.updateGrunts(dt);
    this.separateUnits(dt);
    this.updateWaveTimer(dt);
    this.updateFighters(dt);
    this.cleanupDead();
    this.updateTowerTurrets(dt);
    this.updateFogOfWar();
    this.updateHealthBars();
    this.updateUnitPips();
    this.updateUnitAnimations(dt);
    this.selection.update(dt);
    this.checkWinCondition();
  }

  /** Visual-only tick for online mode — no game logic, just rendering helpers */
  tickVisuals(dt: number): void {
    this.updateFogOfWar();
    this.updateHealthBars();
    this.updateUnitPips();
    this.updateUnitAnimations(dt);
    this.selection.update(dt);

    // Refresh info panel if a building with a training queue is selected
    if (this.selection.selected.size === 1) {
      const sel = this.selection.getSelected()[0];
      if (sel && (sel.entityType === 'main_base' || sel.status === 'constructing')) {
        this.updateInfoPanel();
      }
    }
  }

  /** Apply server snapshot data to HUD and local state (online mode) */
  setFromSnapshot(snapshot: import('@dyarchy/shared').SnapshotMsg): void {
    this.crystals = snapshot.teamResources[1] ?? 0;
    this.supplyCap = snapshot.teamSupply[1]?.cap ?? 10;
    this.supplyUsed = snapshot.teamSupply[1]?.used ?? 0;
    this.waveTimer = snapshot.waveTimer;
    this.buildPanel.setCrystals(this.crystals);

    // Sync training queues from server
    const serverQueues = snapshot.trainingQueues?.[1] ?? [];
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
        tq.queue = stq.queue.map(s => ({ elapsed: s.elapsed, duration: s.duration }));
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

        cb = { entity, type: 'barracks' as any, elapsed: 0, duration: CONSTRUCTION_TIME, wireframe, barBg, barFill };
        this.constructing.push(cb);
      }

      // Update progress bar
      const progress = entity.constructionProgress;
      const barWidth = 4 * progress;
      cb.barFill.scale.set(progress || 0.001, 1, 1);
      cb.barFill.position.x = entity.mesh.position.x - 2 + barWidth / 2;
      cb.wireframe.position.set(entity.mesh.position.x, 0, entity.mesh.position.z);
      cb.barBg.position.set(entity.mesh.position.x, cb.barBg.position.y, entity.mesh.position.z);
    }

    // Remove construction visuals for entities that are no longer constructing
    this.constructing = this.constructing.filter(cb => {
      if (activeIds.has(cb.entity.id)) return true;
      scene.remove(cb.wireframe);
      cb.wireframe.geometry.dispose();
      scene.remove(cb.barBg);
      cb.barBg.geometry.dispose();
      scene.remove(cb.barFill);
      cb.barFill.geometry.dispose();
      return false;
    });
  }

  private checkWinCondition(): void {
    for (const teamId of [1, 2] as const) {
      const hasBuildings = this.sceneManager.entities.some(
        e => (e.entityType === 'tower' || e.entityType === 'main_base')
          && e.teamId === teamId && e.hp > 0,
      );
      if (!hasBuildings) {
        const winner = teamId === 1 ? 2 : 1;
        this._gameOver = { winner };
        return;
      }
    }
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

  // ===================== Info Panel =====================

  private updateInfoPanel(): void {
    const items = this.selection.getSelected();

    // Toggle build panel: only show when a friendly grunt is selected
    const hasGruntSelected = items.some(
      s => s.entityType === 'grunt' && s.teamId === 1,
    );
    if (hasGruntSelected) {
      this.buildPanel.setCrystals(this.crystals);
      this.buildPanel.show();
    } else {
      this.buildPanel.hide();
      // If we were placing a building and deselected the grunt, cancel
      if (this.activeBuildType) this.cancelPlacement();
    }

    if (items.length === 1) {
      const item = items[0];
      const grunt = this.grunts.find(g => g.entity.id === item.id);
      if (grunt) {
        this.infoPanel.show(items, this.getGruntStatusText(grunt));
        return;
      }
      const fighter = this.fighters.find(f => f.entity.id === item.id);
      if (fighter) {
        this.infoPanel.show(items, this.getFighterStatusText(fighter));
        return;
      }
      // Building with training queue
      const tq = this.trainingQueues.get(item.id);
      const queueInfo = {
        baseId: item.id,
        slots: (tq?.queue ?? []).map((q, i) => ({
          unitType: 'grunt',
          progress: i === 0 ? q.elapsed / q.duration : null,
        })),
        maxSlots: MAX_TRAINING_QUEUE,
      };

      if (item.entityType === 'main_base' && item.teamId === 1) {
        const status = tq && tq.queue.length > 0
          ? `Training Grunt... ${Math.round((tq.queue[0].elapsed / tq.queue[0].duration) * 100)}%`
          : undefined;
        this.infoPanel.show(items, status, queueInfo);
        return;
      }
    }
    this.infoPanel.show(items);
  }

  private getGruntStatusText(grunt: Grunt): string {
    switch (grunt.state) {
      case 'idle': return 'Idle';
      case 'moving': return 'Moving';
      case 'moving_to_node': return 'Moving to crystals';
      case 'harvesting': {
        const pct = Math.round((grunt.harvestTimer / GRUNT_HARVEST_TIME) * 100);
        return `Harvesting... ${pct}%`;
      }
      case 'returning': return `Returning (${grunt.carriedCrystals} crystals)`;
      case 'moving_to_attack': return 'Moving to attack';
      case 'attacking': return 'Attacking';
      case 'moving_to_build': return 'Moving to build site';
      case 'building': return 'Building...';
    }
  }

  private getFighterStatusText(fighter: Fighter): string {
    switch (fighter.state) {
      case 'idle': return 'Idle';
      case 'moving_to_point': return 'Moving';
      case 'moving_to_target': return 'Moving to target';
      case 'moving_to_enemy': return 'Engaging enemy';
      case 'attacking': return 'Attacking';
    }
  }

  // ===================== Grunt Training =====================

  private trainGrunt(): void {
    if (this.supplyUsed >= this.supplyCap) return;
    if (this.crystals < GRUNT_COST) return;

    const selected = this.selection.getSelected();
    const sel = selected.find(s => s.entityType === 'main_base' && s.teamId === 1);
    if (!sel) return;

    const base = this.sceneManager.entities.find(e => e.id === sel.id);
    if (!base) return;

    // In online mode, send to server (server handles validation and queue)
    if (this.onServerTrain) {
      this.onServerTrain(base.id);
      return;
    }

    // Offline: handle locally
    let tq = this.trainingQueues.get(base.id);
    if (!tq) {
      tq = { baseEntity: base, queue: [], barBg: null, barFill: null };
      this.trainingQueues.set(base.id, tq);
    }

    if (tq.queue.length >= MAX_TRAINING_QUEUE) return;

    tq.queue.push({ elapsed: 0, duration: GRUNT_TRAIN_TIME });
    this.supplyUsed += GRUNT_SUPPLY_COST;
    if (GRUNT_COST > 0) this.spendCrystals(GRUNT_COST);
    this.updateHud();
    this.updateInfoPanel();
    this.updateTrainingBar(tq);
  }

  private cancelTraining(baseId: string, index: number): void {
    if (this.onServerCancelTrain) {
      this.onServerCancelTrain(baseId, index);
      return;
    }

    const tq = this.trainingQueues.get(baseId);
    if (!tq || index < 0 || index >= tq.queue.length) return;

    tq.queue.splice(index, 1);
    this.supplyUsed = Math.max(0, this.supplyUsed - GRUNT_SUPPLY_COST);
    if (GRUNT_COST > 0) {
      this.crystals += GRUNT_COST;
      this.buildPanel.setCrystals(this.crystals);
    }
    this.updateHud();
    this.updateInfoPanel();
    this.updateTrainingBar(tq);
  }

  private updateTraining(dt: number): void {
    let anyActive = false;

    for (const [, tq] of this.trainingQueues) {
      if (tq.queue.length === 0) continue;
      anyActive = true;

      // Only the first item in queue progresses
      const current = tq.queue[0];
      current.elapsed += dt;

      if (current.elapsed >= current.duration) {
        tq.queue.shift();
        this.spawnGrunt(tq.baseEntity);
        this.updateTrainingBar(tq);
      } else {
        this.updateTrainingBar(tq);
      }
    }

    // Live-update info panel if a training base is selected
    if (anyActive && this.selection.selected.size === 1) {
      const sel = this.selection.getSelected()[0];
      if (sel) {
        for (const [, tq] of this.trainingQueues) {
          if (tq.baseEntity.id === sel.id && tq.queue.length > 0) {
            this.updateInfoPanel();
            break;
          }
        }
      }
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

  private spawnGrunt(base: SceneEntity): void {
    this.gruntCounter++;
    const angle = Math.random() * Math.PI * 2;
    const spawnX = base.mesh.position.x + Math.cos(angle) * 6;
    const spawnZ = base.mesh.position.z + Math.sin(angle) * 6;

    const mesh = createGrunt(1);
    mesh.position.set(spawnX, 0, spawnZ);
    this.sceneManager.scene.add(mesh);

    const entity = this.sceneManager.registerEntity(
      mesh, `Grunt ${this.gruntCounter}`, 'grunt', 1, 50, 50,
    );
    this.selection.setSelectables(this.sceneManager.entities);

    this.grunts.push({
      entity, state: 'idle', targetNode: null, attackTarget: null, buildTarget: null,
      homeBase: base, harvestTimer: 0, carriedCrystals: 0, movePoint: null, attackTimer: 0,
    });
    SoundManager.instance().gruntSpawned(entity.mesh.position.x, entity.mesh.position.z);
    this.updateInfoPanel();
  }

  // ===================== Grunt AI =====================

  private updateGrunts(dt: number): void {
    for (const grunt of this.grunts) {
      switch (grunt.state) {
        case 'idle': break;
        case 'moving': {
          if (!grunt.movePoint) { grunt.state = 'idle'; break; }
          if (this.moveToward(grunt.entity.mesh, grunt.movePoint, dt, GRUNT_SPEED)) {
            grunt.movePoint = null;
            grunt.state = 'idle';
          }
          break;
        }
        case 'moving_to_node': {
          if (!grunt.targetNode) { grunt.state = 'idle'; break; }
          if (this.moveToward(grunt.entity.mesh, grunt.targetNode.mesh.position, dt, GRUNT_SPEED)) {
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
          if (this.moveToward(grunt.entity.mesh, grunt.homeBase.mesh.position, dt, GRUNT_SPEED)) {
            this.crystals += grunt.carriedCrystals;
            grunt.carriedCrystals = 0;
            this.buildPanel.setCrystals(this.crystals);
            this.updateHud();
            grunt.state = grunt.targetNode ? 'moving_to_node' : 'idle';
          }
          break;
        }
        case 'moving_to_attack': {
          if (!grunt.attackTarget || grunt.attackTarget.hp <= 0) {
            grunt.attackTarget = null;
            grunt.state = 'idle';
            break;
          }
          const range = this.attackRange(grunt.attackTarget, GRUNT_ATTACK_RANGE);
          const dist = this.distXZ(grunt.entity.mesh.position, grunt.attackTarget.mesh.position);
          if (dist <= range) {
            grunt.state = 'attacking';
            grunt.attackTimer = 0;
          } else {
            this.moveToward(grunt.entity.mesh, grunt.attackTarget.mesh.position, dt, GRUNT_SPEED, range - 0.5);
          }
          break;
        }
        case 'attacking': {
          if (!grunt.attackTarget || grunt.attackTarget.hp <= 0) {
            grunt.attackTarget = null;
            grunt.state = 'idle';
            break;
          }
          const range = this.attackRange(grunt.attackTarget, GRUNT_ATTACK_RANGE);
          const dist = this.distXZ(grunt.entity.mesh.position, grunt.attackTarget.mesh.position);
          if (dist > range + 1) {
            grunt.state = 'moving_to_attack';
            break;
          }
          grunt.attackTimer += dt;
          if (grunt.attackTimer >= GRUNT_ATTACK_INTERVAL) {
            grunt.attackTimer = 0;
            grunt.attackTarget.hp -= GRUNT_DAMAGE;
            if (grunt.attackTarget.hp <= 0) {
              grunt.attackTarget.hp = 0;
              grunt.attackTarget = null;
              grunt.state = 'idle';
            }
          }
          break;
        }
        case 'moving_to_build': {
          if (!grunt.buildTarget || grunt.buildTarget.status !== 'constructing') {
            grunt.buildTarget = null;
            grunt.state = 'idle';
            break;
          }
          const dist = this.distXZ(grunt.entity.mesh.position, grunt.buildTarget.mesh.position);
          if (dist <= 3) {
            grunt.state = 'building';
          } else {
            this.moveToward(grunt.entity.mesh, grunt.buildTarget.mesh.position, dt, GRUNT_SPEED);
          }
          break;
        }
        case 'building': {
          if (!grunt.buildTarget || grunt.buildTarget.status !== 'constructing') {
            grunt.buildTarget = null;
            grunt.state = 'idle';
            break;
          }
          // Stay near the building
          const dist = this.distXZ(grunt.entity.mesh.position, grunt.buildTarget.mesh.position);
          if (dist > 5) {
            // Grunt was moved away — pause building
            grunt.state = 'idle';
            grunt.buildTarget = null;
          }
          break;
        }
      }
    }

    if (this.selection.selected.size === 1) {
      const sel = this.selection.getSelected()[0];
      if (sel) {
        const grunt = this.grunts.find(g => g.entity.id === sel.id);
        if (grunt && grunt.state !== 'idle') this.updateInfoPanel();
      }
    }
  }

  // ===================== Fighter Wave System =====================

  private updateWaveTimer(dt: number): void {
    this.waveTimer -= dt;
    this.updateHud();

    if (this.waveTimer <= 0) {
      this.spawnWave(1);
      this.spawnWave(2);
      this.waveTimer = WAVE_INTERVAL;
      SoundManager.instance().fighterWaveSpawned();
    }
  }

  private getTeamFighters(teamId: 1 | 2): Fighter[] {
    return this.fighters.filter(f => f.teamId === teamId);
  }

  /** Get living enemy structures to attack: towers first, then main base */
  private getEnemyTargets(teamId: 1 | 2): SceneEntity[] {
    const enemyTeam = teamId === 1 ? 2 : 1;
    const towers = this.sceneManager.entities.filter(
      e => e.entityType === 'tower' && e.teamId === enemyTeam && e.hp > 0,
    );
    if (towers.length > 0) return towers;
    // If all towers are dead, target main base
    const base = this.sceneManager.entities.filter(
      e => e.entityType === 'main_base' && e.teamId === enemyTeam && e.hp > 0,
    );
    return base;
  }

  private spawnWave(teamId: 1 | 2): void {
    const teamFighters = this.getTeamFighters(teamId);
    const canSpawn = Math.min(FIGHTERS_PER_WAVE, MAX_FIGHTERS_PER_TEAM - teamFighters.length);
    if (canSpawn <= 0) return;

    const base = this.sceneManager.entities.find(
      e => e.entityType === 'main_base' && e.teamId === teamId,
    );
    if (!base) return;

    const enemyTargets = this.getEnemyTargets(teamId);
    if (enemyTargets.length === 0) return;

    // Sort by z: upper (negative z) first, lower (positive z) second
    const sorted = [...enemyTargets].sort((a, b) => a.mesh.position.z - b.mesh.position.z);
    const upperTower = sorted[0];
    const lowerTower = sorted.length > 1 ? sorted[sorted.length - 1] : sorted[0];

    for (let i = 0; i < canSpawn; i++) {
      this.fighterCounter++;
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 3;
      const spawnX = base.mesh.position.x + Math.cos(angle) * dist;
      const spawnZ = base.mesh.position.z + Math.sin(angle) * dist;

      const mesh = createFighter(teamId);
      mesh.position.set(spawnX, 0, spawnZ);
      this.sceneManager.scene.add(mesh);

      const teamLabel = teamId === 1 ? 'Blue' : 'Red';
      const entity = this.sceneManager.registerEntity(
        mesh, `${teamLabel} Fighter ${this.fighterCounter}`, 'fighter', teamId,
        FIGHTER_HP, FIGHTER_HP,
      );

      // Assign half to upper tower, half to lower
      const target = i < canSpawn / 2 ? upperTower : lowerTower;

      this.fighters.push({
        entity, teamId,
        state: 'moving_to_target',
        assignedTarget: target,
        currentEnemy: null,
        attackTimer: 0,
        playerTarget: null,
        movePoint: null,
      });
    }

    this.selection.setSelectables(this.sceneManager.entities);
    this.updateHud();
  }

  /** After combat ends, resume the best available behavior */
  private resumeAfterCombat(fighter: Fighter): void {
    fighter.currentEnemy = null;
    // Don't clear playerTarget — only clear movePoint since we're interrupting
    // If they had a player-assigned attack target that died, clear it
    if (fighter.playerTarget && fighter.playerTarget.hp <= 0) {
      fighter.playerTarget = null;
    }

    // Priority: player attack target > assigned tower > find new tower > idle
    if (fighter.playerTarget && fighter.playerTarget.hp > 0) {
      fighter.currentEnemy = fighter.playerTarget;
      fighter.state = 'moving_to_enemy';
    } else if (fighter.assignedTarget && fighter.assignedTarget.hp > 0) {
      fighter.state = 'moving_to_target';
    } else {
      fighter.assignedTarget = this.findClosestEnemyTarget(fighter);
      fighter.state = fighter.assignedTarget ? 'moving_to_target' : 'idle';
    }
  }

  private updateFighters(dt: number): void {
    for (const fighter of this.fighters) {
      if (fighter.entity.hp <= 0) {
        continue; // skip dead — cleanupDead will remove them
      }

      // Retarget if assigned target is dead
      if (fighter.assignedTarget && fighter.assignedTarget.hp <= 0) {
        fighter.assignedTarget = this.findClosestEnemyTarget(fighter);
      }

      const structureTarget = fighter.playerTarget?.hp! > 0
        ? fighter.playerTarget!
        : fighter.assignedTarget;

      switch (fighter.state) {
        case 'idle': {
          const nearbyEnemy = this.findNearbyEnemy(fighter);
          if (nearbyEnemy) {
            fighter.currentEnemy = nearbyEnemy;
            fighter.state = 'moving_to_enemy';
            break;
          }
          if (structureTarget && structureTarget.hp > 0) {
            fighter.state = 'moving_to_target';
          } else {
            fighter.assignedTarget = this.findClosestEnemyTarget(fighter);
            if (fighter.assignedTarget) fighter.state = 'moving_to_target';
          }
          break;
        }

        case 'moving_to_point': {
          // Player-commanded move to a ground position
          if (!fighter.movePoint) { fighter.state = 'idle'; break; }

          // Still scan for enemies while moving
          const nearbyEnemy = this.findNearbyEnemy(fighter);
          if (nearbyEnemy) {
            fighter.currentEnemy = nearbyEnemy;
            fighter.state = 'moving_to_enemy';
            break;
          }

          if (this.moveToward(fighter.entity.mesh, fighter.movePoint, dt, FIGHTER_SPEED)) {
            fighter.movePoint = null;
            // Arrived at move point — resume default behavior
            this.resumeAfterCombat(fighter);
          }
          break;
        }

        case 'moving_to_target': {
          const nearbyEnemy = this.findNearbyEnemy(fighter);
          if (nearbyEnemy) {
            fighter.currentEnemy = nearbyEnemy;
            fighter.state = 'moving_to_enemy';
            break;
          }

          if (!structureTarget || structureTarget.hp <= 0) {
            this.resumeAfterCombat(fighter);
            break;
          }

          const stopDist = this.attackRange(structureTarget, FIGHTER_ATTACK_RANGE) - 0.5;
          if (this.moveToward(fighter.entity.mesh, structureTarget.mesh.position, dt, FIGHTER_SPEED, stopDist)) {
            fighter.currentEnemy = structureTarget;
            fighter.state = 'attacking';
            fighter.attackTimer = 0;
          }
          break;
        }

        case 'moving_to_enemy': {
          if (!fighter.currentEnemy || fighter.currentEnemy.hp <= 0) {
            this.resumeAfterCombat(fighter);
            break;
          }

          const range = this.attackRange(fighter.currentEnemy, FIGHTER_ATTACK_RANGE);
          const dist = this.distXZ(fighter.entity.mesh.position, fighter.currentEnemy.mesh.position);
          if (dist <= range) {
            fighter.state = 'attacking';
            fighter.attackTimer = 0;
          } else {
            this.moveToward(fighter.entity.mesh, fighter.currentEnemy.mesh.position, dt, FIGHTER_SPEED, range - 0.5);
          }
          break;
        }

        case 'attacking': {
          if (!fighter.currentEnemy || fighter.currentEnemy.hp <= 0) {
            this.resumeAfterCombat(fighter);
            break;
          }

          // While attacking a non-mobile target, scan for mobile enemies (higher priority)
          if (!RTSController.MOBILE_TYPES.has(fighter.currentEnemy.entityType)) {
            const nearbyEnemy = this.findNearbyEnemy(fighter);
            if (nearbyEnemy) {
              fighter.currentEnemy = nearbyEnemy;
              fighter.state = 'moving_to_enemy';
              break;
            }
          }

          const range = this.attackRange(fighter.currentEnemy, FIGHTER_ATTACK_RANGE);
          const dist = this.distXZ(fighter.entity.mesh.position, fighter.currentEnemy.mesh.position);
          if (dist > range + 1) {
            fighter.state = 'moving_to_enemy';
            break;
          }

          fighter.attackTimer += dt;
          if (fighter.attackTimer >= FIGHTER_ATTACK_INTERVAL) {
            fighter.attackTimer = 0;
            const dmg = RTSController.MOBILE_TYPES.has(fighter.currentEnemy.entityType)
              ? FIGHTER_DAMAGE_UNIT : FIGHTER_DAMAGE_BUILDING;
            fighter.currentEnemy.hp -= dmg;
            // Main bases can't go below 1 HP (no win condition yet)
            if (fighter.currentEnemy.hp <= 0) {
              fighter.currentEnemy.hp = 0;
              this.resumeAfterCombat(fighter);
            }
          }
          break;
        }
      }
    }

    // Live-update info panel for selected fighter
    if (this.selection.selected.size === 1) {
      const sel = this.selection.getSelected()[0];
      if (sel) {
        const fighter = this.fighters.find(f => f.entity.id === sel.id);
        if (fighter) this.updateInfoPanel();
      }
    }
  }

  private static readonly MOBILE_TYPES = new Set(['fighter', 'grunt', 'fps_player']);

  /** Remove any entity (grunt, fighter, building) that has 0 HP */
  private cleanupDead(): void {
    let changed = false;

    // Dead grunts
    const deadGrunts = this.grunts.filter(g => g.entity.hp <= 0);
    for (const g of deadGrunts) {
      this.sceneManager.removeEntity(g.entity.id);
      this.selection.removeFromSelection(g.entity.id);
      this.supplyUsed = Math.max(0, this.supplyUsed - GRUNT_SUPPLY_COST);
      changed = true;
    }
    if (deadGrunts.length > 0) {
      this.grunts = this.grunts.filter(g => g.entity.hp > 0);
    }

    // Dead fighters are already handled in updateFighters, but double-check
    // (fighters from enemy team that get killed by our fighters)
    const deadFighters = this.fighters.filter(f => f.entity.hp <= 0);
    for (const f of deadFighters) {
      this.sceneManager.removeEntity(f.entity.id);
      this.selection.removeFromSelection(f.entity.id);
      changed = true;
    }
    if (deadFighters.length > 0) {
      this.fighters = this.fighters.filter(f => f.entity.hp > 0);
    }

    // Dead buildings/towers/bases (remove from scene)
    const deadBuildings = this.sceneManager.entities.filter(
      e => e.hp <= 0 && (e.entityType === 'tower' || e.entityType === 'player_tower'
        || e.entityType === 'barracks' || e.entityType === 'armory' || e.entityType === 'main_base'),
    );
    for (const b of deadBuildings) {
      this.sceneManager.removeEntity(b.id);
      this.selection.removeFromSelection(b.id);
      changed = true;
    }

    if (changed) {
      this.selection.setSelectables(this.sceneManager.entities);
      this.updateHud();
    }
  }

  /** Find nearest enemy mobile unit (fighter or grunt) within aggro range */
  private findNearbyEnemy(fighter: Fighter): SceneEntity | null {
    const pos = fighter.entity.mesh.position;
    let closest: SceneEntity | null = null;
    let closestDist = FIGHTER_AGGRO_RANGE;

    for (const ent of this.sceneManager.entities) {
      if (ent.teamId === fighter.teamId) continue;
      if (ent.hp <= 0) continue;
      if (!RTSController.MOBILE_TYPES.has(ent.entityType)) continue;
      const d = this.distXZ(pos, ent.mesh.position);
      if (d < closestDist) {
        closestDist = d;
        closest = ent;
      }
    }
    return closest;
  }

  private findClosestEnemyTarget(fighter: Fighter): SceneEntity | null {
    const targets = this.getEnemyTargets(fighter.teamId);
    if (targets.length === 0) return null;

    let closest = targets[0];
    let closestDist = this.distXZ(fighter.entity.mesh.position, closest.mesh.position);
    for (let i = 1; i < targets.length; i++) {
      const d = this.distXZ(fighter.entity.mesh.position, targets[i].mesh.position);
      if (d < closestDist) {
        closestDist = d;
        closest = targets[i];
      }
    }
    return closest;
  }

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
    grunt:      { 1: 0x4488dd, 2: 0xdd4444 },
    fighter:    { 1: 0x2266cc, 2: 0xcc2222 },
    fps_player: { 1: 0x00ffff, 2: 0xff4466 },
  };

  /** Render small team-colored dots above mobile units that draw on top of everything.
   *  Only shown in RTS view — in FPS mode the pips are hidden. */
  private updateUnitPips(): void {
    const scene = this.sceneManager.scene;
    const showPips = !this.isFPSMode;
    const activeIds = new Set<string>();

    for (const entity of this.sceneManager.entities) {
      if (!RTSController.MOBILE_TYPES.has(entity.entityType)) continue;
      if (entity.hp <= 0) continue;

      // Hide own FPS entity pip
      if (entity.id === this.fpsPlayerEntityId && this.isFPSMode) continue;

      activeIds.add(entity.id);

      let pip = this.unitPips.get(entity.id);
      if (!pip) {
        const colors = RTSController.PIP_COLORS[entity.entityType];
        const color = colors ? colors[entity.teamId] : 0xffffff;

        const geo = new THREE.CircleGeometry(0.35, 8);
        const mat = new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.9,
        });
        pip = new THREE.Mesh(geo, mat);
        pip.rotation.x = -Math.PI / 2;
        pip.renderOrder = 999; // draw on top of everything
        scene.add(pip);
        this.unitPips.set(entity.id, pip);
      }

      // Hide pip if entity mesh is hidden (fog of war) or not in RTS mode
      pip.visible = showPips && entity.mesh.visible;
      const pos = entity.mesh.position;
      const yOffset = entity.entityType === 'fps_player' ? 1.8 : 1.5;
      pip.position.set(pos.x, yOffset, pos.z);
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

  private towerFlashTimers = new Map<string, number>();

  private combatSoundTimer = 0;

  private updateUnitAnimations(dt: number): void {
    this.animTime += dt;

    // Animate grunts (offline mode)
    for (const grunt of this.grunts) {
      const isMoving = grunt.state === 'moving' || grunt.state === 'moving_to_node'
        || grunt.state === 'returning' || grunt.state === 'moving_to_build'
        || grunt.state === 'moving_to_attack';
      const isAttacking = grunt.state === 'attacking';
      this.animateUnit(grunt.entity.mesh, isMoving, isAttacking, dt);
    }

    // Animate fighters (offline mode)
    for (const fighter of this.fighters) {
      const isMoving = fighter.state === 'moving_to_target' || fighter.state === 'moving_to_enemy'
        || fighter.state === 'moving_to_point';
      const isAttacking = fighter.state === 'attacking';
      this.animateUnit(fighter.entity.mesh, isMoving, isAttacking, dt);
    }

    // Combat sounds: scan for fighters/grunts near enemies (works in both online and offline)
    this.combatSoundTimer -= dt;
    if (this.combatSoundTimer <= 0) {
      this.combatSoundTimer = 0.4; // check every 0.4s
      this.playCombatSounds();
    }

    // Animate tower turrets + all units in online mode (from entity rotation data)
    for (const entity of this.sceneManager.entities) {
      // Tower turret rotation and muzzle flash
      if (entity.entityType === 'tower' || entity.entityType === 'player_tower') {
        this.animateTowerTurret(entity, dt);
      }
    }
  }

  private animateTowerTurret(entity: SceneEntity, dt: number): void {
    // Find the turret group and muzzle flash inside the mesh hierarchy
    const found: { turret: THREE.Object3D | null; flash: THREE.Object3D | null } = { turret: null, flash: null };
    entity.mesh.traverse((child) => {
      if (child.name === 'turret') found.turret = child;
      if (child.name === 'muzzle_flash') found.flash = child;
    });
    if (!found.turret) return;

    // Rotate turret to face target (rotation.y from server/offline = angle)
    found.turret.rotation.y = entity.rotation.y;

    // Muzzle flash: rotation.z = 1 means "just fired"
    let timer = this.towerFlashTimers.get(entity.id) ?? 0;
    if (entity.rotation.z > 0.5 && timer <= 0) {
      timer = 0.15;
      this.towerFlashTimers.set(entity.id, timer);
      SoundManager.instance().towerFire(entity.mesh.position.x, entity.mesh.position.z);
    }

    if (found.flash && timer > 0) {
      timer -= dt;
      this.towerFlashTimers.set(entity.id, timer);
      const mat = (found.flash as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = timer > 0 ? 1 : 0;
    }
  }

  /** Scan all entities to find active combat and play sounds */
  private playCombatSounds(): void {
    const sm = SoundManager.instance();
    const entities = this.sceneManager.entities;
    const MELEE_RANGE = 4;

    // Collect all fighters and grunts by team
    const team1Mobile: { x: number; z: number; type: string }[] = [];
    const team2Mobile: { x: number; z: number; type: string }[] = [];

    for (const ent of entities) {
      if (ent.hp <= 0) continue;
      if (!RTSController.MOBILE_TYPES.has(ent.entityType)) continue;
      const entry = { x: ent.mesh.position.x, z: ent.mesh.position.z, type: ent.entityType };
      if (ent.teamId === 1) team1Mobile.push(entry);
      else team2Mobile.push(entry);
    }

    // Find combat hotspots: any team1 unit within melee range of a team2 unit
    let playedFighter = false;
    let playedGrunt = false;

    for (const a of team1Mobile) {
      for (const b of team2Mobile) {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        if (dx * dx + dz * dz < MELEE_RANGE * MELEE_RANGE) {
          const cx = (a.x + b.x) / 2;
          const cz = (a.z + b.z) / 2;
          if ((a.type === 'fighter' || b.type === 'fighter') && !playedFighter) {
            sm.fighterAttack(cx, cz);
            playedFighter = true;
          }
          if ((a.type === 'grunt' || b.type === 'grunt') && !playedGrunt) {
            sm.gruntAttack(cx, cz);
            playedGrunt = true;
          }
          if (playedFighter && playedGrunt) return;
        }
      }
    }
  }

  private animateUnit(mesh: THREE.Object3D, moving: boolean, attacking: boolean, _dt: number): void {
    // The visual group is the first Group child of the hitbox
    const visualGroup = mesh.children.find(c => c.type === 'Group') as THREE.Group | undefined;
    if (!visualGroup) return;

    if (moving) {
      // Walking bob: slight up/down + side-to-side sway
      const t = this.animTime * 8;
      visualGroup.position.y = Math.abs(Math.sin(t)) * 0.08;
      visualGroup.rotation.z = Math.sin(t) * 0.05;
      visualGroup.rotation.x = 0;
    } else if (attacking) {
      // Attack: lunge forward periodically
      const t = this.animTime * 4;
      const lunge = Math.max(0, Math.sin(t)) * 0.15;
      visualGroup.position.y = 0;
      visualGroup.rotation.z = 0;
      visualGroup.rotation.x = -lunge;
    } else {
      // Idle: gentle breathing
      visualGroup.position.y = Math.sin(this.animTime * 2) * 0.02;
      visualGroup.rotation.z = 0;
      visualGroup.rotation.x = 0;
    }
  }

  /** Building radii for attack range calculation — units stop at the edge */
  private static readonly BUILDING_RADII: Record<string, number> = {
    main_base: 5, tower: 3, barracks: 3.5, armory: 3.5, player_tower: 2.5,
  };

  /** Get effective attack range for a target — adds building radius so units stay at edge */
  private attackRange(target: SceneEntity, baseRange: number): number {
    const radius = RTSController.BUILDING_RADII[target.entityType] ?? 0;
    return baseRange + radius;
  }

  // ===================== Unit separation =====================

  private static readonly UNIT_RADIUS = 0.6;
  private static readonly SEPARATION_FORCE = 6;

  private separateUnits(dt: number): void {
    const allMobile = this.sceneManager.entities.filter(
      e => RTSController.MOBILE_TYPES.has(e.entityType) && e.hp > 0,
    );
    const r = RTSController.UNIT_RADIUS;
    const minDist = r * 2;

    for (let i = 0; i < allMobile.length; i++) {
      const a = allMobile[i];
      for (let j = i + 1; j < allMobile.length; j++) {
        const b = allMobile[j];
        const dx = a.mesh.position.x - b.mesh.position.x;
        const dz = a.mesh.position.z - b.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < minDist && dist > 0.001) {
          const overlap = minDist - dist;
          const pushX = (dx / dist) * overlap * 0.5;
          const pushZ = (dz / dist) * overlap * 0.5;
          const force = RTSController.SEPARATION_FORCE * dt;

          a.mesh.position.x += pushX * force;
          a.mesh.position.z += pushZ * force;
          b.mesh.position.x -= pushX * force;
          b.mesh.position.z -= pushZ * force;
        } else if (dist <= 0.001) {
          // Exactly overlapping — nudge randomly
          const angle = Math.random() * Math.PI * 2;
          const nudge = 0.5 * dt;
          a.mesh.position.x += Math.cos(angle) * nudge;
          a.mesh.position.z += Math.sin(angle) * nudge;
        }
      }
    }
  }

  // ===================== Fog of War =====================

  private updateFogOfWar(): void {
    // Only show fog in RTS mode
    if (this.isFPSMode) {
      this.fog.hide();
      // Show all entities in FPS mode
      for (const entity of this.sceneManager.entities) {
        entity.mesh.visible = true;
      }
      return;
    }

    this.fog.show();
    this.fog.update(this.sceneManager.entities);

    // Hide/show entities based on fog visibility
    for (const entity of this.sceneManager.entities) {
      // Always show own team entities and resource nodes
      if (entity.teamId === 1 || entity.entityType === 'resource_node') {
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

  // ===================== Tower Turrets (offline) =====================

  private static readonly TOWER_RANGE = 25;
  private static readonly TOWER_DAMAGE = 10;
  private static readonly TOWER_FIRE_RATE = 1.5;

  private towerCooldowns = new Map<string, number>();

  /** Offline tower AI — find targets and shoot */
  private updateTowerTurrets(dt: number): void {
    for (const entity of this.sceneManager.entities) {
      if (entity.entityType !== 'tower' && entity.entityType !== 'player_tower') continue;
      if (entity.hp <= 0 || entity.status !== 'active') continue;

      let cooldown = this.towerCooldowns.get(entity.id) ?? 0;
      cooldown = Math.max(0, cooldown - dt);
      this.towerCooldowns.set(entity.id, cooldown);

      // Find best target
      const enemyTeam = entity.teamId === 1 ? 2 : 1;
      let bestTarget: SceneEntity | null = null;
      let bestDist = RTSController.TOWER_RANGE;
      let foundFPS = false;

      for (const ent of this.sceneManager.entities) {
        if (ent.teamId === entity.teamId) continue;
        if (ent.hp <= 0) continue;
        if (!RTSController.MOBILE_TYPES.has(ent.entityType)) continue;

        const d = this.distXZ(entity.mesh.position, ent.mesh.position);
        if (d > RTSController.TOWER_RANGE) continue;

        if (ent.entityType === 'fps_player') {
          if (!foundFPS || d < bestDist) {
            bestTarget = ent; bestDist = d; foundFPS = true;
          }
          continue;
        }
        if (!foundFPS && d < bestDist) {
          bestTarget = ent; bestDist = d;
        }
      }

      // Rotate turret toward target
      if (bestTarget) {
        const dx = bestTarget.mesh.position.x - entity.mesh.position.x;
        const dz = bestTarget.mesh.position.z - entity.mesh.position.z;
        entity.rotation.y = Math.atan2(dx, dz);

        if (cooldown <= 0) {
          this.towerCooldowns.set(entity.id, RTSController.TOWER_FIRE_RATE);
          bestTarget.hp -= RTSController.TOWER_DAMAGE;
          entity.rotation.z = 1; // signal "just fired" for animation
          SoundManager.instance().towerFire(entity.mesh.position.x, entity.mesh.position.z);
          if (bestTarget.hp <= 0) bestTarget.hp = 0;
        } else {
          entity.rotation.z = 0;
        }
      } else {
        entity.rotation.z = 0;
      }
    }
  }

  // ===================== Health bars =====================

  private healthBars = new Map<string, { bg: THREE.Mesh; fill: THREE.Mesh }>();

  private static readonly BUILDING_BAR_HEIGHTS: Record<string, number> = {
    main_base: 8, tower: 10, barracks: 4.5, armory: 5, player_tower: 9,
  };

  /** Call every tick to update floating health bars above damaged entities */
  private updateHealthBars(): void {
    const scene = this.sceneManager.scene;
    const cam = this.activeCamera;

    for (const entity of this.sceneManager.entities) {
      // Hide FPS player bar in FPS mode
      const hideFPS = this.isFPSMode && entity.id === this.fpsPlayerEntityId;
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

  // ===================== Right-click commands =====================

  private onRightClick = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.activeBuildType) {
      this.cancelPlacement();
      return;
    }

    const selected = this.selection.getSelected();
    if (selected.length === 0) return;

    const worldPos = this.rtsCamera.screenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;

    const clickedEntity = this.sceneManager.entities.find(ent => {
      if (ent.hp <= 0) return false;
      const dx = ent.mesh.position.x - worldPos.x;
      const dz = ent.mesh.position.z - worldPos.z;
      return Math.sqrt(dx * dx + dz * dz) < 3;
    });

    const mobileTypes = new Set(['grunt', 'fighter']);
    const selectedMobileIds = selected.filter(s => mobileTypes.has(s.entityType)).map(s => s.id);
    const selectedGruntIds = selected.filter(s => s.entityType === 'grunt').map(s => s.id);
    const selectedFighterIds = selected.filter(s => s.entityType === 'fighter').map(s => s.id);

    if (selectedMobileIds.length === 0) return;

    const isEnemy = clickedEntity && clickedEntity.teamId !== 1 && clickedEntity.entityType !== 'resource_node' && clickedEntity.hp > 0;
    const isResource = clickedEntity?.entityType === 'resource_node';
    const isConstructing = clickedEntity && clickedEntity.status === 'constructing' && clickedEntity.teamId === 1;

    // --- Online mode: send all commands to server ---
    if (this.onServerCommand) {
      if (selectedGruntIds.length > 0 && isConstructing && clickedEntity) {
        this.onServerCommand({ command: 'build_at', unitIds: selectedGruntIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'move');
      } else if (selectedGruntIds.length > 0 && isResource && clickedEntity) {
        this.onServerCommand({ command: 'harvest', unitIds: selectedGruntIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'harvest');
      } else if (isEnemy && clickedEntity) {
        this.onServerCommand({ command: 'attack', unitIds: selectedMobileIds, targetId: clickedEntity.id });
        this.selection.showActionMarker(clickedEntity.mesh.position, 'attack');
      } else {
        const tp = { x: worldPos.x, y: 0, z: worldPos.z };
        this.onServerCommand({ command: 'move', unitIds: selectedMobileIds, targetPos: tp });
        this.selection.showActionMarker(new THREE.Vector3(tp.x, 0, tp.z), 'move');
      }
      this.updateInfoPanel();
      return;
    }

    // --- Offline mode: handle locally ---
    const selectedGrunts = selectedGruntIds
      .map(id => this.grunts.find(g => g.entity.id === id))
      .filter((g): g is Grunt => g !== undefined);
    const selectedFighters = selectedFighterIds
      .map(id => this.fighters.find(f => f.entity.id === id))
      .filter((f): f is Fighter => f !== undefined);

    if (selectedGrunts.length > 0 && isConstructing && clickedEntity) {
      for (const grunt of selectedGrunts) {
        grunt.buildTarget = clickedEntity; grunt.targetNode = null;
        grunt.attackTarget = null; grunt.movePoint = null;
        grunt.carriedCrystals = 0; grunt.state = 'moving_to_build';
      }
      this.selection.showActionMarker(clickedEntity.mesh.position, 'move');
      this.updateInfoPanel();
      return;
    }

    if (selectedGrunts.length > 0 && isResource && clickedEntity) {
      for (const grunt of selectedGrunts) {
        grunt.targetNode = clickedEntity; grunt.attackTarget = null;
        grunt.buildTarget = null; grunt.state = 'moving_to_node';
        grunt.harvestTimer = 0; grunt.carriedCrystals = 0;
      }
      this.selection.showActionMarker(clickedEntity.mesh.position, 'harvest');
      this.updateInfoPanel();
      return;
    }

    if (isEnemy && clickedEntity) {
      for (const fighter of selectedFighters) {
        fighter.playerTarget = clickedEntity; fighter.currentEnemy = clickedEntity;
        fighter.movePoint = null; fighter.state = 'moving_to_enemy';
      }
      for (const grunt of selectedGrunts) {
        grunt.attackTarget = clickedEntity; grunt.targetNode = null;
        grunt.buildTarget = null; grunt.carriedCrystals = 0;
        grunt.movePoint = null; grunt.state = 'moving_to_attack';
      }
      this.selection.showActionMarker(clickedEntity.mesh.position, 'attack');
      this.updateInfoPanel();
      return;
    }

    const moveTarget = new THREE.Vector3(worldPos.x, 0, worldPos.z);
    for (const grunt of selectedGrunts) {
      grunt.targetNode = null; grunt.attackTarget = null; grunt.buildTarget = null;
      grunt.carriedCrystals = 0; grunt.movePoint = moveTarget.clone(); grunt.state = 'moving';
    }
    for (const fighter of selectedFighters) {
      fighter.playerTarget = null; fighter.currentEnemy = null;
      fighter.movePoint = moveTarget.clone(); fighter.state = 'moving_to_point';
    }
    this.selection.showActionMarker(moveTarget, 'move');
    this.updateInfoPanel();
  };

  // ===================== Keyboard shortcuts =====================

  private onKeyDown = (e: KeyboardEvent): void => {
    const selected = this.selection.getSelected();
    if (selected.length === 1 && selected[0].entityType === 'main_base' && selected[0].teamId === 1) {
      if (e.code === 'KeyG') {
        this.trainGrunt();
      } else if (e.code === 'KeyX') {
        const tq = this.trainingQueues.get(selected[0].id);
        if (tq && tq.queue.length > 0) {
          this.cancelTraining(selected[0].id, tq.queue.length - 1);
        }
      }
    }
  };

  // ===================== Construction =====================

  private updateConstruction(dt: number): void {
    const scene = this.sceneManager.scene;
    const completed: ConstructingBuilding[] = [];

    for (const cb of this.constructing) {
      // Only progress if a grunt is actively building this
      const hasBuilder = this.grunts.some(
        g => g.state === 'building' && g.buildTarget?.id === cb.entity.id,
      );

      if (hasBuilder) {
        cb.elapsed += dt;
      }

      const progress = Math.min(cb.elapsed / cb.duration, 1);
      cb.entity.constructionProgress = progress;

      const barWidth = 4 * progress;
      cb.barFill.scale.set(progress || 0.001, 1, 1);
      cb.barFill.position.x = cb.entity.mesh.position.x - 2 + barWidth / 2;

      RTSController.setMeshOpacity(cb.entity.mesh, 0.3 + 0.7 * progress);

      if (progress >= 1) completed.push(cb);
    }

    for (const cb of completed) {
      RTSController.setMeshOpacity(cb.entity.mesh, 1);

      scene.remove(cb.wireframe);
      cb.wireframe.geometry.dispose();
      scene.remove(cb.barBg);
      cb.barBg.geometry.dispose();
      scene.remove(cb.barFill);
      cb.barFill.geometry.dispose();

      cb.entity.status = 'active';
      cb.entity.constructionProgress = 1;

      if (cb.type === 'barracks') {
        this.supplyCap += BARRACKS_SUPPLY_BONUS;
        this.updateHud();
      }

      // Notify building complete callback
      this.onBuildingComplete?.(cb.type);
      const bp = cb.entity.mesh.position;
      SoundManager.instance().buildingComplete(bp.x, bp.z);

      // Release any grunts that were building this — set them to idle
      for (const g of this.grunts) {
        if (g.buildTarget?.id === cb.entity.id) {
          g.buildTarget = null;
          g.state = 'idle';
        }
      }

      this.constructing = this.constructing.filter(c => c !== cb);
    }

    if (completed.length > 0 && this.selection.selected.size > 0) {
      this.updateInfoPanel();
    }
  }

  // ===================== Building Placement =====================

  private startPlacement(type: BuildingChoice): void {
    this.cancelPlacement();
    this.activeBuildType = type;

    // Remember which grunt is building (works for both online and offline)
    const selected = this.selection.getSelected();
    const gruntSel = selected.find(s => s.entityType === 'grunt' && s.teamId === 1);
    this.builderGruntId = gruntSel?.id ?? null;
    this.builderGrunt = gruntSel
      ? this.grunts.find(g => g.entity.id === gruntSel.id) ?? null
      : null;

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
    this.builderGrunt = null;
    this.builderGruntId = null;
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
    this.crystalHud.textContent = `Crystals: ${this.crystals}`;
    this.supplyHud.textContent = `Supply: ${this.supplyUsed} / ${this.supplyCap}`;

    const blueFighters = this.getTeamFighters(1).length;
    this.fighterHud.textContent = `Fighters: ${blueFighters} / ${MAX_FIGHTERS_PER_TEAM}`;

    const secs = Math.max(0, Math.ceil(this.waveTimer));
    this.waveHud.textContent = `Next wave: ${secs}s`;
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.ghost || !this.activeBuildType) return;

    const worldPos = this.rtsCamera.screenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;

    const snappedX = Math.round(worldPos.x / GRID_SIZE) * GRID_SIZE;
    const snappedZ = Math.round(worldPos.z / GRID_SIZE) * GRID_SIZE;

    this.ghost.position.set(snappedX, 0, snappedZ);
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

  private placeBuilding(type: BuildingChoice, pos: THREE.Vector3): SceneEntity {
    const size = BUILDING_SIZES[type];
    const scene = this.sceneManager.scene;

    // Create the proper building mesh
    let building: THREE.Mesh;
    if (type === 'barracks') building = createBarracks(1);
    else if (type === 'armory') building = createArmory(1);
    else building = createPlayerTower(1);

    building.position.set(pos.x, 0, pos.z);
    RTSController.setMeshOpacity(building, 0.3);
    scene.add(building);

    // Wireframe overlay (geometry shifted up so bottom at y=0)
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
    barFill.scale.set(0, 1, 1);
    scene.add(barFill);

    const entityType = type === 'tower' ? 'player_tower' as const : type;
    const entity = this.sceneManager.registerEntity(
      building, BUILDING_LABELS[type], entityType, 1, 100, 100, 'constructing',
    );
    this.selection.setSelectables(this.sceneManager.entities);

    this.constructing.push({
      entity, type, elapsed: 0, duration: CONSTRUCTION_TIME,
      wireframe, barBg, barFill,
    });

    return entity;
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

    // In online mode, send build command to server
    if (this.onServerBuild) {
      this.onServerBuild(type, { x: pos.x, y: pos.y, z: pos.z }, this.builderGruntId ?? undefined);
      SoundManager.instance().buildingPlaced(pos.x, pos.z);
      this.cancelPlacement();
      return;
    }

    // Offline: handle locally
    const entity = this.placeBuilding(type, pos);
    SoundManager.instance().buildingPlaced(pos.x, pos.z);

    if (this.builderGrunt) {
      this.builderGrunt.buildTarget = entity;
      this.builderGrunt.targetNode = null;
      this.builderGrunt.attackTarget = null;
      this.builderGrunt.movePoint = null;
      this.builderGrunt.state = 'moving_to_build';
    }

    this.spendCrystals(cost);
    this.cancelPlacement();
  };
}
