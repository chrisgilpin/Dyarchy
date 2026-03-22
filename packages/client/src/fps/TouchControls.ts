/** Detect if the device is a touchscreen (phone/tablet) */
export function isMobile(): boolean {
  return 'ontouchstart' in window && navigator.maxTouchPoints > 0;
}

const JOYSTICK_RADIUS = 50;
const DEADZONE = 0.15;
const TOUCH_AIM_SENSITIVITY = 0.004;

export interface TouchState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  shooting: boolean;
  aimDeltaX: number;
  aimDeltaY: number;
}

export class TouchControls {
  private container: HTMLDivElement;
  private joystickBase: HTMLDivElement;
  private joystickThumb: HTMLDivElement;
  private fireBtn: HTMLDivElement;
  private jumpBtn: HTMLDivElement;

  // Touch tracking
  private joystickTouchId: number | null = null;
  private aimTouchId: number | null = null;
  private fireTouchId: number | null = null;
  private jumpTouchId: number | null = null;

  private joystickCenter = { x: 0, y: 0 };
  private aimLastPos = { x: 0, y: 0 };

  // Public state
  readonly state: TouchState = {
    forward: false, backward: false, left: false, right: false,
    jump: false, shooting: false, aimDeltaX: 0, aimDeltaY: 0,
  };

  constructor() {
    // Root container for all touch controls
    this.container = document.createElement('div');
    this.container.id = 'touch-controls';
    this.container.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      pointer-events:none; z-index:1000; display:none;
    `;

    // Joystick base (left side)
    this.joystickBase = document.createElement('div');
    this.joystickBase.style.cssText = `
      position:absolute; bottom:80px; left:40px;
      width:${JOYSTICK_RADIUS * 2 + 20}px; height:${JOYSTICK_RADIUS * 2 + 20}px;
      border-radius:50%; background:rgba(255,255,255,0.08);
      border:2px solid rgba(255,255,255,0.2);
      pointer-events:auto; touch-action:none;
    `;

    this.joystickThumb = document.createElement('div');
    this.joystickThumb.style.cssText = `
      position:absolute; top:50%; left:50%;
      width:40px; height:40px; margin:-20px 0 0 -20px;
      border-radius:50%; background:rgba(255,255,255,0.35);
      border:2px solid rgba(255,255,255,0.5);
      transition:none;
    `;
    this.joystickBase.appendChild(this.joystickThumb);
    this.container.appendChild(this.joystickBase);

    // Fire button (bottom-right)
    this.fireBtn = document.createElement('div');
    this.fireBtn.style.cssText = `
      position:absolute; bottom:80px; right:40px;
      width:80px; height:80px; border-radius:50%;
      background:rgba(255,60,60,0.3); border:3px solid rgba(255,60,60,0.6);
      pointer-events:auto; touch-action:none;
      display:flex; align-items:center; justify-content:center;
      font-size:12px; color:rgba(255,255,255,0.7); font-family:system-ui;
    `;
    this.fireBtn.textContent = 'FIRE';
    this.container.appendChild(this.fireBtn);

    // Jump button (above fire)
    this.jumpBtn = document.createElement('div');
    this.jumpBtn.style.cssText = `
      position:absolute; bottom:180px; right:50px;
      width:60px; height:60px; border-radius:50%;
      background:rgba(60,160,255,0.25); border:2px solid rgba(60,160,255,0.5);
      pointer-events:auto; touch-action:none;
      display:flex; align-items:center; justify-content:center;
      font-size:11px; color:rgba(255,255,255,0.7); font-family:system-ui;
    `;
    this.jumpBtn.textContent = 'JUMP';
    this.container.appendChild(this.jumpBtn);

    // Aim area (right side, behind buttons — full screen touch receiver)
    const aimArea = document.createElement('div');
    aimArea.style.cssText = `
      position:absolute; top:0; left:40%; width:60%; height:100%;
      pointer-events:auto; touch-action:none;
    `;
    // Insert behind buttons so buttons get priority
    this.container.insertBefore(aimArea, this.joystickBase);

    document.body.appendChild(this.container);

    // Bind touch events
    this.joystickBase.addEventListener('touchstart', this.onJoystickStart, { passive: false });
    this.joystickBase.addEventListener('touchmove', this.onJoystickMove, { passive: false });
    this.joystickBase.addEventListener('touchend', this.onJoystickEnd, { passive: false });
    this.joystickBase.addEventListener('touchcancel', this.onJoystickEnd, { passive: false });

    this.fireBtn.addEventListener('touchstart', this.onFireStart, { passive: false });
    this.fireBtn.addEventListener('touchend', this.onFireEnd, { passive: false });
    this.fireBtn.addEventListener('touchcancel', this.onFireEnd, { passive: false });

    this.jumpBtn.addEventListener('touchstart', this.onJumpStart, { passive: false });
    this.jumpBtn.addEventListener('touchend', this.onJumpEnd, { passive: false });
    this.jumpBtn.addEventListener('touchcancel', this.onJumpEnd, { passive: false });

    aimArea.addEventListener('touchstart', this.onAimStart, { passive: false });
    aimArea.addEventListener('touchmove', this.onAimMove, { passive: false });
    aimArea.addEventListener('touchend', this.onAimEnd, { passive: false });
    aimArea.addEventListener('touchcancel', this.onAimEnd, { passive: false });
  }

  show(): void { this.container.style.display = 'block'; }
  hide(): void { this.container.style.display = 'none'; }

  /** Consume and reset aim deltas (call once per frame) */
  consumeAim(): { dx: number; dy: number } {
    const dx = this.state.aimDeltaX;
    const dy = this.state.aimDeltaY;
    this.state.aimDeltaX = 0;
    this.state.aimDeltaY = 0;
    return { dx, dy };
  }

  // ---- Joystick ----

  private onJoystickStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (this.joystickTouchId !== null) return;
    const t = e.changedTouches[0];
    this.joystickTouchId = t.identifier;
    const rect = this.joystickBase.getBoundingClientRect();
    this.joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.updateJoystick(t.clientX, t.clientY);
  };

  private onJoystickMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joystickTouchId) {
        this.updateJoystick(t.clientX, t.clientY);
      }
    }
  };

  private onJoystickEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.joystickTouchId) {
        this.joystickTouchId = null;
        this.state.forward = false;
        this.state.backward = false;
        this.state.left = false;
        this.state.right = false;
        // Reset thumb to center
        this.joystickThumb.style.transform = 'translate(0px, 0px)';
      }
    }
  };

  private updateJoystick(clientX: number, clientY: number): void {
    let dx = clientX - this.joystickCenter.x;
    let dy = clientY - this.joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Clamp to radius
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }

    // Move thumb visual
    this.joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;

    // Normalize to [-1, 1]
    const nx = dx / JOYSTICK_RADIUS;
    const ny = dy / JOYSTICK_RADIUS;

    // Apply deadzone and map to booleans
    this.state.forward = ny < -DEADZONE;
    this.state.backward = ny > DEADZONE;
    this.state.left = nx < -DEADZONE;
    this.state.right = nx > DEADZONE;
  }

  // ---- Aim ----

  private onAimStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (this.aimTouchId !== null) return;
    const t = e.changedTouches[0];
    this.aimTouchId = t.identifier;
    this.aimLastPos = { x: t.clientX, y: t.clientY };
  };

  private onAimMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.aimTouchId) {
        const dx = t.clientX - this.aimLastPos.x;
        const dy = t.clientY - this.aimLastPos.y;
        this.state.aimDeltaX += dx * TOUCH_AIM_SENSITIVITY;
        this.state.aimDeltaY += dy * TOUCH_AIM_SENSITIVITY;
        this.aimLastPos = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private onAimEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.aimTouchId) {
        this.aimTouchId = null;
      }
    }
  };

  // ---- Fire ----

  private onFireStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.state.shooting = true;
    this.fireBtn.style.background = 'rgba(255,60,60,0.6)';
  };

  private onFireEnd = (e: TouchEvent): void => {
    e.preventDefault();
    this.state.shooting = false;
    this.fireBtn.style.background = 'rgba(255,60,60,0.3)';
  };

  // ---- Jump ----

  private onJumpStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.state.jump = true;
    this.jumpBtn.style.background = 'rgba(60,160,255,0.5)';
  };

  private onJumpEnd = (e: TouchEvent): void => {
    e.preventDefault();
    this.state.jump = false;
    this.jumpBtn.style.background = 'rgba(60,160,255,0.25)';
  };
}
