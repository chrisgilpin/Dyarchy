import * as THREE from 'three';

/** Team colors: blue team vs red team, with lighter/darker variants */
const TEAM = {
  1: { primary: 0x2255bb, light: 0x4488dd, dark: 0x113388 },
  2: { primary: 0xbb2222, light: 0xdd4444, dark: 0x881111 },
} as const;

/** Add eyes (and hidden X-eyes for death) to a unit at the given head position.
 *  eyeY = center Y of the head, faceZ = front face Z of the head */
function addEyes(group: THREE.Group, eyeY: number, faceZ: number, spacing = 0.08, eyeSize = 0.08): void {
  const eyeGroup = new THREE.Group();
  eyeGroup.name = 'eyes_alive';
  for (const xOff of [-spacing, spacing]) {
    // White of eye
    const white = new THREE.Mesh(
      new THREE.BoxGeometry(eyeSize * 1.3, eyeSize * 1.3, 0.01),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    white.position.set(xOff, eyeY, faceZ + 0.005);
    eyeGroup.add(white);
    // Pupil
    const pupil = new THREE.Mesh(
      new THREE.BoxGeometry(eyeSize * 0.6, eyeSize * 0.6, 0.01),
      new THREE.MeshLambertMaterial({ color: 0x111111 }),
    );
    pupil.position.set(xOff, eyeY, faceZ + 0.01);
    eyeGroup.add(pupil);
  }
  group.add(eyeGroup);

  // X-eyes (hidden by default, shown on death)
  const xGroup = new THREE.Group();
  xGroup.name = 'eyes_dead';
  xGroup.visible = false;
  const xMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  for (const xOff of [-spacing, spacing]) {
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(eyeSize * 1.4, eyeSize * 0.3, 0.01),
        xMat,
      );
      bar.position.set(xOff, eyeY, faceZ + 0.01);
      bar.rotation.z = angle;
      xGroup.add(bar);
    }
  }
  group.add(xGroup);
}

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

  // Turret platform on top of roof
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 0.4, 8),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  );
  platform.position.y = 7.7;
  group.add(platform);

  // Turret gun barrel
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.15, 2.5, 6),
    new THREE.MeshLambertMaterial({ color: 0x333333 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 8.0, 1.0);
  group.add(barrel);

  // Turret housing
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.8, 1.0),
    new THREE.MeshLambertMaterial({ color: c.light }),
  );
  housing.position.y = 8.0;
  group.add(housing);

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

  // Muzzle flash (at barrel tip, hidden by default via visible=false)
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffff44 }),
  );
  flash.name = 'muzzle_flash';
  flash.visible = false;
  flash.position.set(0, 0, 4.6);
  barrelGroup.add(flash);

  group.add(turret);

  return groupToMesh(group);
}

/** Create a barracks mesh — low wide building with stripes */
/** Create a farm mesh — small wooden building with crop field */
export function createFarm(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Barn structure
  const barn = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2.5, 3),
    new THREE.MeshLambertMaterial({ color: 0x8B6914 }),
  );
  barn.position.y = 1.25;
  group.add(barn);

  // Roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.5, 1.2, 4),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  roof.position.y = 3.1;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  // Door
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.2, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x553311 }),
  );
  door.position.set(0, 0.6, 1.53);
  group.add(door);

  // Crop patches (green squares around the barn)
  for (const [x, z] of [[-2, -1], [-2, 1], [2, -1], [2, 1]] as const) {
    const crop = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.15, 1.2),
      new THREE.MeshLambertMaterial({ color: 0x44aa33 }),
    );
    crop.position.set(x, 0.08, z);
    group.add(crop);
  }

  return groupToMesh(group);
}

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

/** Create a hero academy — castle-like building with blue roofs, gold spires, and banners */
export function createHeroAcademy(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();
  const stone = 0xbbaa88;

  // Main stone body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(6, 4, 6),
    new THREE.MeshLambertMaterial({ color: stone }),
  );
  body.position.y = 2;
  group.add(body);

  // Central tower
  const centralTower = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 3, 2.5),
    new THREE.MeshLambertMaterial({ color: stone }),
  );
  centralTower.position.y = 5.5;
  group.add(centralTower);

  // Central roof (blue cone)
  const centralRoof = new THREE.Mesh(
    new THREE.ConeGeometry(2, 2.5, 6),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  centralRoof.position.y = 8.25;
  group.add(centralRoof);

  // Gold spire on top
  const centralSpire = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 1.2, 4),
    new THREE.MeshLambertMaterial({ color: 0xddaa00 }),
  );
  centralSpire.position.y = 10;
  group.add(centralSpire);

  // Four corner turrets with blue roofs and gold spires
  for (const [cx, cz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.9, 4.5, 6),
      new THREE.MeshLambertMaterial({ color: stone }),
    );
    turret.position.set(cx, 2.25, cz);
    group.add(turret);

    const turretRoof = new THREE.Mesh(
      new THREE.ConeGeometry(1.1, 1.5, 6),
      new THREE.MeshLambertMaterial({ color: c.primary }),
    );
    turretRoof.position.set(cx, 5.25, cz);
    group.add(turretRoof);

    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.8, 4),
      new THREE.MeshLambertMaterial({ color: 0xddaa00 }),
    );
    spire.position.set(cx, 6.4, cz);
    group.add(spire);
  }

  // Front archway (dark opening)
  const archway = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.5, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x332211 }),
  );
  archway.position.set(0, 1.25, 3.1);
  group.add(archway);

  // Banner on front (team-colored, red/gold trim)
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.8),
    new THREE.MeshLambertMaterial({ color: c.light, side: THREE.DoubleSide }),
  );
  banner.position.set(0, 5, 3.15);
  group.add(banner);

  // Gold emblem on banner
  const emblem = new THREE.Mesh(
    new THREE.CircleGeometry(0.35, 8),
    new THREE.MeshLambertMaterial({ color: 0xddaa00, side: THREE.DoubleSide }),
  );
  emblem.position.set(0, 5.2, 3.2);
  group.add(emblem);

  const merged = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01));
  merged.add(group);
  return merged;
}

/** Create a garage — rectangular building, larger than armory */
export function createGarage(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Main body — wide rectangle
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(7, 4, 6),
    new THREE.MeshLambertMaterial({ color: 0x5a5a5a }),
  );
  body.position.y = 2;
  group.add(body);

  // Flat roof with slight overhang
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(7.4, 0.3, 6.4),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  roof.position.y = 4.15;
  group.add(roof);

  // Garage door (front face) — large opening
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 3, 0.15),
    new THREE.MeshLambertMaterial({ color: 0x333333 }),
  );
  door.position.set(0, 1.5, 3.05);
  group.add(door);

  // Door frame
  const frameMat = new THREE.MeshLambertMaterial({ color: c.light });
  // Top bar
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 0.2), frameMat);
  topBar.position.set(0, 3.1, 3.05);
  group.add(topBar);
  // Side bars
  for (const side of [-1, 1]) {
    const sideBar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.2), frameMat);
    sideBar.position.set(side * 2.375, 1.5, 3.05);
    group.add(sideBar);
  }

  // "G" label on top
  const labelMat = new THREE.MeshLambertMaterial({ color: c.light });
  // G shape made of boxes
  const gParts: [number, number, number, number, number][] = [
    // [w, h, x, y, z] relative to roof top
    [1.2, 0.2, 0, 0.3, 0.4],    // top bar
    [0.2, 1.2, -0.5, 0.3, 0],   // left bar
    [1.2, 0.2, 0, 0.3, -0.4],   // bottom bar
    [0.2, 0.5, 0.5, 0.3, -0.15], // right bottom
    [0.6, 0.2, 0.3, 0.3, 0],    // middle bar
  ];
  for (const [w, h, x, y, z] of gParts) {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, h), labelMat);
    part.position.set(x, 4.35 + y * 0.1, z);
    group.add(part);
  }

  return groupToMesh(group);
}

/** Create a jeep vehicle — Warthog-style military jeep with mounted turret */
export function createJeep(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Chassis — wide, low body
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.8, 4.5),
    new THREE.MeshLambertMaterial({ color: 0x5a6a3a }),
  );
  chassis.position.y = 0.7;
  group.add(chassis);

  // Hood (front, slightly raised and angled)
  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.4, 1.5),
    new THREE.MeshLambertMaterial({ color: 0x4e5e32 }),
  );
  hood.position.set(0, 1.2, -1.2);
  hood.rotation.x = -0.15;
  group.add(hood);

  // Windshield
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.8, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x88ccee, transparent: true, opacity: 0.5 }),
  );
  windshield.position.set(0, 1.6, -0.4);
  windshield.rotation.x = -0.3;
  group.add(windshield);

  // Roll cage / cab frame
  const cageMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  for (const xSign of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), cageMat);
    post.position.set(xSign * 1.15, 1.6, -0.1);
    group.add(post);
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.5), cageMat);
    topBar.position.set(xSign * 1.15, 2.1, 0.4);
    group.add(topBar);
  }

  // Rear bed
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.5, 1.8),
    new THREE.MeshLambertMaterial({ color: 0x4e5e32 }),
  );
  bed.position.set(0, 0.8, 1.4);
  group.add(bed);

  // Side panels
  for (const xSign of [-1, 1]) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.6, 1.5),
      new THREE.MeshLambertMaterial({ color: 0x5a6a3a }),
    );
    panel.position.set(xSign * 1.4, 1.2, 1.4);
    group.add(panel);
  }

  // Wheels (4)
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
  const wheelPositions: [number, number][] = [[-1.4, -1.3], [1.4, -1.3], [-1.4, 1.5], [1.4, 1.5]];
  for (const [wx, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 8), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.5, wz);
    group.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 6), hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.5, wz);
    group.add(hub);
  }

  // Headlights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
  for (const xSign of [-1, 1]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 5), lightMat);
    light.position.set(xSign * 0.8, 1.0, -2.25);
    group.add(light);
  }

  // Front bumper/grille
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.4, 0.15),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  );
  grille.position.set(0, 0.8, -2.25);
  group.add(grille);

  // Mounted turret (rear) — rotatable group named 'turret'
  const turretGroup = new THREE.Group();
  turretGroup.name = 'turret';
  turretGroup.position.set(0, 2.0, 1.2);

  // Turret base/pedestal
  const turretBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.5, 0.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x666666 }),
  );
  turretGroup.add(turretBase);

  // Shield plates
  const shieldMat = new THREE.MeshLambertMaterial({ color: c.primary });
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.1), shieldMat);
  shield.position.set(0, 0.5, -0.4);
  turretGroup.add(shield);
  for (const xSign of [-1, 1]) {
    const sideShield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.8), shieldMat);
    sideShield.position.set(xSign * 0.6, 0.5, 0);
    turretGroup.add(sideShield);
  }

  // Gun barrels (twin)
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  for (const xSign of [-0.5, 0.5]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 5), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(xSign * 0.2, 0.6, -1.3);
    turretGroup.add(barrel);
  }

  // Muzzle flash (hidden by default via visible=false)
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffff44 }),
  );
  flash.name = 'muzzle_flash';
  flash.visible = false;
  flash.position.set(0, 0.6, -2.2);
  turretGroup.add(flash);

  group.add(turretGroup);

  // Team color stripe along side
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.2, 4.5),
    new THREE.MeshLambertMaterial({ color: c.light }),
  );
  stripe.position.set(1.42, 0.9, 0);
  group.add(stripe);
  const stripe2 = stripe.clone();
  stripe2.position.x = -1.42;
  group.add(stripe2);

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

  // Turret platform (rotates to track targets)
  const turret = new THREE.Group();
  turret.name = 'turret';
  turret.position.y = 7.2;

  const turretBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.7, 0.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x666666 }),
  );
  turret.add(turretBase);

  // Gun barrel
  const barrelGroup = new THREE.Group();
  barrelGroup.name = 'barrel_primary';
  barrelGroup.rotation.x = 0.2;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 3.0, 6),
    new THREE.MeshLambertMaterial({ color: 0x444444 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 1.5);
  barrelGroup.add(barrel);
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.7, 6),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  );
  housing.rotation.x = Math.PI / 2;
  housing.position.set(0, 0, 0.35);
  barrelGroup.add(housing);
  turret.add(barrelGroup);

  // Muzzle flash
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffff44 }),
  );
  flash.name = 'muzzle_flash';
  flash.visible = false;
  flash.position.set(0, 0, 3.2);
  barrelGroup.add(flash);

  group.add(turret);

  return groupToMesh(group);
}

/** Create a crystal resource node — cluster of crystals */
export function createResourceNode(): THREE.Mesh {
  const group = new THREE.Group();

  // Rocky base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.2, 0.4, 8),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  );
  base.position.y = 0.2;
  group.add(base);

  // Main large crystal
  const mainCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9, 0),
    new THREE.MeshLambertMaterial({ color: 0x44ccff, emissive: 0x112244 }),
  );
  mainCrystal.position.set(0, 1.2, 0);
  mainCrystal.scale.set(1, 1.5, 1);
  group.add(mainCrystal);

  // Surrounding smaller crystals
  const offsets = [
    { x: -0.9, z: -0.5, s: 0.55, h: 0.8, tilt: 0.3 },
    { x: 0.8, z: -0.6, s: 0.5, h: 0.7, tilt: -0.25 },
    { x: 0.3, z: 0.9, s: 0.6, h: 0.9, tilt: 0.2 },
    { x: -0.6, z: 0.7, s: 0.4, h: 0.6, tilt: -0.35 },
    { x: 1.1, z: 0.3, s: 0.35, h: 0.5, tilt: 0.4 },
  ];
  for (const o of offsets) {
    const c = new THREE.Mesh(
      new THREE.OctahedronGeometry(o.s, 0),
      new THREE.MeshLambertMaterial({ color: 0x55ddff, emissive: 0x0a1a33 }),
    );
    c.position.set(o.x, o.h, o.z);
    c.scale.set(1, 1.4, 1);
    c.rotation.z = o.tilt;
    group.add(c);
  }

  // Glowing beacon above crystals (visible even through fog)
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x66eeff, transparent: true, opacity: 0.6 }),
  );
  beacon.position.y = 3;
  group.add(beacon);

  // Point light for glow
  const light = new THREE.PointLight(0x44ccff, 0.8, 8);
  light.position.y = 2.5;
  group.add(light);

  return groupToMesh(group);
}

/** Create a worker mesh — construction worker with hard hat, overalls, and hammer. ~1.3 units tall */
export function createWorker(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const overallColor = teamId === 1 ? 0x3366aa : 0xaa3333; // blue or red overalls
  const group = new THREE.Group();

  // Legs as groups (boot + overalls together, pivot at hip)
  for (const xOff of [-0.12, 0.12]) {
    const legGroup = new THREE.Group();
    legGroup.name = xOff < 0 ? 'leg_l' : 'leg_r';
    legGroup.position.set(xOff, 0.5, 0); // pivot at hip

    const boot = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.2, 0.22),
      new THREE.MeshLambertMaterial({ color: 0x553322 }),
    );
    boot.position.set(0, -0.4, 0);
    legGroup.add(boot);

    const overalls = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.3, 0.2),
      new THREE.MeshLambertMaterial({ color: overallColor }),
    );
    overalls.position.set(0, -0.15, 0);
    legGroup.add(overalls);

    group.add(legGroup);
  }

  // White t-shirt (upper body)
  const shirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.25, 0.35),
    new THREE.MeshLambertMaterial({ color: 0xeeeeee }),
  );
  shirt.position.y = 0.65;
  group.add(shirt);

  // Team-colored overalls bib
  const bib = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.2, 0.36),
    new THREE.MeshLambertMaterial({ color: overallColor }),
  );
  bib.position.set(0, 0.72, 0);
  group.add(bib);

  // Crystal bag on back (hidden by default, shown when carrying crystals)
  const bag = new THREE.Group();
  bag.name = 'crystal_bag';
  bag.visible = false;
  const sack = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.5, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x886644 }),
  );
  sack.position.set(0, 0.55, -0.28);
  bag.add(sack);
  // Crystals poking out of the top
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.14, 0),
    new THREE.MeshLambertMaterial({ color: 0x44ccff, emissive: 0x112244 }),
  );
  crystal.position.set(0.08, 0.85, -0.28);
  crystal.scale.set(1, 1.3, 1);
  bag.add(crystal);
  const crystal2 = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.1, 0),
    new THREE.MeshLambertMaterial({ color: 0x55ddff, emissive: 0x0a1a33 }),
  );
  crystal2.position.set(-0.1, 0.82, -0.25);
  crystal2.scale.set(1, 1.2, 1);
  bag.add(crystal2);
  group.add(bag);

  // Brown tool belt
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.06, 0.37),
    new THREE.MeshLambertMaterial({ color: 0x885533 }),
  );
  belt.position.y = 0.52;
  group.add(belt);

  // Head (skin tone)
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.26, 0.26),
    new THREE.MeshLambertMaterial({ color: 0xddbb88 }),
  );
  head.position.y = 0.97;
  group.add(head);

  addEyes(group, 0.99, 0.13);

  // Brown beard
  const beard = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.1, 0.14),
    new THREE.MeshLambertMaterial({ color: 0x664422 }),
  );
  beard.position.set(0, 0.87, 0.08);
  group.add(beard);

  // Yellow hard hat (brim + dome)
  const hatBrim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.04, 8),
    new THREE.MeshLambertMaterial({ color: 0xffcc00 }),
  );
  hatBrim.position.y = 1.12;
  group.add(hatBrim);

  const hatDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xffcc00 }),
  );
  hatDome.position.y = 1.14;
  group.add(hatDome);

  // Orange hat band
  const hatBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.175, 0.175, 0.03, 8),
    new THREE.MeshLambertMaterial({ color: 0xff8800 }),
  );
  hatBand.position.y = 1.12;
  group.add(hatBand);

  // Hammer as named group (for animation), pivots at shoulder
  const weaponGroup = new THREE.Group();
  weaponGroup.name = 'weapon';
  weaponGroup.position.set(0.3, 0.8, 0.05); // pivot at right shoulder

  const hammerHandle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4),
    new THREE.MeshLambertMaterial({ color: 0x885533 }),
  );
  hammerHandle.position.set(0, -0.1, 0);
  hammerHandle.rotation.z = -0.3;
  weaponGroup.add(hammerHandle);

  const hammerHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.12, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x888888 }),
  );
  hammerHead.position.set(0.06, 0.12, 0);
  weaponGroup.add(hammerHead);

  group.add(weaponGroup);

  return groupToMesh(group);
}

/** Create a fighter mesh — barbarian warrior with club, headband, leather vest. ~1.1 units tall */
export function createFighter(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Legs as groups (boot + pants together, pivot at hip)
  for (const xOff of [-0.12, 0.12]) {
    const legGroup = new THREE.Group();
    legGroup.name = xOff < 0 ? 'leg_l' : 'leg_r';
    legGroup.position.set(xOff, 0.4, 0); // pivot at hip height

    const boot = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.15, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x664433 }),
    );
    boot.position.set(0, -0.325, 0);
    legGroup.add(boot);

    const pants = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.25, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x556633 }),
    );
    pants.position.set(0, -0.12, 0);
    legGroup.add(pants);

    group.add(legGroup);
  }

  // Brown leather belt with buckle
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.06, 0.32),
    new THREE.MeshLambertMaterial({ color: 0x775533 }),
  );
  belt.position.y = 0.43;
  group.add(belt);

  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.04, 0.01),
    new THREE.MeshLambertMaterial({ color: 0xaa8833 }),
  );
  buckle.position.set(0, 0.43, 0.165);
  group.add(buckle);

  // Bare skin arms (muscular)
  for (const xOff of [-0.26, 0.26]) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.3, 0.14),
      new THREE.MeshLambertMaterial({ color: 0xddaa77 }),
    );
    arm.position.set(xOff, 0.6, 0);
    group.add(arm);
  }

  // Brown leather wrist guards
  for (const xOff of [-0.26, 0.26]) {
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.08, 0.15),
      new THREE.MeshLambertMaterial({ color: 0x664422 }),
    );
    guard.position.set(xOff, 0.48, 0);
    group.add(guard);
  }

  // Brown leather vest (torso)
  const vest = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.35, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x885533 }),
  );
  vest.position.y = 0.63;
  group.add(vest);

  // V-neck skin showing
  const vneck = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.1, 0.01),
    new THREE.MeshLambertMaterial({ color: 0xddaa77 }),
  );
  vneck.position.set(0, 0.72, 0.155);
  group.add(vneck);

  // Head (skin tone)
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.24, 0.24),
    new THREE.MeshLambertMaterial({ color: 0xddbb88 }),
  );
  head.position.y = 0.95;
  group.add(head);
  addEyes(group, 0.97, 0.12);

  // Spiky brown hair (multiple small boxes jutting upward)
  const hairColor = 0x553322;
  for (let i = 0; i < 7; i++) {
    const spike = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08 + Math.random() * 0.06, 0.06),
      new THREE.MeshLambertMaterial({ color: hairColor }),
    );
    spike.position.set(
      (Math.random() - 0.5) * 0.2,
      1.12 + Math.random() * 0.04,
      (Math.random() - 0.5) * 0.18,
    );
    spike.rotation.set(
      (Math.random() - 0.5) * 0.4,
      Math.random() * 0.5,
      (Math.random() - 0.5) * 0.4,
    );
    group.add(spike);
  }

  // Red headband (team-colored)
  const headband = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.04, 0.26),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  headband.position.y = 1.0;
  group.add(headband);

  // Headband tail (small flap trailing behind)
  const bandTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.03, 0.1),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  bandTail.position.set(0.13, 0.99, -0.16);
  bandTail.rotation.z = -0.3;
  group.add(bandTail);

  // Wooden club as a named group (for attack animation), pivots at shoulder
  const weaponGroup = new THREE.Group();
  weaponGroup.name = 'weapon';
  weaponGroup.position.set(0.15, 0.7, 0.1); // pivot at right shoulder

  const clubHandle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.03, 0.6, 5),
    new THREE.MeshLambertMaterial({ color: 0x775533 }),
  );
  clubHandle.position.set(0.1, -0.2, 0.1);
  clubHandle.rotation.z = Math.PI / 2;
  weaponGroup.add(clubHandle);

  const clubHead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.04, 0.15, 5),
    new THREE.MeshLambertMaterial({ color: 0x664422 }),
  );
  clubHead.position.set(0.35, -0.2, 0.1);
  clubHead.rotation.z = Math.PI / 2;
  weaponGroup.add(clubHead);

  group.add(weaponGroup);

  return groupToMesh(group);
}

/** Create a foot soldier mesh — ranged combat unit with a gun. ~1.2 units tall */
/** Create an archer mesh — ranged unit with bow. ~1.2 units tall */
export function createArcher(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Legs
  for (const xOff of [-0.1, 0.1]) {
    const legGroup = new THREE.Group();
    legGroup.name = xOff < 0 ? 'leg_l' : 'leg_r';
    legGroup.position.set(xOff, 0.4, 0);
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.4, 0.16),
      new THREE.MeshLambertMaterial({ color: 0x556644 }),
    );
    leg.position.set(0, -0.2, 0);
    legGroup.add(leg);
    group.add(legGroup);
  }

  // Body (hooded tunic)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.38, 0.28),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  body.position.y = 0.6;
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 0.22),
    new THREE.MeshLambertMaterial({ color: 0xddbb88 }),
  );
  head.position.y = 0.93;
  group.add(head);
  addEyes(group, 0.95, 0.11, 0.06, 0.07);

  // Hood
  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.16, 0.26),
    new THREE.MeshLambertMaterial({ color: c.dark }),
  );
  hood.position.y = 1.04;
  group.add(hood);

  // Bow (left side) as weapon group
  const weaponGroup = new THREE.Group();
  weaponGroup.name = 'weapon';
  weaponGroup.position.set(-0.25, 0.65, 0.1);

  const bowCurve = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.02, 4, 8, Math.PI),
    new THREE.MeshLambertMaterial({ color: 0x885533 }),
  );
  bowCurve.rotation.z = Math.PI / 2;
  weaponGroup.add(bowCurve);

  // Bowstring
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.4, 3),
    new THREE.MeshLambertMaterial({ color: 0xcccccc }),
  );
  string.position.x = 0.0;
  weaponGroup.add(string);

  group.add(weaponGroup);

  // Quiver on back
  const quiver = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.05, 0.35, 5),
    new THREE.MeshLambertMaterial({ color: 0x664422 }),
  );
  quiver.position.set(0.1, 0.65, -0.18);
  quiver.rotation.z = 0.15;
  group.add(quiver);

  return groupToMesh(group);
}

export function createFootSoldier(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Legs as named groups
  for (const xOff of [-0.1, 0.1]) {
    const legGroup = new THREE.Group();
    legGroup.name = xOff < 0 ? 'leg_l' : 'leg_r';
    legGroup.position.set(xOff, 0.4, 0);

    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.4, 0.16),
      new THREE.MeshLambertMaterial({ color: 0x444444 }),
    );
    leg.position.set(0, -0.2, 0);
    legGroup.add(leg);
    group.add(legGroup);
  }

  // Body (tactical vest)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.3),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  body.position.set(0, 0.6, 0);
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 0.22),
    new THREE.MeshLambertMaterial({ color: 0xddbb88 }),
  );
  head.position.set(0, 0.93, 0);
  group.add(head);
  addEyes(group, 0.95, 0.11, 0.06, 0.07);

  // Beret
  const beret = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.12, 0.08, 8),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  beret.position.set(0.02, 1.08, 0);
  group.add(beret);

  // Gun (right hand) as named group
  const weaponGroup = new THREE.Group();
  weaponGroup.name = 'weapon';
  weaponGroup.position.set(0.28, 0.6, -0.1);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x333333 }),
  );
  weaponGroup.add(gun);
  group.add(weaponGroup);

  return groupToMesh(group);
}

/** Create the FPS player mesh visible in RTS view. ~1.5 units tall (slightly taller than grunt) */
export function createFPSPlayer(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc8a070 });
  const bootMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
  const beltMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x6b6b3a });
  const jacketMat = new THREE.MeshLambertMaterial({ color: 0x3a4a7a });
  const shirtMat = new THREE.MeshLambertMaterial({ color: 0xddddcc });
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x553322 });
  const buckleMat = new THREE.MeshLambertMaterial({ color: 0xbb9933 });
  const capeMat = new THREE.MeshLambertMaterial({ color: c.primary, side: THREE.DoubleSide });

  // ---- Boots ----
  for (const xOff of [-0.13, 0.13]) {
    const legGroup = new THREE.Group();
    legGroup.name = xOff < 0 ? 'leg_l' : 'leg_r';
    legGroup.position.set(xOff, 0.5, 0);

    // Upper leg (pants)
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.28, 0.19), pantsMat);
    thigh.position.set(0, -0.14, 0);
    legGroup.add(thigh);

    // Boot (lower leg)
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.26, 0.22), bootMat);
    boot.position.set(0, -0.37, 0);
    legGroup.add(boot);

    // Boot buckle
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.01), buckleMat);
    buckle.position.set(0, -0.28, 0.11);
    legGroup.add(buckle);

    // Boot sole
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.04, 0.24), new THREE.MeshLambertMaterial({ color: 0x3a2510 }));
    sole.position.set(0, -0.50, 0);
    legGroup.add(sole);

    group.add(legGroup);
  }

  // ---- Torso — layered shirt + jacket ----
  // Shirt (white, open collar — slightly visible)
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.20, 0.30), shirtMat);
  shirt.position.set(0, 0.92, 0);
  group.add(shirt);

  // Jacket (blue/team-tinted)
  const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.48, 0.34), jacketMat);
  jacket.position.set(0, 0.78, 0);
  group.add(jacket);

  // Jacket trim (gold edges on shoulders)
  for (const sx of [-0.24, 0.24]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.34), buckleMat);
    trim.position.set(sx, 1.0, 0);
    group.add(trim);
  }

  // ---- Belt + pouches ----
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.36), beltMat);
  belt.position.set(0, 0.56, 0);
  group.add(belt);

  // Belt buckle (center)
  const mainBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.02), buckleMat);
  mainBuckle.position.set(0, 0.56, 0.18);
  group.add(mainBuckle);

  // Shoulder strap (diagonal)
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.50, 0.06), beltMat);
  strap.position.set(-0.05, 0.80, 0.15);
  strap.rotation.z = 0.5;
  group.add(strap);

  // Pouches on belt
  for (const [px, pz] of [[-0.22, 0.16], [0.22, 0.16], [-0.20, -0.14]] as [number, number][]) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.07), beltMat);
    pouch.position.set(px, 0.53, pz);
    group.add(pouch);
  }

  // ---- Arms ----
  for (const [xOff, name] of [[-0.32, 'arm_l'], [0.32, 'arm_r']] as [number, string][]) {
    // Upper arm (jacket sleeve)
    const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.16), jacketMat);
    upperArm.position.set(xOff, 0.88, 0);
    group.add(upperArm);

    // Forearm (skin with wrist wrap)
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.14), skinMat);
    forearm.position.set(xOff, 0.68, 0.06);
    group.add(forearm);

    // Wrist bracer
    const bracer = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.15), beltMat);
    bracer.position.set(xOff, 0.64, 0.06);
    group.add(bracer);
  }

  // ---- Head ----
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 8), skinMat);
  head.position.y = 1.22;
  group.add(head);
  addEyes(group, 1.24, 0.18, 0.06, 0.07);

  // Spiky hair (multiple angled blocks)
  const hairBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.30), hairMat);
  hairBase.position.set(0, 1.38, -0.02);
  group.add(hairBase);

  // Hair spikes
  const spikeGeo = new THREE.ConeGeometry(0.06, 0.16, 4);
  for (const [sx, sy, sz, rx, rz] of [
    [0, 1.48, -0.04, -0.3, 0],
    [-0.10, 1.46, -0.02, -0.2, 0.4],
    [0.10, 1.46, -0.02, -0.2, -0.4],
    [0.05, 1.47, 0.06, 0.3, -0.2],
    [-0.08, 1.45, 0.04, 0.2, 0.3],
    [0, 1.44, -0.10, -0.6, 0],
  ] as [number, number, number, number, number][]) {
    const spike = new THREE.Mesh(spikeGeo, hairMat);
    spike.position.set(sx, sy, sz);
    spike.rotation.set(rx, 0, rz);
    group.add(spike);
  }

  // ---- Cape (team-colored, drapes from shoulders) ----
  // Flat plane attached to upper back, team colored
  const capeTop = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.04, 0.04), capeMat);
  capeTop.position.set(0, 1.0, -0.18);
  group.add(capeTop);

  // Cape body — tapered plane flowing down the back
  const capeShape = new THREE.Shape();
  capeShape.moveTo(-0.15, 0);
  capeShape.lineTo(0.15, 0);
  capeShape.lineTo(0.20, -0.55);
  capeShape.lineTo(-0.20, -0.55);
  capeShape.closePath();
  const capeGeo = new THREE.ShapeGeometry(capeShape);
  const cape = new THREE.Mesh(capeGeo, capeMat);
  cape.position.set(0, 1.0, -0.19);
  cape.name = 'cape';
  group.add(cape);

  // Cape tattered bottom edge (small triangular cuts)
  for (const tx of [-0.14, -0.05, 0.05, 0.14]) {
    const tatter = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.08, 3),
      capeMat,
    );
    tatter.position.set(tx, 0.42, -0.19);
    tatter.rotation.x = Math.PI;
    group.add(tatter);
  }

  // ---- Gun held in front ----
  // Revolver-style (barrel + grip)
  const gunBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.28, 6),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  );
  gunBarrel.rotation.x = Math.PI / 2;
  gunBarrel.position.set(0.28, 0.72, 0.22);
  group.add(gunBarrel);

  const gunCylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6),
    new THREE.MeshLambertMaterial({ color: 0x444444 }),
  );
  gunCylinder.rotation.x = Math.PI / 2;
  gunCylinder.position.set(0.28, 0.72, 0.10);
  group.add(gunCylinder);

  const gunGrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.10, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x6b4226 }),
  );
  gunGrip.position.set(0.28, 0.65, 0.06);
  group.add(gunGrip);

  // Gold trigger guard
  const triggerGuard = new THREE.Mesh(
    new THREE.TorusGeometry(0.025, 0.008, 4, 6, Math.PI),
    buckleMat,
  );
  triggerGuard.position.set(0.28, 0.68, 0.10);
  triggerGuard.rotation.y = Math.PI / 2;
  group.add(triggerGuard);

  // Rotate visual group so eyes/gun face -Z (matching the server's forward direction)
  group.rotation.y = Math.PI;

  return groupToMesh(group);
}

/** Create a player-built turret — small platform with a rotating gun */
export function createTurret(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Sandbag base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.8, 1.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a7a5a }),
  );
  base.position.y = 0.6;
  group.add(base);

  // Turret platform
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 0.3, 8),
    new THREE.MeshLambertMaterial({ color: 0x666666 }),
  );
  platform.position.y = 1.35;
  group.add(platform);

  // Turret gun (rotates — named 'turret')
  const turret = new THREE.Group();
  turret.name = 'turret';
  turret.position.y = 1.5;

  const gunBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.4, 0.3, 6),
    new THREE.MeshLambertMaterial({ color: c.dark }),
  );
  turret.add(gunBase);

  const barrelGroup = new THREE.Group();
  barrelGroup.rotation.x = 0.15;

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 2.0, 5),
    new THREE.MeshLambertMaterial({ color: 0x444444 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 1.0);
  barrelGroup.add(barrel);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffff44 }),
  );
  flash.name = 'muzzle_flash';
  flash.visible = false;
  flash.position.set(0, 0, 2.1);
  barrelGroup.add(flash);

  turret.add(barrelGroup);
  group.add(turret);

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

// ===================== Vegetation =====================

/** Create a decorative tree */
/** Create a sniper nest — tall elevated platform with ladder for FPS player */
export function createSniperNest(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Four support poles
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x664422 });
  for (const [xOff, zOff] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10, 5), poleMat);
    pole.position.set(xOff * 1.2, 5, zOff * 1.2);
    group.add(pole);
  }

  // Platform at top
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.2, 3),
    new THREE.MeshLambertMaterial({ color: 0x886644 }),
  );
  platform.position.y = 9.5;
  group.add(platform);

  // Low railing (team-colored)
  const railMat = new THREE.MeshLambertMaterial({ color: c.primary });
  for (const [xOff, zOff, w, d] of [[-1.4, 0, 0.1, 3], [1.4, 0, 0.1, 3], [0, -1.4, 3, 0.1], [0, 1.4, 3, 0.1]] as const) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), railMat);
    rail.position.set(xOff, 10, zOff);
    group.add(rail);
  }

  // Ladder on one side
  const ladderMat = new THREE.MeshLambertMaterial({ color: 0x775533 });
  // Side rails
  for (const xOff of [-0.3, 0.3]) {
    const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 10, 0.08), ladderMat);
    sideRail.position.set(xOff, 5, 1.3);
    group.add(sideRail);
  }
  // Rungs
  for (let y = 1; y < 10; y += 0.8) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.08), ladderMat);
    rung.position.set(0, y, 1.3);
    group.add(rung);
  }

  // Team flag on a pole
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 4), poleMat);
  flagPole.position.set(-1.2, 11, -1.2);
  group.add(flagPole);
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.4, 0.02),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  flag.position.set(-0.9, 11.5, -1.2);
  group.add(flag);

  return groupToMesh(group);
}

export function createTree(leafColors?: number[], trunkColor?: number): THREE.Group {
  const group = new THREE.Group();
  // Trunk
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.4, 3, 6),
    new THREE.MeshLambertMaterial({ color: trunkColor ?? 0x664422 }),
  );
  trunk.position.y = 1.5;
  group.add(trunk);
  // Foliage layers
  const defaultLeaf = 0x227722;
  const colors = leafColors ?? [defaultLeaf];
  for (const [y, r, h] of [[3.5, 2.2, 2], [4.5, 1.6, 1.8], [5.3, 1.0, 1.4]] as const) {
    const baseColor = colors[Math.floor(Math.random() * colors.length)];
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 6),
      new THREE.MeshLambertMaterial({ color: leafColors ? baseColor : (defaultLeaf + Math.floor(Math.random() * 0x112211)) }),
    );
    leaves.position.y = y;
    group.add(leaves);
  }
  return group;
}

/** Create a decorative rock */
export function createRock(color?: number, secondaryColor?: number): THREE.Group {
  const group = new THREE.Group();
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.2 + Math.random() * 0.6, 0),
    new THREE.MeshLambertMaterial({ color: color ?? 0x777777 }),
  );
  rock.position.y = 0.6;
  rock.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.2);
  group.add(rock);
  // Smaller secondary rock
  const rock2 = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.3, 0),
    new THREE.MeshLambertMaterial({ color: secondaryColor ?? 0x888888 }),
  );
  rock2.position.set(1 + Math.random() * 0.5, 0.3, 0.5 * (Math.random() - 0.5));
  group.add(rock2);
  return group;
}

// ===================== Helper =====================

/** Convert a group of meshes into a single mesh wrapper for raycasting.
 *  The returned mesh has its origin at y=0 (ground level).
 *  Visual children keep their original y positions (feet near y=0). */
/** Create a helicopter mesh */
export function createHelicopter(teamId: 1 | 2): THREE.Mesh {
  const c = TEAM[teamId];
  const group = new THREE.Group();

  // Fuselage — rounded body
  const fuselage = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.6, 3.5),
    new THREE.MeshLambertMaterial({ color: 0x4a5a3a }),
  );
  fuselage.position.set(0, 1.5, 0);
  group.add(fuselage);

  // Cockpit — semi-transparent glass front
  const cockpit = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.0, 0.8),
    new THREE.MeshLambertMaterial({ color: 0x88bbee, transparent: true, opacity: 0.5 }),
  );
  cockpit.position.set(0, 1.8, -1.8);
  group.add(cockpit);

  // Tail boom
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 3.5),
    new THREE.MeshLambertMaterial({ color: 0x4a5a3a }),
  );
  tail.position.set(0, 1.5, 3.5);
  group.add(tail);

  // Tail fin (vertical)
  const tailFin = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 1.2, 0.8),
    new THREE.MeshLambertMaterial({ color: c.primary }),
  );
  tailFin.position.set(0, 2.2, 5.0);
  group.add(tailFin);

  // Tail rotor (small disc on side of tail fin)
  const tailRotor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.05, 12),
    new THREE.MeshLambertMaterial({ color: 0x888888, transparent: true, opacity: 0.4 }),
  );
  tailRotor.rotation.z = Math.PI / 2;
  tailRotor.position.set(0.3, 2.2, 5.0);
  tailRotor.name = 'tailRotor';
  group.add(tailRotor);

  // Main rotor mast
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.6, 6),
    new THREE.MeshLambertMaterial({ color: 0x333333 }),
  );
  mast.position.set(0, 2.6, 0);
  group.add(mast);

  // Main rotor disc (transparent spinning disc)
  const mainRotor = new THREE.Mesh(
    new THREE.CylinderGeometry(3.5, 3.5, 0.08, 24),
    new THREE.MeshLambertMaterial({ color: 0x999999, transparent: true, opacity: 0.3 }),
  );
  mainRotor.position.set(0, 2.95, 0);
  mainRotor.name = 'mainRotor';
  group.add(mainRotor);

  // Skids (landing gear) — two parallel bars
  const skidMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const skidGeo = new THREE.BoxGeometry(0.12, 0.12, 3.0);
  const skidL = new THREE.Mesh(skidGeo, skidMat);
  skidL.position.set(-0.9, 0.06, 0);
  group.add(skidL);
  const skidR = new THREE.Mesh(skidGeo, skidMat);
  skidR.position.set(0.9, 0.06, 0);
  group.add(skidR);

  // Skid struts
  const strutGeo = new THREE.BoxGeometry(0.08, 0.8, 0.08);
  for (const sx of [-0.9, 0.9]) {
    for (const sz of [-0.8, 0.8]) {
      const strut = new THREE.Mesh(strutGeo, skidMat);
      strut.position.set(sx, 0.5, sz);
      group.add(strut);
    }
  }

  // Team color stripe
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.3, 3.5),
    new THREE.MeshLambertMaterial({ color: c.light }),
  );
  stripe.position.set(1.02, 1.5, 0);
  group.add(stripe);
  const stripe2 = stripe.clone();
  stripe2.position.x = -1.02;
  group.add(stripe2);

  // Gatling gun (chin-mounted under cockpit)
  const turretGroup = new THREE.Group();
  turretGroup.name = 'turret';

  // Pivot mount — allows the turret to rotate toward aim point
  const mountBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.25, 0.25, 8),
    new THREE.MeshLambertMaterial({ color: 0x333333 }),
  );
  turretGroup.add(mountBase);

  // Barrel housing (rotating cluster)
  const barrelGroup = new THREE.Group();
  barrelGroup.name = 'barrelSpin';
  const housingMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

  // Central housing cylinder
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8),
    housingMat,
  );
  housing.rotation.x = Math.PI / 2;
  housing.position.z = -0.7;
  barrelGroup.add(housing);

  // Six barrels arranged in a circle
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const bx = Math.cos(angle) * 0.1;
    const by = Math.sin(angle) * 0.1;
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6),
      barrelMat,
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(bx, by, -0.8);
    barrelGroup.add(barrel);
  }

  // Front barrel ring
  const frontRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.02, 6, 12),
    housingMat,
  );
  frontRing.position.z = -1.4;
  barrelGroup.add(frontRing);

  turretGroup.add(barrelGroup);

  // Muzzle flash (at barrel tip)
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffff00 }),
  );
  flash.position.z = -1.5;
  flash.visible = false;
  flash.name = 'muzzleFlash';
  turretGroup.add(flash);

  turretGroup.position.set(0, 0.65, -1.8);
  group.add(turretGroup);

  group.rotation.order = 'YXZ';
  return groupToMesh(group);
}

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
