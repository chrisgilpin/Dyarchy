export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  yaw: number;
  pitch: number;
  dt: number;
}

export type TeamId = 1 | 2 | 3;
export type Role = 'fps' | 'rts';
export type HeroType = 'tank' | 'healer' | 'mechanic';
export type AIDifficulty = 'easy' | 'medium' | 'hard';

/** Per-slot CPU configuration: null = empty (no CPU), string = CPU difficulty */
export type CPUSlotConfig = Record<string, AIDifficulty | null>; // key: "1_fps", "1_rts", "2_fps", "2_rts"

/** Tunnel system types for underground gameplay */
export interface TunnelPortal {
  position: Vec3;
  targetLayer: number;
  targetPosition: Vec3;
  radius: number; // trigger radius
}

export interface TunnelConfig {
  id: number;             // layer ID (1, 2, etc. — 0 is always surface)
  regions: { min: Vec3; max: Vec3 }[];  // AABB volumes defining the tunnel space
  portals: TunnelPortal[];
  ceilingHeight: number;  // height above tunnel floor
  floorY: number;         // absolute Y of tunnel floor
}
