import type { SceneEntity } from '../renderer/SceneManager.js';
import type { TeamId } from '@dyarchy/shared';

const MINIMAP_SIZE = 160; // px height; width scales to map aspect ratio
const UNIT_DOT = 3;
const BUILDING_DOT = 5;
const RESOURCE_DOT = 4;

const BUILDING_TYPES = new Set([
  'main_base', 'barracks', 'armory', 'tower', 'player_tower', 'turret',
  'farm', 'sniper_nest', 'garage', 'hero_academy',
]);

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly container: HTMLDivElement;
  private readonly mapWidth: number;
  private readonly mapDepth: number;
  private readonly pixelW: number;
  private readonly pixelH: number;

  localTeamId: TeamId = 1;

  // Camera viewport callback
  onClickWorld: ((x: number, z: number) => void) | null = null;

  private dragging = false;

  constructor(mapWidth: number, mapDepth: number) {
    this.mapWidth = mapWidth;
    this.mapDepth = mapDepth;

    // Scale canvas to map aspect ratio
    const aspect = mapWidth / mapDepth;
    this.pixelH = MINIMAP_SIZE;
    this.pixelW = Math.round(MINIMAP_SIZE * aspect);

    this.container = document.createElement('div');
    this.container.style.cssText = `
      position:fixed; bottom:42px; right:12px; z-index:16;
      border:2px solid #555; border-radius:4px; overflow:hidden;
      background:rgba(0,0,0,0.7); display:none;
      cursor:crosshair;
    `;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.pixelW;
    this.canvas.height = this.pixelH;
    this.canvas.style.cssText = `display:block;width:${this.pixelW}px;height:${this.pixelH}px;`;
    this.ctx = this.canvas.getContext('2d')!;

    this.container.appendChild(this.canvas);
    document.body.appendChild(this.container);

    // Click / drag on minimap
    this.canvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.dragging = true;
      this.handleClick(e);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        e.stopPropagation();
        e.preventDefault();
        this.handleClick(e);
      }
    });
    document.addEventListener('mouseup', () => { this.dragging = false; });
    this.canvas.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      this.dragging = false;
    });
    // Prevent the click from propagating to game canvas
    this.canvas.addEventListener('click', (e) => e.stopPropagation());

    // Touch support for minimap
    this.canvas.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.dragging = true;
      if (e.touches.length > 0) this.handleTouch(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      if (this.dragging && e.touches.length > 0) {
        e.stopPropagation();
        e.preventDefault();
        this.handleTouch(e.touches[0]);
      }
    }, { passive: false });
    this.canvas.addEventListener('touchend', (e) => {
      e.stopPropagation();
      this.dragging = false;
    });
  }

  show(): void { this.container.style.display = 'block'; }
  hide(): void { this.container.style.display = 'none'; }

  private handleClick(e: MouseEvent): void {
    this.handleInputAt(e.clientX, e.clientY);
  }

  private handleTouch(t: Touch): void {
    this.handleInputAt(t.clientX, t.clientY);
  }

  private handleInputAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const worldX = (px / this.pixelW - 0.5) * this.mapWidth;
    const worldZ = (py / this.pixelH - 0.5) * this.mapDepth;
    this.onClickWorld?.(worldX, worldZ);
  }

  /** Convert world (x,z) to minimap pixel coordinates */
  private toPixel(x: number, z: number): [number, number] {
    const px = (x / this.mapWidth + 0.5) * this.pixelW;
    const py = (z / this.mapDepth + 0.5) * this.pixelH;
    return [px, py];
  }

  /**
   * Redraw the minimap. Call each frame from tickVisuals.
   * @param entities All scene entities
   * @param camCenterX Camera center X in world space
   * @param camCenterZ Camera center Z in world space
   * @param viewHalfW Half-width of the camera viewport in world units
   * @param viewHalfH Half-height (depth) of the camera viewport in world units
   */
  update(
    entities: SceneEntity[],
    camCenterX: number,
    camCenterZ: number,
    viewHalfW: number,
    viewHalfH: number,
    isVisible?: (x: number, z: number) => boolean,
    isExplored?: (x: number, z: number) => boolean,
  ): void {
    const ctx = this.ctx;
    const w = this.pixelW;
    const h = this.pixelH;

    // Clear with dark terrain color
    ctx.fillStyle = '#2a2a1e';
    ctx.fillRect(0, 0, w, h);

    // Draw entities
    for (const e of entities) {
      if (e.hp <= 0) continue;

      const [px, py] = this.toPixel(e.mesh.position.x, e.mesh.position.z);

      // Resource nodes
      if (e.entityType === 'resource_node') {
        ctx.fillStyle = '#0ff';
        ctx.fillRect(px - RESOURCE_DOT / 2, py - RESOURCE_DOT / 2, RESOURCE_DOT, RESOURCE_DOT);
        continue;
      }

      // Fog of war: enemy buildings persist once explored, enemy units need active visibility
      const isOwn = e.teamId === this.localTeamId;
      if (!isOwn) {
        const wx = e.mesh.position.x, wz = e.mesh.position.z;
        const isBuilding = BUILDING_TYPES.has(e.entityType);
        if (isBuilding) {
          // Buildings persist on minimap once the area has been explored
          if (isExplored && !isExplored(wx, wz)) continue;
        } else {
          // Units only show while actively visible (friendly unit nearby)
          if (isVisible && !isVisible(wx, wz)) continue;
        }
      }

      const MINIMAP_COLORS: Record<number, string> = { 1: '#4488ff', 2: '#ff4444', 3: '#44dd44' };
      const color = isOwn ? '#ffffff' : (MINIMAP_COLORS[e.teamId] ?? '#ff4444');

      if (BUILDING_TYPES.has(e.entityType)) {
        // Buildings: larger square
        ctx.fillStyle = color;
        ctx.fillRect(px - BUILDING_DOT / 2, py - BUILDING_DOT / 2, BUILDING_DOT, BUILDING_DOT);
      } else if (e.entityType === 'fps_player') {
        // FPS players: diamond shape
        const FPS_COLORS: Record<number, string> = { 1: '#00aaff', 2: '#ff8800', 3: '#00ff00' };
        ctx.fillStyle = isOwn ? '#00ff00' : (FPS_COLORS[e.teamId] ?? '#ff8800');
        ctx.beginPath();
        ctx.moveTo(px, py - 4);
        ctx.lineTo(px + 3, py);
        ctx.lineTo(px, py + 4);
        ctx.lineTo(px - 3, py);
        ctx.closePath();
        ctx.fill();
      } else {
        // Units (workers, soldiers, fighters, vehicles): small dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, UNIT_DOT / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw camera viewport rectangle
    const [vx1, vy1] = this.toPixel(camCenterX - viewHalfW, camCenterZ - viewHalfH);
    const [vx2, vy2] = this.toPixel(camCenterX + viewHalfW, camCenterZ + viewHalfH);
    const rw = vx2 - vx1;
    const rh = vy2 - vy1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx1, vy1, rw, rh);
  }

  destroy(): void {
    this.container.remove();
  }
}
