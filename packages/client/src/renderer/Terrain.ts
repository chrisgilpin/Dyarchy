import { MAP_WIDTH, MAP_DEPTH } from '@dyarchy/shared';
import type { MapConfig } from '@dyarchy/shared';

/**
 * Gentle rolling hills using layered sine waves.
 * Max elevation ~2 units. Flat near the center for fair combat.
 * This is the default (meadow) terrain — kept for offline mode backward compat.
 */
export function getTerrainHeight(x: number, z: number): number {
  // Normalize to 0-1 range
  const nx = (x + MAP_WIDTH / 2) / MAP_WIDTH;
  const nz = (z + MAP_DEPTH / 2) / MAP_DEPTH;

  // Flatten the center combat area (within ~30% of center)
  const cx = Math.abs(x) / (MAP_WIDTH / 2); // 0 at center, 1 at edge
  const cz = Math.abs(z) / (MAP_DEPTH / 2);
  const centerFade = Math.max(0, Math.min(1, (Math.max(cx, cz) - 0.2) / 0.3));

  // Layered sine waves for rolling hills
  let h = 0;
  h += Math.sin(nx * Math.PI * 2.5) * Math.cos(nz * Math.PI * 3) * 1.2;
  h += Math.sin(nx * Math.PI * 5 + 1.3) * Math.cos(nz * Math.PI * 4 + 0.7) * 0.5;
  h += Math.sin(nx * Math.PI * 8 + 2.1) * Math.sin(nz * Math.PI * 6 + 1.5) * 0.25;

  // Apply center fade — flat in the middle, hills near edges
  h *= centerFade;

  return Math.max(0, h);
}

/**
 * Creates a terrain height function from a MapConfig's terrain parameters.
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
