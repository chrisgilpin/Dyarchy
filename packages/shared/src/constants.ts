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
export const MAP_WIDTH = 240;
export const MAP_DEPTH = 150;
export const GROUND_Y = 0;

// Team spawn positions
export const TEAM_SPAWNS: Record<1 | 2, Vec3> = {
  1: { x: -96, y: 0, z: 0 },
  2: { x: 96, y: 0, z: 0 },
};

// Pre-placed structures
export const INITIAL_BUILDINGS = {
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
};

// Obstacle cubes in the center for FPS cover
export const OBSTACLES: Vec3[] = [
  { x: 0, y: 0, z: -22 },
  { x: 0, y: 0, z: 22 },
  { x: -18, y: 0, z: 0 },
  { x: 18, y: 0, z: 0 },
  { x: -10, y: 0, z: -12 },
  { x: 10, y: 0, z: 12 },
];

// Resource nodes
export const RESOURCE_NODES: Vec3[] = [
  // Near-base nodes (50% closer to bases)
  { x: -81, y: 0, z: -38 },
  { x: -81, y: 0, z: 38 },
  { x: -69, y: 0, z: 0 },
  { x: 81, y: 0, z: -38 },
  { x: 81, y: 0, z: 38 },
  { x: 69, y: 0, z: 0 },
  // High-value center nodes
  { x: -12, y: 0, z: -45 },
  { x: 12, y: 0, z: 45 },
];

// Vegetation (decorative trees and rocks)
export const VEGETATION: { pos: Vec3; type: 'tree' | 'rock' }[] = [
  // Scattered trees around the map
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
  // Rocks
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
];

// Hero system
export const HERO_ABILITY_MAX_CHARGE = 6;   // seconds of full use
export const HERO_ABILITY_RECHARGE_MULT = 0.83; // recharges ~0.83x slower than it drains (~5s from empty)
export const HERO_DEPLETED_LOCKOUT = 20;    // seconds lockout if fully depleted
export const SHIELD_MAX_HP = 200;
export const SHIELD_RADIUS = PLAYER_HEIGHT * 2.5;  // sphere radius centered on tank (50% of original)
export const HEAL_AURA_RADIUS = 7;
export const REPAIR_AURA_RADIUS = 7;
export const AURA_HEAL_RATE = 0.05;         // 5% maxHp
export const AURA_TICK_INTERVAL = 2;        // seconds

// Helicopter
export const HELI_HP = 100;
export const HELI_COST = 400;
export const HELI_TRAIN_TIME = 12;
export const HELI_SUPPLY_COST = 3;
export const HELI_MAX_SPEED = 20;
export const HELI_ACCELERATION = 12;
export const HELI_BRAKE_FORCE = 15;
export const HELI_REVERSE_MAX = 6;
export const HELI_TURN_RATE = 1.5;
export const HELI_FRICTION = 10;
export const HELI_ASCEND_SPEED = 12;
export const HELI_DESCEND_SPEED = 8;
export const HELI_HOVER_DRIFT = -2;       // slow downward drift when no vertical input
export const HELI_MAX_ALTITUDE = 20;
export const HELI_COLLISION_RADIUS = 3.0;
export const HELI_TURRET_FIRE_RATE = 0.4;
export const HELI_TURRET_DAMAGE = 8;
export const HELI_TURRET_RANGE = 30;

// Edge trees (decorative, generated deterministically — used for collision on both client and server)
export const EDGE_TREES: Vec3[] = (() => {
  const rng = (seed: number) => { let s = seed; return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; }; };
  const rand = rng(99); // dedicated seed for edge trees
  const positions: Vec3[] = [];
  for (let i = 0; i < 20; i++) {
    const side = Math.floor(rand() * 4);
    let tx: number, tz: number;
    const margin = 5;
    if (side === 0) { tx = (rand() - 0.5) * MAP_WIDTH; tz = -MAP_DEPTH / 2 + margin; }
    else if (side === 1) { tx = (rand() - 0.5) * MAP_WIDTH; tz = MAP_DEPTH / 2 - margin; }
    else if (side === 2) { tx = -MAP_WIDTH / 2 + margin; tz = (rand() - 0.5) * MAP_DEPTH; }
    else { tx = MAP_WIDTH / 2 - margin; tz = (rand() - 0.5) * MAP_DEPTH; }
    positions.push({ x: Math.round(tx * 10) / 10, y: 0, z: Math.round(tz * 10) / 10 });
  }
  return positions;
})();
