import * as THREE from 'three';
import { MAP_WIDTH, MAP_DEPTH } from '@dyarchy/shared';
import type { SceneEntity } from '../renderer/SceneManager.js';

// Vision ranges by entity type
const VISION_RANGES: Record<string, number> = {
  main_base: 20,
  barracks: 12,
  armory: 12,
  worker: 14,
  fighter: 12,
  fps_player: 16,
  foot_soldier: 14,
  archer: 25,
  farm: 10,
};

// Tower/turret vision = their combat range (25 base, scales with level)
const TOWER_BASE_RANGE = 25;
const TOWER_TYPES = new Set(['tower', 'player_tower', 'turret']);

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

  // Map dimensions (configurable per-map)
  private mapWidth: number;
  private mapDepth: number;
  private fogResX: number;
  private fogResZ: number;

  teamId: 1 | 2;
  enabled = true;
  private terrainHeightFn?: (x: number, z: number) => number;

  constructor(scene: THREE.Scene, teamId: 1 | 2 = 1, mapWidth = MAP_WIDTH, mapDepth = MAP_DEPTH, terrainHeightFn?: (x: number, z: number) => number) {
    this.scene = scene;
    this.teamId = teamId;
    this.terrainHeightFn = terrainHeightFn;
    this.mapWidth = mapWidth;
    this.mapDepth = mapDepth;
    // Scale fog resolution proportionally to map size
    this.fogResX = Math.round(FOG_RES_X * (mapWidth / 240));
    this.fogResZ = Math.round(FOG_RES_Z * (mapDepth / 150));
    this.explored = new Uint8Array(this.fogResX * this.fogResZ);
    this.visibility = new Uint8Array(this.fogResX * this.fogResZ);

    // Create offscreen canvas for fog texture
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.fogResX;
    this.canvas.height = this.fogResZ;
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

    // Use enough segments so the fog plane can follow terrain contours
    const segsX = 60;
    const segsZ = Math.round(60 * (this.mapDepth / this.mapWidth));
    const geo = new THREE.PlaneGeometry(this.mapWidth, this.mapDepth, segsX, segsZ);
    geo.rotateX(-Math.PI / 2);

    // Displace vertices to hug the terrain surface
    if (terrainHeightFn) {
      const posAttr = geo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        posAttr.setY(i, terrainHeightFn(x, z) + 1.5);
      }
      geo.computeVertexNormals();
    }

    this.mesh = new THREE.Mesh(geo, mat);
    if (!terrainHeightFn) {
      // Flat fallback for meadow-style maps
      this.mesh.position.set(0, 5, 0);
    }
    this.mesh.renderOrder = 500;
    scene.add(this.mesh);
  }

  /** Update fog based on friendly entity positions (only entities on the given layer) */
  update(entities: SceneEntity[], localLayerId: number = 0): void {
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
      // Skip entities on different layers (hidden by snapshot renderer)
      if (!entity.mesh.visible) continue;

      let range: number;
      if (TOWER_TYPES.has(entity.entityType)) {
        // Tower vision = combat range, scales with level
        const level = entity.level ?? 1;
        let levelMult = 1;
        if (level >= 3) levelMult = 2.0;
        else if (level >= 2) levelMult = 1.2;
        range = TOWER_BASE_RANGE * levelMult;
      } else {
        range = VISION_RANGES[entity.entityType] ?? DEFAULT_VISION;
      }
      const pos = entity.mesh.position;

      // Elevation bonus: units on higher terrain see further (up to +50%)
      if (this.terrainHeightFn) {
        const elevation = this.terrainHeightFn(pos.x, pos.z);
        const bonus = Math.min(0.5, elevation / 30);
        range *= (1 + bonus);
      }

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
    if (gx < 0 || gx >= this.fogResX || gz < 0 || gz >= this.fogResZ) return false;
    return this.visibility[gz * this.fogResX + gx] === VISIBLE;
  }

  /** Check if a world position has been explored */
  isExplored(worldX: number, worldZ: number): boolean {
    const { gx, gz } = this.worldToGrid(worldX, worldZ);
    if (gx < 0 || gx >= this.fogResX || gz < 0 || gz >= this.fogResZ) return false;
    return this.explored[gz * this.fogResX + gx] >= EXPLORED;
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
    const gx = Math.floor(((worldX + this.mapWidth / 2) / this.mapWidth) * this.fogResX);
    const gz = Math.floor(((worldZ + this.mapDepth / 2) / this.mapDepth) * this.fogResZ);
    return { gx, gz };
  }

  private revealCircle(worldX: number, worldZ: number, range: number): void {
    const { gx: cx, gz: cz } = this.worldToGrid(worldX, worldZ);
    const rx = Math.ceil((range / this.mapWidth) * this.fogResX);
    const rz = Math.ceil((range / this.mapDepth) * this.fogResZ);

    for (let dz = -rz; dz <= rz; dz++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gx >= this.fogResX || gz < 0 || gz >= this.fogResZ) continue;

        const nx = dx / rx;
        const nz = dz / rz;
        if (nx * nx + nz * nz <= 1) {
          this.visibility[gz * this.fogResX + gx] = VISIBLE;
        }
      }
    }
  }

  private renderFogTexture(): void {
    const ctx = this.ctx;
    const imgData = ctx.createImageData(this.fogResX, this.fogResZ);
    const data = imgData.data;

    for (let z = 0; z < this.fogResZ; z++) {
      for (let x = 0; x < this.fogResX; x++) {
        const i = z * this.fogResX + x;
        const px = i * 4;

        if (this.visibility[i] === VISIBLE) {
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 0;
        } else if (this.explored[i] === EXPLORED) {
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 140;
        } else {
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 220;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }
}
