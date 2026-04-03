import type { MapConfig } from './maps.js';
import type { Vec3 } from './types.js';

/**
 * Creates a terrain height function from a MapConfig's terrain parameters.
 * Pure math — no rendering dependencies.
 */
export function createTerrainHeightFn(config: MapConfig): (x: number, z: number) => number {
  const { width, depth, terrain } = config;
  const halfW = width / 2;
  const halfD = depth / 2;

  return (x: number, z: number): number => {
    const nx = (x + halfW) / width;
    const nz = (z + halfD) / depth;

    const cx = Math.abs(x) / halfW;
    const cz = Math.abs(z) / halfD;
    const centerFade = Math.max(0, Math.min(1, (Math.max(cx, cz) - terrain.flatCenterRadius) / terrain.fadeWidth));

    let h = 0;
    for (const layer of terrain.layers) {
      h += Math.sin(nx * Math.PI * layer.freqX + layer.phaseX)
         * Math.cos(nz * Math.PI * layer.freqZ + layer.phaseZ)
         * layer.amp;
    }

    h *= centerFade;
    return Math.max(0, Math.min(terrain.maxElevation, h));
  };
}

/**
 * Pre-computed heightmap grid for fast height lookups and line-of-sight checks.
 * Resolution: 1 world unit per cell. Uses bilinear interpolation for sub-cell queries.
 */
export class HeightmapGrid {
  private grid: Float32Array;
  private resX: number;
  private resZ: number;
  private halfW: number;
  private halfD: number;

  constructor(config: MapConfig) {
    const { width, depth } = config;
    this.halfW = width / 2;
    this.halfD = depth / 2;
    // +1 for fence-post: we need values at both edges
    this.resX = width + 1;
    this.resZ = depth + 1;
    this.grid = new Float32Array(this.resX * this.resZ);

    const heightFn = createTerrainHeightFn(config);

    for (let iz = 0; iz < this.resZ; iz++) {
      const worldZ = iz - this.halfD;
      for (let ix = 0; ix < this.resX; ix++) {
        const worldX = ix - this.halfW;
        this.grid[iz * this.resX + ix] = heightFn(worldX, worldZ);
      }
    }
  }

  /** Get interpolated terrain height at any world position. */
  getHeight(x: number, z: number): number {
    // Convert world coords to grid coords
    const gx = x + this.halfW;
    const gz = z + this.halfD;

    // Clamp to grid bounds
    const cx = Math.max(0, Math.min(this.resX - 1.001, gx));
    const cz = Math.max(0, Math.min(this.resZ - 1.001, gz));

    const ix = Math.floor(cx);
    const iz = Math.floor(cz);
    const fx = cx - ix;
    const fz = cz - iz;

    // Bilinear interpolation
    const h00 = this.grid[iz * this.resX + ix];
    const h10 = this.grid[iz * this.resX + ix + 1];
    const h01 = this.grid[(iz + 1) * this.resX + ix];
    const h11 = this.grid[(iz + 1) * this.resX + ix + 1];

    const h0 = h00 + (h10 - h00) * fx;
    const h1 = h01 + (h11 - h01) * fx;
    return h0 + (h1 - h0) * fz;
  }

  /**
   * Check line-of-sight between two 3D points by raymarching along terrain.
   * Returns true if the ray clears the terrain at every step.
   * @param from - Source position (Y = feet/base height)
   * @param to - Target position (Y = feet/base height)
   * @param eyeHeight - Height above position.y for the ray endpoints
   * @param stepSize - World units between terrain samples (smaller = more precise, slower)
   */
  hasLineOfSight(from: Vec3, to: Vec3, eyeHeight: number = 1.5, stepSize: number = 2): boolean {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);
    if (distXZ < stepSize) return true; // Too close to occlude

    const fromY = from.y + eyeHeight;
    const toY = to.y + eyeHeight;
    const steps = Math.ceil(distXZ / stepSize);
    const invSteps = 1 / steps;

    for (let i = 1; i < steps; i++) {
      const t = i * invSteps;
      const sx = from.x + dx * t;
      const sz = from.z + dz * t;
      const rayY = fromY + (toY - fromY) * t;
      const terrainY = this.getHeight(sx, sz);

      if (terrainY > rayY) return false;
    }
    return true;
  }
}

/** 3D Euclidean distance between two points. */
export function dist3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
