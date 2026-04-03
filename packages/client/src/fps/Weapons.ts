import * as THREE from 'three';

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  fireRate: number; // shots per second
  range: number;
  spread: number; // base radians of random spread (at close range)
  spreadPerDist: number; // additional spread per unit of distance
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
    spreadPerDist: 0.0008, // low accuracy at distance
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
    spreadPerDist: 0.0003, // higher accuracy at distance
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
    spreadPerDist: 0.003, // very low accuracy at distance
    pellets: 6,
    color: 0x664422,
    slot: 'secondary',
  },
  rocket_launcher: {
    id: 'rocket_launcher',
    name: 'Rocket Launcher',
    damage: 80,
    fireRate: 0.05, // 20 second cooldown
    range: 150,
    spread: 0.005,
    spreadPerDist: 0.0001, // rockets travel straight
    pellets: 1,
    color: 0x556633,
    slot: 'secondary',
  },
  sniper_rifle: {
    id: 'sniper_rifle',
    name: 'Sniper Rifle',
    damage: 40,
    fireRate: 0.333, // 3 second cooldown
    range: 500,
    spread: 0,
    spreadPerDist: 0, // perfect accuracy at any distance
    pellets: 1,
    color: 0x334455,
    slot: 'secondary',
  },
  heli_minigun: {
    id: 'heli_minigun',
    name: 'Helicopter Minigun',
    damage: 4,
    fireRate: 20,
    range: 150,
    spread: 0.015,
    spreadPerDist: 0.0005,
    pellets: 1,
    color: 0x333333,
    slot: 'primary',
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
  } else if (weapon.id === 'rocket_launcher') {
    // Thick tube launcher
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6), mat);
    tube.rotation.x = Math.PI / 2;
    group.add(tube);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), mat);
    grip.position.set(0, -0.08, 0.1);
    group.add(grip);
    const sight = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.06, 0.02),
      new THREE.MeshLambertMaterial({ color: 0xcc3333 }),
    );
    sight.position.set(0, 0.06, -0.15);
    group.add(sight);
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
  } else if (weapon.id === 'sniper_rifle') {
    // Long thin barrel + scope
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.65), mat);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.18), mat);
    stock.position.set(0, -0.01, 0.3);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05), mat);
    grip.position.set(0, -0.07, 0.12);
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.045, -0.1);
    group.add(barrel, stock, grip, scope);
  }

  return group;
}
