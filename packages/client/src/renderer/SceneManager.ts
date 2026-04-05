import * as THREE from 'three';
import { MEADOW_MAP } from '@dyarchy/shared';
import type { MapConfig } from '@dyarchy/shared';

/** Low-poly flat-shaded material */
function lpMat(props: THREE.MeshPhongMaterialParameters): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ flatShading: true, shininess: 0, ...props });
}
import {
  createMainBase,
  createTower,
  createResourceNode,
  createObstacle,
  createTree,
  createRock,
} from './MeshFactory.js';
import { getTerrainHeight, createTerrainHeightFn } from './Terrain.js';

export type EntityType = 'main_base' | 'tower' | 'barracks' | 'armory' | 'player_tower' | 'turret' | 'resource_node' | 'worker' | 'fighter' | 'fps_player' | 'foot_soldier' | 'archer' | 'sniper_nest' | 'farm' | 'garage' | 'jeep' | 'helicopter' | 'hero_academy';

export interface SceneEntity {
  id: string;
  name: string;
  entityType: EntityType;
  mesh: THREE.Mesh;
  teamId: 1 | 2;
  hp: number;
  maxHp: number;
  /** 'active' = ready, 'constructing' = still building */
  status: 'active' | 'constructing';
  /** 0-1 construction progress (only relevant when constructing) */
  constructionProgress: number;
  /** Used for tower turret rotation: y = angle, z = firing flag */
  rotation: { x: number; y: number; z: number };
  /** Building level (for upgrade detection) */
  level?: number;
  /** Hero state (synced from snapshot for fps_player entities) */
  heroType?: string;
  heroAbilityActive?: boolean;
  shieldHp?: number;
  playerName?: string;
}

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly mapConfig: MapConfig;
  readonly terrainHeight: (x: number, z: number) => number;

  // Obstacle AABBs for collision (shared with FPS controller)
  readonly obstacleBoxes: { center: THREE.Vector3; halfSize: THREE.Vector3 }[] = [];

  // Obstacle meshes for bullet raycasting (trees, rocks, cover cubes)
  readonly obstacleMeshes: THREE.Object3D[] = [];

  // All selectable entities in the scene
  readonly entities: SceneEntity[] = [];

  // Cloud groups (toggled for RTS view)
  private clouds: THREE.Group[] = [];

  // Dying entities (tip-over + fade animation)
  private dyingEntities: { mesh: THREE.Object3D; timer: number }[] = [];

  private nextId = 0;

  constructor(canvas: HTMLCanvasElement, skipEntities = false, mapConfig?: MapConfig, externalRenderer?: THREE.WebGLRenderer) {
    this.mapConfig = mapConfig ?? MEADOW_MAP;
    this.terrainHeight = createTerrainHeightFn(this.mapConfig);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // sky blue

    if (externalRenderer) {
      this.renderer = externalRenderer;
    } else {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
    );

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.buildScene(skipEntities);
  }

  private buildScene(skipEntities: boolean): void {
    const mc = this.mapConfig;
    const theme = mc.theme;
    const th = this.terrainHeight;

    // ===================== Sky =====================
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 1;
    skyCanvas.height = 256;
    const skyCtx = skyCanvas.getContext('2d')!;
    const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, theme.skyTopColor);
    grad.addColorStop(0.4, theme.skyMidColor);
    grad.addColorStop(0.7, theme.skyLowColor);
    grad.addColorStop(1, theme.skyHorizonColor);
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, 1, 256);
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    this.scene.background = skyTexture;

    this.scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear, theme.fogFar);

    // ===================== Lighting =====================
    const ambient = new THREE.AmbientLight(theme.ambientColor, theme.ambientIntensity);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
    sun.position.set(60, 100, 40);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(theme.fillColor, theme.fillIntensity);
    fill.position.set(-40, 50, -30);
    this.scene.add(fill);

    // ===================== Ground =====================
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 128;
    groundCanvas.height = 64;
    const gCtx = groundCanvas.getContext('2d')!;
    gCtx.fillStyle = theme.groundBaseColor;
    gCtx.fillRect(0, 0, 128, 64);

    const rng = (seed: number) => {
      let s = seed;
      return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
    };
    const rand = rng(42);
    const pr = theme.groundPatchRGBRanges;
    for (let i = 0; i < 300; i++) {
      const px = Math.floor(rand() * 128);
      const pz = Math.floor(rand() * 64);
      const w = 2 + Math.floor(rand() * 6);
      const h = 2 + Math.floor(rand() * 4);
      const r = Math.floor(pr.rMin + rand() * (pr.rMax - pr.rMin));
      const g = Math.floor(pr.gMin + rand() * (pr.gMax - pr.gMin));
      const b = Math.floor(pr.bMin + rand() * (pr.bMax - pr.bMin));
      gCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      gCtx.fillRect(px, pz, w, h);
    }
    gCtx.strokeStyle = `rgba(0,0,0,${theme.gridLineAlpha})`;
    gCtx.lineWidth = 0.5;
    for (let z = 0; z < 64; z += 4) {
      gCtx.beginPath();
      gCtx.moveTo(0, z);
      gCtx.lineTo(128, z);
      gCtx.stroke();
    }
    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(mc.width / 16, mc.depth / 16);
    groundTex.magFilter = THREE.NearestFilter;

    // Scale segments with map size; boost further for tall terrain so slopes aren't blocky
    const terrainDetail = mc.terrain.maxElevation > 10 ? 2 : 1;
    const groundSegsX = Math.round(80 * (mc.width / 240) * terrainDetail);
    const groundSegsZ = Math.round(40 * (mc.depth / 150) * terrainDetail);
    const groundGeo = new THREE.PlaneGeometry(mc.width, mc.depth, groundSegsX, groundSegsZ);
    groundGeo.rotateX(-Math.PI / 2);
    const posAttr = groundGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      posAttr.setY(i, th(x, z));
    }
    groundGeo.computeVertexNormals();
    const groundMat = lpMat({ map: groundTex });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, 0, 0);
    this.scene.add(ground);

    // ===================== Clouds =====================
    const cloudMat = lpMat({ color: 0xffffff, transparent: true, opacity: 0.8 });
    for (let i = 0; i < theme.cloudCount; i++) {
      const cloudGroup = new THREE.Group();
      const numBlobs = 3 + Math.floor(rand() * 4);
      for (let b = 0; b < numBlobs; b++) {
        const r = 2 + rand() * 4;
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
        blob.position.set((rand() - 0.5) * 8, (rand() - 0.3) * 1.5, (rand() - 0.5) * 4);
        blob.scale.set(1, 0.35 + rand() * 0.2, 1);
        cloudGroup.add(blob);
      }
      const cloudBaseY = mc.terrain.maxElevation + 15;
      cloudGroup.position.set(
        (rand() - 0.5) * mc.width * 1.5,
        cloudBaseY + rand() * 25,
        (rand() - 0.5) * mc.depth * 1.5,
      );
      this.scene.add(cloudGroup);
      this.clouds.push(cloudGroup);
    }

    // ===================== Grass Tufts & Flowers =====================
    const grassColors = theme.grassColors;
    const flowerColors = theme.flowerColors;
    const stemColor = mc.id === 'frostpeak' ? 0x667766 : 0x3a7a2a;
    for (let i = 0; i < theme.grassCount; i++) {
      const x = (rand() - 0.5) * mc.width * 0.95;
      const z = (rand() - 0.5) * mc.depth * 0.95;

      const terrainY = th(x, z);
      if (rand() < 0.85) {
        // Low-poly grass blade — triangular cone
        const h = 0.3 + rand() * 0.6;
        const geo = new THREE.ConeGeometry(0.08 + rand() * 0.06, h, 3);
        const grassMat = lpMat({
          color: grassColors[Math.floor(rand() * grassColors.length)],
        });
        const tuft = new THREE.Mesh(geo, grassMat);
        tuft.position.set(x, terrainY + h / 2, z);
        tuft.rotation.y = rand() * Math.PI;
        this.scene.add(tuft);
      } else {
        // Low-poly flower — thin cone stem + icosahedron head
        const stem = new THREE.Mesh(
          new THREE.ConeGeometry(0.02, 0.4, 3),
          lpMat({ color: stemColor }),
        );
        stem.position.set(x, terrainY + 0.2, z);
        this.scene.add(stem);
        const flower = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.1, 0),
          lpMat({
            color: flowerColors[Math.floor(rand() * flowerColors.length)],
          }),
        );
        flower.position.set(x, terrainY + 0.45, z);
        this.scene.add(flower);
      }
    }

    // ===================== Decorative Trees (along map edges) =====================
    const treePositions: [number, number][] = mc.edgeTrees.map(t => [t.x, t.z]);

    const edgeTrunkColor = mc.id === 'frostpeak' ? 0x443322 : 0x8B6914;
    const treeTrunkMat = lpMat({ color: edgeTrunkColor });
    const edgeLeafColors = mc.id === 'frostpeak'
      ? [0x1a4a1a, 0x2a5a2a, 0x1a3a1a, 0xddeeff, 0xeeeeff]
      : [0x3da33d, 0x4aba4a, 0x6ac86a, 0xf0a0c0, 0xf0d060, 0x90d090];

    for (const [tx, tz] of treePositions) {
      const treeGroup = new THREE.Group();
      const trunkH = 2 + rand() * 2;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, trunkH, 5),
        treeTrunkMat,
      );
      trunk.position.y = trunkH / 2;
      treeGroup.add(trunk);

      const leafColor = edgeLeafColors[Math.floor(rand() * edgeLeafColors.length)];
      const leafMat = lpMat({ color: leafColor });
      // Round low-poly canopy — 2-3 overlapping icosahedrons
      const canopies = 2 + Math.floor(rand() * 2);
      for (let l = 0; l < canopies; l++) {
        const r = 1.8 - l * 0.4 + rand() * 0.5;
        const foliage = new THREE.Mesh(
          new THREE.IcosahedronGeometry(r, 1),
          leafMat,
        );
        foliage.position.set(
          (rand() - 0.5) * 0.6,
          trunkH + l * 0.8 + r * 0.5,
          (rand() - 0.5) * 0.6,
        );
        treeGroup.add(foliage);
      }

      // Snow cap on top for frostpeak edge trees
      if (mc.id === 'frostpeak') {
        const snowCap = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.2 + rand() * 0.4, 1),
          lpMat({ color: 0xeeeeff }),
        );
        snowCap.scale.set(1, 0.25, 1);
        snowCap.position.y = trunkH + canopies * 0.8 + 1.2;
        treeGroup.add(snowCap);
      }

      treeGroup.position.set(tx, th(tx, tz), tz);
      this.scene.add(treeGroup);
      this.obstacleMeshes.push(treeGroup);

      const treeY = th(tx, tz);
      this.obstacleBoxes.push({
        center: new THREE.Vector3(tx, treeY + 3, tz),
        halfSize: new THREE.Vector3(1.5, 4, 1.5),
      });
    }

    // ===================== Map Border =====================
    const wallMat = lpMat({ color: theme.wallColor });
    const wallHeight = 1.5;
    const wallThickness = 0.8;

    for (const zSign of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(mc.width + wallThickness * 2, wallHeight, wallThickness),
        wallMat,
      );
      wall.position.set(0, wallHeight / 2, zSign * (mc.depth / 2 + wallThickness / 2));
      this.scene.add(wall);
    }
    for (const xSign of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(wallThickness, wallHeight, mc.depth),
        wallMat,
      );
      wall.position.set(xSign * (mc.width / 2 + wallThickness / 2), wallHeight / 2, 0);
      this.scene.add(wall);
    }

    // Obstacles (rocky cover in center)
    for (const pos of mc.obstacles) {
      const ht = th(pos.x, pos.z);
      const mesh = createObstacle();
      mesh.position.set(pos.x, ht + 1.5, pos.z);
      this.scene.add(mesh);
      this.obstacleMeshes.push(mesh);

      this.obstacleBoxes.push({
        center: new THREE.Vector3(pos.x, ht + 1.5, pos.z),
        halfSize: new THREE.Vector3(1.5, 1.5, 1.5),
      });
    }

    // Decorative vegetation
    for (const veg of mc.vegetation) {
      const obj = veg.type === 'tree'
        ? createTree(theme.treeLeafColors, theme.treeTrunkColor)
        : createRock(theme.rockColor, theme.rockSecondaryColor);
      const ty = th(veg.pos.x, veg.pos.z);
      obj.position.set(veg.pos.x, ty, veg.pos.z);
      this.scene.add(obj);
      this.obstacleMeshes.push(obj);

      const halfSize = veg.type === 'tree'
        ? new THREE.Vector3(1.5, 4, 1.5)
        : new THREE.Vector3(1.2, 1, 1.2);
      const cy = veg.type === 'tree' ? ty + 3 : ty + 1;
      this.obstacleBoxes.push({
        center: new THREE.Vector3(veg.pos.x, cy, veg.pos.z),
        halfSize,
      });
    }

    // ===================== Tunnel Geometry =====================
    if (mc.tunnels) {
      for (const tunnel of mc.tunnels) {
        const tunnelMat = lpMat({ color: 0x332820, side: THREE.DoubleSide });
        const entranceMat = lpMat({ color: 0x221810 });

        for (const region of tunnel.regions) {
          const w = region.max.x - region.min.x;
          const h = tunnel.ceilingHeight;
          const d = region.max.z - region.min.z;
          const cx = (region.min.x + region.max.x) / 2;
          const cz = (region.min.z + region.max.z) / 2;

          // Floor
          const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(w, d),
            tunnelMat,
          );
          floor.rotation.x = -Math.PI / 2;
          floor.position.set(cx, tunnel.floorY, cz);
          this.scene.add(floor);

          // Ceiling
          const ceiling = new THREE.Mesh(
            new THREE.PlaneGeometry(w, d),
            tunnelMat,
          );
          ceiling.rotation.x = Math.PI / 2;
          ceiling.position.set(cx, tunnel.floorY + h, cz);
          this.scene.add(ceiling);

          // North wall (min Z side)
          const northWall = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            tunnelMat,
          );
          northWall.position.set(cx, tunnel.floorY + h / 2, region.min.z);
          this.scene.add(northWall);

          // South wall (max Z side)
          const southWall = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            tunnelMat,
          );
          southWall.position.set(cx, tunnel.floorY + h / 2, region.max.z);
          southWall.rotation.y = Math.PI;
          this.scene.add(southWall);

          // Dim light inside the tunnel
          const tunnelLight = new THREE.PointLight(0xff6633, 0.4, w * 0.7);
          tunnelLight.position.set(cx, tunnel.floorY + h - 0.5, cz);
          this.scene.add(tunnelLight);
        }

        // Entrance arches (visible from surface)
        for (const portal of tunnel.portals) {
          // Only render surface-entry portals (targetLayer > 0)
          if (portal.targetLayer === 0) continue;
          const archW = 4;
          const archH = 4;
          const archD = 1;
          const portalTerrainY = th(portal.position.x, portal.position.z);

          const arch = new THREE.Mesh(
            new THREE.BoxGeometry(archW, archH, archD),
            entranceMat,
          );
          arch.position.set(portal.position.x, portalTerrainY + archH / 2, portal.position.z);
          this.scene.add(arch);

          // Glowing entrance indicator
          const glowLight = new THREE.PointLight(0xff4400, 0.6, 8);
          glowLight.position.set(portal.position.x, portalTerrainY + 1.5, portal.position.z);
          this.scene.add(glowLight);
        }
      }
    }

    if (skipEntities) return; // Online mode: server owns all game entities

    // Pre-placed buildings
    for (const teamId of [1, 2] as const) {
      const buildings = mc.initialBuildings[teamId];
      const teamLabel = teamId === 1 ? 'Blue' : 'Red';

      const base = createMainBase(teamId);
      const baseH = th(buildings.mainBase.x, buildings.mainBase.z);
      base.position.set(buildings.mainBase.x, baseH, buildings.mainBase.z);
      this.scene.add(base);
      this.registerEntity(base, `${teamLabel} Headquarters`, 'main_base', teamId, 100, 100);

      this.obstacleBoxes.push({
        center: new THREE.Vector3(buildings.mainBase.x, baseH + 3, buildings.mainBase.z),
        halfSize: new THREE.Vector3(4, 3, 4),
      });

      for (let i = 0; i < buildings.towers.length; i++) {
        const towerPos = buildings.towers[i];
        const tower = createTower(teamId);
        const tH = th(towerPos.x, towerPos.z);
        tower.position.set(towerPos.x, tH, towerPos.z);
        this.scene.add(tower);
        this.registerEntity(tower, `${teamLabel} Tower ${i + 1}`, 'tower', teamId, 400, 400);

        this.obstacleBoxes.push({
          center: new THREE.Vector3(towerPos.x, tH + 4, towerPos.z),
          halfSize: new THREE.Vector3(2, 4, 2),
        });
      }
    }

    // Resource nodes
    for (let i = 0; i < mc.resourceNodes.length; i++) {
      const pos = mc.resourceNodes[i];
      const node = createResourceNode();
      node.position.set(pos.x, th(pos.x, pos.z), pos.z);
      this.scene.add(node);
      this.registerEntity(node, `Crystal Node ${i + 1}`, 'resource_node', 0 as 1 | 2, 3000, 3000);
    }
  }

  registerEntity(
    mesh: THREE.Mesh,
    name: string,
    entityType: EntityType,
    teamId: 1 | 2,
    hp: number,
    maxHp: number,
    status: 'active' | 'constructing' = 'active',
  ): SceneEntity {
    const entity: SceneEntity = {
      id: `entity-${this.nextId++}`,
      name,
      entityType,
      mesh,
      teamId,
      hp,
      maxHp,
      status,
      constructionProgress: status === 'active' ? 1 : 0,
      rotation: { x: 0, y: 0, z: 0 },
    };
    this.entities.push(entity);
    return entity;
  }

  removeEntity(id: string): void {
    const idx = this.entities.findIndex(e => e.id === id);
    if (idx !== -1) {
      const entity = this.entities[idx];
      this.scene.remove(entity.mesh);
      entity.mesh.geometry.dispose();
      (entity.mesh.material as THREE.Material).dispose();
      this.entities.splice(idx, 1);
    }
  }

  setCloudsVisible(visible: boolean): void {
    for (const cloud of this.clouds) cloud.visible = visible;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  renderWith(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  /** Move a mesh into the dying pool for tip-over + fade animation */
  addDying(mesh: THREE.Object3D): void {
    this.dyingEntities.push({ mesh, timer: 0 });
  }

  /** Animate dying entities: tip over (0–1s), fade out (1–3s), then remove */
  updateDying(dt: number): void {
    for (let i = this.dyingEntities.length - 1; i >= 0; i--) {
      const d = this.dyingEntities[i];
      d.timer += dt;

      if (d.timer < 1) {
        // Tipping phase: rotate 90 degrees on Z axis
        d.mesh.rotation.z = (d.timer / 1) * (Math.PI / 2);
      } else if (d.timer < 3) {
        // Fading phase
        d.mesh.rotation.z = Math.PI / 2;
        const fadeProgress = (d.timer - 1) / 2; // 0–1
        d.mesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mat = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
            if (mat && 'opacity' in mat) {
              mat.transparent = true;
              mat.opacity = 1 - fadeProgress;
            }
          }
        });
      } else {
        // Done — remove and dispose
        this.scene.remove(d.mesh);
        d.mesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).geometry?.dispose();
            const mat = (child as THREE.Mesh).material;
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else if (mat) (mat as THREE.Material).dispose();
          }
        });
        this.dyingEntities.splice(i, 1);
      }
    }
  }

  destroy(): void {
    // Dispose all entity meshes
    for (const entity of this.entities) {
      this.scene.remove(entity.mesh);
      entity.mesh.geometry?.dispose();
      const mat = entity.mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    }
    this.entities.length = 0;

    // Dispose all scene children (terrain, lights, obstacles, etc.)
    const toRemove = [...this.scene.children];
    for (const child of toRemove) {
      this.scene.remove(child);
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        const m = (obj as THREE.Mesh).material;
        if (m) {
          if (Array.isArray(m)) m.forEach(mat => mat.dispose());
          else (m as THREE.Material).dispose();
        }
      });
    }
    // Note: don't dispose renderer — it's shared with the game
  }
}
