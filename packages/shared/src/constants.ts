import type { Vec3 } from './types.js';

// Server
export const TICK_RATE = 20;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;

// FPS Player
export const PLAYER_SPEED = 12;
export const PLAYER_JUMP_VELOCITY = 10;
export const GRAVITY = -25;
export const PLAYER_HEIGHT = 1.5;
export const PLAYER_RADIUS = 0.4;
export const MOUSE_SENSITIVITY = 0.002;
export const RESPAWN_TIME = 7;
export const PLAYER_MAX_HP = 100;

// Map
export const MAP_WIDTH = 200;
export const MAP_DEPTH = 100;
export const GROUND_Y = 0;

// Team spawn positions
export const TEAM_SPAWNS: Record<1 | 2, Vec3> = {
  1: { x: -80, y: 0, z: 0 },
  2: { x: 80, y: 0, z: 0 },
};

// Pre-placed structures
export const INITIAL_BUILDINGS = {
  1: {
    mainBase: { x: -85, y: 0, z: 0 },
    towers: [
      { x: -70, y: 0, z: -20 },
      { x: -70, y: 0, z: 20 },
    ],
  },
  2: {
    mainBase: { x: 85, y: 0, z: 0 },
    towers: [
      { x: 70, y: 0, z: -20 },
      { x: 70, y: 0, z: 20 },
    ],
  },
};

// Obstacle cubes in the center for FPS cover
export const OBSTACLES: Vec3[] = [
  { x: 0, y: 0, z: -15 },
  { x: 0, y: 0, z: 15 },
  { x: -15, y: 0, z: 0 },
  { x: 15, y: 0, z: 0 },
  { x: -8, y: 0, z: -8 },
  { x: 8, y: 0, z: 8 },
];

// Resource nodes
export const RESOURCE_NODES: Vec3[] = [
  { x: -50, y: 0, z: -25 },
  { x: -50, y: 0, z: 25 },
  { x: -30, y: 0, z: 0 },
  { x: 50, y: 0, z: -25 },
  { x: 50, y: 0, z: 25 },
  { x: 30, y: 0, z: 0 },
  // High-value center nodes
  { x: -10, y: 0, z: -30 },
  { x: 10, y: 0, z: 30 },
];
