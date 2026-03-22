import type { Vec3, TeamId } from './types.js';

// ===================== Types =====================

export type MapId = 'meadow' | 'frostpeak';

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

// ===================== Registry =====================

export const MAP_CONFIGS: Record<MapId, MapConfig> = {
  meadow: MEADOW_MAP,
  frostpeak: FROSTPEAK_MAP,
};
