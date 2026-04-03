import type { Vec3, InputState } from './types.js';
import {
  PLAYER_SPEED,
  PLAYER_JUMP_VELOCITY,
  GRAVITY,
  GROUND_Y,
  MAP_WIDTH,
  MAP_DEPTH,
} from './constants.js';

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function lengthVec3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalizeVec3(v: Vec3): Vec3 {
  const len = lengthVec3(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export interface MovementResult {
  position: Vec3;
  velocity: Vec3;
  onGround: boolean;
}

export function applyMovement(
  position: Vec3,
  velocity: Vec3,
  input: InputState,
  dt: number,
  bounds?: { halfW: number; halfD: number },
  groundY: number = GROUND_Y,
): MovementResult {
  const yaw = input.yaw;

  // Movement direction relative to yaw
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);

  let moveX = 0;
  let moveZ = 0;

  if (input.forward) {
    moveX -= sinYaw;
    moveZ -= cosYaw;
  }
  if (input.backward) {
    moveX += sinYaw;
    moveZ += cosYaw;
  }
  if (input.left) {
    moveX -= cosYaw;
    moveZ += sinYaw;
  }
  if (input.right) {
    moveX += cosYaw;
    moveZ -= sinYaw;
  }

  // Normalize horizontal movement
  const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveLen > 0) {
    moveX = (moveX / moveLen) * PLAYER_SPEED;
    moveZ = (moveZ / moveLen) * PLAYER_SPEED;
  }

  // Apply horizontal velocity directly (no acceleration for MVP — snappy FPS feel)
  let vx = moveX;
  let vy = velocity.y;
  let vz = moveZ;

  // Check if on ground
  const onGround = position.y <= groundY + 0.01;

  // Jump
  if (input.jump && onGround) {
    vy = PLAYER_JUMP_VELOCITY;
  }

  // Gravity
  vy += GRAVITY * dt;

  // Integrate position
  let newX = position.x + vx * dt;
  let newY = position.y + vy * dt;
  let newZ = position.z + vz * dt;

  // Ground collision
  if (newY < groundY) {
    newY = groundY;
    vy = 0;
  }

  // Map bounds
  const halfW = bounds?.halfW ?? MAP_WIDTH / 2;
  const halfD = bounds?.halfD ?? MAP_DEPTH / 2;
  newX = Math.max(-halfW, Math.min(halfW, newX));
  newZ = Math.max(-halfD, Math.min(halfD, newZ));

  return {
    position: { x: newX, y: newY, z: newZ },
    velocity: { x: vx, y: vy, z: vz },
    onGround: newY <= groundY + 0.01,
  };
}

// AABB collision check (used for obstacle avoidance)
export interface AABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY &&
    a.minZ <= b.maxZ && a.maxZ >= b.minZ
  );
}

export function pointInAABB(p: Vec3, box: AABB): boolean {
  return (
    p.x >= box.minX && p.x <= box.maxX &&
    p.y >= box.minY && p.y <= box.maxY &&
    p.z >= box.minZ && p.z <= box.maxZ
  );
}
