import * as THREE from 'three';
import {
  MAP_WIDTH,
  MAP_DEPTH,
  OBSTACLES,
  INITIAL_BUILDINGS,
  RESOURCE_NODES,
} from '@dyarchy/shared';
import {
  createMainBase,
  createTower,
  createResourceNode,
  createObstacle,
} from './MeshFactory.js';

export type EntityType = 'main_base' | 'tower' | 'barracks' | 'armory' | 'player_tower' | 'resource_node' | 'grunt' | 'fighter' | 'fps_player';

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
}

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;

  // Obstacle AABBs for collision (shared with FPS controller)
  readonly obstacleBoxes: { center: THREE.Vector3; halfSize: THREE.Vector3 }[] = [];

  // All selectable entities in the scene
  readonly entities: SceneEntity[] = [];

  private nextId = 0;

  constructor(canvas: HTMLCanvasElement, skipEntities = false) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // sky blue

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
    // Ambient + directional light
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(50, 80, 30);
    this.scene.add(directional);

    // Ground plane
    const groundGeo = new THREE.BoxGeometry(MAP_WIDTH, 0.2, MAP_DEPTH);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a7c4f });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -0.1, 0);
    this.scene.add(ground);

    // Map border walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const wallHeight = 4;
    const wallThickness = 1;

    // North/South walls (along X)
    for (const zSign of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(MAP_WIDTH + wallThickness * 2, wallHeight, wallThickness),
        wallMat,
      );
      wall.position.set(0, wallHeight / 2, zSign * (MAP_DEPTH / 2 + wallThickness / 2));
      this.scene.add(wall);
    }
    // East/West walls (along Z)
    for (const xSign of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(wallThickness, wallHeight, MAP_DEPTH),
        wallMat,
      );
      wall.position.set(xSign * (MAP_WIDTH / 2 + wallThickness / 2), wallHeight / 2, 0);
      this.scene.add(wall);
    }

    // Obstacles (rocky cover in center) — always created (terrain, not game entities)
    for (const pos of OBSTACLES) {
      const mesh = createObstacle();
      mesh.position.set(pos.x, 1.5, pos.z);
      this.scene.add(mesh);

      this.obstacleBoxes.push({
        center: new THREE.Vector3(pos.x, 1.5, pos.z),
        halfSize: new THREE.Vector3(1.5, 1.5, 1.5),
      });
    }

    if (skipEntities) return; // Online mode: server owns all game entities

    // Pre-placed buildings
    for (const teamId of [1, 2] as const) {
      const buildings = INITIAL_BUILDINGS[teamId];
      const teamLabel = teamId === 1 ? 'Blue' : 'Red';

      // Main base
      const base = createMainBase(teamId);
      base.position.set(buildings.mainBase.x, 0, buildings.mainBase.z);
      this.scene.add(base);
      this.registerEntity(base, `${teamLabel} Main Base`, 'main_base', teamId, 100, 100);

      this.obstacleBoxes.push({
        center: new THREE.Vector3(buildings.mainBase.x, 3, buildings.mainBase.z),
        halfSize: new THREE.Vector3(4, 3, 4),
      });

      // Towers
      for (let i = 0; i < buildings.towers.length; i++) {
        const towerPos = buildings.towers[i];
        const tower = createTower(teamId);
        tower.position.set(towerPos.x, 0, towerPos.z);
        this.scene.add(tower);
        this.registerEntity(tower, `${teamLabel} Tower ${i + 1}`, 'tower', teamId, 100, 100);

        this.obstacleBoxes.push({
          center: new THREE.Vector3(towerPos.x, 4, towerPos.z),
          halfSize: new THREE.Vector3(2, 4, 2),
        });
      }
    }

    // Resource nodes (crystal gems)
    for (let i = 0; i < RESOURCE_NODES.length; i++) {
      const pos = RESOURCE_NODES[i];
      const node = createResourceNode();
      node.position.set(pos.x, 0, pos.z);
      this.scene.add(node);
      this.registerEntity(node, `Crystal Node ${i + 1}`, 'resource_node', 0 as 1 | 2, 100, 100);
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

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  renderWith(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
