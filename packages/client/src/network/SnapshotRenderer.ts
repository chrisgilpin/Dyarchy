import * as THREE from 'three';
import type { SnapshotMsg, SnapshotEntity } from '@dyarchy/shared';
import type { SceneManager, SceneEntity } from '../renderer/SceneManager.js';
import { SoundManager } from '../audio/SoundManager.js';
import {
  createMainBase, createTower, createBarracks, createArmory,
  createPlayerTower, createResourceNode, createGrunt, createFighter,
  createFPSPlayer,
} from '../renderer/MeshFactory.js';

type TeamId = 1 | 2;

const MESH_CREATORS: Record<string, (teamId: TeamId) => THREE.Mesh> = {
  main_base: (t) => createMainBase(t),
  tower: (t) => createTower(t),
  barracks: (t) => createBarracks(t),
  armory: (t) => createArmory(t),
  player_tower: (t) => createPlayerTower(t),
  grunt: (t) => createGrunt(t),
  fighter: (t) => createFighter(t),
  fps_player: (t) => createFPSPlayer(t),
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
};

// Entity types that should be interpolated (mobile units)
const INTERPOLATED_TYPES = new Set(['grunt', 'fighter', 'fps_player']);

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

  /** ID of the local FPS player entity — hidden when player is in FPS mode */
  localFPSEntityId: string | null = null;
  /** Whether the local player is currently in FPS mode */
  isFPSMode = false;
  /** Called when a building transitions to active */
  onBuildingComplete: ((entityType: string, teamId: TeamId) => void) | null = null;

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

      // Lerp rotation (for tower turrets)
      entity.rotation.y = interp.prevRot.y + (interp.nextRot.y - interp.prevRot.y) * t;
      entity.rotation.z = interp.nextRot.z; // firing flag, don't lerp
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

        mesh.position.set(se.position.x, se.position.y, se.position.z);
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
        if (se.entityType === 'grunt' && se.teamId === 1) {
          SoundManager.instance().gruntSpawned(se.position.x, se.position.z);
        }

        // Init interpolation for mobile units
        if (INTERPOLATED_TYPES.has(se.entityType)) {
          const pos = new THREE.Vector3(se.position.x, se.position.y, se.position.z);
          this.interpStates.set(se.id, {
            prevPos: pos.clone(), nextPos: pos.clone(),
            prevRot: { ...se.rotation }, nextRot: { ...se.rotation },
          });
        }
      } else {
        // Update existing entity
        existing.hp = se.hp;
        existing.maxHp = se.maxHp;
        existing.status = se.status;
        existing.constructionProgress = se.constructionProgress;

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
          // Static entities: snap immediately
          existing.mesh.position.set(se.position.x, se.position.y, se.position.z);
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
            if (se.teamId === 1) SoundManager.instance().buildingComplete(se.position.x, se.position.z);

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
    }

    // Remove entities that are no longer in the snapshot
    for (const [id, entity] of this.knownEntities) {
      if (!serverIds.has(id)) {
        scene.remove(entity.mesh);
        entity.mesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).geometry?.dispose();
          }
        });
        // Remove from sceneManager.entities and interpolation
        const idx = this.sceneManager.entities.findIndex(e => e.id === id);
        if (idx >= 0) this.sceneManager.entities.splice(idx, 1);
        this.interpStates.delete(id);
        this.knownEntities.delete(id);
      }
    }
  }

  getLastSnapshot(): SnapshotMsg | null {
    return this.lastSnapshot;
  }

  private getEntityName(se: SnapshotEntity): string {
    const teamLabel = se.teamId === 1 ? 'Blue' : 'Red';
    switch (se.entityType) {
      case 'main_base': return `${teamLabel} Main Base`;
      case 'tower': return `${teamLabel} Tower`;
      case 'barracks': return 'Barracks';
      case 'armory': return 'Armory';
      case 'player_tower': return 'Tower';
      case 'resource_node': return 'Crystal Node';
      case 'grunt': return 'Grunt';
      case 'fighter': return `${teamLabel} Fighter`;
      case 'fps_player': return `${teamLabel} FPS Player`;
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

  destroy(): void {
    for (const [, entity] of this.knownEntities) {
      this.sceneManager.scene.remove(entity.mesh);
    }
    this.knownEntities.clear();
  }
}
