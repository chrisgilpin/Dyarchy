import * as THREE from 'three';

/** Team colors: blue team vs red team, with lighter/darker variants */
const TEAM = {
  1: { primary: 0x2255bb, light: 0x4488dd, dark: 0x113388 },
  2: { primary: 0xbb2222, light: 0xdd4444, dark: 0x881111 },
} as const;

/** Create a main base mesh — large building with a roof and door marking */
export function createMainBase(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Base structure
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(8, 5, 8),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  body.position.y = 2.5;
  group.add(body);

  // Pyramid roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(6, 2.5, 4),
    new THREE.MeshLambertMaterial({ color: c.dark }),
  );
  roof.position.y = 6.25;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  // Door marking (front face)
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.5, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x332211 }),
  );
  door.position.set(0, 1.25, 4.05);
  group.add(door);

  // Merge into a single mesh for raycasting
  return groupToMesh(group);
}

/** Create a tower mesh — tall cylinder with a rotating turret gun on top */
export function createTower(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Main cylinder
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2.2, 8, 8),
    new THREE.MeshLambertMaterial({ color: c.light }),
  );
  tower.position.y = 4;
  group.add(tower);

  // Top ring (battlements)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2, 0.3, 6, 8),
    new THREE.MeshLambertMaterial({ color: c.dark }),
  );
  ring.position.y = 8;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Turret platform (rotates)
  const turret = new THREE.Group();
  turret.name = 'turret';
  turret.position.y = 8.5;

  // Turret base (wider, more visible)
  const turretBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.0, 0.6, 8),
    new THREE.MeshLambertMaterial({ color: 0x666666 }),
  );
  turret.add(turretBase);

  // Gun barrel — longer, angled down, pointing in +Z direction (forward)
  const barrelGroup = new THREE.Group();
  barrelGroup.rotation.x = 0.25; // angle down toward ground targets

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 4.5, 6),
    new THREE.MeshLambertMaterial({ color: 0x444444 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 2.25);
  barrelGroup.add(barrel);

  // Barrel housing (thicker section near base)
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 1.0, 6),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  );
  housing.rotation.x = Math.PI / 2;
  housing.position.set(0, 0, 0.5);
  barrelGroup.add(housing);

  turret.add(barrelGroup);

  // Muzzle flash (at barrel tip, hidden by default)
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0 }),
  );
  flash.name = 'muzzle_flash';
  flash.position.set(0, 0, 4.6);
  barrelGroup.add(flash);

  group.add(turret);

  return groupToMesh(group);
}

/** Create a barracks mesh — low wide building with stripes */
export function createBarracks(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(5, 3, 5),
    new THREE.MeshLambertMaterial({ color: 0x556655 }),
  );
  body.position.y = 1.5;
  group.add(body);

  // Flat angled roof
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 0.4, 5.5),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  roof.position.y = 3.2;
  group.add(roof);

  // Stripe marking
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(5.1, 0.6, 0.15),
    new THREE.MeshLambertMaterial({ color: c.light }),
  );
  stripe.position.set(0, 2, 2.55);
  group.add(stripe);

  return groupToMesh(group);
}

/** Create an armory mesh — building with an anvil-shaped top */
export function createArmory(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(5, 3, 5),
    new THREE.MeshLambertMaterial({ color: 0x555566 }),
  );
  body.position.y = 1.5;
  group.add(body);

  // Angled roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.5, 1.5, 4),
    new THREE.MeshLambertMaterial({ color: 0x666677 }),
  );
  roof.position.y = 3.75;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  // Weapon rack markers (X on front)
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.5, 0.1),
      new THREE.MeshLambertMaterial({ color: c.light }),
    );
    bar.position.set(0, 1.5, 2.55);
    bar.rotation.z = rot;
    group.add(bar);
  }

  return groupToMesh(group);
}

/** Create a player tower mesh — smaller tower with team color */
export function createPlayerTower(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2, 7, 6),
    new THREE.MeshLambertMaterial({ color: c.light }),
  );
  base.position.y = 3.5;
  group.add(base);

  const top = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 1.5, 6),
    new THREE.MeshLambertMaterial({ color: c.dark }),
  );
  top.position.y = 7.75;
  group.add(top);

  return groupToMesh(group);
}

/** Create a crystal resource node — faceted gem shape */
export function createResourceNode(): THREE.Mesh {
  const group = new THREE.Group();

  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: 0x44ccff, emissive: 0x112244 }),
  );
  crystal.position.y = 1;
  crystal.scale.set(1, 1.4, 1);
  group.add(crystal);

  // Small base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.8, 0.3, 6),
    new THREE.MeshLambertMaterial({ color: 0x666666 }),
  );
  base.position.y = 0.15;
  group.add(base);

  return groupToMesh(group);
}

/** Create a grunt mesh — humanoid worker with pickaxe. ~1.3 units tall */
export function createGrunt(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Legs
  for (const xOff of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.45, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x665544 }),
    );
    leg.position.set(xOff, 0.225, 0);
    group.add(leg);
  }

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.35),
    new THREE.MeshLambertMaterial({ color: 0x8B7355 }),
  );
  body.position.y = 0.7;
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0xddbb88 }),
  );
  head.position.y = 1.13;
  group.add(head);

  // Team-colored helmet
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  helmet.position.y = 1.17;
  group.add(helmet);

  // Pickaxe on back
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.7, 4),
    new THREE.MeshLambertMaterial({ color: 0x664422 }),
  );
  handle.position.set(0.2, 0.8, -0.12);
  handle.rotation.z = 0.4;
  group.add(handle);

  const pickHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.06, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x999999 }),
  );
  pickHead.position.set(0.35, 1.1, -0.12);
  group.add(pickHead);

  return groupToMesh(group);
}

/** Create a fighter mesh — soldier with shield + sword. ~1.1 units tall */
export function createFighter(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Legs
  for (const xOff of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.35, 0.16),
      new THREE.MeshLambertMaterial({ color: 0x555555 }),
    );
    leg.position.set(xOff, 0.175, 0);
    group.add(leg);
  }

  // Body (armored)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.3),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  body.position.y = 0.55;
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0xddbb88 }),
  );
  head.position.y = 0.9;
  group.add(head);

  // Helmet
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: c.dark }),
  );
  helmet.position.y = 0.93;
  group.add(helmet);

  // Shield (left side)
  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.35, 0.25),
    new THREE.MeshLambertMaterial({ color: c.light }),
  );
  shield.position.set(-0.25, 0.5, 0.05);
  group.add(shield);

  // Sword (right side)
  const sword = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.45, 0.04),
    new THREE.MeshLambertMaterial({ color: 0xcccccc }),
  );
  sword.position.set(0.24, 0.5, 0.05);
  group.add(sword);

  // Sword hilt
  const hilt = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.04, 0.04),
    new THREE.MeshLambertMaterial({ color: 0x664422 }),
  );
  hilt.position.set(0.24, 0.3, 0.05);
  group.add(hilt);

  return groupToMesh(group);
}

/** Create the FPS player mesh visible in RTS view. ~1.5 units tall (slightly taller than grunt) */
export function createFPSPlayer(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Legs
  for (const xOff of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.5, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x334455 }),
    );
    leg.position.set(xOff, 0.25, 0);
    group.add(leg);
  }

  // Body (tactical vest)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.55, 0.35),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  body.position.y = 0.78;
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0xddbb88 }),
  );
  head.position.y = 1.25;
  group.add(head);

  // Visor (glowing, distinguishes from other units)
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.07, 0.07),
    new THREE.MeshLambertMaterial({ color: 0x00ffff, emissive: 0x006666 }),
  );
  visor.position.set(0, 1.25, 0.18);
  group.add(visor);

  // Gun held in front
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.35),
    new THREE.MeshLambertMaterial({ color: 0x444444 }),
  );
  gun.position.set(0.22, 0.65, 0.2);
  group.add(gun);

  return groupToMesh(group);
}

/** Obstacle — rocky block */
export function createObstacle(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(3, 3, 3);
  // Slightly randomize vertices for a rough look
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.3);
    pos.setY(i, pos.getY(i) + (Math.random() - 0.5) * 0.3);
    pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.3);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x777766 }));
}

// ===================== Helper =====================

/** Convert a group of meshes into a single mesh wrapper for raycasting.
 *  The returned mesh has its origin at y=0 (ground level).
 *  Visual children keep their original y positions (feet near y=0). */
function groupToMesh(group: THREE.Group): THREE.Mesh {
  const bounds = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const center = new THREE.Vector3();
  bounds.getCenter(center);

  // Create hitbox geometry translated upward so it aligns with the visual,
  // while the mesh origin stays at y=0 (ground level)
  const hitGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
  hitGeo.translate(0, center.y, 0);

  const hitbox = new THREE.Mesh(
    hitGeo,
    new THREE.MeshLambertMaterial({ visible: false }),
  );

  // Visual group keeps its original positions (built from ground up)
  hitbox.add(group);

  return hitbox;
}
