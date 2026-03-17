import * as THREE from 'three';
import { MAP_WIDTH, MAP_DEPTH } from '@dyarchy/shared';
import type { SceneEntity } from '../renderer/SceneManager.js';

// Vision ranges by entity type
const VISION_RANGES: Record<string, number> = {
  main_base: 20,
  tower: 18,
  player_tower: 16,
  barracks: 12,
  armory: 12,
  grunt: 14,
  fighter: 12,
  fps_player: 16,
};

const DEFAULT_VISION = 10;

// Fog resolution — lower = faster, higher = sharper edges
const FOG_RES_X = 200;
const FOG_RES_Z = 100;

// Fog states per cell
const UNEXPLORED = 0;
const EXPLORED = 1;
const VISIBLE = 2;

export class FogOfWar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private mesh: THREE.Mesh;
  private scene: THREE.Scene;

  // Persistent exploration map (UNEXPLORED / EXPLORED)
  private explored: Uint8Array;

  // Current frame visibility
  private visibility: Uint8Array;

  private teamId: 1 | 2;
  enabled = true;

  constructor(scene: THREE.Scene, teamId: 1 | 2 = 1) {
    this.scene = scene;
    this.teamId = teamId;
    this.explored = new Uint8Array(FOG_RES_X * FOG_RES_Z);
    this.visibility = new Uint8Array(FOG_RES_X * FOG_RES_Z);

    // Create offscreen canvas for fog texture
    this.canvas = document.createElement('canvas');
    this.canvas.width = FOG_RES_X;
    this.canvas.height = FOG_RES_Z;
    this.ctx = this.canvas.getContext('2d')!;

    // Create texture and fog plane
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const geo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_DEPTH);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, 0.5, 0); // slightly above ground
    this.mesh.renderOrder = 500; // render above terrain but below UI pips
    scene.add(this.mesh);
  }

  /** Update fog based on friendly entity positions */
  update(entities: SceneEntity[]): void {
    if (!this.enabled) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Clear current visibility
    this.visibility.fill(UNEXPLORED);

    // Mark visible cells around friendly entities
    for (const entity of entities) {
      if (entity.teamId !== this.teamId) continue;
      if (entity.hp <= 0) continue;
      if (entity.entityType === 'resource_node') continue;

      const range = VISION_RANGES[entity.entityType] ?? DEFAULT_VISION;
      const pos = entity.mesh.position;

      this.revealCircle(pos.x, pos.z, range);
    }

    // Update explored map (once seen, stays explored)
    for (let i = 0; i < this.visibility.length; i++) {
      if (this.visibility[i] === VISIBLE) {
        this.explored[i] = EXPLORED;
      }
    }

    // Render fog to canvas
    this.renderFogTexture();
    this.texture.needsUpdate = true;
  }

  /** Check if a world position is currently visible */
  isVisible(worldX: number, worldZ: number): boolean {
    const { gx, gz } = this.worldToGrid(worldX, worldZ);
    if (gx < 0 || gx >= FOG_RES_X || gz < 0 || gz >= FOG_RES_Z) return false;
    return this.visibility[gz * FOG_RES_X + gx] === VISIBLE;
  }

  /** Check if a world position has been explored */
  isExplored(worldX: number, worldZ: number): boolean {
    const { gx, gz } = this.worldToGrid(worldX, worldZ);
    if (gx < 0 || gx >= FOG_RES_X || gz < 0 || gz >= FOG_RES_Z) return false;
    return this.explored[gz * FOG_RES_X + gx] >= EXPLORED;
  }

  destroy(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  show(): void { this.mesh.visible = true; }
  hide(): void { this.mesh.visible = false; }

  // ===================== Internal =====================

  private worldToGrid(worldX: number, worldZ: number): { gx: number; gz: number } {
    // Map world coords (-MAP_WIDTH/2..MAP_WIDTH/2, -MAP_DEPTH/2..MAP_DEPTH/2) to grid (0..RES)
    const gx = Math.floor(((worldX + MAP_WIDTH / 2) / MAP_WIDTH) * FOG_RES_X);
    const gz = Math.floor(((worldZ + MAP_DEPTH / 2) / MAP_DEPTH) * FOG_RES_Z);
    return { gx, gz };
  }

  private revealCircle(worldX: number, worldZ: number, range: number): void {
    const { gx: cx, gz: cz } = this.worldToGrid(worldX, worldZ);
    // Convert range from world units to grid cells
    const rx = Math.ceil((range / MAP_WIDTH) * FOG_RES_X);
    const rz = Math.ceil((range / MAP_DEPTH) * FOG_RES_Z);

    for (let dz = -rz; dz <= rz; dz++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gx >= FOG_RES_X || gz < 0 || gz >= FOG_RES_Z) continue;

        // Ellipse check (map isn't square)
        const nx = dx / rx;
        const nz = dz / rz;
        if (nx * nx + nz * nz <= 1) {
          this.visibility[gz * FOG_RES_X + gx] = VISIBLE;
        }
      }
    }
  }

  private renderFogTexture(): void {
    const ctx = this.ctx;
    const imgData = ctx.createImageData(FOG_RES_X, FOG_RES_Z);
    const data = imgData.data;

    for (let z = 0; z < FOG_RES_Z; z++) {
      for (let x = 0; x < FOG_RES_X; x++) {
        const i = z * FOG_RES_X + x;
        const px = i * 4;

        if (this.visibility[i] === VISIBLE) {
          // Fully visible — transparent
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 0;
        } else if (this.explored[i] === EXPLORED) {
          // Previously explored — semi-transparent dark
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 140; // ~55% opaque
        } else {
          // Unexplored — nearly opaque dark
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 220; // ~86% opaque
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }
}
