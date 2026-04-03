import * as THREE from 'three';

const DEADZONE = 0.15;

/** Gamepad input state (from Bluetooth/USB controller) */
export interface GamepadInput {
  moveX: number;       // Left stick X
  moveY: number;       // Left stick Y
  lookX: number;       // Right stick X
  lookY: number;       // Right stick Y
  fire: boolean;       // R2 / RT
  altFire: boolean;    // L2 / LT
  jump: boolean;       // Cross / A
  interact: boolean;   // Triangle / Y
  swap: boolean;       // Square / X
  heroAbility: boolean; // L1 / LB
  reload: boolean;     // R1 / RB (weapon cycle)
}

/** Configurable button-to-action mapping (button indices into Gamepad.buttons[]) */
export interface GamepadButtonMap {
  fire: number;
  altFire: number;
  jump: number;
  interact: number;
  swap: number;
  heroAbility: number;
  reload: number;
}

/** Configurable axis mapping (axis indices into Gamepad.axes[]) */
export interface GamepadAxisMap {
  moveX: number;    // Left stick horizontal
  moveY: number;    // Left stick vertical
  lookX: number;    // Right stick horizontal
  lookY: number;    // Right stick vertical
}

/** Standard mapping (Xbox / PS / MFi layout) */
const DEFAULT_BUTTON_MAP: GamepadButtonMap = {
  fire: 7,        // R2 / RT
  altFire: 6,     // L2 / LT
  jump: 0,        // A / Cross
  interact: 3,    // Y / Triangle
  swap: 2,        // X / Square
  heroAbility: 4, // LB / L1
  reload: 5,      // RB / R1
};

const DEFAULT_AXIS_MAP: GamepadAxisMap = {
  moveX: 0, moveY: 1, lookX: 2, lookY: 3,
};

const STORAGE_KEY_BUTTONS = 'dyarchy_gamepad_buttons';
const STORAGE_KEY_AXES = 'dyarchy_gamepad_axes';

function loadButtonMap(): GamepadButtonMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BUTTONS);
    if (raw) return { ...DEFAULT_BUTTON_MAP, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_BUTTON_MAP };
}

function loadAxisMap(): GamepadAxisMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AXES);
    if (raw) return { ...DEFAULT_AXIS_MAP, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_AXIS_MAP };
}

export function saveButtonMap(map: GamepadButtonMap): void {
  localStorage.setItem(STORAGE_KEY_BUTTONS, JSON.stringify(map));
}

export function saveAxisMap(map: GamepadAxisMap): void {
  localStorage.setItem(STORAGE_KEY_AXES, JSON.stringify(map));
}

/**
 * Manages WebXR VR sessions, the camera rig, a 3D HUD, and VR input.
 *
 * Non-VR browsers see zero difference — VRButton only appears on WebXR-capable devices
 * and the camera rig is invisible when not presenting.
 */
export class VRManager {
  readonly cameraRig: THREE.Group;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera | null = null;

  // Configurable gamepad mapping
  buttonMap: GamepadButtonMap;
  axisMap: GamepadAxisMap;

  // 3D HUD (children of camera — head-locked)
  private hudGroup: THREE.Group;
  private healthBg!: THREE.Mesh;
  private healthFill!: THREE.Mesh;
  private healthMat!: THREE.MeshBasicMaterial;
  private weaponLabelSprite!: THREE.Sprite;
  private weaponLabelCanvas!: HTMLCanvasElement;
  private weaponLabelCtx!: CanvasRenderingContext2D;
  private cooldownBg!: THREE.Mesh;
  private cooldownFill!: THREE.Mesh;
  private cooldownMat!: THREE.MeshBasicMaterial;
  private reticle: THREE.Group;
  private deadOverlay!: THREE.Mesh;

  // Aim pivot — child of cameraRig, rotated by gamepad pitch.
  // Reticle and weapon are children of this so they follow gamepad aim, not head tracking.
  readonly aimPivot: THREE.Group;

  // Weapon mount (child of aimPivot)
  readonly weaponMount: THREE.Group;
  private _weaponModel: THREE.Group | null = null;

  // Gamepad-controlled pitch for aiming (separate from head tracking)
  private _aimPitch = 0;

  // State
  private _isPresenting = false;

  // Smooth turn accumulator (gamepad right stick)
  private _rigYawOffset = 0;

  // VR button element (for cleanup)
  private vrButtonEl: HTMLElement | null = null;

  get isPresenting(): boolean {
    return this._isPresenting;
  }

  get rigYawOffset(): number {
    return this._rigYawOffset;
  }

  get aimPitch(): number {
    return this._aimPitch;
  }

  /** Set gamepad-controlled aim pitch. Updates the aimPivot rotation. */
  setAimPitch(pitch: number): void {
    this._aimPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    this.aimPivot.rotation.x = this._aimPitch;
  }

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.xr.enabled = true;
    this.buttonMap = loadButtonMap();
    this.axisMap = loadAxisMap();

    // Camera rig — the "body" that moves through the world.
    // The scene camera becomes a child so that XR head tracking is relative to this group.
    this.cameraRig = new THREE.Group();
    this.cameraRig.name = 'VRCameraRig';

    // Session lifecycle
    renderer.xr.addEventListener('sessionstart', () => {
      this._isPresenting = true;
      this.hudGroup.visible = true;
      this.weaponMount.visible = true;
    });
    renderer.xr.addEventListener('sessionend', () => {
      this._isPresenting = false;
      this.hudGroup.visible = false;
      this.weaponMount.visible = false;
      // Reset camera local transform (XR may have moved it)
      if (this.camera) {
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.identity();
      }
    });

    // Build 3D HUD (starts hidden — head-locked, child of camera)
    this.hudGroup = new THREE.Group();
    this.hudGroup.name = 'VRHUD';
    this.hudGroup.visible = false;
    this.buildHUD();

    // Aim pivot — child of cameraRig, positioned at eye height.
    // Rotated by gamepad pitch. Reticle + weapon are children so they
    // follow gamepad aim direction, not head tracking.
    this.aimPivot = new THREE.Group();
    this.aimPivot.name = 'VRAimPivot';
    // No Y offset — rig is already positioned at eye height by FPSController

    // Weapon mount (child of aimPivot, starts hidden)
    this.weaponMount = new THREE.Group();
    this.weaponMount.name = 'VRWeaponMount';
    this.weaponMount.position.set(0.22, -0.28, -0.45);
    this.weaponMount.visible = false;

    // Build reticle (child of aimPivot)
    this.reticle = this.buildReticle();
  }

  // ========================= Setup =========================

  /**
   * Create the "Enter VR" button with proper error handling for visionOS Safari.
   *
   * Three.js's VRButton has no .catch() on requestSession, so session rejections
   * are completely silent. This custom button handles errors and avoids requesting
   * optional features (layers, bounded-floor) that WebKit may choke on.
   */
  createButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 1001;
      padding: 8px 16px; background: rgba(0,0,0,0.6); color: #fff;
      border: 1px solid #555; border-radius: 6px; cursor: pointer;
      font-family: system-ui, sans-serif; font-size: 14px;
    `;
    btn.textContent = 'VR';

    const renderer = this.renderer;
    let currentSession: XRSession | null = null;

    const onSessionStarted = (session: XRSession) => {
      session.addEventListener('end', () => {
        currentSession = null;
        btn.textContent = 'Enter VR';
      });
      renderer.xr.setSession(session);
      currentSession = session;
      btn.textContent = 'Exit VR';
    };

    if (!('xr' in navigator)) {
      btn.textContent = 'VR N/A';
      btn.style.opacity = '0.4';
      btn.style.cursor = 'default';
      btn.title = 'WebXR not available — enable it in Safari Settings > Feature Flags';
      this.vrButtonEl = btn;
      return btn;
    }

    // Check support — update button when ready
    navigator.xr!.isSessionSupported('immersive-vr').then((supported) => {
      if (supported) {
        btn.textContent = 'Enter VR';
        btn.onclick = () => {
          if (currentSession) {
            currentSession.end();
            return;
          }
          // Minimal session options — avoid features WebKit may reject
          const sessionInit: XRSessionInit = {
            optionalFeatures: ['local-floor', 'hand-tracking'],
          };
          navigator.xr!.requestSession('immersive-vr', sessionInit)
            .then(onSessionStarted)
            .catch((err) => {
              console.error('[VR] Session request rejected:', err);
              btn.textContent = 'VR Error';
              btn.style.borderColor = '#f44';
              setTimeout(() => {
                btn.textContent = 'Enter VR';
                btn.style.borderColor = '#555';
              }, 3000);
            });
        };
      } else {
        btn.textContent = 'No VR';
        btn.style.opacity = '0.4';
        btn.style.cursor = 'default';
        btn.title = 'immersive-vr not supported on this device';
      }
    }).catch((err) => {
      console.warn('[VR] isSessionSupported check failed:', err);
      btn.textContent = 'No VR';
      btn.style.opacity = '0.4';
    });

    this.vrButtonEl = btn;
    return btn;
  }

  /** Attach the camera rig to the active game scene. Call when a new SceneManager is created. */
  attachToScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.detachFromScene();
    this.camera = camera;
    scene.add(this.cameraRig);
    // Aim pivot is a child of the rig — gamepad pitch rotates it.
    // Camera is a child of aimPivot so the view tilts with the crosshair.
    // Head tracking adds on top for free-look within that tilted frame.
    this.cameraRig.add(this.aimPivot);
    this.aimPivot.add(camera);
    // HUD stays head-locked (child of camera) for readability
    camera.add(this.hudGroup);
    // Reticle and weapon are also children of aimPivot
    this.aimPivot.add(this.weaponMount);
    this.aimPivot.add(this.reticle);
    // Reset rig
    this.cameraRig.position.set(0, 0, 0);
    this.cameraRig.rotation.set(0, 0, 0);
    this._rigYawOffset = 0;
    this._aimPitch = 0;
    this.aimPivot.rotation.set(0, 0, 0);
  }

  /** Detach from current scene (safe to call multiple times). */
  detachFromScene(): void {
    if (this.camera) {
      this.camera.remove(this.hudGroup);
      // Un-parent camera from aimPivot
      if (this.camera.parent === this.aimPivot) {
        this.aimPivot.remove(this.camera);
      }
    }
    // Remove aim pivot children and aim pivot from rig
    this.aimPivot.remove(this.weaponMount);
    this.aimPivot.remove(this.reticle);
    this.cameraRig.remove(this.aimPivot);
    if (this.cameraRig.parent) {
      this.cameraRig.parent.remove(this.cameraRig);
    }
    this.camera = null;
  }

  // ========================= Rig positioning =========================

  /** Move the camera rig to the player's feet. In VR the headset adds eye offset. */
  setRigPosition(x: number, y: number, z: number): void {
    this.cameraRig.position.set(x, y, z);
  }

  /** Apply smooth turn (from gamepad right stick). Accumulates over time. */
  addRigYaw(delta: number): void {
    this._rigYawOffset += delta;
    this.cameraRig.rotation.y = this._rigYawOffset;
  }

  /** Set rig yaw to a specific value (e.g. sync with player spawn facing). */
  setRigYaw(yaw: number): void {
    this._rigYawOffset = yaw;
    this.cameraRig.rotation.y = yaw;
  }

  // ========================= HUD =========================

  private buildHUD(): void {
    // Health bar background (dark red)
    const barW = 0.16, barH = 0.012;
    const bgGeo = new THREE.PlaneGeometry(barW, barH);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x440000, depthTest: false, transparent: true, opacity: 0.7 });
    this.healthBg = new THREE.Mesh(bgGeo, bgMat);
    this.healthBg.position.set(0, -0.22, -0.5);
    this.healthBg.renderOrder = 9999;
    this.hudGroup.add(this.healthBg);

    // Health bar fill (green)
    const fillGeo = new THREE.PlaneGeometry(barW, barH);
    this.healthMat = new THREE.MeshBasicMaterial({ color: 0x00cc00, depthTest: false, transparent: true, opacity: 0.9 });
    this.healthFill = new THREE.Mesh(fillGeo, this.healthMat);
    this.healthFill.position.set(0, -0.22, -0.499);
    this.healthFill.renderOrder = 10000;
    this.hudGroup.add(this.healthFill);

    // Weapon label (canvas texture → sprite)
    this.weaponLabelCanvas = document.createElement('canvas');
    this.weaponLabelCanvas.width = 256;
    this.weaponLabelCanvas.height = 64;
    this.weaponLabelCtx = this.weaponLabelCanvas.getContext('2d')!;
    const labelTex = new THREE.CanvasTexture(this.weaponLabelCanvas);
    labelTex.minFilter = THREE.LinearFilter;
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, depthTest: false, transparent: true });
    this.weaponLabelSprite = new THREE.Sprite(labelMat);
    this.weaponLabelSprite.scale.set(0.12, 0.03, 1);
    this.weaponLabelSprite.position.set(0, -0.245, -0.5);
    this.weaponLabelSprite.renderOrder = 10000;
    this.hudGroup.add(this.weaponLabelSprite);

    // Cooldown bar (below health bar)
    const cdGeo = new THREE.PlaneGeometry(barW, barH * 0.5);
    const cdBgMat = new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false, transparent: true, opacity: 0.5 });
    this.cooldownBg = new THREE.Mesh(cdGeo, cdBgMat);
    this.cooldownBg.position.set(0, -0.235, -0.5);
    this.cooldownBg.renderOrder = 9999;
    this.hudGroup.add(this.cooldownBg);

    const cdFillGeo = new THREE.PlaneGeometry(barW, barH * 0.5);
    this.cooldownMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false, transparent: true, opacity: 0.8 });
    this.cooldownFill = new THREE.Mesh(cdFillGeo, this.cooldownMat);
    this.cooldownFill.position.set(0, -0.235, -0.499);
    this.cooldownFill.renderOrder = 10000;
    this.hudGroup.add(this.cooldownFill);

    // Death overlay (semi-transparent red screen)
    const deadGeo = new THREE.PlaneGeometry(2, 2);
    const deadMat = new THREE.MeshBasicMaterial({ color: 0x880000, depthTest: false, transparent: true, opacity: 0 });
    this.deadOverlay = new THREE.Mesh(deadGeo, deadMat);
    this.deadOverlay.position.set(0, 0, -0.3);
    this.deadOverlay.renderOrder = 10001;
    this.hudGroup.add(this.deadOverlay);
  }

  private buildReticle(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'VRReticle';
    // Small ring reticle at 3m
    const ringGeo = new THREE.RingGeometry(0.012, 0.016, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthTest: false,
      transparent: true,
      opacity: 0.6,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 10000;
    group.add(ring);
    // Center dot
    const dotGeo = new THREE.CircleGeometry(0.003, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.renderOrder = 10001;
    group.add(dot);
    group.position.set(0, 0, -3);
    group.visible = false; // shown when presenting
    return group;
  }

  /** Update 3D HUD elements from game state. Call each frame while in VR FPS mode. */
  updateHUD(hp: number, maxHp: number, weaponName: string, cooldownPct: number, isDead: boolean): void {
    // Health bar fill
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    this.healthFill.scale.x = Math.max(0.001, ratio);
    // Shift so bar drains from right
    const barW = 0.16;
    this.healthFill.position.x = -(barW * (1 - ratio)) / 2;
    // Color: green → yellow → red
    if (ratio > 0.5) this.healthMat.color.setHex(0x00cc00);
    else if (ratio > 0.25) this.healthMat.color.setHex(0xcccc00);
    else this.healthMat.color.setHex(0xcc0000);

    // Weapon label
    const ctx = this.weaponLabelCtx;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(weaponName, 128, 22);
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`HP: ${Math.ceil(hp)}/${maxHp}`, 128, 50);
    (this.weaponLabelSprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;

    // Cooldown bar
    this.cooldownFill.scale.x = Math.max(0.001, cooldownPct);
    this.cooldownFill.position.x = -(barW * (1 - cooldownPct)) / 2;
    this.cooldownFill.visible = cooldownPct > 0.01;
    this.cooldownBg.visible = cooldownPct > 0.01;

    // Dead overlay
    const deadMat = this.deadOverlay.material as THREE.MeshBasicMaterial;
    deadMat.opacity = isDead ? 0.4 : 0;

    // Reticle visibility
    this.reticle.visible = this._isPresenting && !isDead;
  }

  // ========================= Weapon =========================

  /** Set the weapon model displayed in VR. Pass null to clear. */
  setWeaponModel(model: THREE.Group | null): void {
    if (this._weaponModel) {
      this.weaponMount.remove(this._weaponModel);
    }
    this._weaponModel = model;
    if (model) {
      // Clone so it doesn't interfere with the non-VR weapon scene
      this.weaponMount.add(model);
    }
  }

  /** Apply recoil animation to the VR weapon. */
  setWeaponRecoil(amount: number): void {
    if (!this._weaponModel) return;
    this._weaponModel.position.z = -amount * 0.08;
    this._weaponModel.position.y = amount * 0.02;
  }

  // ========================= Input =========================

  /** Poll the Gamepad API for a connected controller. Returns null if none found. */
  getGamepadInput(): GamepadInput | null {
    const gamepads = navigator.getGamepads();
    for (const gp of gamepads) {
      if (!gp || !gp.connected) continue;
      // Need at least enough axes for the configured mapping
      const a = this.axisMap;
      const b = this.buttonMap;
      const btn = (idx: number) => gp.buttons[idx]?.pressed ?? false;
      const axis = (idx: number) => {
        const v = gp.axes[idx] ?? 0;
        return Math.abs(v) < DEADZONE ? 0 : v;
      };
      return {
        moveX: axis(a.moveX),
        moveY: axis(a.moveY),
        lookX: axis(a.lookX),
        lookY: axis(a.lookY),
        fire: btn(b.fire),
        altFire: btn(b.altFire),
        jump: btn(b.jump),
        interact: btn(b.interact),
        swap: btn(b.swap),
        heroAbility: btn(b.heroAbility),
        reload: btn(b.reload),
      };
    }
    return null;
  }

  /** Get the raw gamepad object for config UI. Returns null if none connected. */
  getRawGamepad(): Gamepad | null {
    const gamepads = navigator.getGamepads();
    for (const gp of gamepads) {
      if (gp && gp.connected) return gp;
    }
    return null;
  }

  /** Get the gamepad-controlled aim direction in world space (rig yaw + aim pitch). */
  getAimDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    if (this._isPresenting) {
      // Apply aim pitch then rig yaw — ignores head tracking entirely
      dir.applyQuaternion(this.aimPivot.quaternion);
      dir.applyQuaternion(this.cameraRig.quaternion);
    } else if (this.camera) {
      this.camera.getWorldDirection(dir);
    }
    return dir.normalize();
  }

  /** Get the aim origin in world space (rig position + eye height). */
  getAimPosition(): THREE.Vector3 {
    const pos = new THREE.Vector3();
    if (this._isPresenting) {
      this.aimPivot.getWorldPosition(pos);
    } else if (this.camera) {
      this.camera.getWorldPosition(pos);
    }
    return pos;
  }

  // ========================= Cleanup =========================

  destroy(): void {
    this.detachFromScene();
    this.vrButtonEl?.remove();
    this.renderer.xr.enabled = false;
  }
}
