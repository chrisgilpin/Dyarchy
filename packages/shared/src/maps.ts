import type { Vec3, TeamId, TunnelConfig } from './types.js';

// ===================== Types =====================

export type MapId = 'meadow' | 'frostpeak' | 'blood_canyon' | 'ironhold';

export interface TerrainLayer {
  freqX: number;
  freqZ: number;
  amp: number;
  phaseX: number;
  phaseZ: number;
}

export interface TerrainConfig {
  maxElevation: number;
  flatCenterRadius: number; // 0-1, fraction of half-map where center is flat
  fadeWidth: number;         // 0-1, width of transition from flat to full height
  layers: TerrainLayer[];
}

export interface MapTheme {
  // Ground
  groundBaseColor: string;
  groundPatchRGBRanges: { rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number };
  gridLineAlpha: number;
  // Sky gradient (top to bottom)
  skyTopColor: string;
  skyMidColor: string;
  skyLowColor: string;
  skyHorizonColor: string;
  // Fog
  fogColor: number;
  fogNear: number;
  fogFar: number;
  // Lighting
  ambientColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  fillColor: number;
  fillIntensity: number;
  // Vegetation
  treeLeafColors: number[];
  treeTrunkColor: number;
  rockColor: number;
  rockSecondaryColor: number;
  // Decorations
  grassColors: number[];
  flowerColors: number[];
  grassCount: number;
  cloudCount: number;
  // Structures
  wallColor: number;
}

export interface MapConfig {
  id: MapId;
  name: string;
  description: string;
  width: number;
  depth: number;
  teamSpawns: Record<TeamId, Vec3>;
  initialBuildings: Record<TeamId, {
    mainBase: Vec3;
    towers: Vec3[];
  }>;
  obstacles: Vec3[];
  resourceNodes: Vec3[];
  vegetation: { pos: Vec3; type: 'tree' | 'rock' }[];
  edgeTrees: Vec3[];
  terrain: TerrainConfig;
  theme: MapTheme;
  tunnels?: TunnelConfig[];
}

// ===================== Helpers =====================

export function generateEdgeTrees(width: number, depth: number, count: number, seed: number): Vec3[] {
  const rng = (s: number) => { let st = s; return () => { st = (st * 16807 + 0) % 2147483647; return st / 2147483647; }; };
  const rand = rng(seed);
  const positions: Vec3[] = [];
  const margin = 5;
  for (let i = 0; i < count; i++) {
    const side = Math.floor(rand() * 4);
    let tx: number, tz: number;
    if (side === 0) { tx = (rand() - 0.5) * width; tz = -depth / 2 + margin; }
    else if (side === 1) { tx = (rand() - 0.5) * width; tz = depth / 2 - margin; }
    else if (side === 2) { tx = -width / 2 + margin; tz = (rand() - 0.5) * depth; }
    else { tx = width / 2 - margin; tz = (rand() - 0.5) * depth; }
    positions.push({ x: Math.round(tx * 10) / 10, y: 0, z: Math.round(tz * 10) / 10 });
  }
  return positions;
}

export function getMapConfig(id: MapId): MapConfig {
  return MAP_CONFIGS[id];
}

// ===================== Meadow (current map) =====================

export const MEADOW_MAP: MapConfig = {
  id: 'meadow',
  name: 'Meadow',
  description: '240x150 — Rolling green hills',
  width: 240,
  depth: 150,
  teamSpawns: {
    1: { x: -96, y: 0, z: 0 },
    2: { x: 96, y: 0, z: 0 },
  },
  initialBuildings: {
    1: {
      mainBase: { x: -102, y: 0, z: 0 },
      towers: [
        { x: -84, y: 0, z: -30 },
        { x: -84, y: 0, z: 30 },
      ],
    },
    2: {
      mainBase: { x: 102, y: 0, z: 0 },
      towers: [
        { x: 84, y: 0, z: -30 },
        { x: 84, y: 0, z: 30 },
      ],
    },
  },
  obstacles: [
    { x: 0, y: 0, z: -22 },
    { x: 0, y: 0, z: 22 },
    { x: -18, y: 0, z: 0 },
    { x: 18, y: 0, z: 0 },
    { x: -10, y: 0, z: -12 },
    { x: 10, y: 0, z: 12 },
  ],
  resourceNodes: [
    { x: -81, y: 0, z: -38 },
    { x: -81, y: 0, z: 38 },
    { x: -69, y: 0, z: 0 },
    { x: 81, y: 0, z: -38 },
    { x: 81, y: 0, z: 38 },
    { x: 69, y: 0, z: 0 },
    { x: -12, y: 0, z: -45 },
    { x: 12, y: 0, z: 45 },
  ],
  vegetation: [
    { pos: { x: -40, y: 0, z: -55 }, type: 'tree' },
    { pos: { x: -55, y: 0, z: -15 }, type: 'tree' },
    { pos: { x: -25, y: 0, z: 50 }, type: 'tree' },
    { pos: { x: -70, y: 0, z: 45 }, type: 'tree' },
    { pos: { x: -90, y: 0, z: -50 }, type: 'tree' },
    { pos: { x: 40, y: 0, z: -55 }, type: 'tree' },
    { pos: { x: 55, y: 0, z: 15 }, type: 'tree' },
    { pos: { x: 25, y: 0, z: -50 }, type: 'tree' },
    { pos: { x: 70, y: 0, z: -45 }, type: 'tree' },
    { pos: { x: 90, y: 0, z: 50 }, type: 'tree' },
    { pos: { x: -5, y: 0, z: 60 }, type: 'tree' },
    { pos: { x: 5, y: 0, z: -60 }, type: 'tree' },
    { pos: { x: -105, y: 0, z: 40 }, type: 'tree' },
    { pos: { x: 105, y: 0, z: -40 }, type: 'tree' },
    { pos: { x: -30, y: 0, z: -30 }, type: 'rock' },
    { pos: { x: 30, y: 0, z: 30 }, type: 'rock' },
    { pos: { x: -50, y: 0, z: 55 }, type: 'rock' },
    { pos: { x: 50, y: 0, z: -55 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: 40 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: -40 }, type: 'rock' },
    { pos: { x: -80, y: 0, z: -20 }, type: 'rock' },
    { pos: { x: 80, y: 0, z: 20 }, type: 'rock' },
    { pos: { x: -15, y: 0, z: 55 }, type: 'rock' },
    { pos: { x: 15, y: 0, z: -55 }, type: 'rock' },
  ],
  edgeTrees: generateEdgeTrees(240, 150, 20, 99),
  terrain: {
    maxElevation: 2.5,
    flatCenterRadius: 0.2,
    fadeWidth: 0.3,
    layers: [
      { freqX: 2.5, freqZ: 3, amp: 1.2, phaseX: 0, phaseZ: 0 },
      { freqX: 5, freqZ: 4, amp: 0.5, phaseX: 1.3, phaseZ: 0.7 },
      { freqX: 8, freqZ: 6, amp: 0.25, phaseX: 2.1, phaseZ: 1.5 },
    ],
  },
  theme: {
    groundBaseColor: '#5a9e45',
    groundPatchRGBRanges: { rMin: 50, rMax: 90, gMin: 120, gMax: 180, bMin: 30, bMax: 60 },
    gridLineAlpha: 0.08,
    skyTopColor: '#4a90d9',
    skyMidColor: '#7ec8e3',
    skyLowColor: '#b8e4f0',
    skyHorizonColor: '#e8f5e0',
    fogColor: 0xc8e8d0,
    fogNear: 80,
    fogFar: 180,
    ambientColor: 0xfff5e0,
    ambientIntensity: 0.65,
    sunColor: 0xfff0d0,
    sunIntensity: 0.9,
    fillColor: 0xd0e0ff,
    fillIntensity: 0.3,
    treeLeafColors: [0x227722, 0x336633, 0x2a8a2a],
    treeTrunkColor: 0x664422,
    rockColor: 0x777777,
    rockSecondaryColor: 0x888888,
    grassColors: [0x4a8e35, 0x5ca842, 0x6bb84f, 0x78c455],
    flowerColors: [0xffee44, 0xff8844, 0xff66aa, 0xaaddff, 0xffffff],
    grassCount: 400,
    cloudCount: 12,
    wallColor: 0x8a8570,
  },
};

// ===================== Frostpeak (new snow mountain map) =====================

export const FROSTPEAK_MAP: MapConfig = {
  id: 'frostpeak',
  name: 'Frostpeak',
  description: '360x225 — Snowy mountain peaks',
  width: 360,
  depth: 225,
  teamSpawns: {
    1: { x: -144, y: 0, z: 0 },
    2: { x: 144, y: 0, z: 0 },
  },
  initialBuildings: {
    1: {
      mainBase: { x: -153, y: 0, z: 0 },
      towers: [
        { x: -126, y: 0, z: -45 },
        { x: -126, y: 0, z: 45 },
      ],
    },
    2: {
      mainBase: { x: 153, y: 0, z: 0 },
      towers: [
        { x: 126, y: 0, z: -45 },
        { x: 126, y: 0, z: 45 },
      ],
    },
  },
  obstacles: [
    // 10 cover cubes for larger arena
    { x: 0, y: 0, z: -33 },
    { x: 0, y: 0, z: 33 },
    { x: -27, y: 0, z: 0 },
    { x: 27, y: 0, z: 0 },
    { x: -15, y: 0, z: -18 },
    { x: 15, y: 0, z: 18 },
    { x: -15, y: 0, z: 18 },
    { x: 15, y: 0, z: -18 },
    { x: -8, y: 0, z: -8 },
    { x: 8, y: 0, z: 8 },
  ],
  resourceNodes: [
    // Near-base nodes
    { x: -122, y: 0, z: -57 },
    { x: -122, y: 0, z: 57 },
    { x: -104, y: 0, z: 0 },
    { x: 122, y: 0, z: -57 },
    { x: 122, y: 0, z: 57 },
    { x: 104, y: 0, z: 0 },
    // Center high-value nodes
    { x: -18, y: 0, z: -68 },
    { x: 18, y: 0, z: 68 },
    // Extra contested nodes for larger map
    { x: -50, y: 0, z: -40 },
    { x: 50, y: 0, z: 40 },
  ],
  vegetation: [
    // Snow-covered pine trees scattered across the map
    { pos: { x: -60, y: 0, z: -82 }, type: 'tree' },
    { pos: { x: -82, y: 0, z: -22 }, type: 'tree' },
    { pos: { x: -38, y: 0, z: 75 }, type: 'tree' },
    { pos: { x: -105, y: 0, z: 68 }, type: 'tree' },
    { pos: { x: -135, y: 0, z: -75 }, type: 'tree' },
    { pos: { x: 60, y: 0, z: -82 }, type: 'tree' },
    { pos: { x: 82, y: 0, z: 22 }, type: 'tree' },
    { pos: { x: 38, y: 0, z: -75 }, type: 'tree' },
    { pos: { x: 105, y: 0, z: -68 }, type: 'tree' },
    { pos: { x: 135, y: 0, z: 75 }, type: 'tree' },
    { pos: { x: -8, y: 0, z: 90 }, type: 'tree' },
    { pos: { x: 8, y: 0, z: -90 }, type: 'tree' },
    { pos: { x: -158, y: 0, z: 60 }, type: 'tree' },
    { pos: { x: 158, y: 0, z: -60 }, type: 'tree' },
    { pos: { x: -70, y: 0, z: 40 }, type: 'tree' },
    { pos: { x: 70, y: 0, z: -40 }, type: 'tree' },
    { pos: { x: -120, y: 0, z: -55 }, type: 'tree' },
    { pos: { x: 120, y: 0, z: 55 }, type: 'tree' },
    // Snow-dusted boulders
    { pos: { x: -45, y: 0, z: -45 }, type: 'rock' },
    { pos: { x: 45, y: 0, z: 45 }, type: 'rock' },
    { pos: { x: -75, y: 0, z: 82 }, type: 'rock' },
    { pos: { x: 75, y: 0, z: -82 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: 60 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: -60 }, type: 'rock' },
    { pos: { x: -120, y: 0, z: -30 }, type: 'rock' },
    { pos: { x: 120, y: 0, z: 30 }, type: 'rock' },
    { pos: { x: -22, y: 0, z: 82 }, type: 'rock' },
    { pos: { x: 22, y: 0, z: -82 }, type: 'rock' },
    { pos: { x: -95, y: 0, z: 15 }, type: 'rock' },
    { pos: { x: 95, y: 0, z: -15 }, type: 'rock' },
  ],
  edgeTrees: generateEdgeTrees(360, 225, 30, 99),
  terrain: {
    maxElevation: 45,
    flatCenterRadius: 0.10,
    fadeWidth: 0.15,
    layers: [
      // Broad sweeping mountain ranges (low freq = gradual, climbable slopes)
      { freqX: 1.5, freqZ: 1.5, amp: 25, phaseX: 0, phaseZ: 0 },
      // Medium ridges and valleys
      { freqX: 3, freqZ: 2.5, amp: 12, phaseX: 1.3, phaseZ: 0.7 },
      // Smaller hills and terrain variation
      { freqX: 5, freqZ: 4, amp: 6, phaseX: 2.1, phaseZ: 1.5 },
      // Fine detail and texture
      { freqX: 8, freqZ: 7, amp: 3, phaseX: 0.5, phaseZ: 2.3 },
    ],
  },
  theme: {
    groundBaseColor: '#c8d4e0',
    groundPatchRGBRanges: { rMin: 180, rMax: 220, gMin: 190, gMax: 225, bMin: 210, bMax: 240 },
    gridLineAlpha: 0.04,
    skyTopColor: '#4a5a7a',
    skyMidColor: '#7888a0',
    skyLowColor: '#a0b0c0',
    skyHorizonColor: '#c8d0d8',
    fogColor: 0xd8e0e8,
    fogNear: 80,
    fogFar: 350,
    ambientColor: 0xd0e0ff,
    ambientIntensity: 0.7,
    sunColor: 0xffeedd,
    sunIntensity: 0.75,
    fillColor: 0xb0c0d8,
    fillIntensity: 0.35,
    treeLeafColors: [0x1a4a1a, 0x2a5a2a, 0x1a3a1a],
    treeTrunkColor: 0x443322,
    rockColor: 0x999999,
    rockSecondaryColor: 0xaaaaaa,
    grassColors: [0xc8d4c0, 0xb8c8b0, 0xa8b8a0],
    flowerColors: [0xffffff, 0xd0d8e8, 0xb0c8d8],
    grassCount: 300,
    cloudCount: 8,
    wallColor: 0x8890a0,
  },
};

// ===================== Blood Canyon (inspired by Blood Gulch) =====================

export const BLOOD_CANYON_MAP: MapConfig = {
  id: 'blood_canyon',
  name: 'Blood Canyon',
  description: '450x150 — Desert canyon with high walls',
  width: 450,
  depth: 150,
  teamSpawns: {
    // Bases at opposite ends of the canyon
    1: { x: -185, y: 0, z: 0 },
    2: { x: 185, y: 0, z: 0 },
  },
  initialBuildings: {
    1: {
      mainBase: { x: -195, y: 0, z: 0 },
      towers: [
        { x: -170, y: 0, z: -35 },
        { x: -170, y: 0, z: 35 },
      ],
    },
    2: {
      mainBase: { x: 195, y: 0, z: 0 },
      towers: [
        { x: 170, y: 0, z: -35 },
        { x: 170, y: 0, z: 35 },
      ],
    },
  },
  obstacles: [
    // Center cover — scattered rocks and low walls across the canyon floor
    { x: 0, y: 0, z: -15 },
    { x: 0, y: 0, z: 15 },
    { x: -30, y: 0, z: 0 },
    { x: 30, y: 0, z: 0 },
    { x: -60, y: 0, z: -10 },
    { x: 60, y: 0, z: 10 },
    { x: -60, y: 0, z: 12 },
    { x: 60, y: 0, z: -12 },
    { x: -90, y: 0, z: 0 },
    { x: 90, y: 0, z: 0 },
    { x: -15, y: 0, z: -8 },
    { x: 15, y: 0, z: 8 },
  ],
  resourceNodes: [
    // Near-base nodes (safe harvesting)
    { x: -160, y: 0, z: -30 },
    { x: -160, y: 0, z: 30 },
    { x: -140, y: 0, z: 0 },
    { x: 160, y: 0, z: -30 },
    { x: 160, y: 0, z: 30 },
    { x: 140, y: 0, z: 0 },
    // Center contested nodes (high-value, risky)
    { x: -20, y: 0, z: -25 },
    { x: 20, y: 0, z: 25 },
    // Mid-field nodes
    { x: -80, y: 0, z: -20 },
    { x: 80, y: 0, z: 20 },
    { x: -80, y: 0, z: 20 },
    { x: 80, y: 0, z: -20 },
  ],
  vegetation: [
    // Sparse desert scrub and boulders along the canyon floor
    // Rocks — lots of them, canyon environment
    { pos: { x: -40, y: 0, z: -30 }, type: 'rock' },
    { pos: { x: 40, y: 0, z: 30 }, type: 'rock' },
    { pos: { x: -100, y: 0, z: 25 }, type: 'rock' },
    { pos: { x: 100, y: 0, z: -25 }, type: 'rock' },
    { pos: { x: -120, y: 0, z: -15 }, type: 'rock' },
    { pos: { x: 120, y: 0, z: 15 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: 30 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: -30 }, type: 'rock' },
    { pos: { x: -50, y: 0, z: 10 }, type: 'rock' },
    { pos: { x: 50, y: 0, z: -10 }, type: 'rock' },
    { pos: { x: -150, y: 0, z: 20 }, type: 'rock' },
    { pos: { x: 150, y: 0, z: -20 }, type: 'rock' },
    { pos: { x: -70, y: 0, z: -25 }, type: 'rock' },
    { pos: { x: 70, y: 0, z: 25 }, type: 'rock' },
    { pos: { x: -180, y: 0, z: -25 }, type: 'rock' },
    { pos: { x: 180, y: 0, z: 25 }, type: 'rock' },
    // Sparse scrubby trees near base areas
    { pos: { x: -170, y: 0, z: -45 }, type: 'tree' },
    { pos: { x: -170, y: 0, z: 45 }, type: 'tree' },
    { pos: { x: 170, y: 0, z: -45 }, type: 'tree' },
    { pos: { x: 170, y: 0, z: 45 }, type: 'tree' },
    { pos: { x: -130, y: 0, z: -35 }, type: 'tree' },
    { pos: { x: 130, y: 0, z: 35 }, type: 'tree' },
  ],
  edgeTrees: generateEdgeTrees(450, 150, 15, 42),
  terrain: {
    // Canyon: high walls on the Z (north/south) edges, flat floor in the center
    // The flatCenterRadius is wide along X (the canyon runs east-west)
    // but the terrain rises sharply on the Z edges
    maxElevation: 25,
    flatCenterRadius: 0.35,  // wide flat canyon floor
    fadeWidth: 0.15,         // sharp transition to canyon walls
    layers: [
      // Primary canyon walls — sharp rise on the Z axis (high freqX = smooth along canyon length, high amp)
      { freqX: 0.5, freqZ: 2.0, amp: 20, phaseX: 0, phaseZ: 0 },
      // Secondary ridges — undulating canyon walls
      { freqX: 2.0, freqZ: 3.0, amp: 8, phaseX: 1.0, phaseZ: 0.5 },
      // Rolling hills on the canyon floor (low amplitude)
      { freqX: 3.0, freqZ: 2.0, amp: 3, phaseX: 0.5, phaseZ: 1.8 },
      // Fine rocky detail
      { freqX: 6.0, freqZ: 5.0, amp: 1.5, phaseX: 2.3, phaseZ: 0.9 },
    ],
  },
  theme: {
    // Desert canyon — warm sandy tones, orange-red rock, blue sky
    groundBaseColor: '#c4a060',
    groundPatchRGBRanges: { rMin: 160, rMax: 210, gMin: 130, gMax: 170, bMin: 70, bMax: 110 },
    gridLineAlpha: 0.05,
    skyTopColor: '#2a5599',
    skyMidColor: '#5588cc',
    skyLowColor: '#88aadd',
    skyHorizonColor: '#ddccaa',
    fogColor: 0xd8c8a8,
    fogNear: 100,
    fogFar: 400,
    ambientColor: 0xffe8c0,
    ambientIntensity: 0.7,
    sunColor: 0xffdd99,
    sunIntensity: 1.0,
    fillColor: 0xccaa88,
    fillIntensity: 0.25,
    treeLeafColors: [0x556633, 0x667744, 0x445522],
    treeTrunkColor: 0x775533,
    rockColor: 0xaa7744,
    rockSecondaryColor: 0xbb8855,
    grassColors: [0xaa9955, 0x998844, 0x887733],
    flowerColors: [0xffcc44, 0xff8833, 0xcc6622],
    grassCount: 150,
    cloudCount: 5,
    wallColor: 0xaa8866,
  },
};

// ===================== Ironhold Caverns (tunnel map) =====================

export const IRONHOLD_MAP: MapConfig = {
  id: 'ironhold',
  name: 'Ironhold Caverns',
  description: '300x180 — Volcanic ridges with underground tunnels',
  width: 300,
  depth: 180,
  teamSpawns: {
    1: { x: -120, y: 0, z: 0 },
    2: { x: 120, y: 0, z: 0 },
  },
  initialBuildings: {
    1: {
      mainBase: { x: -128, y: 0, z: 0 },
      towers: [
        { x: -106, y: 0, z: -35 },
        { x: -106, y: 0, z: 35 },
      ],
    },
    2: {
      mainBase: { x: 128, y: 0, z: 0 },
      towers: [
        { x: 106, y: 0, z: -35 },
        { x: 106, y: 0, z: 35 },
      ],
    },
  },
  obstacles: [
    // Center arena cover
    { x: 0, y: 0, z: -18 },
    { x: 0, y: 0, z: 18 },
    { x: -22, y: 0, z: 0 },
    { x: 22, y: 0, z: 0 },
    { x: -12, y: 0, z: -10 },
    { x: 12, y: 0, z: 10 },
    { x: -12, y: 0, z: 10 },
    { x: 12, y: 0, z: -10 },
    // Near tunnel entrances
    { x: -55, y: 0, z: -48 },
    { x: 55, y: 0, z: -48 },
    { x: -55, y: 0, z: 48 },
    { x: 55, y: 0, z: 48 },
  ],
  resourceNodes: [
    // Near-base safe nodes
    { x: -100, y: 0, z: -42 },
    { x: -100, y: 0, z: 42 },
    { x: -88, y: 0, z: 0 },
    { x: 100, y: 0, z: -42 },
    { x: 100, y: 0, z: 42 },
    { x: 88, y: 0, z: 0 },
    // Contested center nodes
    { x: -15, y: 0, z: -30 },
    { x: 15, y: 0, z: 30 },
    // High-value nodes near tunnel entrances (incentivize tunnel control)
    { x: -50, y: 0, z: -55 },
    { x: 50, y: 0, z: -55 },
    { x: -50, y: 0, z: 55 },
    { x: 50, y: 0, z: 55 },
  ],
  vegetation: [
    // Dark dead trees scattered across volcanic landscape
    { pos: { x: -60, y: 0, z: -25 }, type: 'tree' },
    { pos: { x: -80, y: 0, z: 15 }, type: 'tree' },
    { pos: { x: -35, y: 0, z: 55 }, type: 'tree' },
    { pos: { x: -110, y: 0, z: -55 }, type: 'tree' },
    { pos: { x: 60, y: 0, z: 25 }, type: 'tree' },
    { pos: { x: 80, y: 0, z: -15 }, type: 'tree' },
    { pos: { x: 35, y: 0, z: -55 }, type: 'tree' },
    { pos: { x: 110, y: 0, z: 55 }, type: 'tree' },
    { pos: { x: -5, y: 0, z: 65 }, type: 'tree' },
    { pos: { x: 5, y: 0, z: -65 }, type: 'tree' },
    // Volcanic boulders — heavy rock presence
    { pos: { x: -40, y: 0, z: -40 }, type: 'rock' },
    { pos: { x: 40, y: 0, z: 40 }, type: 'rock' },
    { pos: { x: -70, y: 0, z: 50 }, type: 'rock' },
    { pos: { x: 70, y: 0, z: -50 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: 35 }, type: 'rock' },
    { pos: { x: 0, y: 0, z: -35 }, type: 'rock' },
    { pos: { x: -95, y: 0, z: -20 }, type: 'rock' },
    { pos: { x: 95, y: 0, z: 20 }, type: 'rock' },
    { pos: { x: -30, y: 0, z: -60 }, type: 'rock' },
    { pos: { x: 30, y: 0, z: 60 }, type: 'rock' },
    { pos: { x: -65, y: 0, z: -60 }, type: 'rock' },
    { pos: { x: 65, y: 0, z: 60 }, type: 'rock' },
    { pos: { x: -120, y: 0, z: 35 }, type: 'rock' },
    { pos: { x: 120, y: 0, z: -35 }, type: 'rock' },
  ],
  edgeTrees: generateEdgeTrees(300, 180, 18, 77),
  terrain: {
    // Volcanic ridges at north/south edges, flat central valley
    maxElevation: 25,
    flatCenterRadius: 0.25,
    fadeWidth: 0.18,
    layers: [
      // Primary ridges — strong Z-axis rise (north/south walls)
      { freqX: 1.0, freqZ: 2.0, amp: 18, phaseX: 0, phaseZ: 0 },
      // Secondary undulation along ridges
      { freqX: 2.5, freqZ: 3.0, amp: 8, phaseX: 0.8, phaseZ: 0.5 },
      // Gentle valley floor variation
      { freqX: 3.0, freqZ: 1.5, amp: 3, phaseX: 1.5, phaseZ: 1.2 },
      // Fine volcanic texture
      { freqX: 6.0, freqZ: 5.0, amp: 1.5, phaseX: 2.0, phaseZ: 0.7 },
    ],
  },
  theme: {
    // Dark volcanic — charcoal ground, ember-orange accents, brooding sky
    groundBaseColor: '#3a3530',
    groundPatchRGBRanges: { rMin: 40, rMax: 70, gMin: 35, gMax: 55, bMin: 30, bMax: 48 },
    gridLineAlpha: 0.06,
    skyTopColor: '#1a1520',
    skyMidColor: '#2a2535',
    skyLowColor: '#4a3540',
    skyHorizonColor: '#6a4530',
    fogColor: 0x2a2025,
    fogNear: 60,
    fogFar: 280,
    ambientColor: 0xff8844,
    ambientIntensity: 0.4,
    sunColor: 0xff6622,
    sunIntensity: 0.6,
    fillColor: 0x442222,
    fillIntensity: 0.3,
    treeLeafColors: [0x222218, 0x2a2a1e, 0x1a1a12],
    treeTrunkColor: 0x2a2018,
    rockColor: 0x555045,
    rockSecondaryColor: 0x665850,
    grassColors: [0x3a3525, 0x4a4530, 0x2a2518],
    flowerColors: [0xff4400, 0xff6600, 0xcc3300],
    grassCount: 100,
    cloudCount: 3,
    wallColor: 0x443830,
  },
  tunnels: [
    // North tunnel — goes under the north ridge
    {
      id: 1,
      floorY: -5,
      ceilingHeight: 6,
      regions: [
        // Tunnel volume (underground corridor from west to east under north ridge)
        { min: { x: -65, y: -6, z: -62 }, max: { x: 65, y: 2, z: -48 } },
      ],
      portals: [
        // West entrance: surface → underground
        { position: { x: -60, y: 0, z: -55 }, targetLayer: 1, targetPosition: { x: -55, y: -5, z: -55 }, radius: 4 },
        // West entrance: underground → surface
        { position: { x: -60, y: 0, z: -55 }, targetLayer: 0, targetPosition: { x: -60, y: 0, z: -50 }, radius: 4 },
        // East entrance: surface → underground
        { position: { x: 60, y: 0, z: -55 }, targetLayer: 1, targetPosition: { x: 55, y: -5, z: -55 }, radius: 4 },
        // East entrance: underground → surface
        { position: { x: 60, y: 0, z: -55 }, targetLayer: 0, targetPosition: { x: 60, y: 0, z: -50 }, radius: 4 },
      ],
    },
    // South tunnel — goes under the south ridge
    {
      id: 2,
      floorY: -5,
      ceilingHeight: 6,
      regions: [
        { min: { x: -65, y: -6, z: 48 }, max: { x: 65, y: 2, z: 62 } },
      ],
      portals: [
        // West entrance: surface → underground
        { position: { x: -60, y: 0, z: 55 }, targetLayer: 2, targetPosition: { x: -55, y: -5, z: 55 }, radius: 4 },
        // West entrance: underground → surface
        { position: { x: -60, y: 0, z: 55 }, targetLayer: 0, targetPosition: { x: -60, y: 0, z: 50 }, radius: 4 },
        // East entrance: surface → underground
        { position: { x: 60, y: 0, z: 55 }, targetLayer: 2, targetPosition: { x: 55, y: -5, z: 55 }, radius: 4 },
        // East entrance: underground → surface
        { position: { x: 60, y: 0, z: 55 }, targetLayer: 0, targetPosition: { x: 60, y: 0, z: 50 }, radius: 4 },
      ],
    },
  ],
};

// ===================== Registry =====================

export const MAP_CONFIGS: Record<MapId, MapConfig> = {
  meadow: MEADOW_MAP,
  frostpeak: FROSTPEAK_MAP,
  blood_canyon: BLOOD_CANYON_MAP,
  ironhold: IRONHOLD_MAP,
};
