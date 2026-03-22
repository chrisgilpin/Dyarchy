import * as THREE from 'three';
import type { RTSCamera } from './RTSCamera.js';
import { SoundManager } from '../audio/SoundManager.js';
import { getTerrainHeight as defaultTerrainHeight } from '../renderer/Terrain.js';

export interface Selectable {
  id: string;
  name: string;
  entityType: string;
  mesh: THREE.Mesh;
  teamId: 1 | 2;
  hp: number;
  maxHp: number;
  status: 'active' | 'constructing';
  constructionProgress: number;
  rotation: { x: number; y: number; z: number };
}

// Size thresholds for ring radius based on entity type
const RING_SIZES: Record<string, { inner: number; outer: number }> = {
  main_base: { inner: 6, outer: 6.4 },
  tower: { inner: 3.5, outer: 3.8 },
  barracks: { inner: 4, outer: 4.3 },
  armory: { inner: 4, outer: 4.3 },
  player_tower: { inner: 3.5, outer: 3.8 },
  turret: { inner: 2, outer: 2.3 },
  resource_node: { inner: 2, outer: 2.3 },
  worker: { inner: 1.2, outer: 1.5 },
  fighter: { inner: 1, outer: 1.3 },
  fps_player: { inner: 1.2, outer: 1.5 },
  foot_soldier: { inner: 1.1, outer: 1.4 },
  archer: { inner: 1.1, outer: 1.4 },
  sniper_nest: { inner: 2, outer: 2.3 },
  farm: { inner: 3, outer: 3.3 },
  garage: { inner: 5, outer: 5.3 },
  jeep: { inner: 2.5, outer: 2.8 },
  helicopter: { inner: 3.0, outer: 3.3 },
};

const DEFAULT_RING = { inner: 2, outer: 2.3 };

export class Selection {
  readonly selected: Set<string> = new Set();

  private selectables: Selectable[] = [];
  private readonly rtsCamera: RTSCamera;
  private readonly scene: THREE.Scene;
  private onChange: (() => void) | null = null;

  /** When true, clicks don't change selection (used during building placement) */
  suppressClicks = false;

  /** Filter function — return false to make an entity unselectable */
  selectFilter: ((s: Selectable) => boolean) | null = null;

  private shiftHeld = false;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private lastClickTime = 0;
  private lastClickPos = { x: 0, y: 0 };
  private readonly dragBox: HTMLDivElement;

  private readonly highlights = new Map<string, THREE.Mesh>();

  // Action marker (move/attack/harvest)
  private actionMarker: THREE.Mesh | null = null;
  private actionMarkerTimer = 0;

  private terrainHeight: (x: number, z: number) => number;

  constructor(rtsCamera: RTSCamera, scene: THREE.Scene, terrainHeight?: (x: number, z: number) => number) {
    this.rtsCamera = rtsCamera;
    this.scene = scene;
    this.terrainHeight = terrainHeight ?? defaultTerrainHeight;

    this.dragBox = document.createElement('div');
    this.dragBox.style.cssText =
      'position:fixed;border:1px solid #0f0;background:rgba(0,255,0,0.1);pointer-events:none;display:none;z-index:15;';
    document.body.appendChild(this.dragBox);
  }

  setSelectables(selectables: Selectable[]): void {
    this.selectables = selectables;
  }

  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  getSelected(): Selectable[] {
    return this.selectables.filter(s => this.selected.has(s.id));
  }

  getSelectableById(id: string): Selectable | undefined {
    return this.selectables.find(s => s.id === id);
  }

  enable(): void {
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  disable(): void {
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    this.isDragging = false;
    this.dragBox.style.display = 'none';
    this.clearSelection();
    this.removeActionMarker();
  }

  /** Call every frame to update highlight ring positions and move marker */
  update(dt: number): void {
    // Update highlight positions to follow moving units
    for (const [id, ring] of this.highlights) {
      const s = this.selectables.find(s => s.id === id);
      if (s) {
        ring.position.set(s.mesh.position.x, this.terrainHeight(s.mesh.position.x, s.mesh.position.z) + 0.15, s.mesh.position.z);
      }
    }

    // Fade out action marker
    if (this.actionMarker) {
      this.actionMarkerTimer -= dt;
      if (this.actionMarkerTimer <= 0) {
        this.removeActionMarker();
      } else {
        const mat = this.actionMarker.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.min(1, this.actionMarkerTimer / 0.5);
        const scale = 0.5 + (this.actionMarkerTimer / 1.5) * 0.5;
        this.actionMarker.scale.set(scale, scale, scale);
      }
    }
  }

  private static readonly ACTION_COLORS = {
    move: 0x00ff00,   // green
    attack: 0xff3333,  // red
    harvest: 0x3399ff, // blue
  };

  /** Show a visual marker for an action: move (green), attack (red), harvest (blue) */
  showActionMarker(position: THREE.Vector3, action: 'move' | 'attack' | 'harvest', targetEntityType?: string): void {
    SoundManager.instance().unitCommand();
    this.removeActionMarker();

    const color = Selection.ACTION_COLORS[action];
    // Scale ring to be larger than the target entity
    const targetSize = targetEntityType ? (RING_SIZES[targetEntityType] || DEFAULT_RING) : DEFAULT_RING;
    const inner = Math.max(1, targetSize.outer + 0.3);
    const outer = inner + 0.3;
    const geo = new THREE.RingGeometry(inner, outer, 32);
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    this.actionMarker = new THREE.Mesh(geo, mat);
    this.actionMarker.rotation.x = -Math.PI / 2;
    this.actionMarker.position.set(position.x, this.terrainHeight(position.x, position.z) + 0.15, position.z);
    this.scene.add(this.actionMarker);
    this.actionMarkerTimer = 1.5;
  }

  /** Backwards compat alias */
  showMoveMarker(position: THREE.Vector3): void {
    this.showActionMarker(position, 'move');
  }

  private removeActionMarker(): void {
    if (this.actionMarker) {
      this.scene.remove(this.actionMarker);
      this.actionMarker.geometry.dispose();
      (this.actionMarker.material as THREE.Material).dispose();
      this.actionMarker = null;
    }
  }

  /** Remove a specific entity from selection (e.g. when it dies) */
  removeFromSelection(id: string): void {
    if (this.selected.delete(id)) {
      const ring = this.highlights.get(id);
      if (ring) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        this.highlights.delete(id);
      }
      this.onChange?.();
    }
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || this.suppressClicks) return;
    this.isDragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragBox.style.display = 'none';
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isDragging) return;

    const dx = Math.abs(e.clientX - this.dragStart.x);
    const dy = Math.abs(e.clientY - this.dragStart.y);

    if (dx > 5 || dy > 5) {
      this.dragBox.style.display = 'block';
      this.dragBox.style.left = Math.min(e.clientX, this.dragStart.x) + 'px';
      this.dragBox.style.top = Math.min(e.clientY, this.dragStart.y) + 'px';
      this.dragBox.style.width = dx + 'px';
      this.dragBox.style.height = dy + 'px';
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0 || this.suppressClicks) return;

    const dx = Math.abs(e.clientX - this.dragStart.x);
    const dy = Math.abs(e.clientY - this.dragStart.y);

    const isClick = dx < 5 && dy < 5;

    this.shiftHeld = e.shiftKey;
    if (!e.shiftKey) {
      this.clearSelection();
    }

    if (isClick) {
      const now = performance.now();
      const dblClickDx = Math.abs(e.clientX - this.lastClickPos.x);
      const dblClickDy = Math.abs(e.clientY - this.lastClickPos.y);
      const isDoubleClick = (now - this.lastClickTime < 400) && dblClickDx < 10 && dblClickDy < 10;
      this.lastClickTime = now;
      this.lastClickPos = { x: e.clientX, y: e.clientY };
      this.clickSelect(e.clientX, e.clientY, isDoubleClick);
    } else {
      this.boxSelect(
        Math.min(e.clientX, this.dragStart.x),
        Math.min(e.clientY, this.dragStart.y),
        Math.max(e.clientX, this.dragStart.x),
        Math.max(e.clientY, this.dragStart.y),
      );
    }

    this.isDragging = false;
    this.dragBox.style.display = 'none';
  };

  private clickSelect(screenX: number, screenY: number, doubleClick = false): void {
    // Project each selectable to screen space and pick the closest to the click.
    // This correctly handles units at any terrain height.
    const camera = this.rtsCamera.camera;
    const MAX_SCREEN_DIST = 40; // pixels

    let closest: Selectable | null = null;
    let closestDist = MAX_SCREEN_DIST;

    for (const s of this.selectables) {
      if (this.selectFilter && !this.selectFilter(s)) continue;
      const projected = s.mesh.position.clone().project(camera);
      const sx = (projected.x + 1) / 2 * window.innerWidth;
      const sy = (-projected.y + 1) / 2 * window.innerHeight;
      const dx = sx - screenX;
      const dy = sy - screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = s;
      }
    }

    if (closest) {
      this.addToSelection(closest.id);

      // Double-click: also select all same-type units within 30 units
      if (doubleClick) {
        const SAME_TYPE_RADIUS = 30;
        for (const s of this.selectables) {
          if (s.id === closest.id) continue;
          if (this.selectFilter && !this.selectFilter(s)) continue;
          if (s.entityType !== closest.entityType || s.teamId !== closest.teamId) continue;
          const sdx = s.mesh.position.x - closest.mesh.position.x;
          const sdz = s.mesh.position.z - closest.mesh.position.z;
          if (Math.sqrt(sdx * sdx + sdz * sdz) < SAME_TYPE_RADIUS) {
            this.addToSelection(s.id);
          }
        }
      }
    }
  }

  private boxSelect(
    left: number, top: number, right: number, bottom: number,
  ): void {
    const camera = this.rtsCamera.camera;

    for (const s of this.selectables) {
      if (this.selectFilter && !this.selectFilter(s)) continue;
      const projected = s.mesh.position.clone().project(camera);
      const screenX = (projected.x + 1) / 2 * window.innerWidth;
      const screenY = (-projected.y + 1) / 2 * window.innerHeight;

      if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
        this.addToSelection(s.id);
      }
    }
  }

  private addToSelection(id: string): void {
    this.selected.add(id);
    this.updateHighlights();
    this.onChange?.();
  }

  clearSelection(): void {
    const hadSelection = this.selected.size > 0;
    this.selected.clear();
    this.updateHighlights();
    if (hadSelection) this.onChange?.();
  }

  updateHighlights(): void {
    // Remove stale highlights
    for (const [id, ring] of this.highlights) {
      if (!this.selected.has(id)) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        this.highlights.delete(id);
      }
    }

    // Add new highlights with appropriate sizing
    for (const id of this.selected) {
      if (this.highlights.has(id)) continue;

      const s = this.selectables.find(s => s.id === id);
      if (!s) continue;

      const size = RING_SIZES[s.entityType] || DEFAULT_RING;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(size.inner, size.outer, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
      );
      ring.renderOrder = 999;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.mesh.position.x, this.terrainHeight(s.mesh.position.x, s.mesh.position.z) + 0.15, s.mesh.position.z);
      this.scene.add(ring);
      this.highlights.set(id, ring);
    }
  }
}
