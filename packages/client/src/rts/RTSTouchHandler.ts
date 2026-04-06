import type { RTSCamera } from './RTSCamera.js';
import type { RTSController } from './RTSController.js';
import type { Selection } from './Selection.js';

const DRAG_THRESHOLD = 15; // pixels before committing to drag
const LONG_PRESS_MS = 500; // ms to trigger command

enum Gesture {
  NONE,
  WAITING,     // finger down, not yet committed
  PAN,         // single-finger camera drag
  PINCH,       // two-finger zoom
  LONG_PRESS,  // held still for 500ms
  BUILD_DRAG,  // dragging building ghost
}

export class RTSTouchHandler {
  private gesture = Gesture.NONE;
  private touchStartPos = { x: 0, y: 0 };
  private lastPanPos = { x: 0, y: 0 };
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private pinchStartDist = 0;
  private pinchStartZoom = 0;
  private enabled = false;

  // Bound handlers for cleanup
  private _onStart: (e: TouchEvent) => void;
  private _onMove: (e: TouchEvent) => void;
  private _onEnd: (e: TouchEvent) => void;

  /** Whether tap should ADD to selection (multi-select toggle from HUD) */
  multiSelectMode = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: RTSCamera,
    private controller: RTSController,
    private selection: Selection,
  ) {
    this._onStart = this.onTouchStart.bind(this);
    this._onMove = this.onTouchMove.bind(this);
    this._onEnd = this.onTouchEnd.bind(this);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.canvas.addEventListener('touchstart', this._onStart, { passive: false });
    this.canvas.addEventListener('touchmove', this._onMove, { passive: false });
    this.canvas.addEventListener('touchend', this._onEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', this._onEnd, { passive: false });
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.canvas.removeEventListener('touchstart', this._onStart);
    this.canvas.removeEventListener('touchmove', this._onMove);
    this.canvas.removeEventListener('touchend', this._onEnd);
    this.canvas.removeEventListener('touchcancel', this._onEnd);
    this.cancelLongPress();
    this.gesture = Gesture.NONE;
  }

  destroy(): void {
    this.disable();
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();

    if (e.touches.length >= 2 && (this.gesture === Gesture.WAITING || this.gesture === Gesture.PAN)) {
      // Switch to pinch
      this.cancelLongPress();
      this.gesture = Gesture.PINCH;
      this.pinchStartDist = this.getPinchDist(e);
      this.pinchStartZoom = this.camera.getZoom();
      return;
    }

    if (e.touches.length === 1 && this.gesture === Gesture.NONE) {
      const t = e.touches[0];
      this.touchStartPos = { x: t.clientX, y: t.clientY };
      this.lastPanPos = { x: t.clientX, y: t.clientY };

      // Check if building placement is active
      if (this.controller.getActiveBuildType()) {
        this.gesture = Gesture.BUILD_DRAG;
        this.controller.moveGhostTo(t.clientX, t.clientY);
        return;
      }

      this.gesture = Gesture.WAITING;

      // Start long-press timer
      this.longPressTimer = setTimeout(() => {
        if (this.gesture === Gesture.WAITING) {
          this.gesture = Gesture.LONG_PRESS;
          // Haptic feedback
          if (navigator.vibrate) navigator.vibrate(50);
          // Issue command at touch position
          this.controller.commandAt(this.touchStartPos.x, this.touchStartPos.y);
        }
      }, LONG_PRESS_MS);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();

    if (this.gesture === Gesture.PINCH && e.touches.length >= 2) {
      const newDist = this.getPinchDist(e);
      const ratio = this.pinchStartDist / newDist; // >1 = fingers moved closer = zoom out
      const targetZoom = this.pinchStartZoom * ratio;
      const delta = targetZoom - this.camera.getZoom();
      this.camera.setZoom(delta);
      return;
    }

    if (e.touches.length !== 1) return;
    const t = e.touches[0];

    if (this.gesture === Gesture.BUILD_DRAG) {
      this.controller.moveGhostTo(t.clientX, t.clientY);
      return;
    }

    if (this.gesture === Gesture.WAITING) {
      const dx = t.clientX - this.touchStartPos.x;
      const dy = t.clientY - this.touchStartPos.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        // Commit to pan
        this.cancelLongPress();
        this.gesture = Gesture.PAN;
      }
      return;
    }

    if (this.gesture === Gesture.PAN) {
      // Convert screen delta to world delta using screenToWorld
      const before = this.camera.screenToWorld(this.lastPanPos.x, this.lastPanPos.y);
      const after = this.camera.screenToWorld(t.clientX, t.clientY);
      if (before && after) {
        // Invert: dragging right should pan camera left (Google Maps style)
        this.camera.panBy(before.x - after.x, before.z - after.z);
      }
      this.lastPanPos = { x: t.clientX, y: t.clientY };
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();

    // If one finger lifted during pinch, switch to pan with remaining finger
    if (this.gesture === Gesture.PINCH && e.touches.length === 1) {
      this.gesture = Gesture.PAN;
      this.lastPanPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return;
    }

    if (e.touches.length > 0) return; // still fingers down

    if (this.gesture === Gesture.WAITING) {
      // Tap — finger lifted before long-press or drag threshold
      this.cancelLongPress();
      this.selection.selectAt(this.touchStartPos.x, this.touchStartPos.y, this.multiSelectMode);
    }

    if (this.gesture === Gesture.BUILD_DRAG) {
      // Lift = place building
      this.controller.placeBuilding();
    }

    this.cancelLongPress();
    this.gesture = Gesture.NONE;
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private getPinchDist(e: TouchEvent): number {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
