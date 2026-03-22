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

export type TeamId = 1 | 2;
export type Role = 'fps' | 'rts';
export type HeroType = 'tank' | 'healer' | 'mechanic';
