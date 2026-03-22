import * as THREE from 'three';
import type { SnapshotMsg, SnapshotEntity } from '@dyarchy/shared';
import type { SceneManager, SceneEntity } from '../renderer/SceneManager.js';
import { SoundManager } from '../audio/SoundManager.js';
// getTerrainHeight accessed via this.sceneManager.terrainHeight
import {
  createMainBase, createTower, createBarracks, createArmory, createFarm,
  createPlayerTower, createTurret, createSniperNest, createResourceNode, createWorker, createFighter, createArcher,
  createFPSPlayer, createFootSoldier, createGarage, createJeep, createHelicopter,
} from '../renderer/MeshFactory.js';

type TeamId = 1 | 2;

const MESH_CREATORS: Record<string, (teamId: TeamId) => THREE.Mesh> = {
  main_base: (t) => createMainBase(t),
  tower: (t) => createTower(t),
  farm: (t) => createFarm(t),
  barracks: (t) => createBarracks(t),
  armory: (t) => createArmory(t),
  player_tower: (t) => createPlayerTower(t),
  turret: (t) => createTurret(t),
  sniper_nest: (t) => createSniperNest(t),
  garage: (t) => createGarage(t),
  jeep: (t) => createJeep(t),
  helicopter: (t) => createHelicopter(t),
  worker: (t) => createWorker(t),
  fighter: (t) => createFighter(t),
  fps_player: (t) => createFPSPlayer(t),
  foot_soldier: (t) => createFootSoldier(t),
  archer: (t) => createArcher(t),
};

/**
 * Applies server snapshots to the Three.js scene.
 * Creates new meshes for new entities, updates positions for existing ones,
 * and removes meshes for entities that no longer exist.
 */
const BUILDING_COLLISION: Record<string, { hx: number; hy: number; hz: number; cy: number }> = {
  main_base: { hx: 4, hy: 3, hz: 4, cy: 3 },
  tower: { hx: 2, hy: 4, hz: 2, cy: 4 },
  barracks: { hx: 3, hy: 2, hz: 3, cy: 2 },
  armory: { hx: 3, hy: 2, hz: 3, cy: 2 },
  player_tower: { hx: 2.5, hy: 4, hz: 2.5, cy: 4 },
  turret: { hx: 1.5, hy: 1.5, hz: 1.5, cy: 1 },
  farm: { hx: 2.5, hy: 2, hz: 2.5, cy: 2 },
  garage: { hx: 3.5, hy: 2.5, hz: 3, cy: 2.5 },
  // sniper_nest: open structure, no solid collision box
};

// Entity types that should be interpolated (mobile units)
const INTERPOLATED_TYPES = new Set(['worker', 'fighter', 'fps_player', 'foot_soldier', 'archer', 'jeep', 'helicopter']);

interface InterpState {
  prevPos: THREE.Vector3;
  nextPos: THREE.Vector3;
  prevRot: { x: number; y: number; z: number };
  nextRot: { x: number; y: number; z: number };
}

export class SnapshotRenderer {
  private sceneManager: SceneManager;
  private knownEntities = new Map<string, SceneEntity>();
  private obstacleIds = new Set<string>();
  private prevActiveIds = new Set<string>();
  private lastSnapshot: SnapshotMsg | null = null;

  // Interpolation state
  private interpStates = new Map<string, InterpState>();
  private snapshotTime = 0; // time when last snapshot arrived
  private snapshotInterval = 0.05; // estimated interval between snapshots (50ms = 20tps)

  // Jeep airborne physics (client-side)
  private jeepAir = new Map<string, { vy: number; y: number; prevTerrainY: number }>();

  // Track jeep velocities for collision ragdoll detection
  private jeepVelocities = new Map<string, { vx: number; vz: number; speed: number; px: number; pz: number }>();

  // Jeep damage visual state
  private jeepDamageState = new Map<string, {
    smokeParticles: THREE.Mesh[];
    flameParticles: THREE.Mesh[];
    wheelRemoved: boolean;
    lastDmgLevel: number; // 0=none, 1=smoke, 2=smoke+flame, 3=wheel+more flames
  }>();

  /** ID of the local FPS player entity — hidden when player is in FPS mode */
  localFPSEntityId: string | null = null;
  /** Local player's team */
  localTeamId: 1 | 2 = 1;
  /** Whether the local player is currently in FPS mode */
  isFPSMode = false;
  /** Called when a building transitions to active */
  onBuildingComplete: ((entityType: string, teamId: TeamId) => void) | null = null;
  /** Called when a main_base upgrades (level changes) */
  onBaseUpgrade: ((teamId: TeamId, level: number) => void) | null = null;
  /** Called when a new entity first appears in the snapshot */
  onEntityCreated: ((entityType: string, teamId: TeamId) => void) | null = null;
  /** Called when an entity is destroyed (hp drops to 0 or removed from snapshot) */
  onEntityDestroyed: ((entityType: string, teamId: TeamId, entityId: string) => void) | null = null;

  // Name labels above fps_player entities
  private nameLabels = new Map<string, THREE.Sprite>();
  private losRaycaster = new THREE.Raycaster();
  private deadFPSPlayers = new Set<string>(); // track fps_players currently in death animation
  private walkPhase = new Map<string, number>(); // per-entity walk animation phase

  // Hero visuals
  private heroIcons = new Map<string, THREE.Sprite>();
  private auraCircles = new Map<string, THREE.Mesh>();
  private heroGlows = new Map<string, THREE.Mesh>();
  private shieldDomes = new Map<string, THREE.Mesh>(); // 3rd-person shield (visible to all)

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
  }

  /** Call every frame to smoothly interpolate entity positions */
  update(dt: number): void {
    this.snapshotTime += dt;
    const t = Math.min(1, this.snapshotTime / this.snapshotInterval);

    for (const [id, interp] of this.interpStates) {
      const entity = this.knownEntities.get(id);
      if (!entity) continue;
      // Skip local FPS player (driven by local camera)
      if (id === this.localFPSEntityId && this.isFPSMode) continue;

      // Lerp position
      entity.mesh.position.lerpVectors(interp.prevPos, interp.nextPos, t);
      // FPS players: server Y includes PLAYER_HEIGHT (1.5) — subtract it for mesh placement
      // Only add back any extra Y from jumping
      if (entity.entityType === 'fps_player') {
        const terrainY = this.sceneManager.terrainHeight(entity.mesh.position.x, entity.mesh.position.z);
        const lerpedY = interp.prevPos.y + (interp.nextPos.y - interp.prevPos.y) * t;
        // Server Y = terrainY + PLAYER_HEIGHT + jumpHeight. Mesh should be at terrainY + jumpHeight.
        const jumpHeight = Math.max(0, lerpedY - 1.5); // subtract PLAYER_HEIGHT
        entity.mesh.position.y = terrainY + jumpHeight;
      } else if (entity.entityType === 'jeep') {
        // Jeep airborne physics: maintain vertical velocity when terrain drops away
        const terrainY = this.sceneManager.terrainHeight(entity.mesh.position.x, entity.mesh.position.z);
        let air = this.jeepAir.get(id);
        if (!air) {
          air = { vy: 0, y: terrainY, prevTerrainY: terrainY };
          this.jeepAir.set(id, air);
        }
        // Estimate vertical velocity from terrain slope (how fast terrain Y is changing under the jeep)
        const terrainDeltaPerSec = (terrainY - air.prevTerrainY) / Math.max(dt, 0.001);
        air.prevTerrainY = terrainY;

        if (air.y <= terrainY + 0.05) {
          // On the ground — track terrain, inherit slope velocity
          air.y = terrainY;
          air.vy = terrainDeltaPerSec;
        } else {
          // Airborne — apply gravity
          air.vy += -40 * dt;
          air.y += air.vy * dt;
          // Land if we fall to terrain
          if (air.y <= terrainY) {
            air.y = terrainY;
            air.vy = 0;
          }
        }
        entity.mesh.position.y = air.y;

        // Track jeep velocity for collision ragdoll
        const prev = this.jeepVelocities.get(id);
        const px = entity.mesh.position.x;
        const pz = entity.mesh.position.z;
        if (prev && dt > 0.001) {
          prev.vx = (px - prev.px) / dt;
          prev.vz = (pz - prev.pz) / dt;
          prev.speed = Math.sqrt(prev.vx * prev.vx + prev.vz * prev.vz);
          prev.px = px;
          prev.pz = pz;
        } else {
          this.jeepVelocities.set(id, { vx: 0, vz: 0, speed: 0, px, pz });
        }
      } else if (entity.entityType === 'helicopter') {
        // Helicopter: lerp Y from server position (it flies at altitude)
        const lerpedY = interp.prevPos.y + (interp.nextPos.y - interp.prevPos.y) * t;
        const terrainY = this.sceneManager.terrainHeight(entity.mesh.position.x, entity.mesh.position.z);
        entity.mesh.position.y = Math.max(terrainY, lerpedY);
      } else {
        entity.mesh.position.y = this.sceneManager.terrainHeight(entity.mesh.position.x, entity.mesh.position.z);
      }

      // Push FPS player entities out of buildings (server has no obstacle collision)
      if (entity.entityType === 'fps_player') {
        for (const box of this.sceneManager.obstacleBoxes) {
          const overlapX = (0.4 + box.halfSize.x) - Math.abs(entity.mesh.position.x - box.center.x);
          const overlapZ = (0.4 + box.halfSize.z) - Math.abs(entity.mesh.position.z - box.center.z);
          if (overlapX > 0 && overlapZ > 0) {
            if (overlapX < overlapZ) {
              entity.mesh.position.x += entity.mesh.position.x > box.center.x ? overlapX : -overlapX;
            } else {
              entity.mesh.position.z += entity.mesh.position.z > box.center.z ? overlapZ : -overlapZ;
            }
          }
        }
      }

      // Lerp rotation
      if (entity.entityType === 'jeep') {
        // Angle-aware lerp for jeep heading (shortest path around the circle)
        let diff = interp.nextRot.y - interp.prevRot.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        entity.rotation.y = interp.prevRot.y + diff * t;
        entity.mesh.rotation.y = entity.rotation.y;

        // Tilt jeep to match terrain slope (or level out when airborne)
        const hx = entity.mesh.position.x;
        const hz = entity.mesh.position.z;
        const terrainYHere = this.sceneManager.terrainHeight(hx, hz);
        const airborne = entity.mesh.position.y > terrainYHere + 0.1;
        let targetPitch = 0;
        let targetRoll = 0;
        if (!airborne) {
          const sampleDist = 2.0;
          const heading = entity.mesh.rotation.y;
          const cosH = Math.cos(heading);
          const sinH = Math.sin(heading);
          const hFront = this.sceneManager.terrainHeight(hx - sinH * sampleDist, hz - cosH * sampleDist);
          const hBack = this.sceneManager.terrainHeight(hx + sinH * sampleDist, hz + cosH * sampleDist);
          const hLeft = this.sceneManager.terrainHeight(hx - cosH * sampleDist, hz + sinH * sampleDist);
          const hRight = this.sceneManager.terrainHeight(hx + cosH * sampleDist, hz - sinH * sampleDist);
          targetPitch = Math.atan2(hFront - hBack, sampleDist * 2);
          targetRoll = Math.atan2(hRight - hLeft, sampleDist * 2);
        }
        // Smooth toward target to avoid jitter (slower correction when airborne for floaty feel)
        const prevPitch = entity.mesh.rotation.x || 0;
        const prevRoll = entity.mesh.rotation.z || 0;
        const smoothing = 1 - Math.exp(-(airborne ? 3 : 10) * dt);
        entity.mesh.rotation.x = prevPitch + (targetPitch - prevPitch) * smoothing;
        entity.mesh.rotation.z = prevRoll + (targetRoll - prevRoll) * smoothing;
      } else if (entity.entityType === 'helicopter') {
        // Angle-aware heading lerp
        let diff = interp.nextRot.y - interp.prevRot.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        entity.rotation.y = interp.prevRot.y + diff * t;
        entity.mesh.rotation.y = entity.rotation.y;
        // No terrain tilt for helicopter — stays level
        entity.mesh.rotation.x = 0;
        entity.mesh.rotation.z = 0;

        // Spin rotors
        const mainRotor = entity.mesh.getObjectByName('mainRotor');
        if (mainRotor) mainRotor.rotation.y += dt * 15;
        const tailRotor = entity.mesh.getObjectByName('tailRotor');
        if (tailRotor) tailRotor.rotation.x += dt * 25;
      } else {
        entity.rotation.y = interp.prevRot.y + (interp.nextRot.y - interp.prevRot.y) * t;
      }
      entity.rotation.z = interp.nextRot.z; // firing flag, don't lerp
      entity.rotation.x = interp.nextRot.x; // turret aim angle (jeep) or miss flag (tower)

      // Leg walk animation for mobile units with named leg groups
      const LEGGED_TYPES = ['worker', 'fighter', 'fps_player', 'foot_soldier', 'archer'];
      if (LEGGED_TYPES.includes(entity.entityType)) {
        const dx = interp.nextPos.x - interp.prevPos.x;
        const dz = interp.nextPos.z - interp.prevPos.z;
        const speed = Math.sqrt(dx * dx + dz * dz) / this.snapshotInterval;
        const phase = this.walkPhase.get(id) ?? 0;
        if (speed > 0.5) {
          // Advance phase proportional to speed
          const newPhase = phase + dt * speed * 0.8;
          this.walkPhase.set(id, newPhase);
          const swing = Math.sin(newPhase) * 0.5; // ±0.5 radians
          const mergedMesh = entity.mesh;
          const innerGroup = mergedMesh.children?.[0];
          if (innerGroup) {
            const legL = innerGroup.getObjectByName('leg_l');
            const legR = innerGroup.getObjectByName('leg_r');
            if (legL) legL.rotation.x = swing;
            if (legR) legR.rotation.x = -swing;
          }
        } else {
          // Standing still — reset legs
          this.walkPhase.set(id, 0);
          const innerGroup = entity.mesh.children?.[0];
          if (innerGroup) {
            const legL = innerGroup.getObjectByName('leg_l');
            const legR = innerGroup.getObjectByName('leg_r');
            if (legL) legL.rotation.x = 0;
            if (legR) legR.rotation.x = 0;
          }
        }
      }
    }

    // Update name label positions and visibility (with line-of-sight check in FPS mode)
    for (const [id, label] of this.nameLabels) {
      const entity = this.knownEntities.get(id);
      if (!entity) continue;
      const hidden = !entity.mesh.visible || (id === this.localFPSEntityId && this.isFPSMode);
      label.visible = !hidden;
      if (label.visible) {
        label.position.set(entity.mesh.position.x, entity.mesh.position.y + 3.5, entity.mesh.position.z);

        // In FPS mode, hide name if obstacle blocks line of sight from camera
        if (this.isFPSMode && id !== this.localFPSEntityId) {
          const cam = this.sceneManager.camera;
          const targetPos = entity.mesh.position.clone().setY(entity.mesh.position.y + 1.5);
          const dir = targetPos.clone().sub(cam.position).normalize();
          const dist = cam.position.distanceTo(targetPos);

          this.losRaycaster.set(cam.position, dir);
          this.losRaycaster.far = dist;
          // Check obstacles + building entity meshes for LOS blocking
          const blockers: THREE.Object3D[] = [...this.sceneManager.obstacleMeshes];
          for (const e of this.sceneManager.entities) {
            if (!INTERPOLATED_TYPES.has(e.entityType) && e.entityType !== 'resource_node') {
              blockers.push(e.mesh); // buildings block LOS
            }
          }
          const hits = this.losRaycaster.intersectObjects(blockers, true);
          if (hits.length > 0 && hits[0].distance < dist - 1) {
            label.visible = false;
          }
        }
      }
    }
  }

  applySnapshot(snapshot: SnapshotMsg): void {
    // Track timing for interpolation
    if (this.lastSnapshot) {
      // Use actual time between snapshots for smoother lerp
      this.snapshotInterval = Math.max(0.02, this.snapshotTime);
    }
    this.snapshotTime = 0;

    this.lastSnapshot = snapshot;
    const scene = this.sceneManager.scene;
    const serverIds = new Set<string>();

    for (const se of snapshot.entities) {
      serverIds.add(se.id);

      let existing = this.knownEntities.get(se.id);

      if (!existing) {
        // Create new entity
        const creator = MESH_CREATORS[se.entityType];
        let mesh: THREE.Mesh;

        if (creator) {
          mesh = creator(se.teamId);
        } else if (se.entityType === 'resource_node') {
          mesh = createResourceNode();
        } else {
          // Fallback: small box
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshLambertMaterial({ color: 0xff00ff }),
          );
        }

        mesh.position.set(se.position.x, this.sceneManager.terrainHeight(se.position.x, se.position.z), se.position.z);
        if (se.entityType === 'jeep' || se.entityType === 'helicopter') {
          mesh.rotation.order = 'YXZ';
        }
        scene.add(mesh);

        const entity = this.sceneManager.registerEntity(
          mesh, this.getEntityName(se), se.entityType as any,
          se.teamId, se.hp, se.maxHp, se.status,
        );
        const idx = this.sceneManager.entities.indexOf(entity);
        if (idx >= 0) {
          this.sceneManager.entities[idx] = { ...entity, id: se.id };
          this.knownEntities.set(se.id, this.sceneManager.entities[idx]);
        }

        // Add collision box for buildings
        const col = BUILDING_COLLISION[se.entityType];
        if (col && !this.obstacleIds.has(se.id)) {
          this.sceneManager.obstacleBoxes.push({
            center: new THREE.Vector3(se.position.x, col.cy, se.position.z),
            halfSize: new THREE.Vector3(col.hx, col.hy, col.hz),
          });
          this.obstacleIds.add(se.id);
        }

        // Track initial active status
        if (se.status === 'active') this.prevActiveIds.add(se.id);

        // Sound for new friendly grunt
        if (se.entityType === 'worker' && se.teamId === this.localTeamId) {
          SoundManager.instance().workerSpawned(se.position.x, se.position.z);
        }

        // Notify about new entities (vehicles)
        this.onEntityCreated?.(se.entityType, se.teamId);

        // Init interpolation for mobile units
        if (INTERPOLATED_TYPES.has(se.entityType)) {
          const pos = new THREE.Vector3(se.position.x, se.position.y, se.position.z);
          this.interpStates.set(se.id, {
            prevPos: pos.clone(), nextPos: pos.clone(),
            prevRot: { ...se.rotation }, nextRot: { ...se.rotation },
          });
        }

        // Create name label for fps_player entities
        if (se.entityType === 'fps_player' && se.playerName) {
          const label = this.createNameLabel(se.playerName, se.teamId);
          label.position.set(se.position.x, 3.5, se.position.z);
          scene.add(label);
          this.nameLabels.set(se.id, label);
        }
      } else {
        // Update existing entity
        const wasDead = existing.hp <= 0;
        existing.hp = se.hp;
        existing.maxHp = se.maxHp;
        existing.status = se.status;
        existing.constructionProgress = se.constructionProgress;

        // Detect HQ upgrade
        if (se.entityType === 'main_base' && se.level && se.level > (existing.level ?? 1)) {
          existing.level = se.level;
          this.onBaseUpgrade?.(se.teamId, se.level);
        }

        // Detect building/entity destruction (hp went from >0 to <=0)
        if (se.hp <= 0 && !wasDead) {
          this.onEntityDestroyed?.(se.entityType, se.teamId, se.id);
        }

        // Detect FPS player death — trigger tip-over animation on their mesh
        if (se.entityType === 'fps_player' && se.hp <= 0 && !this.deadFPSPlayers.has(se.id)) {
          this.deadFPSPlayers.add(se.id);
          this.animateFPSPlayerDeath(existing.mesh);
        }
        // Detect respawn — reset death state
        if (se.entityType === 'fps_player' && se.hp > 0 && this.deadFPSPlayers.has(se.id)) {
          this.deadFPSPlayers.delete(se.id);
          existing.mesh.rotation.z = 0; // reset tip-over rotation
        }

        // Toggle alive/dead eyes based on HP
        if (se.hp <= 0 !== wasDead) {
          this.setEyeState(existing.mesh, se.hp <= 0);
        }

        // Update jeep damage visuals
        if (se.entityType === 'jeep') {
          this.updateJeepDamageVisuals(se.id, existing.mesh, se.hp, se.maxHp);
        }

        // Create name label if it doesn't exist yet (name may arrive in a later snapshot)
        if (se.entityType === 'fps_player' && se.playerName && !this.nameLabels.has(se.id)) {
          const label = this.createNameLabel(se.playerName, se.teamId);
          label.position.set(se.position.x, 3.5, se.position.z);
          this.sceneManager.scene.add(label);
          this.nameLabels.set(se.id, label);
        }

        // Set up interpolation for mobile units
        if (INTERPOLATED_TYPES.has(se.entityType)) {
          const prevInterp = this.interpStates.get(se.id);
          const prevPos = prevInterp
            ? prevInterp.nextPos.clone()
            : existing.mesh.position.clone();
          const prevRot = prevInterp
            ? { ...prevInterp.nextRot }
            : { ...existing.rotation };

          this.interpStates.set(se.id, {
            prevPos,
            nextPos: new THREE.Vector3(se.position.x, se.position.y, se.position.z),
            prevRot,
            nextRot: { ...se.rotation },
          });
        } else {
          // Static entities: snap immediately, adjust for terrain
          const ty = this.sceneManager.terrainHeight(se.position.x, se.position.z);
          existing.mesh.position.set(se.position.x, ty, se.position.z);
          existing.rotation = { ...se.rotation };
        }

        // Update opacity for constructing buildings
        if (se.status === 'constructing') {
          this.setMeshOpacity(existing.mesh, 0.3 + 0.7 * se.constructionProgress);
        } else if (se.status === 'active') {
          this.setMeshOpacity(existing.mesh, 1);

          // Detect building just completed (was not active before, now is)
          if (!this.prevActiveIds.has(se.id)) {
            this.prevActiveIds.add(se.id);
            this.onBuildingComplete?.(se.entityType, se.teamId);
            if (se.teamId === this.localTeamId) SoundManager.instance().buildingComplete(se.position.x, se.position.z);

            // Add collision box if we haven't already
            const col = BUILDING_COLLISION[se.entityType];
            if (col && !this.obstacleIds.has(se.id)) {
              this.sceneManager.obstacleBoxes.push({
                center: new THREE.Vector3(se.position.x, col.cy, se.position.z),
                halfSize: new THREE.Vector3(col.hx, col.hy, col.hz),
              });
              this.obstacleIds.add(se.id);
            }
          }
        }
      }

      // Hide local FPS entity when in first-person view
      const entity = this.knownEntities.get(se.id);
      if (entity && se.id === this.localFPSEntityId) {
        entity.mesh.visible = !this.isFPSMode;
      }

      // Hero visuals for friendly fps_players (icon, aura, glow)
      if (se.entityType === 'fps_player' && se.teamId === this.localTeamId && entity) {
        this.updateHeroVisuals(se, entity.mesh);
      } else if (se.entityType === 'fps_player' && se.teamId !== this.localTeamId) {
        // Remove enemy hero visuals (icon/aura/glow — not shield dome)
        this.removeHeroVisuals(se.id);
      }

      // Tank shield dome — visible to ALL players (including enemies)
      if (se.entityType === 'fps_player' && entity) {
        this.updateShieldDome(se, entity.mesh);
      }
    }

    // Remove entities that are no longer in the snapshot
    const DYING_TYPES = new Set(['worker', 'fighter', 'fps_player', 'foot_soldier', 'archer']);
    const RAGDOLL_TYPES = new Set(['worker', 'fighter', 'foot_soldier', 'archer', 'fps_player']);
    for (const [id, entity] of this.knownEntities) {
      if (!serverIds.has(id)) {
        // Check if a nearby fast jeep caused this death (for ragdoll)
        let jeepHit: { vx: number; vz: number; speed: number } | null = null;
        if (RAGDOLL_TYPES.has(entity.entityType)) {
          for (const [, jv] of this.jeepVelocities) {
            if (jv.speed > 20) {
              const dx = entity.mesh.position.x - jv.px;
              const dz = entity.mesh.position.z - jv.pz;
              // Check units in a wide area ahead of the jeep (server applies large knockback)
              const dist = Math.sqrt(dx * dx + dz * dz);
              if (dist < jv.speed * 1.5) {
                jeepHit = jv;
                break;
              }
            }
          }
        }

        if (entity.entityType === 'jeep' || entity.entityType === 'helicopter') {
          // Vehicle destroyed — dramatic explosion
          this.explodeJeep(entity.mesh);
          this.cleanupJeepDamageState(id);
        } else if (jeepHit) {
          // Ragdoll: launch unit in the jeep's direction
          this.launchJeepRagdoll(entity.mesh, jeepHit);
        } else if (DYING_TYPES.has(entity.entityType)) {
          // Play death animation instead of instant removal
          this.sceneManager.addDying(entity.mesh);
        } else {
          scene.remove(entity.mesh);
          entity.mesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).geometry?.dispose();
            }
          });
        }
        // Remove from sceneManager.entities, interpolation, and name labels
        const idx = this.sceneManager.entities.findIndex(e => e.id === id);
        if (idx >= 0) this.sceneManager.entities.splice(idx, 1);
        this.interpStates.delete(id);
        this.jeepAir.delete(id);
        this.jeepVelocities.delete(id);
        this.knownEntities.delete(id);
        const label = this.nameLabels.get(id);
        if (label) {
          scene.remove(label);
          (label.material as THREE.SpriteMaterial).map?.dispose();
          (label.material as THREE.SpriteMaterial).dispose();
          this.nameLabels.delete(id);
        }
        this.removeHeroVisuals(id);
        this.removeShieldDome(id);
      }
    }
  }

  getLastSnapshot(): SnapshotMsg | null {
    return this.lastSnapshot;
  }

  /** Toggle between alive eyes and X-eyes on a unit mesh. */
  private setEyeState(mesh: THREE.Object3D, dead: boolean): void {
    const innerGroup = mesh.children?.[0];
    if (!innerGroup) return;
    const eyesAlive = innerGroup.getObjectByName('eyes_alive');
    const eyesDead = innerGroup.getObjectByName('eyes_dead');
    if (eyesAlive) eyesAlive.visible = !dead;
    if (eyesDead) eyesDead.visible = dead;
  }

  /** Animate an FPS player mesh tipping over on death */
  private animateFPSPlayerDeath(mesh: THREE.Object3D): void {
    const startTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed < 1) {
        mesh.rotation.z = (elapsed / 1) * (Math.PI / 2);
        requestAnimationFrame(animate);
      } else {
        mesh.rotation.z = Math.PI / 2;
      }
    };
    requestAnimationFrame(animate);
  }

  private createNameLabel(name: string, teamId: TeamId): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Black outline for readability
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText(name, 128, 32);
    // Team-colored fill
    ctx.fillStyle = teamId === 1 ? '#66aaff' : '#ff6688';
    ctx.fillText(name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 1, 1);
    sprite.renderOrder = 998;
    return sprite;
  }

  private getEntityName(se: SnapshotEntity): string {
    const teamLabel = se.teamId === 1 ? 'Blue' : 'Red';
    switch (se.entityType) {
      case 'main_base': return `${teamLabel} Headquarters`;
      case 'tower': return `${teamLabel} Tower`;
      case 'barracks': return 'Barracks';
      case 'armory': return 'Armory';
      case 'player_tower': return 'Tower';
      case 'resource_node': return 'Crystal Node';
      case 'worker': return 'Worker';
      case 'fighter': return `${teamLabel} Fighter`;
      case 'fps_player': return `${teamLabel} FPS Player`;
      case 'foot_soldier': return 'Foot Soldier';
      case 'archer': return 'Archer';
      case 'sniper_nest': return 'Sniper Nest';
      case 'farm': return 'Farm';
      case 'turret': return 'Turret';
      case 'garage': return 'Garage';
      case 'jeep': return 'Jeep';
      case 'helicopter': return 'Helicopter';
      default: return se.entityType;
    }
  }

  private setMeshOpacity(mesh: THREE.Object3D, opacity: number): void {
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

  // ===================== Jeep Damage Visuals =====================

  private updateJeepDamageVisuals(id: string, mesh: THREE.Object3D, hp: number, maxHp: number): void {
    const dmgPct = 1 - hp / maxHp; // 0 = full health, 1 = destroyed
    let level = 0;
    if (dmgPct >= 0.75) level = 3;
    else if (dmgPct >= 0.5) level = 2;
    else if (dmgPct >= 0.2) level = 1;

    let state = this.jeepDamageState.get(id);
    if (!state) {
      state = { smokeParticles: [], flameParticles: [], wheelRemoved: false, lastDmgLevel: 0 };
      this.jeepDamageState.set(id, state);
    }

    if (level === state.lastDmgLevel) return;
    state.lastDmgLevel = level;

    // Remove old particles
    for (const p of state.smokeParticles) { mesh.remove(p); (p.material as THREE.Material).dispose(); }
    for (const p of state.flameParticles) { mesh.remove(p); (p.material as THREE.Material).dispose(); }
    state.smokeParticles = [];
    state.flameParticles = [];

    // Hood position (local to jeep group)
    const hoodX = 0, hoodY = 1.4, hoodZ = -1.2;

    if (level >= 1) {
      // Small smoke wisps
      for (let i = 0; i < 3; i++) {
        const smoke = this.createSmokeParticle();
        smoke.position.set(hoodX + (Math.random() - 0.5) * 0.8, hoodY + Math.random() * 0.3, hoodZ + (Math.random() - 0.5) * 0.5);
        mesh.add(smoke);
        state.smokeParticles.push(smoke);
      }
    }

    if (level >= 2) {
      // More smoke + small flames
      for (let i = 0; i < 4; i++) {
        const smoke = this.createSmokeParticle();
        smoke.position.set(hoodX + (Math.random() - 0.5) * 1.2, hoodY + Math.random() * 0.5, hoodZ + (Math.random() - 0.5) * 0.8);
        smoke.scale.setScalar(1.3);
        mesh.add(smoke);
        state.smokeParticles.push(smoke);
      }
      for (let i = 0; i < 2; i++) {
        const flame = this.createFlameParticle();
        flame.position.set(hoodX + (Math.random() - 0.5) * 0.6, hoodY + 0.2 + Math.random() * 0.3, hoodZ + (Math.random() - 0.5) * 0.4);
        mesh.add(flame);
        state.flameParticles.push(flame);
      }
    }

    if (level >= 3) {
      // Even more flames
      for (let i = 0; i < 4; i++) {
        const flame = this.createFlameParticle();
        flame.position.set(hoodX + (Math.random() - 0.5) * 1.0, hoodY + Math.random() * 0.5, hoodZ + (Math.random() - 0.5) * 0.6);
        flame.scale.setScalar(1.2);
        mesh.add(flame);
        state.flameParticles.push(flame);
      }

      // Remove a wheel (front-left)
      if (!state.wheelRemoved) {
        state.wheelRemoved = true;
        mesh.traverse((child) => {
          // Find the front-left wheel by position (approximately -1.4, 0.5, -1.3)
          if ((child as THREE.Mesh).isMesh && Math.abs(child.position.x - (-1.4)) < 0.3
              && Math.abs(child.position.z - (-1.3)) < 0.3 && Math.abs(child.position.y - 0.5) < 0.3) {
            child.visible = false;
          }
        });
      }
    }
  }

  private createSmokeParticle(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(0.25, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x555555, transparent: true, opacity: 0.5, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Animate: bob upward slowly
    const startY = mesh.position.y;
    const animate = () => {
      mesh.position.y += 0.005;
      mat.opacity = 0.3 + Math.sin(Date.now() * 0.003 + Math.random() * 10) * 0.2;
      if (mesh.parent) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    return mesh;
  }

  private createFlameParticle(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(0.2, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6611, transparent: true, opacity: 0.8, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Animate: flicker
    const animate = () => {
      const t = Date.now() * 0.005;
      mat.color.setHex(Math.random() > 0.5 ? 0xffcc22 : 0xff6611);
      mat.opacity = 0.5 + Math.sin(t + Math.random() * 5) * 0.3;
      mesh.scale.setScalar(0.8 + Math.sin(t * 1.3) * 0.3);
      if (mesh.parent) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    return mesh;
  }

  private explodeJeep(mesh: THREE.Object3D): void {
    const scene = this.sceneManager.scene;
    const pos = mesh.position.clone();

    // Remove the jeep mesh
    scene.remove(mesh);

    // Explosion flash — expanding orange sphere
    const explosionGeo = new THREE.SphereGeometry(1, 8, 8);
    const explosionMat = new THREE.MeshBasicMaterial({
      color: 0xff8800, transparent: true, opacity: 0.9, depthWrite: false,
    });
    const explosion = new THREE.Mesh(explosionGeo, explosionMat);
    explosion.position.copy(pos);
    explosion.position.y += 1;
    scene.add(explosion);

    // Debris particles
    const debris: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; spin: number }[] = [];
    for (let i = 0; i < 15; i++) {
      const size = 0.2 + Math.random() * 0.5;
      const dGeo = new THREE.BoxGeometry(size, size, size);
      const dMat = new THREE.MeshLambertMaterial({
        color: Math.random() > 0.5 ? 0x444444 : 0x5a6a3a,
        transparent: true, opacity: 1,
      });
      const d = new THREE.Mesh(dGeo, dMat);
      d.position.copy(pos);
      d.position.y += 0.5 + Math.random();
      scene.add(d);
      const angle = Math.random() * Math.PI * 2;
      const hSpeed = 3 + Math.random() * 8;
      debris.push({
        mesh: d,
        vx: Math.cos(angle) * hSpeed,
        vy: 5 + Math.random() * 10,
        vz: Math.sin(angle) * hSpeed,
        spin: (Math.random() - 0.5) * 15,
      });
    }

    let t = 0;
    const G = 20;
    const animate = () => {
      t += 0.016;

      // Expand and fade explosion sphere
      const scale = 1 + t * 12;
      explosion.scale.setScalar(scale);
      explosionMat.opacity = Math.max(0, 0.9 - t * 1.2);

      // Debris physics
      for (const d of debris) {
        d.vy -= G * 0.016;
        d.mesh.position.x += d.vx * 0.016;
        d.mesh.position.y += d.vy * 0.016;
        d.mesh.position.z += d.vz * 0.016;
        d.mesh.rotation.x += d.spin * 0.016;
        d.mesh.rotation.z += d.spin * 0.7 * 0.016;
        if (d.mesh.position.y < 0) {
          d.mesh.position.y = 0;
          d.vy *= -0.3; // bounce
          d.vx *= 0.5;
          d.vz *= 0.5;
        }
        // Fade after 1.5s
        if (t > 1.5) {
          const fade = Math.max(0, 1 - (t - 1.5) / 2);
          (d.mesh.material as THREE.MeshLambertMaterial).opacity = fade;
          (d.mesh.material as THREE.MeshLambertMaterial).transparent = true;
        }
      }

      if (t < 4) {
        requestAnimationFrame(animate);
      } else {
        // Cleanup
        scene.remove(explosion);
        explosionGeo.dispose();
        explosionMat.dispose();
        for (const d of debris) {
          scene.remove(d.mesh);
          d.mesh.geometry.dispose();
          (d.mesh.material as THREE.Material).dispose();
        }
      }
    };
    requestAnimationFrame(animate);
  }

  private cleanupJeepDamageState(id: string): void {
    const state = this.jeepDamageState.get(id);
    if (state) {
      for (const p of state.smokeParticles) (p.material as THREE.Material).dispose();
      for (const p of state.flameParticles) (p.material as THREE.Material).dispose();
      this.jeepDamageState.delete(id);
    }
  }

  private launchJeepRagdoll(mesh: THREE.Object3D, jeep: { vx: number; vz: number; speed: number }): void {
    const scene = this.sceneManager.scene;
    // Normalize jeep direction
    const dirX = jeep.vx / jeep.speed;
    const dirZ = jeep.vz / jeep.speed;
    // Launch: high and far in the jeep's direction with some randomness
    const launchPower = Math.min(jeep.speed / 35, 2.0); // normalized, capped at 2x
    const G = 20;
    const peakHeight = (8 + 12 * launchPower) * 0.34; // low arc — 34% of rocket height
    const vy = Math.sqrt(2 * G * peakHeight);
    const horizSpeed = (6 + 10 * launchPower) * 1.66; // 66% more horizontal distance
    // Slight random offset so units don't all fly the same way
    const offsetAngle = (Math.random() - 0.5) * 0.6;
    const cos = Math.cos(offsetAngle);
    const sin = Math.sin(offsetAngle);
    const vx = (dirX * cos - dirZ * sin) * horizSpeed;
    const vz = (dirX * sin + dirZ * cos) * horizSpeed;
    const startX = mesh.position.x;
    const startY = mesh.position.y;
    const startZ = mesh.position.z;
    // Random spin per axis: 360°/4s (slow) to 360°/0.33s (fast), log-distributed
    const randomSpin = () => {
      const minRate = Math.PI * 2 / 4;      // ~1.57 rad/s
      const maxRate = Math.PI * 2 / 0.66;   // ~9.5 rad/s
      const rate = minRate * Math.pow(maxRate / minRate, Math.random());
      return (Math.random() < 0.5 ? -1 : 1) * rate;
    };
    const spinX = randomSpin();
    const spinY = randomSpin();
    const spinZ = randomSpin();
    let t = 0;

    const ragdoll = () => {
      t += 0.016;
      mesh.position.x = startX + vx * t;
      mesh.position.y = Math.max(0, startY + vy * t - 0.5 * G * t * t);
      mesh.position.z = startZ + vz * t;
      mesh.rotation.x += spinX * 0.016;
      mesh.rotation.y += spinY * 0.016;
      mesh.rotation.z += spinZ * 0.016;

      // Landed
      if (t > 0.3 && mesh.position.y <= 0) {
        mesh.position.y = 0;
        // Settle to lying flat
        let settleT = 0;
        const targetRotZ = Math.PI / 2;
        const settle = () => {
          settleT += 0.016;
          const blend = Math.min(1, settleT / 0.3);
          mesh.rotation.z += (targetRotZ - mesh.rotation.z) * blend * 0.15;
          mesh.rotation.x *= 1 - blend * 0.15;
          mesh.rotation.y *= 1 - blend * 0.1;
          if (settleT < 0.4) {
            requestAnimationFrame(settle);
          } else {
            mesh.rotation.z = targetRotZ;
            mesh.rotation.x = 0;
            // Fade out
            let fadeT = 0;
            const fadeOut = () => {
              fadeT += 0.016;
              const opacity = Math.max(0, 1 - fadeT / 2);
              this.setMeshOpacity(mesh, opacity);
              if (fadeT < 2) {
                requestAnimationFrame(fadeOut);
              } else {
                scene.remove(mesh);
              }
            };
            requestAnimationFrame(fadeOut);
          }
        };
        requestAnimationFrame(settle);
        return;
      }
      if (t < 8) requestAnimationFrame(ragdoll);
    };
    requestAnimationFrame(ragdoll);
  }

  // ===================== Hero Visuals =====================

  private updateHeroVisuals(se: SnapshotEntity, mesh: THREE.Object3D): void {
    const scene = this.sceneManager.scene;

    // Hero icon
    if (se.heroType && se.hp > 0) {
      if (!this.heroIcons.has(se.id)) {
        const iconText = se.heroType === 'tank' ? 'TANK' : se.heroType === 'healer' ? 'HEAL' : 'MECH';
        const iconColor = se.heroType === 'tank' ? '#4488ff' : '#44cc44';
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 32;
        const ctx = canvas.getContext('2d')!;
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.strokeText(iconText, 64, 16);
        ctx.fillStyle = iconColor;
        ctx.fillText(iconText, 64, 16);
        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(2, 0.5, 1);
        sprite.renderOrder = 999;
        scene.add(sprite);
        this.heroIcons.set(se.id, sprite);
      }
      const icon = this.heroIcons.get(se.id)!;
      icon.position.set(mesh.position.x, mesh.position.y + 4.5, mesh.position.z);
      icon.visible = !(se.id === this.localFPSEntityId && this.isFPSMode);
    } else {
      this.removeHeroIcon(se.id);
    }

    // Aura circle (healer/mechanic active)
    if (se.heroAbilityActive && (se.heroType === 'healer' || se.heroType === 'mechanic') && se.hp > 0) {
      if (!this.auraCircles.has(se.id)) {
        const geo = new THREE.RingGeometry(6.5, 7, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0x44cc44, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = -Math.PI / 2;
        scene.add(ring);
        this.auraCircles.set(se.id, ring);
      }
      const ring = this.auraCircles.get(se.id)!;
      ring.position.set(mesh.position.x, 0.1, mesh.position.z);
    } else {
      this.removeAuraCircle(se.id);
    }

    // Ability glow ring
    if (se.heroAbilityActive && se.hp > 0) {
      if (!this.heroGlows.has(se.id)) {
        const glowColor = se.heroType === 'tank' ? 0x4488ff : 0x44cc44;
        const geo = new THREE.RingGeometry(0.8, 1.2, 16);
        const mat = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
        const glow = new THREE.Mesh(geo, mat);
        glow.rotation.x = -Math.PI / 2;
        scene.add(glow);
        this.heroGlows.set(se.id, glow);
      }
      const glow = this.heroGlows.get(se.id)!;
      glow.position.set(mesh.position.x, 0.15, mesh.position.z);
      // Pulse
      const pulse = 0.4 + Math.sin(Date.now() * 0.005) * 0.2;
      (glow.material as THREE.MeshBasicMaterial).opacity = pulse;
    } else {
      this.removeHeroGlow(se.id);
    }
  }

  private updateShieldDome(se: SnapshotEntity, mesh: THREE.Object3D): void {
    const scene = this.sceneManager.scene;
    const isShieldActive = se.heroAbilityActive && se.heroType === 'tank' && se.hp > 0;
    // Don't show dome on local FPS entity in first-person (they have their own in the main scene)
    const isLocalFPS = se.id === this.localFPSEntityId && this.isFPSMode;

    if (isShieldActive && !isLocalFPS) {
      if (!this.shieldDomes.has(se.id)) {
        const PLAYER_H = 1.5;
        const radius = PLAYER_H * 2.5;
        const geo = new THREE.SphereGeometry(radius, 32, 24);
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: {
            uTime: { value: 0 },
            uCenter: { value: new THREE.Vector3() },
            uRadius: { value: radius },
          },
          vertexShader: `
            varying vec3 vWorldPos;
            varying vec3 vNormal;
            void main() {
              vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform vec3 uCenter;
            uniform float uRadius;
            varying vec3 vWorldPos;
            varying vec3 vNormal;
            void main() {
              float h = clamp((vWorldPos.y - uCenter.y + uRadius) / (uRadius * 2.0), 0.0, 1.0);
              vec3 white = vec3(1.0, 1.0, 1.0);
              vec3 purple = vec3(0.6, 0.2, 0.9);
              vec3 col = mix(white, purple, h);
              float shimmer = sin(vWorldPos.x * 3.0 + uTime * 2.0)
                            * cos(vWorldPos.z * 4.0 + uTime * 1.5)
                            * sin(vWorldPos.y * 2.5 + uTime * 3.0);
              float alpha = 0.14 + shimmer * 0.07;
              float fresnel = pow(1.0 - abs(dot(vNormal, normalize(cameraPosition - vWorldPos))), 2.0);
              alpha += fresnel * 0.11;
              gl_FragColor = vec4(col, clamp(alpha, 0.05, 0.29));
            }
          `,
        });
        const dome = new THREE.Mesh(geo, mat);
        dome.renderOrder = 900;
        scene.add(dome);
        this.shieldDomes.set(se.id, dome);
      }
      const dome = this.shieldDomes.get(se.id)!;
      dome.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      const mat = dome.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = performance.now() * 0.001;
      mat.uniforms.uCenter.value.set(mesh.position.x, mesh.position.y, mesh.position.z);
    } else {
      this.removeShieldDome(se.id);
    }
  }

  private removeShieldDome(id: string): void {
    const dome = this.shieldDomes.get(id);
    if (dome) {
      this.sceneManager.scene.remove(dome);
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      this.shieldDomes.delete(id);
    }
  }

  private removeHeroVisuals(id: string): void {
    this.removeHeroIcon(id);
    this.removeAuraCircle(id);
    this.removeHeroGlow(id);
  }

  private removeHeroIcon(id: string): void {
    const icon = this.heroIcons.get(id);
    if (icon) {
      this.sceneManager.scene.remove(icon);
      (icon.material as THREE.SpriteMaterial).map?.dispose();
      (icon.material as THREE.SpriteMaterial).dispose();
      this.heroIcons.delete(id);
    }
  }

  private removeAuraCircle(id: string): void {
    const ring = this.auraCircles.get(id);
    if (ring) {
      this.sceneManager.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      this.auraCircles.delete(id);
    }
  }

  private removeHeroGlow(id: string): void {
    const glow = this.heroGlows.get(id);
    if (glow) {
      this.sceneManager.scene.remove(glow);
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
      this.heroGlows.delete(id);
    }
  }

  destroy(): void {
    for (const [, entity] of this.knownEntities) {
      this.sceneManager.scene.remove(entity.mesh);
    }
    this.knownEntities.clear();
    for (const [, label] of this.nameLabels) {
      this.sceneManager.scene.remove(label);
      (label.material as THREE.SpriteMaterial).map?.dispose();
      (label.material as THREE.SpriteMaterial).dispose();
    }
    this.nameLabels.clear();
    // Clean up hero visuals
    for (const id of [...this.heroIcons.keys()]) this.removeHeroIcon(id);
    for (const id of [...this.auraCircles.keys()]) this.removeAuraCircle(id);
    for (const id of [...this.heroGlows.keys()]) this.removeHeroGlow(id);
    for (const id of [...this.shieldDomes.keys()]) this.removeShieldDome(id);
  }
}
