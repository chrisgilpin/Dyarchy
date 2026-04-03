import { MAP_WIDTH, MAP_DEPTH } from '@dyarchy/shared';
import type { MapConfig } from '@dyarchy/shared';

// Re-export the shared terrain height function so existing client imports still work
export { createTerrainHeightFn } from '@dyarchy/shared';

/**
 * Legacy default terrain height function for meadow map (offline mode backward compat).
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
