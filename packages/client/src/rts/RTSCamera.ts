import * as THREE from 'three';
import { MAP_WIDTH, MAP_DEPTH } from '@dyarchy/shared';

const PAN_SPEED = 40;
const ZOOM_SPEED = 5;
const MIN_ZOOM = 35;
const MAX_ZOOM = 46;
const EDGE_PAN_MARGIN = 30;

// Camera pitch interpolates from 55° (zoomed out) to 25° (zoomed in)
const PITCH_ZOOMED_OUT = 55 * (Math.PI / 180); // ~0.96 rad
const PITCH_ZOOMED_IN = 25 * (Math.PI / 180);  // ~0.44 rad

export class RTSCamera {
  readonly camera: THREE.OrthographicCamera;

  private zoom = 40;
  centerX = 0;
  centerZ = 0;

  private readonly halfW: number;
  private readonly halfD: number;

  private readonly keys = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  private mouseX = 0;
  private mouseY = 0;

  constructor(mapWidth = MAP_WIDTH, mapDepth = MAP_DEPTH) {
    this.halfW = mapWidth / 2;
    this.halfD = mapDepth / 2;
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(
      -this.zoom * aspect,
      this.zoom * aspect,
      this.zoom,
      -this.zoom,
      0.1,
      500,
    );

    this.updateCameraTransform();
    this.updateProjection();

    window.addEventListener('resize', () => this.updateProjection());
  }

  enable(): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('wheel', this.onWheel, { passive: false });
  }

  disable(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('wheel', this.onWheel);
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.up = true; break;
      case 'KeyS': case 'ArrowDown': this.keys.down = true; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.up = false; break;
      case 'KeyS': case 'ArrowDown': this.keys.down = false; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setZoom(e.deltaY > 0 ? ZOOM_SPEED : -ZOOM_SPEED);
  };

  /** Programmatic zoom by delta (positive = zoom out, negative = zoom in). */
  setZoom(delta: number): void {
    this.zoom += delta;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom));
    this.updateProjection();
    this.updateCameraTransform();
  }

  /** Get current zoom level. */
  getZoom(): number { return this.zoom; }

  /** Pan camera by world-unit offsets. */
  panBy(dx: number, dz: number): void {
    this.centerX += dx;
    this.centerZ += dz;
    this.centerX = Math.max(-this.halfW, Math.min(this.halfW, this.centerX));
    this.centerZ = Math.max(-this.halfD, Math.min(this.halfD, this.centerZ));
    this.updateCameraTransform();
  }

  update(dt: number): void {
    let dx = 0;
    let dz = 0;

    // Keyboard pan
    if (this.keys.left) dx -= 1;
    if (this.keys.right) dx += 1;
    if (this.keys.up) dz -= 1;
    if (this.keys.down) dz += 1;

    // Edge pan
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.mouseX < EDGE_PAN_MARGIN) dx -= 1;
    if (this.mouseX > w - EDGE_PAN_MARGIN) dx += 1;
    if (this.mouseY < EDGE_PAN_MARGIN) dz -= 1;
    if (this.mouseY > h - EDGE_PAN_MARGIN) dz += 1;

    const speed = PAN_SPEED * (this.zoom / 40);
    this.centerX += dx * speed * dt;
    this.centerZ += dz * speed * dt;

    // Clamp to map bounds
    this.centerX = Math.max(-this.halfW, Math.min(this.halfW, this.centerX));
    this.centerZ = Math.max(-this.halfD, Math.min(this.halfD, this.centerZ));

    this.updateCameraTransform();
  }

  private updateCameraTransform(): void {
    // Interpolate pitch: zoomed out (MAX_ZOOM) = 55°, zoomed in (MIN_ZOOM) = 25°
    const t = (this.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM); // 0 = zoomed in, 1 = zoomed out
    const pitch = PITCH_ZOOMED_IN + t * (PITCH_ZOOMED_OUT - PITCH_ZOOMED_IN);
    const offsetY = 100 * Math.sin(pitch);
    const offsetZ = 100 * Math.cos(pitch);
    this.camera.position.set(this.centerX, offsetY, this.centerZ + offsetZ);
    this.camera.lookAt(this.centerX, 0, this.centerZ);
  }

  private updateProjection(): void {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.left = -this.zoom * aspect;
    this.camera.right = this.zoom * aspect;
    this.camera.top = this.zoom;
    this.camera.bottom = -this.zoom;
    this.camera.updateProjectionMatrix();
  }

  /** Optional terrain height function — set this so screenToWorld accounts for hills */
  terrainHeight: ((x: number, z: number) => number) | null = null;

  /** Get world position on the terrain from screen coordinates.
   *  Iteratively refines the intersection to account for terrain elevation. */
  screenToWorld(screenX: number, screenY: number): THREE.Vector3 | null {
    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const up = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3();
    let planeY = 0;

    // Iterate: intersect plane at current Y, get terrain height there, repeat
    for (let i = 0; i < 4; i++) {
      const plane = new THREE.Plane(up, -planeY);
      const hit = raycaster.ray.intersectPlane(plane, target);
      if (!hit) return null;
      if (!this.terrainHeight) return target;
      planeY = this.terrainHeight(target.x, target.z);
    }

    // Final intersection at converged height
    const finalPlane = new THREE.Plane(up, -planeY);
    raycaster.ray.intersectPlane(finalPlane, target);
    target.y = planeY;
    return target;
  }
}
