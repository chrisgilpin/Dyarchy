import * as THREE from 'three';

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  fireRate: number; // shots per second
  range: number;
  spread: number; // radians of random spread
  pellets: number; // 1 for single shot, more for shotgun
  color: number; // viewmodel color
  slot: 'primary' | 'secondary';
}

export const WEAPONS: Record<string, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    damage: 8,
    fireRate: 4,
    range: 100,
    spread: 0.02,
    pellets: 1,
    color: 0x888888,
    slot: 'primary',
  },
  rifle: {
    id: 'rifle',
    name: 'Rifle',
    damage: 15,
    fireRate: 3,
    range: 200,
    spread: 0.01,
    pellets: 1,
    color: 0x445566,
    slot: 'secondary',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    damage: 8,
    fireRate: 1,
    range: 30,
    spread: 0.08,
    pellets: 6,
    color: 0x664422,
    slot: 'secondary',
  },
};

/** Creates a simple weapon viewmodel mesh for rendering in front of the camera */
export function createWeaponModel(weapon: WeaponDef): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: weapon.color });

  if (weapon.id === 'pistol') {
    // Small boxy pistol
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), mat);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), mat);
    grip.position.set(0, -0.08, 0.05);
    group.add(body, grip);
  } else if (weapon.id === 'rifle') {
    // Long barrel + stock
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), mat);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.15), mat);
    stock.position.set(0, -0.02, 0.25);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05), mat);
    grip.position.set(0, -0.07, 0.1);
    group.add(barrel, stock, grip);
  } else if (weapon.id === 'shotgun') {
    // Wide barrel + pump
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.4), mat);
    const pump = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.04, 0.12),
      new THREE.MeshLambertMaterial({ color: 0x553311 }),
    );
    pump.position.set(0, -0.05, -0.08);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), mat);
    grip.position.set(0, -0.07, 0.12);
    group.add(barrel, pump, grip);
  }

  return group;
}
