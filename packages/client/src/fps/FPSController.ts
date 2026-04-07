import * as THREE from 'three';
import type { InputState, TeamId } from '@dyarchy/shared';
import { SoundManager } from '../audio/SoundManager.js';
import {
  MOUSE_SENSITIVITY,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  GROUND_Y,
} from '@dyarchy/shared';
import { applyMovement } from '@dyarchy/shared';
import { WEAPONS, type WeaponDef, createWeaponModel } from './Weapons.js';
import type { SceneManager, SceneEntity } from '../renderer/SceneManager.js';
import { createFPSPlayer } from '../renderer/MeshFactory.js';
import { isMobile, TouchControls } from './TouchControls.js';
import type { GamepadInput } from '../vr/VRManager.js';
// getTerrainHeight accessed via this.sceneManager.terrainHeight

const RESPAWN_TIME = 7;
const BASE_MAX_HP = 100;
const ARMORY_INTERACT_RANGE = 6;

export class FPSController {
  readonly camera: THREE.PerspectiveCamera;

  private position: THREE.Vector3;
  private velocity = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private onGround = true;
  private enabled = false;

  private readonly keys = {
    forward: false, backward: false, left: false, right: false, jump: false,
  };

  private locked = false;
  private readonly canvas: HTMLCanvasElement;
  private _eventCleanup: (() => void) | null = null;
  private readonly obstacleBoxes: { center: THREE.Vector3; halfSize: THREE.Vector3 }[];
  private readonly sceneManager: SceneManager;
  private readonly spawnPosition: THREE.Vector3;

  // Player entity visible in RTS view
  playerEntity: SceneEntity | null = null;
  private playerMesh: THREE.Mesh;

  // Health
  hp = BASE_MAX_HP;
  maxHp = BASE_MAX_HP;
  isDead = false;
  respawnTimer = 0;

  // Kill cam state
  private killCamTargetId: string | null = null;
  private killCamName: string | null = null;
  private killCamAngle = 0;
  private nestTeleportCooldown = 0; // suppress position reconciliation after nest teleport

  // Health bar display for hit enemies
  private hitHealthBars = new Map<string, { bg: THREE.Mesh; fill: THREE.Mesh; timer: number }>();

  // Weapons: primary (pistol, always) + secondary (chosen at armory)
  private primaryWeapon: WeaponDef = WEAPONS.pistol;
  private secondaryWeapon: WeaponDef | null = null;
  private activeSlot: 'primary' | 'secondary' = 'primary';
  private weaponCooldowns = new Map<string, number>(); // per-weapon cooldown timers
  cheatNoCooldown = false;
  armoryUnlocked = false;
  armoryLevel2 = false;
  rocketCooldownReduced = false;

  // Sniper scope
  private scopeLevel = 0; // 0=none, 1=2x, 2=5x
  private scopeOverlay: HTMLDivElement | null = null;
  private defaultFOV = 70;

  /** Callback for online mode: notifies when FPS hits an entity */
  onHit: ((targetId: string, damage: number) => void) | null = null;
  /** When true, this controller doesn't create its own entity (server owns it) */
  isOnline = false;
  localTeamId: TeamId = 1;
  /** Callback to send input to server (online mode) */
  onInput: ((keys: { forward: boolean; backward: boolean; left: boolean; right: boolean; jump: boolean }, yaw: number, pitch: number, dt: number) => void) | null = null;
  /** Callback to send arbitrary messages to server */
  onServerMessage: ((msg: any) => void) | null = null;
  private inputSeq = 0;

  // Hero system
  heroType: string | null = null;
  heroAbilityActive = false;
  heroAbilityCharge = 10;
  heroAbilityMaxCharge = 10;
  heroAbilityDepleted = false;
  heroAbilityLockout = 0;
  shieldHp = 0;
  baseUpgraded = false;
  hasHeroAcademy = false;
  heroHpLevel = 0;
  heroDmgLevel = 0;
  heroRegenActive = false;
  private shieldMesh: THREE.Mesh | null = null;
  private heroSelectionContainer: HTMLDivElement | null = null;
  private abilityBar: HTMLDivElement | null = null;
  private abilityFill: HTMLDivElement | null = null;
  private abilityText: HTMLDivElement | null = null;

  // Mobile touch controls
  readonly mobile = isMobile();
  private touchControls: TouchControls | null = null;

  // VR mode
  vrMode = false;
  vrCameraRig: THREE.Group | null = null;
  vrGamepadInput: GamepadInput | null = null;
  vrAimPitch = 0; // gamepad-controlled pitch for VR aiming (set by game loop)

  // Gamepad edge-detection state (tracks which buttons were held last frame)
  private gpPrev = {
    fire: false, altFire: false, jump: false,
    interact: false, swap: false, heroAbility: false, reload: false,
  };

  // Hysteresis state for analog stick → boolean conversion (prevents jitter near deadzone)
  private gpMoveState = { forward: false, backward: false, left: false, right: false };

  // Vehicle state
  inVehicle = false;
  vehicleId: string | null = null;
  vehicleSeat: 'driver' | 'gunner' | null = null;
  vehicleType: 'jeep' | 'helicopter' | null = null;
  private vehicleHeading = 0;
  private shiftHeld = false;
  private vehicleChaseCamAngle = 0; // horizontal orbit angle relative to vehicle

  // Helicopter aiming: offset within the targeting circle (world units, clamped to radius 3)
  private heliAimX = 0; // lateral offset (positive = right of heading)
  private heliAimZ = 0; // forward/back offset (positive = forward of center aim point)
  private heliAimPitch = 0; // vertical aim angle (positive = up, negative = down)
  private heliTargetRing: HTMLDivElement | null = null;
  private heliGunSpinSpeed = 0; // gatling barrel spin speed (radians/sec)
  private heliCrosshair: HTMLDivElement | null = null; // circular crosshair for helicopter
  private heliGunHeat = 0;        // 0–5 seconds of firing accumulated
  private heliGunOverheated = false; // true = forced cooldown, can't fire
  private heliMouseHeld = false;   // mouse button held state for auto-fire
  private heliHeatBar: HTMLDivElement | null = null; // heat indicator HUD

  // Weapon viewmodel
  private weaponScene: THREE.Scene;
  private weaponCamera: THREE.PerspectiveCamera;
  private currentModel: THREE.Group | null = null;
  private muzzleFlash: THREE.Mesh | null = null;
  private muzzleFlashTimer = 0;
  private recoilAmount = 0;
  private readonly weaponRestPos = new THREE.Vector3(0.25, -0.2, -0.4);

  // Shooting visuals
  private readonly raycaster = new THREE.Raycaster();

  // Damage vignette (flash on hit)
  private damageVignette: HTMLDivElement;
  private damageFlashTimer = 0;
  // Persistent damage border (grows as HP drops)
  private damageBorder: HTMLDivElement;

  // HUD elements
  private hud: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLDivElement;
  private jeepHpRow: HTMLDivElement;
  private jeepHpFill: HTMLDivElement;
  private jeepHpText: HTMLDivElement;
  private weaponHud: HTMLDivElement;
  private cooldownFill: HTMLDivElement;
  private interactPrompt: HTMLDivElement;
  private waveTimerHud!: HTMLDivElement;
  waveTimer = 30; // synced from game loop
  private respawnOverlay: HTMLDivElement;
  private respawnText: HTMLDivElement;
  private hitMarker: HTMLDivElement;
  private hitMarkerTimer = 0;

  // Armory weapon selection menu
  private armoryMenu: HTMLDivElement;
  private armoryMenuVisible = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    spawnPosition: THREE.Vector3,
    obstacleBoxes: { center: THREE.Vector3; halfSize: THREE.Vector3 }[],
    sceneManager: SceneManager,
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.spawnPosition = spawnPosition.clone();
    this.position = spawnPosition.clone();
    this.position.y = sceneManager.terrainHeight(spawnPosition.x, spawnPosition.z) + PLAYER_HEIGHT;
    this.obstacleBoxes = obstacleBoxes;
    this.sceneManager = sceneManager;

    // Weapon viewmodel scene (rendered on top)
    this.weaponScene = new THREE.Scene();
    this.weaponScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const wLight = new THREE.DirectionalLight(0xffffff, 0.8);
    wLight.position.set(1, 2, 1);
    this.weaponScene.add(wLight);
    this.weaponCamera = new THREE.PerspectiveCamera(70, canvas.width / canvas.height, 0.01, 10);

    // Create player mesh (visible in RTS view) — only in offline mode
    // In online mode, the SnapshotRenderer handles the player entity
    this.playerMesh = createFPSPlayer(1);
    this.playerMesh.position.set(this.position.x, 0, this.position.z);
    sceneManager.scene.add(this.playerMesh);

    // Will be set to null in online mode after construction
    this.playerEntity = sceneManager.registerEntity(
      this.playerMesh, 'FPS Player', 'fps_player', 1, this.hp, this.maxHp,
    );

    // Event listeners (stored for cleanup in destroy())
    const onPointerLock = () => { this.locked = document.pointerLockElement === canvas; };
    const onMouseMove = (e: MouseEvent) => {
      if (!this.locked || this.armoryMenuVisible || this.vrGamepadInput) return;
      if (this.inVehicle && this.vehicleType === 'helicopter') {
        const aimSensitivity = 0.03;
        this.heliAimX += e.movementX * aimSensitivity;
        this.heliAimZ -= e.movementY * aimSensitivity;
        const dist = Math.sqrt(this.heliAimX * this.heliAimX + this.heliAimZ * this.heliAimZ);
        if (dist > 3) {
          this.heliAimX *= 3 / dist;
          this.heliAimZ *= 3 / dist;
          this.yaw -= e.movementX * MOUSE_SENSITIVITY;
          this.heliAimPitch -= e.movementY * MOUSE_SENSITIVITY;
          this.heliAimPitch = Math.max(-0.6, Math.min(0.4, this.heliAimPitch));
        }
      } else {
        this.yaw -= e.movementX * MOUSE_SENSITIVITY;
        this.pitch -= e.movementY * MOUSE_SENSITIVITY;
        this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (this.armoryMenuVisible) return;
      this.onKey(e.code, true);
      this.onActionKey(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (!this.armoryMenuVisible) this.onKey(e.code, false);
      this.onKeyUp(e.code);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!this.enabled || !this.locked || this.isDead || this.armoryMenuVisible) return;
      if (e.button === 0) { this.heliMouseHeld = true; this.tryShoot(); }
      if (e.button === 2) this.toggleScope();
    };
    const onMouseUp = (e: MouseEvent) => { if (e.button === 0) this.heliMouseHeld = false; };
    const onContext = (e: Event) => e.preventDefault();

    document.addEventListener('pointerlockchange', onPointerLock);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContext);

    this._eventCleanup = () => {
      document.removeEventListener('pointerlockchange', onPointerLock);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContext);
    };

    // Mobile touch controls
    if (this.mobile) {
      this.touchControls = new TouchControls();
    }

    // Build scope overlay (hidden by default)
    this.scopeOverlay = document.createElement('div');
    this.scopeOverlay.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 11; display: none;
    `;
    // Blurred edges with clear circle center
    this.scopeOverlay.innerHTML = `
      <div style="position:absolute;inset:0;background:rgba(0,0,0,0.85);
        -webkit-mask-image:radial-gradient(circle 180px at center, transparent 170px, black 190px);
        mask-image:radial-gradient(circle 180px at center, transparent 170px, black 190px);
        backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);"></div>
      <div style="position:absolute;inset:0;
        background:radial-gradient(circle 180px at center, transparent 168px, rgba(0,0,0,0.9) 172px, rgba(0,0,0,0.9) 178px, transparent 182px);
        pointer-events:none;"></div>
      <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(0,0,0,0.4);"></div>
      <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(0,0,0,0.4);"></div>
      <div id="scope-zoom-label" style="position:absolute;bottom:calc(50% - 200px);left:50%;transform:translateX(-50%);
        color:rgba(255,255,255,0.5);font-size:13px;font-family:system-ui,sans-serif;"></div>
    `;
    document.body.appendChild(this.scopeOverlay);

    // Build HUD elements
    this.hud = this.buildHud();
    this.hpFill = this.hud.querySelector('#fps-hp-fill') as HTMLDivElement;
    this.hpText = this.hud.querySelector('#fps-hp-text') as HTMLDivElement;
    this.jeepHpRow = this.hud.querySelector('#fps-jeep-hp-row') as HTMLDivElement;
    this.jeepHpFill = this.hud.querySelector('#fps-jeep-hp-fill') as HTMLDivElement;
    this.jeepHpText = this.hud.querySelector('#fps-jeep-hp-text') as HTMLDivElement;
    this.weaponHud = this.hud.querySelector('#fps-weapon-hud') as HTMLDivElement;
    this.cooldownFill = this.hud.querySelector('#fps-cooldown-fill') as HTMLDivElement;
    this.interactPrompt = this.hud.querySelector('#fps-interact') as HTMLDivElement;
    this.abilityBar = this.hud.querySelector('#fps-ability-bar') as HTMLDivElement;
    this.abilityFill = this.hud.querySelector('#fps-ability-fill') as HTMLDivElement;
    this.abilityText = this.hud.querySelector('#fps-ability-text') as HTMLDivElement;

    this.respawnOverlay = this.buildRespawnOverlay();
    this.respawnText = this.respawnOverlay.querySelector('#respawn-text') as HTMLDivElement;

    this.hitMarker = this.buildHitMarker();
    this.armoryMenu = this.buildArmoryMenu();

    // Damage flash vignette (brief flash on hit)
    this.damageVignette = document.createElement('div');
    this.damageVignette.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 13; opacity: 0;
      background: radial-gradient(ellipse at center, transparent 40%, rgba(180,0,0,0.6) 100%);
    `;
    document.body.appendChild(this.damageVignette);

    // Persistent damage border (grows as HP decreases)
    this.damageBorder = document.createElement('div');
    this.damageBorder.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 12; opacity: 0;
    `;
    document.body.appendChild(this.damageBorder);

    // Set initial weapon model
    this.setWeaponModel(this.primaryWeapon);
  }

  /** Show a notification banner on the FPS player's screen */
  showNotification(text: string, color = '#ffd700'): void {
    const notif = document.createElement('div');
    notif.style.cssText = `
      position:fixed; top:80px; left:50%; transform:translateX(-50%);
      padding:10px 24px; background:rgba(0,0,0,0.75); color:${color};
      border:1px solid ${color}; border-radius:8px; font-size:16px; font-weight:bold;
      font-family:system-ui,sans-serif; z-index:20; pointer-events:none;
      animation:fps-notif-in 0.3s ease-out;
    `;
    notif.textContent = text;
    // Stack multiple notifications
    const existing = document.querySelectorAll('.fps-notif');
    notif.style.top = `${80 + existing.length * 50}px`;
    notif.className = 'fps-notif';
    document.body.appendChild(notif);
    // Add animation keyframes if needed
    if (!document.getElementById('fps-notif-style')) {
      const style = document.createElement('style');
      style.id = 'fps-notif-style';
      style.textContent = `
        @keyframes fps-notif-in { from { opacity:0; transform:translateX(-50%) translateY(-10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => {
      notif.style.transition = 'opacity 0.5s';
      notif.style.opacity = '0';
      setTimeout(() => notif.remove(), 600);
    }, 4000);
  }

  enable(): void {
    this.enabled = true;
    this.hud.style.display = 'block';
    this.playerMesh.visible = false;
    this.updateHud();
    // Update team badge
    const badge = document.getElementById('fps-team-badge');
    if (badge) {
      const isBlue = this.localTeamId === 1;
      badge.textContent = isBlue ? 'BLUE TEAM' : 'RED TEAM';
      badge.style.background = isBlue ? 'rgba(40,80,180,0.7)' : 'rgba(180,40,40,0.7)';
      badge.style.color = '#fff';
      badge.style.border = `2px solid ${isBlue ? '#4488ff' : '#ff4444'}`;
      badge.style.display = '';
    }
    if (this.mobile) this.touchControls?.show();
  }

  disable(): void {
    this.enabled = false;
    this.resetScope();
    if (this.locked) document.exitPointerLock();
    this.keys.forward = this.keys.backward = this.keys.left = this.keys.right = this.keys.jump = false;
    this.hud.style.display = 'none';
    this.respawnOverlay.style.display = 'none';
    this.waveTimerHud.style.display = 'none';
    const badge = document.getElementById('fps-team-badge');
    if (badge) badge.style.display = 'none';
    const lvlBadges = document.getElementById('fps-level-badges');
    if (lvlBadges) lvlBadges.style.display = 'none';
    this.hideArmoryMenu();
    this.playerMesh.visible = true;
    if (this.mobile) this.touchControls?.hide();
  }

  destroy(): void {
    this.disable();
    if (this._eventCleanup) { this._eventCleanup(); this._eventCleanup = null; }
    this.hud.remove();
    this.respawnOverlay.remove();
    this.hitMarker.remove();
    this.armoryMenu.remove();
    this.damageVignette.remove();
    this.scopeOverlay?.remove();
    this.damageBorder.remove();
    document.getElementById('fps-team-badge')?.remove();
    document.getElementById('fps-level-badges')?.remove();
    this.heliCrosshair?.remove();
    this.heliTargetRing?.remove();
    this.heliHeatBar?.remove();
    this.removeShieldVisual();
    if (this.heroSelectionContainer) { this.heroSelectionContainer.remove(); this.heroSelectionContainer = null; }
  }

  unlockArmory(): void {
    this.armoryUnlocked = true;
  }

  /** Sync FPS player state from server snapshot (online mode) */
  syncFromServer(serverHp: number, serverMaxHp: number, serverPos: { x: number; y: number; z: number }, killerEntityId?: string, killerName?: string, heroFields?: { heroType?: string; heroAbilityActive?: boolean; shieldHp?: number; abilityCharge?: number; abilityMaxCharge?: number; abilityDepleted?: boolean; abilityLockout?: number }): void {
    // Sync hero fields from server
    if (heroFields) {
      this.heroType = heroFields.heroType ?? null;
      this.heroAbilityCharge = heroFields.abilityCharge ?? 0;
      this.heroAbilityMaxCharge = heroFields.abilityMaxCharge ?? 10;
      this.heroAbilityDepleted = heroFields.abilityDepleted ?? false;
      this.heroAbilityLockout = heroFields.abilityLockout ?? 0;
      this.shieldHp = heroFields.shieldHp ?? 0;
      // Server deactivated ability (charge ran out, entered vehicle, etc.)
      if (!heroFields.heroAbilityActive && this.heroAbilityActive) {
        this.heroAbilityActive = false;
        this.restoreWeaponModel();
        this.removeShieldVisual();
      }
      // Shield visual is updated per-frame in updateShieldVisual()
      this.updateHud();
    }

    // Detect death from server
    if (serverHp <= 0 && !this.isDead) {
      this.hp = 0;
      this.killCamTargetId = killerEntityId ?? null;
      this.killCamName = killerName ?? null;
      this.killCamAngle = 0;
      this.die();
      return;
    }

    // Detect respawn from server
    if (serverHp > 0 && this.isDead) {
      this.isDead = false;
      this.hp = serverHp;
      this.maxHp = serverMaxHp;
      // heroType is synced from server above — don't reset it here
      this.heroAbilityActive = false;
      this.removeShieldVisual();
      this.respawnOverlay.style.display = 'none';
      // Remove hero selection UI
      if (this.heroSelectionContainer) {
        this.heroSelectionContainer.remove();
        this.heroSelectionContainer = null;
      }
      // Exit vehicle if still flagged as in one (server already ejected us on death)
      if (this.inVehicle) {
        this.handleVehicleExited();
      }
      this.position.set(serverPos.x, serverPos.y, serverPos.z);
      this.velocity = { x: 0, y: 0, z: 0 };
      // Reset to default weapon (pistol only)
      this.secondaryWeapon = null;
      this.activeSlot = 'primary';
      this.setWeaponModel(this.primaryWeapon);
      this.weaponCooldowns.clear();
      this.updateHud();
      SoundManager.instance().playerRespawn();
      return;
    }

    // Sync HP from server (damage or regen)
    if (!this.isDead && serverHp !== this.hp) {
      if (serverHp < this.hp) {
        this.flashDamageVignette();
      }
      this.hp = serverHp;
      this.maxHp = serverMaxHp;
      this.updateHud();
      if (this.hp <= 0) {
        this.hp = 0;
        this.die();
      }
    }

    // Position reconciliation — keep client in sync with server
    // Skip when in vehicle (vehicle mesh drives position) or after sniper nest teleport
    if (!this.isDead && !this.inVehicle && this.nestTeleportCooldown <= 0) {
      const dx = serverPos.x - this.position.x;
      const dy = serverPos.y - this.position.y;
      const dz = serverPos.z - this.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // When the player is locally idle (no movement input, on ground), trust the
      // client prediction and only correct large desyncs. This avoids the "ghost
      // slide" caused by network latency: the server is still processing
      // older "moving" inputs while the client has already stopped.
      const isIdle = !this.keys.forward && !this.keys.backward
        && !this.keys.left && !this.keys.right && this.onGround;
      const minorThreshold = isIdle ? 4 : 0.04; // ignore <2 unit drift when idle

      if (distSq > 9) {
        // Major desync (> 3 units) — hard snap to server
        this.position.x = serverPos.x;
        this.position.y = serverPos.y;
        this.position.z = serverPos.z;
        this.velocity = { x: 0, y: 0, z: 0 };
      } else if (distSq > minorThreshold) {
        // Drift correction — gentle when moving, only large when idle
        this.position.x += dx * 0.1;
        this.position.y += dy * 0.1;
        this.position.z += dz * 0.1;
      }
    }
  }

  getActiveWeapon(): WeaponDef {
    if (this.activeSlot === 'secondary' && this.secondaryWeapon) return this.secondaryWeapon;
    return this.primaryWeapon;
  }

  getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  /** Get gamepad-controlled aim direction in VR (rig yaw + vrAimPitch, ignores head). */
  private getVRAimDirection(): THREE.Vector3 {
    const rigYaw = this.vrCameraRig?.rotation.y ?? 0;
    const pitch = this.vrAimPitch;
    const dir = new THREE.Vector3(
      -Math.sin(rigYaw) * Math.cos(pitch),
      -Math.sin(pitch),
      -Math.cos(rigYaw) * Math.cos(pitch),
    );
    return dir.normalize();
  }

  /** Cheat: clear all weapon cooldowns (single-player only) */
  cheatResetCooldowns(): void {
    this.weaponCooldowns.clear();
  }

  /** Dev tool: equip any weapon by ID, bypassing armory requirements */
  cheatEquipWeapon(weaponId: string): void {
    const weapon = WEAPONS[weaponId];
    if (!weapon) return;
    if (weapon.slot === 'primary') {
      this.primaryWeapon = weapon;
      this.activeSlot = 'primary';
    } else {
      this.secondaryWeapon = weapon;
      this.activeSlot = 'secondary';
    }
    this.setWeaponModel(weapon);
    this.weaponCooldowns.clear();
    this.updateHud();
  }

  /** Show hit marker and enemy health bar (called when jeep turret hits an enemy) */
  showHitMarker(targetId?: string): void {
    this.hitMarkerTimer = 0.3;
    this.hitMarker.style.opacity = '1';
    this.hitMarker.style.filter = 'none';
    if (targetId) {
      const entity = this.sceneManager.entities.find(e => e.id === targetId);
      if (entity) this.showHitHealthBar(entity);
    }
  }

  isPointerLocked(): boolean {
    return this.locked || this.mobile || this.vrMode || this.vrGamepadInput !== null;
  }

  // ===================== Input =====================

  private onKey(code: string, down: boolean): void {
    switch (code) {
      case 'KeyW': this.keys.forward = down; break;
      case 'KeyS': this.keys.backward = down; break;
      case 'KeyA': this.keys.left = down; break;
      case 'KeyD': this.keys.right = down; break;
      case 'Space': this.keys.jump = down; break;
      case 'ShiftLeft': case 'ShiftRight': this.shiftHeld = down; break;
    }
  }

  private onActionKey(code: string): void {
    if (this.isDead) {
      // Allow number keys to select hero while dead
      if (this.heroSelectionContainer) {
        const heroIndex = code === 'Digit1' ? 0 : code === 'Digit2' ? 1 : code === 'Digit3' ? 2 : -1;
        if (heroIndex >= 0) {
          const buttons = this.heroSelectionContainer.querySelectorAll('button');
          if (buttons[heroIndex]) (buttons[heroIndex] as HTMLButtonElement).click();
        }
      }
      return;
    }

    // Q to swap weapons
    if (code === 'KeyQ' && this.secondaryWeapon) {
      this.resetScope();
      this.activeSlot = this.activeSlot === 'primary' ? 'secondary' : 'primary';
      this.setWeaponModel(this.getActiveWeapon());
      this.updateHud();
      SoundManager.instance().weaponSwitch();
    }

    // 1 = primary, 2 = secondary
    if (code === 'Digit1') {
      this.resetScope();
      this.activeSlot = 'primary';
      this.setWeaponModel(this.primaryWeapon);
      this.updateHud();
      SoundManager.instance().weaponSwitch();
    }
    if (code === 'Digit2' && this.secondaryWeapon) {
      this.resetScope();
      this.activeSlot = 'secondary';
      this.setWeaponModel(this.secondaryWeapon);
      this.updateHud();
      SoundManager.instance().weaponSwitch();
    }

    // E to interact: vehicle > sniper nest > armory
    if (code === 'KeyE') {
      if (this.inVehicle) {
        this.exitVehicle();
      } else if (!this.tryEnterVehicle()) {
        this.tryInteractArmory();
      }
    }

    // F to honk horn (driver only, jeep only) or activate hero ability
    if (code === 'KeyF') {
      if (this.inVehicle && this.vehicleSeat === 'driver' && this.vehicleType === 'jeep') {
        const sm = SoundManager.instance();
        if (sm.playHorn(this.position.x, this.position.z)) {
          this.onServerMessage?.({ type: 'horn_honk', vehicleId: this.vehicleId! });
        }
      } else if (!this.inVehicle && this.heroType && !this.heroAbilityActive && !this.heroAbilityDepleted && this.heroAbilityCharge > 0) {
        this.heroAbilityActive = true;
        this.onServerMessage?.({ type: 'hero_ability', active: true });
        if (this.heroType !== 'tank') this.hideWeaponModel();
        this.showShieldVisual();
      }
    }
  }

  private onKeyUp(code: string): void {
    if (code === 'KeyF' && this.heroAbilityActive) {
      this.heroAbilityActive = false;
      this.onServerMessage?.({ type: 'hero_ability', active: false });
      if (this.heroType !== 'tank') this.restoreWeaponModel();
      this.removeShieldVisual();
    }
  }

  private hideWeaponModel(): void {
    if (this.currentModel) this.currentModel.visible = false;
  }

  private restoreWeaponModel(): void {
    if (this.currentModel) this.currentModel.visible = true;
  }

  private showShieldVisual(): void {
    if (this.heroType !== 'tank') return;
    if (this.shieldMesh) return;
    // Full sphere in the main scene, centered on the player
    const radius = PLAYER_HEIGHT * 2.5;
    const geo = new THREE.SphereGeometry(radius, 32, 24);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          // Gradient: white at bottom, purple at top based on local Y
          float h = clamp((vWorldPos.y - (${(-radius).toFixed(1)})) / (${(radius * 2).toFixed(1)}), 0.0, 1.0);
          vec3 white = vec3(1.0, 1.0, 1.0);
          vec3 purple = vec3(0.6, 0.2, 0.9);
          vec3 col = mix(white, purple, h);

          // Shimmer: random-ish patches change opacity over time
          float shimmer = sin(vWorldPos.x * 3.0 + uTime * 2.0)
                        * cos(vWorldPos.z * 4.0 + uTime * 1.5)
                        * sin(vWorldPos.y * 2.5 + uTime * 3.0);
          float alpha = 0.14 + shimmer * 0.07;

          // Fresnel edge glow — brighter at glancing angles
          float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
          alpha += fresnel * 0.09;

          gl_FragColor = vec4(col, clamp(alpha, 0.05, 0.29));
        }
      `,
    });
    this.shieldMesh = new THREE.Mesh(geo, mat);
    this.sceneManager.scene.add(this.shieldMesh);
  }

  private removeShieldVisual(): void {
    if (this.shieldMesh) {
      this.sceneManager.scene.remove(this.shieldMesh);
      (this.shieldMesh.material as THREE.Material).dispose();
      this.shieldMesh.geometry.dispose();
      this.shieldMesh = null;
    }
  }

  /** Update first-person shield position and shimmer each frame */
  private updateShieldVisual(): void {
    if (!this.shieldMesh) return;
    this.shieldMesh.position.copy(this.position);
    this.shieldMesh.position.y -= PLAYER_HEIGHT; // center on feet
    const mat = this.shieldMesh.material as THREE.ShaderMaterial;
    if (mat.uniforms?.uTime) {
      mat.uniforms.uTime.value = performance.now() * 0.001;
    }
  }

  // ===================== Update =====================

  /** Check if this FPS player is inside an enemy tank's shield sphere */
  private getShieldSlow(): number {
    const SHIELD_R = 1.5 * 2.5; // PLAYER_HEIGHT * 2.5 from constants
    for (const ent of this.sceneManager.entities) {
      if (ent.entityType !== 'fps_player') continue;
      if (ent.teamId === this.localTeamId) continue;
      if (!ent.heroAbilityActive || ent.heroType !== 'tank') continue;
      if ((ent.shieldHp ?? 0) <= 0) continue;
      const dx = this.position.x - ent.mesh.position.x;
      const dz = this.position.z - ent.mesh.position.z;
      if (Math.sqrt(dx * dx + dz * dz) <= SHIELD_R) return 0.34;
    }
    return 1;
  }

  /** Tick weapon cooldowns — call every frame regardless of FPS/RTS mode */
  tickCooldowns(dt: number): void {
    // Enemy shield slow: cooldowns tick 66% slower
    const slow = this.getShieldSlow();
    const effectiveDt = dt * slow;
    for (const [id, cd] of this.weaponCooldowns) {
      const newCd = cd - effectiveDt;
      if (newCd <= 0) this.weaponCooldowns.delete(id);
      else this.weaponCooldowns.set(id, newCd);
    }
  }

  update(dt: number): void {
    if (!this.enabled) return;

    // Gamepad input: map sticks + buttons to movement keys and actions
    if (this.vrGamepadInput) {
      const gp = this.vrGamepadInput;
      const prev = this.gpPrev;

      // Left stick → movement (hysteresis to prevent jitter near deadzone)
      // Turn ON at 0.25, turn OFF at 0.10 — prevents oscillation near threshold
      const ON = 0.25, OFF = 0.10;
      const ms = this.gpMoveState;
      ms.forward  = gp.moveY < -(ms.forward  ? OFF : ON);
      ms.backward = gp.moveY >  (ms.backward ? OFF : ON);
      ms.left     = gp.moveX < -(ms.left     ? OFF : ON);
      ms.right    = gp.moveX >  (ms.right    ? OFF : ON);
      this.keys.forward = ms.forward;
      this.keys.backward = ms.backward;
      this.keys.left = ms.left;
      this.keys.right = ms.right;
      this.keys.jump = gp.jump;

      // Right stick → camera look (flat-screen only; VR uses head tracking)
      if (!this.vrMode) {
        const GAMEPAD_LOOK_SPEED = 3.0;
        this.yaw -= gp.lookX * GAMEPAD_LOOK_SPEED * dt;
        this.pitch -= gp.lookY * GAMEPAD_LOOK_SPEED * dt;
        this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      }

      if (!this.isDead) {
        // R2/RT — fire (edge-detect for semi-auto, hold for auto)
        if (gp.fire) {
          if (!prev.fire) this.tryShoot();
          prev.fire = true;
        } else {
          prev.fire = false;
        }

        // L2/LT — scope toggle (edge-detect)
        if (gp.altFire && !prev.altFire) this.toggleScope();
        prev.altFire = gp.altFire;

        // Triangle/Y — interact (edge-detect)
        if (gp.interact && !prev.interact) {
          if (this.inVehicle) {
            this.exitVehicle();
          } else if (!this.tryEnterVehicle()) {
            this.tryInteractArmory();
          }
        }
        prev.interact = gp.interact;

        // Square/X — weapon swap (edge-detect)
        if (gp.swap && !prev.swap && this.secondaryWeapon) {
          this.resetScope();
          this.activeSlot = this.activeSlot === 'primary' ? 'secondary' : 'primary';
          this.setWeaponModel(this.getActiveWeapon());
          this.updateHud();
          SoundManager.instance().weaponSwitch();
        }
        prev.swap = gp.swap;

        // R1/RB — also weapon swap (alternative)
        if (gp.reload && !prev.reload && this.secondaryWeapon) {
          this.resetScope();
          this.activeSlot = this.activeSlot === 'primary' ? 'secondary' : 'primary';
          this.setWeaponModel(this.getActiveWeapon());
          this.updateHud();
          SoundManager.instance().weaponSwitch();
        }
        prev.reload = gp.reload;

        // L1/LB — hero ability (hold to activate, release to deactivate)
        if (gp.heroAbility && !prev.heroAbility) {
          if (this.inVehicle && this.vehicleSeat === 'driver' && this.vehicleType === 'jeep') {
            const sm = SoundManager.instance();
            if (sm.playHorn(this.position.x, this.position.z)) {
              this.onServerMessage?.({ type: 'horn_honk', vehicleId: this.vehicleId! });
            }
          } else if (!this.inVehicle && this.heroType && !this.heroAbilityActive && !this.heroAbilityDepleted && this.heroAbilityCharge > 0) {
            this.heroAbilityActive = true;
            this.onServerMessage?.({ type: 'hero_ability', active: true });
            if (this.heroType !== 'tank') this.hideWeaponModel();
            this.showShieldVisual();
          }
        }
        if (!gp.heroAbility && prev.heroAbility && this.heroAbilityActive) {
          this.heroAbilityActive = false;
          this.onServerMessage?.({ type: 'hero_ability', active: false });
          if (this.heroType !== 'tank') this.restoreWeaponModel();
          this.removeShieldVisual();
        }
        prev.heroAbility = gp.heroAbility;
      }
    }

    // Mobile touch input: read touch state into keys and camera
    if (!this.vrGamepadInput && this.mobile && this.touchControls) {
      const ts = this.touchControls.state;
      this.keys.forward = ts.forward;
      this.keys.backward = ts.backward;
      this.keys.left = ts.left;
      this.keys.right = ts.right;
      this.keys.jump = ts.jump;

      // Apply aim deltas
      const aim = this.touchControls.consumeAim();
      this.yaw -= aim.dx;
      this.pitch -= aim.dy;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

      // Auto-fire while fire button held
      if (ts.shooting && !this.isDead) {
        this.tryShoot();
      }
    }

    // Helicopter minigun: auto-fire while mouse/trigger held + overheat system
    if (this.inVehicle && this.vehicleType === 'helicopter' && !this.isDead) {
      const isFiring = this.heliMouseHeld || (this.vrGamepadInput?.fire ?? false);
      if (isFiring && (!this.heliGunOverheated || this.cheatNoCooldown)) {
        if (!this.cheatNoCooldown) this.heliGunHeat += dt;
        this.tryShoot(); // cooldown system handles fire rate
        if (this.heliGunHeat >= 5 && !this.cheatNoCooldown) {
          this.heliGunOverheated = true;
        }
      } else {
        // Cool down at same rate as heat-up (5s to full = 5s to empty)
        this.heliGunHeat = Math.max(0, this.heliGunHeat - dt);
        if (this.heliGunOverheated && this.heliGunHeat <= 0) {
          this.heliGunOverheated = false;
        }
      }
    } else {
      // Not in helicopter — reset heat state
      if (this.heliGunHeat > 0) {
        this.heliGunHeat = 0;
        this.heliGunOverheated = false;
      }
    }

    // Decrement nest teleport cooldown
    if (this.nestTeleportCooldown > 0) this.nestTeleportCooldown -= dt;

    if (this.isDead) {
      this.respawnTimer -= dt;
      this.respawnText.textContent = `Respawning in ${Math.ceil(Math.max(0, this.respawnTimer))}s`;

      // Kill cam: orbit camera around killer entity
      // In VR, move the rig instead (headset stays head-tracked within it)
      if (this.killCamTargetId) {
        const killerEntity = this.sceneManager.entities.find(e => e.id === this.killCamTargetId);
        if (killerEntity && killerEntity.hp > 0) {
          this.killCamAngle += dt * 0.5; // slow orbit
          const dist = 8;
          const height = 4;
          const targetPos = killerEntity.mesh.position;
          if (this.vrMode && this.vrCameraRig) {
            this.vrCameraRig.position.set(
              targetPos.x + Math.cos(this.killCamAngle) * dist,
              targetPos.y + height - PLAYER_HEIGHT,
              targetPos.z + Math.sin(this.killCamAngle) * dist,
            );
          } else {
            this.camera.position.set(
              targetPos.x + Math.cos(this.killCamAngle) * dist,
              targetPos.y + height,
              targetPos.z + Math.sin(this.killCamAngle) * dist,
            );
            this.camera.lookAt(targetPos.x, targetPos.y + 1.5, targetPos.z);
          }
        }
      }

      // In offline mode, respawn locally. In online mode, server controls respawn via syncFromServer.
      // Server controls respawn via syncFromServer()
      return;
    }

    // Sync HP from entity (fighters may have attacked us)
    if (this.playerEntity && this.playerEntity.hp < this.hp) {
      this.hp = this.playerEntity.hp;
      this.updateHud();
      if (this.hp <= 0) {
        this.hp = 0;
        this.die();
        return;
      }
    }

    // Weapon cooldowns are ticked externally via tickCooldowns() every frame

    // Update shield visual position + shimmer
    this.updateShieldVisual();

    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= dt;
      this.hitMarker.style.opacity = this.hitMarkerTimer > 0 ? '1' : '0';
    }

    // Damage vignette fade (hit flash)
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= dt;
      this.damageVignette.style.opacity = String(Math.max(0, this.damageFlashTimer / 0.3));
    }

    // Persistent damage border — grows from edges as HP drops
    // At 100% HP: invisible. At 1% HP: covers 25% of screen from edges.
    const hpPct = Math.max(0, this.hp / this.maxHp); // 1 = full, 0 = dead
    const damagePct = 1 - hpPct; // 0 = no damage, 1 = nearly dead
    if (damagePct > 0.01) {
      // transparent center radius: 75% at no damage, 50% at max damage (25% border)
      const centerRadius = 75 - damagePct * 25;
      const borderOpacity = 0.5 + damagePct * 0.45; // 0.5 at low damage, 0.95 at near-death
      this.damageBorder.style.opacity = '1';
      this.damageBorder.style.background = `radial-gradient(ellipse at center, transparent ${centerRadius}%, rgba(120,0,0,${borderOpacity}) 100%)`;
    } else {
      this.damageBorder.style.opacity = '0';
    }

    // ---- Vehicle mode: third-person camera + vehicle input ----
    if (this.inVehicle && this.vehicleId) {
      const vehicleEntity = this.sceneManager.entities.find(e => e.id === this.vehicleId);
      if (vehicleEntity && vehicleEntity.hp > 0) {
        const vPos = vehicleEntity.mesh.position;
        this.vehicleHeading = vehicleEntity.rotation.y;

        if (this.vehicleSeat === 'driver' && this.onServerMessage) {
          const isThrottling = this.keys.forward || this.keys.backward;
          const isStrafing = this.vehicleType === 'helicopter' && (this.keys.left || this.keys.right);
          const hasVertical = this.vehicleType === 'helicopter' && (this.keys.jump || this.shiftHeld);
          // For helicopter: detect if camera yaw differs from heading (player wants to turn in place)
          const driveHeading = this.yaw + Math.PI;
          let wantsTurn = false;
          if (this.vehicleType === 'helicopter') {
            let yawDiff = driveHeading - this.vehicleHeading;
            while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
            while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
            wantsTurn = Math.abs(yawDiff) > 0.05;
          }
          // Send input when pressing controls OR when the helicopter needs to turn
          if (isThrottling || hasVertical || isStrafing || wantsTurn) {
            const msg: any = {
              type: 'vehicle_input',
              seq: this.inputSeq++,
              forward: this.keys.forward,
              backward: this.keys.backward,
              cameraYaw: (isThrottling || isStrafing || wantsTurn) ? driveHeading : this.vehicleHeading,
              dt,
            };
            if (this.vehicleType === 'helicopter') {
              msg.ascend = this.keys.jump;
              msg.descend = this.shiftHeld;
              msg.strafeLeft = this.keys.left;
              msg.strafeRight = this.keys.right;
            }
            this.onServerMessage(msg);
          }
        }

        // Third-person chase camera — directly controlled by mouse yaw/pitch
        const camDist = 12;
        const camHeight = 4;
        // Camera orbits around vehicle based on mouse yaw
        const camAngle = this.yaw + Math.PI; // behind where camera faces
        const camPitch = Math.max(-0.3, Math.min(0.8, -this.pitch * 0.5 + 0.2)); // slight elevation control

        const camX = vPos.x + Math.sin(camAngle) * camDist * Math.cos(camPitch);
        const camZ = vPos.z + Math.cos(camAngle) * camDist * Math.cos(camPitch);
        const baseCamY = vPos.y + camHeight + Math.sin(camPitch) * camDist;
        const terrainAtCam = this.sceneManager.terrainHeight(camX, camZ);
        const camY = Math.max(baseCamY, terrainAtCam + 1.5);

        this.camera.position.set(camX, camY, camZ);
        this.camera.lookAt(vPos.x, vPos.y + 1.0, vPos.z);
        this.camera.fov = 75;
        this.camera.updateProjectionMatrix();

        // Helicopter targeting: project a targeting circle and movable crosshair
        if (this.vehicleType === 'helicopter') {
          const heading = vehicleEntity.rotation.y;
          const sinH = Math.sin(heading);
          const cosH = Math.cos(heading);
          // Center aim point: 15 units in front of heli, with pitch offset
          const aimDist = 15;
          const centerX = vPos.x - sinH * aimDist;
          const centerZ = vPos.z - cosH * aimDist;
          const centerY = vPos.y + 1.0 + Math.sin(this.heliAimPitch) * aimDist;

          // Project center of targeting circle
          const centerScreen = new THREE.Vector3(centerX, centerY, centerZ).project(this.camera);
          // Project a point at the edge of the circle (radius 3) to get screen-space diameter
          const edgeScreen = new THREE.Vector3(centerX + 3, centerY, centerZ).project(this.camera);
          const hw = window.innerWidth / 2;
          const hh = window.innerHeight / 2;
          const centerSX = hw + centerScreen.x * hw;
          const centerSY = hh - centerScreen.y * hh;
          const edgeSX = hw + edgeScreen.x * hw;
          const ringRadius = Math.abs(edgeSX - centerSX);
          const ringDiameter = ringRadius * 2;

          // Show/update the targeting ring
          if (!this.heliTargetRing) {
            this.heliTargetRing = document.createElement('div');
            this.heliTargetRing.style.cssText = `
              position:fixed; pointer-events:none; z-index:9;
              border:2px solid rgba(80,160,255,0.4); border-radius:50%;
              transform:translate(-50%,-50%);
            `;
            document.body.appendChild(this.heliTargetRing);
          }
          this.heliTargetRing.style.display = 'block';
          this.heliTargetRing.style.left = `${centerSX}px`;
          this.heliTargetRing.style.top = `${centerSY}px`;
          this.heliTargetRing.style.width = `${ringDiameter}px`;
          this.heliTargetRing.style.height = `${ringDiameter}px`;

          // Position crosshair: aim offset is in local heli space (right/forward)
          // Convert to world space using the heading
          const aimWorldX = centerX + this.heliAimX * cosH - this.heliAimZ * sinH;
          const aimWorldZ = centerZ - this.heliAimX * sinH - this.heliAimZ * cosH;
          const aimScreen = new THREE.Vector3(aimWorldX, centerY, aimWorldZ).project(this.camera);

          // Hide the default crosshair, use circular helicopter crosshair instead
          const defaultCrosshair = document.getElementById('crosshair');
          if (defaultCrosshair) defaultCrosshair.style.display = 'none';

          // Create/update circular crosshair showing hit zone at ~200 distance
          if (!this.heliCrosshair) {
            this.heliCrosshair = document.createElement('div');
            this.heliCrosshair.style.cssText = `
              position:fixed; pointer-events:none; z-index:11;
              border:2px solid rgba(255,100,100,0.7); border-radius:50%;
              transform:translate(-50%,-50%);
              box-shadow: 0 0 8px rgba(255,100,100,0.3);
            `;
            // Inner dot
            const dot = document.createElement('div');
            dot.style.cssText = `
              position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
              width:4px; height:4px; background:rgba(255,100,100,0.9); border-radius:50%;
            `;
            this.heliCrosshair.appendChild(dot);
            document.body.appendChild(this.heliCrosshair);
          }
          // Size the circle to represent spread at 200 units distance
          const spreadAtDist = WEAPONS['heli_minigun'].spread + WEAPONS['heli_minigun'].spreadPerDist * 200;
          const spreadWorldRadius = spreadAtDist * 200; // spread in world units at 200m
          const spreadEdge = new THREE.Vector3(aimWorldX + spreadWorldRadius, centerY, aimWorldZ).project(this.camera);
          const aimSX = hw + aimScreen.x * hw;
          const aimSY = hh - aimScreen.y * hh;
          const spreadEdgeSX = hw + spreadEdge.x * hw;
          const maxRedRadius = ringRadius * 4; // never more than 4x the blue circle
          const crosshairRadius = Math.min(maxRedRadius, Math.max(12, Math.abs(spreadEdgeSX - aimSX)));
          const crosshairDiam = crosshairRadius * 2;
          this.heliCrosshair.style.display = 'block';
          this.heliCrosshair.style.left = `${aimSX}px`;
          this.heliCrosshair.style.top = `${aimSY}px`;
          this.heliCrosshair.style.width = `${crosshairDiam}px`;
          this.heliCrosshair.style.height = `${crosshairDiam}px`;

          // Heat bar under the circular crosshair
          if (!this.heliHeatBar) {
            this.heliHeatBar = document.createElement('div');
            this.heliHeatBar.style.cssText = `
              position:fixed; pointer-events:none; z-index:11;
              width:60px; height:6px; background:rgba(0,0,0,0.5);
              border-radius:3px; overflow:hidden; transform:translateX(-50%);
            `;
            const fill = document.createElement('div');
            fill.style.cssText = 'height:100%;width:0%;border-radius:3px;transition:background 0.1s;';
            fill.id = 'heli-heat-fill';
            this.heliHeatBar.appendChild(fill);
            document.body.appendChild(this.heliHeatBar);
          }
          const heatPct = (this.heliGunHeat / 5) * 100;
          this.heliHeatBar.style.left = `${aimSX}px`;
          this.heliHeatBar.style.top = `${aimSY + crosshairRadius + 10}px`;
          this.heliHeatBar.style.display = heatPct > 1 ? 'block' : 'none';
          const heatFill = document.getElementById('heli-heat-fill');
          if (heatFill) {
            heatFill.style.width = `${heatPct}%`;
            heatFill.style.background = this.heliGunOverheated ? '#f44' : heatPct > 70 ? '#fa0' : '#4c4';
          }

          // Show turret muzzle flash
          const turretFlash = vehicleEntity.mesh.getObjectByName('muzzleFlash');
          if (turretFlash) {
            if (this.muzzleFlashTimer > 0) {
              turretFlash.visible = true;
              this.muzzleFlashTimer -= dt;
            } else {
              turretFlash.visible = false;
            }
          }

          // Rotate turret toward aim point
          const turret = vehicleEntity.mesh.getObjectByName('turret') as THREE.Group | undefined;
          if (turret) {
            // Aim direction in helicopter-local space
            const localAimX = this.heliAimX;
            const localAimZ = this.heliAimZ;
            const turretYaw = Math.atan2(localAimX, -(aimDist + localAimZ));
            turret.rotation.y = turretYaw;
            // Pitch the turret down toward the target
            turret.rotation.x = this.heliAimPitch * 0.5;

            // Spin barrel cluster when firing
            const barrelSpin = turret.getObjectByName('barrelSpin');
            if (barrelSpin) {
              if (this.heliGunSpinSpeed > 0) {
                barrelSpin.rotation.z += this.heliGunSpinSpeed * dt;
              }
              // Spin down gradually
              this.heliGunSpinSpeed = Math.max(0, this.heliGunSpinSpeed - dt * 30);
            }
          }

          // Make helicopter 85% transparent if the crosshair overlaps the heli mesh
          const aimNDC = new THREE.Vector2(aimScreen.x, aimScreen.y);
          this.raycaster.setFromCamera(aimNDC, this.camera);
          const heliHits = this.raycaster.intersectObject(vehicleEntity.mesh, true);
          const crosshairOverlapsHeli = heliHits.length > 0;

          // Collect ALL unique materials from every mesh in the helicopter tree
          const allMats = new Set<THREE.Material>();
          vehicleEntity.mesh.traverse((obj: THREE.Object3D) => {
            if (!(obj as THREE.Mesh).isMesh) return;
            const m = obj as THREE.Mesh;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) allMats.add(mat);
          });

          for (const mat of allMats) {
            // Skip the invisible hitbox material
            if (!mat.visible) continue;
            if (mat.userData.heliOrigOpacity === undefined) {
              mat.userData.heliOrigOpacity = mat.opacity;
              mat.userData.heliOrigTransparent = mat.transparent;
            }
            mat.transparent = true;
            mat.opacity = crosshairOverlapsHeli
              ? mat.userData.heliOrigOpacity * 0.15
              : mat.userData.heliOrigOpacity;
            mat.needsUpdate = true;
          }
        }

        // Move player position to vehicle for HUD/sync purposes
        this.position.set(vPos.x, vPos.y + 1.5, vPos.z);

        // Update HUD every frame to show live jeep HP
        this.updateHud();
        this.updateHitHealthBars(dt);
      } else {
        // Vehicle destroyed — force exit
        this.handleVehicleExited();
      }
      this.updateInteractPrompt();
      return;
    }

    // ---- Sniper nest: E key to climb/descend, platform standing ----
    const PLAT_H = 9.5;
    let onPlatform = false;
    let platformNestTerrainY = 0;
    const currentTerrainY = this.sceneManager.terrainHeight(this.position.x, this.position.z);
    const playerFeetY = this.position.y - PLAYER_HEIGHT;

    // Check all sniper nests for platform standing
    for (const ent of this.sceneManager.entities) {
      if (ent.entityType !== 'sniper_nest' || ent.hp <= 0) continue;
      const np = ent.mesh.position;
      const nty = this.sceneManager.terrainHeight(np.x, np.z);
      const dxP = this.position.x - np.x;
      const dzP = this.position.z - np.z;
      const feetAbove = playerFeetY - nty;
      if (Math.abs(dxP) < 1.8 && Math.abs(dzP) < 1.8 && feetAbove >= PLAT_H - 1 && feetAbove <= PLAT_H + 3) {
        onPlatform = true;
        platformNestTerrainY = nty;
        break;
      }
    }

    // Normal movement
    // In VR, movement direction comes from the camera rig yaw only (gamepad-controlled).
    // Head tracking does NOT affect movement direction.
    let effectiveYaw = this.yaw;
    if (this.vrMode && this.vrCameraRig) {
      effectiveYaw = this.vrCameraRig.rotation.y;
    }
    const input: InputState = {
      forward: this.keys.forward, backward: this.keys.backward,
      left: this.keys.left, right: this.keys.right,
      jump: this.keys.jump, yaw: effectiveYaw, pitch: this.pitch, dt,
    };

    // Use absolute feet position + groundY param (matches server approach)
    const groundY = onPlatform ? (platformNestTerrainY + PLAT_H) : currentTerrainY;
    const feetPos = { x: this.position.x, y: this.position.y - PLAYER_HEIGHT, z: this.position.z };
    const mc = this.sceneManager.mapConfig;
    const result = applyMovement(feetPos, this.velocity, input, dt, { halfW: mc.width / 2, halfD: mc.depth / 2 }, groundY);

    let newX = result.position.x;
    let newZ = result.position.z;

    for (const box of this.obstacleBoxes) {
      const overlapX = (PLAYER_RADIUS + box.halfSize.x) - Math.abs(newX - box.center.x);
      const overlapZ = (PLAYER_RADIUS + box.halfSize.z) - Math.abs(newZ - box.center.z);
      const overlapY = (PLAYER_HEIGHT + box.halfSize.y) - Math.abs(result.position.y + PLAYER_HEIGHT / 2 - box.center.y);

      if (overlapX > 0 && overlapZ > 0 && overlapY > 0) {
        if (overlapX < overlapZ) newX += newX > box.center.x ? overlapX : -overlapX;
        else newZ += newZ > box.center.z ? overlapZ : -overlapZ;
      }
    }

    // Snap to terrain at new position (handles walking uphill/downhill)
    const newTerrainY = this.sceneManager.terrainHeight(newX, newZ);
    const platformOffset = onPlatform ? PLAT_H : 0;
    let newFeetY = result.position.y;
    let vy = result.velocity.y;
    if (result.onGround || newFeetY < newTerrainY) {
      newFeetY = newTerrainY + platformOffset;
      if (vy < 0) vy = 0;
    }
    let newY = newFeetY + PLAYER_HEIGHT;
    this.velocity = { ...result.velocity, y: vy };
    this.onGround = result.onGround || newFeetY <= newTerrainY + platformOffset + 0.01;

    this.position.set(newX, newY, newZ);

    // Server owns player entity position via SnapshotRenderer
    if (this.playerEntity) {
      this.playerEntity.hp = this.hp;
      this.playerEntity.maxHp = this.maxHp;
    }

    if (this.vrMode && this.vrCameraRig) {
      // VR: position the camera rig at the player's eye level.
      // The XR headset adds its own offset on top, so we place the rig at game eye height.
      const groundY = this.sceneManager.terrainHeight(this.position.x, this.position.z);
      this.vrCameraRig.position.set(this.position.x, groundY + PLAYER_HEIGHT, this.position.z);
      // Don't touch camera rotation — headset controls it
    } else {
      this.camera.position.copy(this.position);
      const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    }

    // Send input to server (online mode) — use effectiveYaw so server moves in the same direction
    if (this.onInput) {
      this.onInput(
        { ...this.keys },
        effectiveYaw, this.pitch, dt,
      );
    }

    // Weapon viewmodel animation
    this.recoilAmount = Math.max(0, this.recoilAmount - dt * 8);
    if (this.currentModel) {
      const pos = this.weaponRestPos.clone();
      pos.z -= this.recoilAmount * 0.08;
      pos.y += this.recoilAmount * 0.02;
      this.currentModel.position.copy(pos);
    }

    // Muzzle flash fade
    if (this.muzzleFlash) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlash.visible = false;
      }
    }

    // Cooldown indicator
    const weapon = this.getActiveWeapon();
    const maxCooldown = 1 / weapon.fireRate;
    const currentCooldown = this.weaponCooldowns.get(weapon.id) ?? 0;
    const cooldownPct = Math.min(1, currentCooldown / maxCooldown);
    this.cooldownFill.style.width = (cooldownPct * 100) + '%';
    this.cooldownFill.style.display = cooldownPct > 0 ? 'block' : 'none';

    // Update weapon camera aspect
    this.weaponCamera.aspect = this.canvas.width / this.canvas.height;
    this.weaponCamera.updateProjectionMatrix();

    // Wave timer HUD
    const secs = Math.max(0, Math.ceil(this.waveTimer));
    this.waveTimerHud.textContent = `Next wave: ${secs}s`;
    this.waveTimerHud.style.display = this.isDead ? 'none' : 'block';

    // Update health bars for recently hit enemies
    this.updateHitHealthBars(dt);

    // Check armory proximity for interact prompt
    this.updateInteractPrompt();
  }

  /** Render the weapon viewmodel on top of the main scene (skipped in VR — weapon is in-scene) */
  renderWeaponView(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled || this.isDead || !this.currentModel || this.vrMode) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.weaponScene, this.weaponCamera);
    renderer.autoClear = true;
  }

  // ===================== Combat =====================

  takeDamage(amount: number): void {
    if (this.isDead) return;
    this.hp -= amount;
    this.updateHud();
    this.flashDamageVignette();
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
    if (this.playerEntity) this.playerEntity.hp = this.hp;
  }

  private flashDamageVignette(): void {
    this.damageFlashTimer = 0.3;
    this.damageVignette.style.opacity = '1';
  }

  private die(): void {
    this.isDead = true;
    this.respawnTimer = RESPAWN_TIME;
    this.resetScope();
    // Reset hero ability visual
    this.removeShieldVisual();
    this.restoreWeaponModel();
    this.respawnOverlay.style.display = 'flex';
    // Show killer name
    const killedByEl = this.respawnOverlay.querySelector('#killed-by') as HTMLDivElement;
    if (killedByEl) {
      killedByEl.textContent = this.killCamName ? `Killed by ${this.killCamName}` : '';
      killedByEl.style.display = this.killCamName ? 'block' : 'none';
    }
    // Show hero selection if HQ upgraded
    this.showHeroSelection();
    if (this.playerEntity) this.playerEntity.hp = 0;
    this.updateHud();
    SoundManager.instance().playerDeath();
  }

  private showHeroSelection(): void {
    // Remove old hero selection if present
    if (this.heroSelectionContainer) {
      this.heroSelectionContainer.remove();
      this.heroSelectionContainer = null;
    }
    if (!this.hasHeroAcademy) return;

    const container = document.createElement('div');
    container.style.cssText = `
      display:flex; gap:12px; margin-top:8px; pointer-events:auto;
    `;

    const heroes = [
      { type: 'tank', icon: '🛡', label: 'Tank', desc: 'Block frontal damage' },
      { type: 'healer', icon: '+', label: 'Healer', desc: 'Heal nearby allies' },
      { type: 'mechanic', icon: '🔧', label: 'Mechanic', desc: 'Repair nearby vehicles' },
    ];

    for (let i = 0; i < heroes.length; i++) {
      const hero = heroes[i];
      const btn = document.createElement('button');
      btn.style.cssText = `
        padding:10px 18px; background:rgba(255,255,255,0.08); border:2px solid #555;
        border-radius:8px; cursor:pointer; color:#ccc; font-family:system-ui,sans-serif;
        font-size:14px; text-align:center; transition:border-color 0.15s;
      `;
      btn.innerHTML = `
        <div style="font-size:24px;margin-bottom:4px;">${hero.icon}</div>
        <div style="font-weight:bold;margin-bottom:2px;">[${i + 1}] ${hero.label}</div>
        <div style="font-size:11px;color:#888;">${hero.desc}</div>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.heroType = hero.type;
        this.onServerMessage?.({ type: 'select_hero', heroType: hero.type });
        // Highlight selected
        container.querySelectorAll('button').forEach(b => {
          b.style.borderColor = '#555';
          b.style.background = 'rgba(255,255,255,0.08)';
        });
        btn.style.borderColor = '#0f0';
        btn.style.background = 'rgba(0,255,0,0.15)';
      });
      btn.addEventListener('mouseenter', () => { if (this.heroType !== hero.type) btn.style.borderColor = '#888'; });
      btn.addEventListener('mouseleave', () => { if (this.heroType !== hero.type) btn.style.borderColor = '#555'; });
      container.appendChild(btn);
    }

    this.heroSelectionContainer = container;
    this.respawnOverlay.appendChild(container);
  }

  private respawn(): void {
    this.isDead = false;
    this.hp = this.maxHp;
    this.respawnOverlay.style.display = 'none';
    SoundManager.instance().playerRespawn();
    const spawn = this.sceneManager.mapConfig.teamSpawns[this.localTeamId]!;
    this.position.set(spawn.x, this.sceneManager.terrainHeight(spawn.x, spawn.z) + PLAYER_HEIGHT, spawn.z);
    this.velocity = { x: 0, y: 0, z: 0 };
    if (this.playerEntity) this.playerEntity.hp = this.hp;
    // Reset to default weapon (pistol only)
    this.secondaryWeapon = null;
    this.activeSlot = 'primary';
    this.setWeaponModel(this.primaryWeapon);
    this.weaponCooldowns.clear();
    this.updateHud();
  }

  private tryShoot(): void {
    if (this.heroAbilityActive && this.heroType !== 'tank') return; // weapons disabled during non-tank hero ability
    if (this.heliGunOverheated && !this.cheatNoCooldown) return; // minigun overheated
    // Helicopter uses built-in minigun instead of equipped weapon
    const weapon = (this.inVehicle && this.vehicleType === 'helicopter')
      ? WEAPONS['heli_minigun']
      : this.getActiveWeapon();
    const currentCd = this.weaponCooldowns.get(weapon.id) ?? 0;
    if (currentCd > 0) return;

    if (!this.cheatNoCooldown) {
      let cooldown = 1 / weapon.fireRate;
      if (weapon.id === 'rocket_launcher' && this.rocketCooldownReduced) cooldown *= 0.5;
      this.weaponCooldowns.set(weapon.id, cooldown);
    }
    this.recoilAmount = 1;

    // Spin up the gatling barrels when firing from helicopter
    if (weapon.id === 'heli_minigun') {
      this.heliGunSpinSpeed = 60; // radians/sec
    }

    // Track shot for accuracy stats
    this.onServerMessage?.({ type: 'fps_shoot', weaponId: weapon.id, origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } });

    // Weapon-specific sound
    const sm = SoundManager.instance();
    if (weapon.id === 'heli_minigun') sm.shootPistol(); // rapid light sound
    else if (weapon.id === 'pistol') sm.shootPistol();
    else if (weapon.id === 'rifle') sm.shootRifle();
    else if (weapon.id === 'shotgun') sm.shootShotgun();
    else if (weapon.id === 'rocket_launcher') sm.shootShotgun(); // heavy boom

    // Rocket launcher: spawn a traveling projectile instead of hitscan
    if (weapon.id === 'rocket_launcher') {
      this.fireRocket();
      // Broadcast rocket to other players
      let rocketOrigin: THREE.Vector3;
      let rocketForward: THREE.Vector3;
      if (this.vrMode) {
        rocketOrigin = this.position.clone();
        rocketForward = this.getVRAimDirection();
      } else {
        rocketOrigin = this.position.clone();
        rocketForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      }
      this.onServerMessage?.({
        type: 'rocket_fired',
        origin: { x: rocketOrigin.x, y: rocketOrigin.y, z: rocketOrigin.z },
        direction: { x: rocketForward.x, y: rocketForward.y, z: rocketForward.z },
      } as any);
      return;
    }

    // Muzzle flash
    if (this.inVehicle && this.vehicleType === 'helicopter') {
      // Helicopter: turret muzzle flash is handled in the targeting update section
      this.muzzleFlashTimer = 0.04;
    } else if (this.muzzleFlash) {
      this.muzzleFlash.visible = true;
      this.muzzleFlashTimer = 0.06;
    }

    // In helicopter, shoot toward the red dot (crosshair aim point)
    let origin: THREE.Vector3;
    let forward: THREE.Vector3;
    if (this.inVehicle && this.vehicleType === 'helicopter' && this.vehicleId) {
      const vehicleEntity = this.sceneManager.entities.find(e => e.id === this.vehicleId);
      if (vehicleEntity) {
        const vPos = vehicleEntity.mesh.position;
        const heading = vehicleEntity.rotation.y;
        const sinH = Math.sin(heading);
        const cosH = Math.cos(heading);
        // Compute the world-space aim point (same math as the crosshair dot)
        const aimDist = 15;
        const centerX = vPos.x - sinH * aimDist;
        const centerZ = vPos.z - cosH * aimDist;
        const centerY = vPos.y + 1.0 + Math.sin(this.heliAimPitch) * aimDist;
        const aimWorldX = centerX + this.heliAimX * cosH - this.heliAimZ * sinH;
        const aimWorldZ = centerZ - this.heliAimX * sinH - this.heliAimZ * cosH;
        const aimPoint = new THREE.Vector3(aimWorldX, centerY, aimWorldZ);
        // Raycast from camera through the aim point (guarantees bullets hit where the dot is)
        origin = this.camera.position.clone();
        forward = aimPoint.sub(origin).normalize();
      } else {
        origin = this.camera.position.clone();
        forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      }
    } else if (this.vrMode) {
      // VR: use gamepad aim direction (rig yaw + aim pitch, not head tracking)
      origin = this.position.clone();
      forward = this.getVRAimDirection();
    } else {
      origin = this.position.clone();
      forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    }

    for (let i = 0; i < weapon.pellets; i++) {
      const dir = forward.clone();
      // Distance-dependent spread: base spread + spreadPerDist * estimated distance
      const estDist = weapon.range * 0.5; // estimate half range as typical engagement distance
      const totalSpread = weapon.spread + weapon.spreadPerDist * estDist;
      if (totalSpread > 0) {
        dir.x += (Math.random() - 0.5) * totalSpread;
        dir.y += (Math.random() - 0.5) * totalSpread;
        dir.z += (Math.random() - 0.5) * totalSpread;
        dir.normalize();
      }

      this.raycaster.set(origin, dir);
      this.raycaster.far = weapon.range;

      const targetMeshes: THREE.Object3D[] = [];
      const meshToEntity = new Map<THREE.Object3D, SceneEntity>();
      const obstacleMeshSet = new Set<THREE.Object3D>();

      // Add game entities as targets
      for (const ent of this.sceneManager.entities) {
        if (ent.id === this.playerEntity?.id) continue;
        if (this.inVehicle && ent.id === this.vehicleId) continue; // don't shoot own vehicle
        if (ent.entityType === 'resource_node') continue;
        if (ent.hp <= 0) continue;
        targetMeshes.push(ent.mesh);
        meshToEntity.set(ent.mesh, ent);
      }

      // Add obstacle meshes (trees, rocks, cover) as bullet blockers
      for (const obs of this.sceneManager.obstacleMeshes) {
        targetMeshes.push(obs);
        obstacleMeshSet.add(obs);
      }

      const intersects = this.raycaster.intersectObjects(targetMeshes, true);

      // Helicopter minigun miss: trace ray to ground plane and spawn debris there
      if (intersects.length === 0 && weapon.id === 'heli_minigun' && forward.y < -0.01) {
        // Ray-ground intersection: find t where origin.y + forward.y * t = terrainY
        // Iterate to converge on terrain height
        let t = -origin.y / forward.y; // initial estimate assuming flat ground at y=0
        for (let i = 0; i < 3; i++) {
          const gx = origin.x + forward.x * t;
          const gz = origin.z + forward.z * t;
          const terrainY = this.sceneManager.terrainHeight(gx, gz);
          t = (terrainY - origin.y) / forward.y;
          if (t < 0) break; // ray points away from ground
        }
        if (t > 0 && t < weapon.range) {
          const groundHit = origin.clone().add(forward.clone().multiplyScalar(t));
          groundHit.y = this.sceneManager.terrainHeight(groundHit.x, groundHit.z);
          this.spawnImpactDebris(groundHit, 'ground');
          this.onServerMessage?.({ type: 'heli_impact', x: groundHit.x, y: groundHit.y, z: groundHit.z, kind: 'ground' } as any);
        }
      }

      if (intersects.length > 0) {
        const hit = intersects[0];

        // Check if we hit an obstacle (bullet blocked, no damage)
        let hitObstacle = false;
        let checkObj: THREE.Object3D | null = hit.object;
        while (checkObj) {
          if (obstacleMeshSet.has(checkObj)) { hitObstacle = true; break; }
          checkObj = checkObj.parent;
        }
        if (hitObstacle) {
          this.showHitEffect(hit.point);
          SoundManager.instance().bulletImpact(hit.point.x, hit.point.z);
          if (weapon.id === 'heli_minigun') {
            this.spawnImpactDebris(hit.point, 'ground');
            this.onServerMessage?.({ type: 'heli_impact', x: hit.point.x, y: hit.point.y, z: hit.point.z, kind: 'ground' } as any);
          }
          break; // bullet stopped by obstacle
        }

        // Walk up to find the root entity mesh (intersect may hit a child)
        let hitObj = hit.object as THREE.Object3D;
        let hitEntity: SceneEntity | undefined;
        while (hitObj) {
          hitEntity = meshToEntity.get(hitObj);
          if (hitEntity) break;
          hitObj = hitObj.parent!;
        }
        if (hitEntity) {
          // Standard guns do 1 damage to buildings (rocket launcher is handled separately)
          const BUILDING_TYPES = new Set(['main_base', 'tower', 'barracks', 'armory', 'player_tower', 'turret', 'farm', 'sniper_nest', 'garage', 'hero_academy']);
          const isBuilding = BUILDING_TYPES.has(hitEntity.entityType);
          const actualDamage = isBuilding ? 1 : weapon.damage;
          hitEntity.hp -= actualDamage;
          if (hitEntity.entityType === 'main_base' && hitEntity.hp < 1 && hitEntity.teamId === this.localTeamId) {
            hitEntity.hp = 1;
          }
          if (hitEntity.hp < 0) hitEntity.hp = 0;

          this.hitMarkerTimer = 0.3;
          this.hitMarker.style.opacity = '1';
          this.showHitEffect(hit.point);
          SoundManager.instance().bulletImpact(hit.point.x, hit.point.z);

          // Visual feedback: different colors for enemy vs friendly fire
          const isFriendly = hitEntity.teamId === this.localTeamId;
          if (isFriendly) {
            // Friendly fire — blue flash warning
            this.hitMarker.style.filter = 'hue-rotate(180deg)';
            this.showScreenFlash('rgba(0, 100, 255, 0.15)');
          } else {
            // Enemy hit — just show hit marker, no screen flash
            this.hitMarker.style.filter = 'none';
          }

          // Knockback + blood for non-building targets
          if (!isBuilding) {
            this.applyKnockbackAndBlood(hitEntity.mesh, hit.point, dir, actualDamage);
          }

          // Helicopter minigun: spawn debris and broadcast to all players
          if (weapon.id === 'heli_minigun') {
            const kind = isBuilding ? 'building' : 'blood';
            this.spawnImpactDebris(hit.point, kind);
            this.onServerMessage?.({ type: 'heli_impact', x: hit.point.x, y: hit.point.y, z: hit.point.z, kind } as any);
          }

          // Notify server in online mode
          this.onHit?.(hitEntity.id, actualDamage);

          // Show/refresh health bar above hit entity
          if (!isBuilding) {
            this.showHitHealthBar(hitEntity);
          }
        }
        break;
      }
    }
  }

  private showHitHealthBar(entity: SceneEntity): void {
    const scene = this.sceneManager.scene;
    let bar = this.hitHealthBars.get(entity.id);

    if (!bar) {
      const bgGeo = new THREE.PlaneGeometry(1.5, 0.2);
      const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide, depthTest: false, transparent: true });
      const bg = new THREE.Mesh(bgGeo, bgMat);
      bg.renderOrder = 999;
      scene.add(bg);

      const fillGeo = new THREE.PlaneGeometry(1.5, 0.2);
      const fillMat = new THREE.MeshBasicMaterial({ color: 0xcc4444, side: THREE.DoubleSide, depthTest: false, transparent: true });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.renderOrder = 999;
      scene.add(fill);

      bar = { bg, fill, timer: 3 };
      this.hitHealthBars.set(entity.id, bar);
    }

    // Refresh timer
    bar.timer = 3;

    // Update fill
    const pct = Math.max(0, entity.hp / entity.maxHp);
    bar.fill.scale.set(pct || 0.001, 1, 1);
    const fillMat = bar.fill.material as THREE.MeshBasicMaterial;
    fillMat.color.setHex(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xcccc44 : 0xcc4444);
  }

  /** Update hit health bars: position, face camera, countdown timers */
  private updateHitHealthBars(dt: number): void {
    const scene = this.sceneManager.scene;
    for (const [id, bar] of this.hitHealthBars) {
      bar.timer -= dt;
      if (bar.timer <= 0) {
        scene.remove(bar.bg);
        scene.remove(bar.fill);
        bar.bg.geometry.dispose();
        bar.fill.geometry.dispose();
        this.hitHealthBars.delete(id);
        continue;
      }

      const entity = this.sceneManager.entities.find(e => e.id === id);
      if (!entity || entity.hp <= 0) {
        scene.remove(bar.bg);
        scene.remove(bar.fill);
        bar.bg.geometry.dispose();
        bar.fill.geometry.dispose();
        this.hitHealthBars.delete(id);
        continue;
      }

      // Position above entity head
      const pos = entity.mesh.position;
      const yOffset = 3;
      bar.bg.position.set(pos.x, pos.y + yOffset, pos.z);
      const pct = Math.max(0, entity.hp / entity.maxHp);
      const fillWidth = 1.5 * pct;
      bar.fill.scale.set(pct || 0.001, 1, 1);
      bar.fill.position.set(pos.x - (1.5 - fillWidth) / 2, pos.y + yOffset, pos.z);

      // Billboard: face camera
      bar.bg.lookAt(this.camera.position);
      bar.fill.lookAt(this.camera.position);

      // Update color
      const fillMat = bar.fill.material as THREE.MeshBasicMaterial;
      fillMat.color.setHex(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xcccc44 : 0xcc4444);

      // Fade out in last 0.5s
      const opacity = bar.timer < 0.5 ? bar.timer / 0.5 : 1;
      (bar.bg.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
      fillMat.opacity = opacity;
    }
  }

  private showScreenFlash(color: string): void {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:fixed;inset:0;pointer-events:none;z-index:10;
      background:${color};transition:opacity 0.3s;
    `;
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '0'; });
    setTimeout(() => flash.remove(), 400);
  }

  private showHitEffect(point: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.15, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(point);
    this.sceneManager.scene.add(sphere);
    setTimeout(() => {
      this.sceneManager.scene.remove(sphere);
      geo.dispose();
      mat.dispose();
    }, 100);
  }

  private applyKnockbackAndBlood(targetMesh: THREE.Mesh, hitPoint: THREE.Vector3, shotDir: THREE.Vector3, damage: number): void {
    const scene = this.sceneManager.scene;

    // Knockback — push mesh in shot direction (scaled by damage)
    const knockbackDist = Math.min(0.5, damage * 0.03);
    const kx = shotDir.x * knockbackDist;
    const kz = shotDir.z * knockbackDist;
    const origX = targetMesh.position.x;
    const origZ = targetMesh.position.z;
    targetMesh.position.x += kx;
    targetMesh.position.z += kz;
    // Spring back over 200ms
    const startTime = performance.now();
    const springBack = () => {
      const t = Math.min(1, (performance.now() - startTime) / 200);
      targetMesh.position.x = origX + kx * (1 - t);
      targetMesh.position.z = origZ + kz * (1 - t);
      if (t < 1) requestAnimationFrame(springBack);
    };
    requestAnimationFrame(springBack);

    // Blood particles
    const BLOOD_GEO = new THREE.SphereGeometry(0.06, 4, 4);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xcc0000 });
      const p = new THREE.Mesh(BLOOD_GEO, mat);
      p.position.copy(hitPoint);
      scene.add(p);
      const vel = {
        x: (Math.random() - 0.5) * 3 + shotDir.x * 2,
        y: 1 + Math.random() * 2,
        z: (Math.random() - 0.5) * 3 + shotDir.z * 2,
      };
      let elapsed = 0;
      const anim = () => {
        elapsed += 0.016;
        vel.y -= 12 * 0.016;
        p.position.x += vel.x * 0.016;
        p.position.y += vel.y * 0.016;
        p.position.z += vel.z * 0.016;
        const scale = Math.max(0, 1 - elapsed * 2);
        p.scale.setScalar(scale);
        if (elapsed > 0.5 || scale <= 0) {
          scene.remove(p);
          mat.dispose();
          return;
        }
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
  }

  /** Spawn debris particles at an impact point. type: 'ground'|'building'|'blood' */
  spawnImpactDebris(point: THREE.Vector3, type: 'ground' | 'building' | 'blood'): void {
    const scene = this.sceneManager.scene;
    const count = type === 'blood' ? 6 : 8;
    const color = type === 'ground' ? 0x886644 : type === 'building' ? 0x999999 : 0xcc0000;
    const geo = type === 'blood'
      ? new THREE.SphereGeometry(0.06, 4, 4)
      : new THREE.BoxGeometry(0.12, 0.12, 0.12);

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: type === 'ground'
          ? (0x664422 + Math.floor(Math.random() * 0x222222))
          : color,
      });
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(point);
      p.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      scene.add(p);

      // Debris flies HIGH — velocity scaled for dramatic effect
      const spread = type === 'blood' ? 2 : 3;
      const upForce = type === 'blood' ? 6 : 10 + Math.random() * 8;
      const vel = {
        x: (Math.random() - 0.5) * spread,
        y: upForce,
        z: (Math.random() - 0.5) * spread,
      };
      let elapsed = 0;
      const lifetime = 1.2 + Math.random() * 0.5;
      const anim = () => {
        const dt = 0.016;
        elapsed += dt;
        vel.y -= 18 * dt; // strong gravity
        p.position.x += vel.x * dt;
        p.position.y += vel.y * dt;
        p.position.z += vel.z * dt;
        p.rotation.x += 5 * dt;
        p.rotation.y += 3 * dt;
        // Fade out near end of life
        const fade = elapsed > lifetime * 0.7 ? 1 - (elapsed - lifetime * 0.7) / (lifetime * 0.3) : 1;
        p.scale.setScalar(Math.max(0, fade));
        // Stop at ground
        const groundY = this.sceneManager.terrainHeight(p.position.x, p.position.z);
        if (p.position.y < groundY) {
          p.position.y = groundY;
          vel.y = -vel.y * 0.3; // bounce
          vel.x *= 0.5;
          vel.z *= 0.5;
        }
        if (elapsed > lifetime) {
          scene.remove(p);
          mat.dispose();
          return;
        }
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
  }

  // ===================== Rocket Projectile =====================

  private fireRocket(): void {
    const origin = this.position.clone();
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.camera.quaternion);

    const scene = this.sceneManager.scene;

    // Create rocket mesh
    const rocketGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x556633 }),
    );
    body.rotation.x = Math.PI / 2;
    rocketGroup.add(body);

    // Flame trail
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.3, 5),
      new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 }),
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.z = -0.3;
    rocketGroup.add(flame);

    rocketGroup.position.copy(origin);
    rocketGroup.lookAt(origin.clone().add(forward));
    scene.add(rocketGroup);

    const ROCKET_SPEED = 20;
    const MAX_DIST = 75; // 50% of map length
    let traveled = 0;

    const animate = () => {
      const step = ROCKET_SPEED * 0.016;
      rocketGroup.position.add(forward.clone().multiplyScalar(step));
      traveled += step;

      // Flicker flame
      (flame.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.random() * 0.5;

      // Check collision with obstacle boxes (buildings, trees, rocks)
      let hitObstacle = false;
      const rp = rocketGroup.position;
      for (const box of this.obstacleBoxes) {
        if (Math.abs(rp.x - box.center.x) < box.halfSize.x + 0.3 &&
            Math.abs(rp.y - box.center.y) < box.halfSize.y + 0.3 &&
            Math.abs(rp.z - box.center.z) < box.halfSize.z + 0.3) {
          hitObstacle = true;
          break;
        }
      }
      if (hitObstacle) {
        this.applyRocketSplash(rocketGroup.position);
        this.spawnRocketExplosion(rocketGroup.position);
        scene.remove(rocketGroup);
        return;
      }

      // Check collision with ground (terrain)
      const terrainY = this.sceneManager.terrainHeight(rp.x, rp.z);
      if (rp.y <= terrainY + 0.2) {
        this.applyRocketSplash(rocketGroup.position);
        this.spawnRocketExplosion(rocketGroup.position);
        scene.remove(rocketGroup);
        return;
      }

      // Check collision with entities (cylindrical hitbox: XZ radius + height)
      let directHit = false;
      for (const ent of this.sceneManager.entities) {
        if (ent.id === this.playerEntity?.id) continue;
        if (ent.entityType === 'resource_node') continue;
        if (ent.hp <= 0) continue;
        const dx = ent.mesh.position.x - rp.x;
        const dz = ent.mesh.position.z - rp.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        // Hitbox height based on entity type
        const isMobile = ['worker', 'fighter', 'fps_player', 'foot_soldier', 'archer'].includes(ent.entityType);
        const hitHeight = isMobile ? 1.8 : 5; // units are ~1.5 tall, buildings are taller
        const hitRadius = isMobile ? 0.8 : 1.5;
        const entityBaseY = ent.mesh.position.y;
        const entityTopY = entityBaseY + hitHeight;
        if (distXZ < hitRadius && rp.y >= entityBaseY && rp.y <= entityTopY) {
          directHit = true;
          break;
        }
      }
      if (directHit) {
        this.applyRocketSplash(rocketGroup.position);
        this.spawnRocketExplosion(rocketGroup.position);
        scene.remove(rocketGroup);
        return;
      }

      if (traveled > MAX_DIST) {
        // Explode at max range
        this.applyRocketSplash(rocketGroup.position);
        this.spawnRocketExplosion(rocketGroup.position);
        scene.remove(rocketGroup);
        return;
      }

      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Spawn a visual-only rocket from another player (no damage, just the projectile + explosion) */
  spawnRemoteRocket(origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, shooterId?: string): void {
    const scene = this.sceneManager.scene;
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();

    const rocketGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x556633 }),
    );
    body.rotation.x = Math.PI / 2;
    rocketGroup.add(body);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.3, 5),
      new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 }),
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.z = -0.3;
    rocketGroup.add(flame);

    rocketGroup.position.set(origin.x, origin.y, origin.z);
    rocketGroup.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
    scene.add(rocketGroup);

    const ROCKET_SPEED = 20;
    const MAX_DIST = 75;
    let traveled = 0;

    const animate = () => {
      const step = ROCKET_SPEED * 0.016;
      rocketGroup.position.add(dir.clone().multiplyScalar(step));
      traveled += step;
      (flame.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.random() * 0.5;

      // Hit terrain
      const rp = rocketGroup.position;
      const terrainY = this.sceneManager.terrainHeight(rp.x, rp.z);
      if (rp.y <= terrainY + 0.2 || traveled > MAX_DIST) {
        this.spawnRocketExplosion(rocketGroup.position);
        scene.remove(rocketGroup);
        return;
      }

      // Hit obstacle
      for (const box of this.obstacleBoxes) {
        if (Math.abs(rp.x - box.center.x) < box.halfSize.x + 0.3 &&
            Math.abs(rp.y - box.center.y) < box.halfSize.y + 0.3 &&
            Math.abs(rp.z - box.center.z) < box.halfSize.z + 0.3) {
          this.spawnRocketExplosion(rocketGroup.position);
          scene.remove(rocketGroup);
          return;
        }
      }

      // Hit entity (skip the shooter)
      for (const ent of this.sceneManager.entities) {
        if (ent.hp <= 0) continue;
        if (ent.id === shooterId) continue;
        const dx = ent.mesh.position.x - rp.x;
        const dz = ent.mesh.position.z - rp.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        const isMobile = ['worker', 'fighter', 'fps_player', 'foot_soldier', 'archer'].includes(ent.entityType);
        const hitRadius = isMobile ? 0.8 : 1.5;
        const hitHeight = isMobile ? 1.8 : 5;
        if (distXZ < hitRadius && rp.y >= ent.mesh.position.y && rp.y <= ent.mesh.position.y + hitHeight) {
          this.spawnRocketExplosion(rocketGroup.position);
          scene.remove(rocketGroup);
          return;
        }
      }

      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Apply splash damage to all entities within blast radius */
  private applyRocketSplash(center: THREE.Vector3): void {
    const SPLASH_RADIUS = 10;
    const MAX_DAMAGE = 80;
    const scene = this.sceneManager.scene;

    for (const ent of this.sceneManager.entities) {
      if (ent.id === this.playerEntity?.id) continue;
      if (ent.entityType === 'resource_node') continue;
      if (ent.hp <= 0) continue;

      const dx = ent.mesh.position.x - center.x;
      const dy = (ent.mesh.position.y + 1) - center.y; // entity center ~1 unit above base
      const dz = ent.mesh.position.z - center.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > SPLASH_RADIUS) continue;

      // Damage falls off with distance
      const falloff = 1 - dist / SPLASH_RADIUS;
      const damage = Math.round(MAX_DAMAGE * falloff);
      if (damage <= 0) continue;

      const wasAlive = ent.hp > 0;
      ent.hp -= damage;
      if (ent.hp < 0) ent.hp = 0;
      this.onHit?.(ent.id, damage);

      // Ragdoll killed units — launch into air, spin, land, then fade
      const MOBILE = new Set(['worker', 'fighter', 'foot_soldier', 'fps_player']);
      if (wasAlive && ent.hp <= 0 && MOBILE.has(ent.entityType)) {
        const MAX_HEIGHT = PLAYER_HEIGHT * 10; // max 10x player height (~15 units)
        const launchPower = falloff * 0.8 + 0.3; // 0.3–1.1 normalized
        const dirX = dist > 0.1 ? dx / dist : (Math.random() - 0.5) * 2;
        const dirZ = dist > 0.1 ? dz / dist : (Math.random() - 0.5) * 2;
        const mesh = ent.mesh;
        // Calculate vy to reach desired peak: peak = vy²/(2g), so vy = sqrt(2g * peak)
        const peakHeight = MAX_HEIGHT * launchPower;
        const G = 20;
        const vy = Math.sqrt(2 * G * peakHeight);
        const horizSpeed = 4 + 6 * launchPower;
        const vx = dirX * horizSpeed * (0.8 + Math.random() * 0.4);
        const vz = dirZ * horizSpeed * (0.8 + Math.random() * 0.4);
        const startX = mesh.position.x;
        const startY = mesh.position.y;
        const startZ = mesh.position.z;
        const spinX = (Math.random() - 0.5) * 8;
        const spinY = (Math.random() - 0.5) * 6;
        const spinZ = (Math.random() - 0.5) * 8;
        let t = 0;
        let landed = false;

        const ragdoll = () => {
          t += 0.016;
          mesh.position.x = startX + vx * t;
          mesh.position.y = Math.max(0, startY + vy * t - 0.5 * G * t * t);
          mesh.position.z = startZ + vz * t;
          mesh.rotation.x += spinX * 0.016;
          mesh.rotation.y += spinY * 0.016;
          mesh.rotation.z += spinZ * 0.016;

          // Landed: past the peak and back on ground
          if (t > 0.2 && mesh.position.y <= 0) {
            mesh.position.y = 0;
            landed = true;
            // Settle to lying flat on Z axis
            let settleT = 0;
            const targetRotZ = Math.PI / 2;
            const settle = () => {
              settleT += 0.016;
              const blend = Math.min(1, settleT / 0.3);
              mesh.rotation.z += (targetRotZ - mesh.rotation.z) * blend * 0.15;
              mesh.rotation.x *= 1 - blend * 0.15;
              mesh.rotation.y *= 1 - blend * 0.1;
              if (settleT < 0.4) {
                requestAnimationFrame(settle);
              } else {
                // Now lying flat — start fade out
                mesh.rotation.z = targetRotZ;
                mesh.rotation.x = 0;
                let fadeT = 0;
                const fadeOut = () => {
                  fadeT += 0.016;
                  const opacity = Math.max(0, 1 - fadeT / 2);
                  mesh.traverse((child) => {
                    if ((child as THREE.Mesh).isMesh) {
                      const m = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
                      if (m && 'opacity' in m) { m.transparent = true; m.opacity = opacity; }
                    }
                  });
                  if (fadeT < 2) {
                    requestAnimationFrame(fadeOut);
                  } else {
                    this.sceneManager.scene.remove(mesh);
                  }
                };
                requestAnimationFrame(fadeOut);
              }
            };
            requestAnimationFrame(settle);
            return;
          }
          if (t < 6) requestAnimationFrame(ragdoll);
        };
        requestAnimationFrame(ragdoll);
      }
    }
  }

  private spawnRocketExplosion(pos: THREE.Vector3): void {
    const scene = this.sceneManager.scene;
    SoundManager.instance().playerDeath(); // big boom sound

    // Flash sphere
    const blast = new THREE.Mesh(
      new THREE.SphereGeometry(2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.8 }),
    );
    blast.position.copy(pos);
    scene.add(blast);

    // Debris
    const particles: THREE.Mesh[] = [];
    for (let i = 0; i < 12; i++) {
      const size = 0.2 + Math.random() * 0.3;
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color: Math.random() < 0.5 ? 0x887755 : 0xff6633 }),
      );
      p.position.copy(pos);
      p.userData.vel = {
        x: (Math.random() - 0.5) * 12,
        y: 3 + Math.random() * 6,
        z: (Math.random() - 0.5) * 12,
      };
      scene.add(p);
      particles.push(p);
    }

    let elapsed = 0;
    const animExplosion = () => {
      elapsed += 0.016;
      // Expand and fade blast
      const s = 1 + elapsed * 5;
      blast.scale.set(s, s, s);
      (blast.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - elapsed * 2);

      for (const p of particles) {
        const v = p.userData.vel;
        v.y -= 12 * 0.016;
        p.position.x += v.x * 0.016;
        p.position.y += v.y * 0.016;
        p.position.z += v.z * 0.016;
        p.rotation.x += 4 * 0.016;
      }

      if (elapsed > 0.8) {
        scene.remove(blast);
        blast.geometry.dispose();
        for (const p of particles) {
          scene.remove(p);
          p.geometry.dispose();
        }
        return;
      }
      requestAnimationFrame(animExplosion);
    };
    requestAnimationFrame(animExplosion);
  }

  // ===================== Weapon Model =====================

  private toggleScope(): void {
    const weapon = this.getActiveWeapon();
    if (weapon.id !== 'sniper_rifle') return; // only sniper has scope

    this.scopeLevel = (this.scopeLevel + 1) % 3; // cycle: 0 → 1 → 2 → 0

    if (this.scopeLevel === 0) {
      // No scope
      this.camera.fov = this.defaultFOV;
      this.camera.updateProjectionMatrix();
      if (this.scopeOverlay) this.scopeOverlay.style.display = 'none';
      if (this.currentModel) this.currentModel.visible = true;
    } else {
      const zoom = this.scopeLevel === 1 ? 2 : 5;
      this.camera.fov = this.defaultFOV / zoom;
      this.camera.updateProjectionMatrix();
      if (this.scopeOverlay) {
        this.scopeOverlay.style.display = 'block';
        const label = this.scopeOverlay.querySelector('#scope-zoom-label');
        if (label) label.textContent = `${zoom}x`;
      }
      // Hide weapon viewmodel when scoped
      if (this.currentModel) this.currentModel.visible = false;
    }
  }

  /** Reset scope when switching weapons or dying */
  private resetScope(): void {
    this.scopeLevel = 0;
    this.camera.fov = this.defaultFOV;
    this.camera.updateProjectionMatrix();
    if (this.scopeOverlay) this.scopeOverlay.style.display = 'none';
    if (this.currentModel) this.currentModel.visible = true;
  }

  private setWeaponModel(weapon: WeaponDef): void {
    if (this.currentModel) {
      this.weaponScene.remove(this.currentModel);
    }
    this.currentModel = createWeaponModel(weapon);
    this.currentModel.position.copy(this.weaponRestPos);
    this.weaponScene.add(this.currentModel);

    // Add muzzle flash to the weapon model (at barrel tip)
    if (this.muzzleFlash) {
      this.currentModel.remove(this.muzzleFlash);
    }
    const flashGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff44 });
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    // Position at the end of the barrel (negative Z is forward in weapon space)
    const barrelLen = weapon.id === 'rifle' ? -0.25 : weapon.id === 'shotgun' ? -0.2 : -0.1;
    this.muzzleFlash.position.set(0, 0, barrelLen);
    this.muzzleFlash.visible = false;
    this.currentModel.add(this.muzzleFlash);
  }

  // ===================== Armory Interaction =====================

  private findNearbyArmory(): SceneEntity | null {
    for (const ent of this.sceneManager.entities) {
      if (ent.entityType !== 'armory' || ent.teamId !== this.localTeamId || ent.status !== 'active') continue;
      const dx = this.position.x - ent.mesh.position.x;
      const dz = this.position.z - ent.mesh.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < ARMORY_INTERACT_RANGE) return ent;
    }
    return null;
  }

  private findNearbySniperNest(): SceneEntity | null {
    for (const ent of this.sceneManager.entities) {
      if (ent.entityType !== 'sniper_nest' || ent.hp <= 0) continue;
      const dx = this.position.x - ent.mesh.position.x;
      const dz = this.position.z - ent.mesh.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < 4) return ent;
    }
    return null;
  }

  private isOnSniperNestPlatform(): SceneEntity | null {
    const playerFeetY = this.position.y - PLAYER_HEIGHT;
    for (const ent of this.sceneManager.entities) {
      if (ent.entityType !== 'sniper_nest' || ent.hp <= 0) continue;
      const np = ent.mesh.position;
      const nty = this.sceneManager.terrainHeight(np.x, np.z);
      const dx = this.position.x - np.x;
      const dz = this.position.z - np.z;
      const feetAbove = playerFeetY - nty;
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2 && feetAbove >= 8 && feetAbove <= 12) return ent;
    }
    return null;
  }

  // ===================== Vehicle Interaction =====================

  private findNearbyVehicle(): { id: string; mesh: THREE.Mesh; position: THREE.Vector3; seat: 'driver' | 'gunner'; vehicleType: 'jeep' | 'helicopter' } | null {
    for (const entity of this.sceneManager.entities) {
      if (entity.entityType !== 'jeep' && entity.entityType !== 'helicopter') continue;
      if (entity.hp <= 0) continue;
      if (entity.teamId !== this.localTeamId) continue;
      const dx = entity.mesh.position.x - this.position.x;
      const dz = entity.mesh.position.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 5) continue;

      if (entity.entityType === 'helicopter') {
        // Helicopter: driver-only
        return { id: entity.id, mesh: entity.mesh, position: entity.mesh.position, seat: 'driver', vehicleType: 'helicopter' };
      }

      // Jeep: determine seat based on proximity to front/rear
      const heading = entity.rotation.y;
      const frontX = entity.mesh.position.x - Math.sin(heading) * 2;
      const frontZ = entity.mesh.position.z - Math.cos(heading) * 2;
      const rearX = entity.mesh.position.x + Math.sin(heading) * 2;
      const rearZ = entity.mesh.position.z + Math.cos(heading) * 2;
      const distFront = Math.sqrt((this.position.x - frontX) ** 2 + (this.position.z - frontZ) ** 2);
      const distRear = Math.sqrt((this.position.x - rearX) ** 2 + (this.position.z - rearZ) ** 2);
      const seat = distFront <= distRear ? 'driver' : 'gunner';
      return { id: entity.id, mesh: entity.mesh, position: entity.mesh.position, seat, vehicleType: 'jeep' };
    }
    return null;
  }

  private tryEnterVehicle(): boolean {
    const vehicle = this.findNearbyVehicle();
    if (!vehicle) return false;
    this.onServerMessage?.({ type: 'enter_vehicle', vehicleId: vehicle.id, seat: vehicle.seat });
    return true;
  }

  private exitVehicle(): void {
    this.onServerMessage?.({ type: 'exit_vehicle' });
  }

  /** Called when server confirms vehicle entry */
  handleVehicleEntered(vehicleId: string, seat: 'driver' | 'gunner'): void {
    this.inVehicle = true;
    this.vehicleId = vehicleId;
    this.vehicleSeat = seat;
    // Determine vehicle type from scene entity
    const vehicleEntity = this.sceneManager.entities.find(e => e.id === vehicleId);
    this.vehicleType = (vehicleEntity?.entityType === 'helicopter') ? 'helicopter' : 'jeep';
    // Set camera yaw to match vehicle heading so camera starts behind the vehicle
    if (vehicleEntity) {
      this.yaw = vehicleEntity.rotation.y;
      this.pitch = 0;
    }
    // Hide weapon viewmodel
    if (this.currentModel) this.currentModel.visible = false;
    // Hide crosshair for jeep driver (no gun), keep it for helicopter pilot and jeep gunner
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
      crosshair.style.display = (this.vehicleType === 'jeep' && seat === 'driver') ? 'none' : 'block';
    }
  }

  /** Called when server confirms vehicle exit */
  handleVehicleExited(): void {
    this.inVehicle = false;
    this.vehicleId = null;
    this.vehicleSeat = null;
    this.vehicleType = null;
    // Restore weapon viewmodel
    if (this.currentModel) this.currentModel.visible = true;
    // Restore crosshair to center
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
      crosshair.style.display = 'block';
      crosshair.style.left = '50%';
      crosshair.style.top = '50%';
    }
    // Clean up helicopter targeting
    this.heliAimX = 0;
    this.heliAimZ = 0;
    this.heliAimPitch = 0;
    this.heliGunSpinSpeed = 0;
    if (this.heliTargetRing) {
      this.heliTargetRing.remove();
      this.heliTargetRing = null;
    }
    if (this.heliCrosshair) {
      this.heliCrosshair.remove();
      this.heliCrosshair = null;
    }
    if (this.heliHeatBar) {
      this.heliHeatBar.remove();
      this.heliHeatBar = null;
    }
    this.heliGunHeat = 0;
    this.heliGunOverheated = false;
    // Restore helicopter mesh opacity
    if (this.vehicleId) {
      const veh = this.sceneManager.entities.find(e => e.id === this.vehicleId);
      if (veh) {
        const restoreMats = new Set<THREE.Material>();
        veh.mesh.traverse((obj: THREE.Object3D) => {
          if (!(obj as THREE.Mesh).isMesh) return;
          const m = obj as THREE.Mesh;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) restoreMats.add(mat);
        });
        for (const mat of restoreMats) {
          if (mat.userData.heliOrigOpacity !== undefined) {
            mat.opacity = mat.userData.heliOrigOpacity;
            mat.transparent = mat.userData.heliOrigTransparent ?? false;
            mat.needsUpdate = true;
            delete mat.userData.heliOrigOpacity;
            delete mat.userData.heliOrigTransparent;
          }
        }
      }
    }
    // Restore first-person FOV
    this.camera.fov = this.defaultFOV;
    this.camera.updateProjectionMatrix();
  }

  private updateInteractPrompt(): void {
    if (this.inVehicle) {
      this.interactPrompt.style.display = 'block';
      if (this.vehicleType === 'helicopter') {
        this.interactPrompt.textContent = 'Press E to exit | Space=Up Shift=Down';
      } else {
        this.interactPrompt.textContent = this.vehicleSeat === 'driver'
          ? 'Press E to exit vehicle | F to honk'
          : 'Press E to exit vehicle';
      }
      return;
    }
    const nearVehicle = this.findNearbyVehicle();
    if (nearVehicle) {
      this.interactPrompt.style.display = 'block';
      const label = nearVehicle.vehicleType === 'helicopter' ? 'Helicopter' : 'Jeep';
      this.interactPrompt.textContent = `Press E to enter ${label} (${nearVehicle.seat})`;
      return;
    }
    const onNestPlatform = this.isOnSniperNestPlatform();
    if (onNestPlatform) {
      this.interactPrompt.style.display = 'block';
      this.interactPrompt.textContent = 'Press E to climb down';
    } else if (this.findNearbySniperNest()) {
      this.interactPrompt.style.display = 'block';
      this.interactPrompt.textContent = 'Press E to climb Sniper Nest';
    } else if (this.armoryUnlocked && this.findNearbyArmory()) {
      this.interactPrompt.style.display = 'block';
      this.interactPrompt.textContent = 'Press E to access Armory';
    } else {
      this.interactPrompt.style.display = 'none';
    }
  }

  private tryInteractArmory(): void {
    // Sniper nest: climb up or down
    const onPlatform = this.isOnSniperNestPlatform();
    if (onPlatform) {
      // Climb down — teleport to ground near the ladder
      const np = onPlatform.mesh.position;
      const nty = this.sceneManager.terrainHeight(np.x, np.z);
      this.position.set(np.x, nty + PLAYER_HEIGHT, np.z + 2.5);
      this.velocity = { x: 0, y: 0, z: 0 };
      this.keys.forward = this.keys.backward = this.keys.left = this.keys.right = this.keys.jump = false;
      this.nestTeleportCooldown = 2.0;
      this.onServerMessage?.({ type: 'climb_nest', action: 'down', nestId: onPlatform.id });
      return;
    }
    const nearNest = this.findNearbySniperNest();
    if (nearNest) {
      // Climb up — teleport to platform center with zero momentum
      const np = nearNest.mesh.position;
      const nty = this.sceneManager.terrainHeight(np.x, np.z);
      this.position.set(np.x, nty + 9.5 + PLAYER_HEIGHT, np.z);
      this.velocity = { x: 0, y: 0, z: 0 };
      this.keys.forward = this.keys.backward = this.keys.left = this.keys.right = this.keys.jump = false;
      this.nestTeleportCooldown = 2.0;
      // Tell server to teleport us too
      this.onServerMessage?.({ type: 'climb_nest', action: 'up', nestId: nearNest.id });
      return;
    }

    if (!this.armoryUnlocked) return;
    if (!this.findNearbyArmory()) return;
    this.showArmoryMenu();
  }

  private showArmoryMenu(): void {
    this.armoryMenuVisible = true;
    this.armoryMenu.style.display = 'flex';

    // Rebuild weapon buttons — always show all, grey out locked ones
    const btnRow = this.armoryMenu.querySelector('#armory-btn-row');
    if (btnRow) {
      btnRow.innerHTML = '';
      const allWeaponIds = ['rifle', 'shotgun', 'rocket_launcher', 'sniper_rifle'];
      for (const wid of allWeaponIds) {
        const w = WEAPONS[wid];
        const locked = (wid === 'rocket_launcher' || wid === 'sniper_rifle') && !this.armoryLevel2;
        const cooldownText = w.fireRate < 1 ? `Cooldown: ${Math.round(1 / w.fireRate)}s` : `Rate: ${w.fireRate}/s`;
        const btn = document.createElement('button');
        btn.innerHTML = `
          <div style="font-size:18px;font-weight:bold;margin-bottom:6px;">${w.name}</div>
          <div style="font-size:12px;color:#aaa;">DMG: ${w.damage}${w.pellets > 1 ? ` x${w.pellets}` : ''}</div>
          <div style="font-size:12px;color:#aaa;">${cooldownText}</div>
          <div style="font-size:12px;color:#aaa;">Range: ${w.range}</div>
          ${locked ? '<div style="font-size:11px;color:#f44;margin-top:4px;">Requires Armory Lv.2</div>' : ''}
        `;
        btn.style.cssText = `
          padding: 16px 24px; min-width: 140px;
          background: rgba(255,255,255,0.08); color: #fff;
          border: 2px solid ${locked ? '#333' : '#555'}; border-radius: 8px;
          cursor: ${locked ? 'not-allowed' : 'pointer'}; font-family: system-ui, sans-serif;
          opacity: ${locked ? '0.4' : '1'};
        `;
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('mouseup', (e) => e.stopPropagation());
        if (!locked) {
          btn.addEventListener('click', (e) => { e.stopPropagation(); this.selectSecondaryWeapon(wid); });
          btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#0f0'; });
          btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#555'; });
        } else {
          btn.addEventListener('click', (e) => e.stopPropagation());
        }
        btnRow.appendChild(btn);
      }
    }

    if (this.locked) document.exitPointerLock();
  }

  private hideArmoryMenu(): void {
    this.armoryMenuVisible = false;
    this.armoryMenu.style.display = 'none';
  }

  private selectSecondaryWeapon(weaponId: string): void {
    const weapon = WEAPONS[weaponId];
    if (!weapon || weapon.slot !== 'secondary') return;
    this.secondaryWeapon = weapon;
    this.activeSlot = 'secondary';
    this.setWeaponModel(weapon);
    this.hideArmoryMenu();
    this.updateHud();
    // Re-lock pointer
    this.canvas.requestPointerLock();
  }

  // ===================== HUD =====================

  private updateHud(): void {
    const pct = Math.max(0, (this.hp / this.maxHp) * 100);
    this.hpFill.style.width = pct + '%';
    this.hpFill.style.background = pct > 50 ? '#4c4' : pct > 25 ? '#cc4' : '#c44';
    this.hpText.textContent = `${Math.ceil(this.hp)} / ${this.maxHp}`;

    // Jeep health bar (visible when in vehicle)
    if (this.inVehicle && this.vehicleId) {
      const vehicleEntity = this.sceneManager.entities.find(e => e.id === this.vehicleId);
      if (vehicleEntity && vehicleEntity.hp > 0) {
        this.jeepHpRow.style.display = '';
        const jeepPct = Math.max(0, (vehicleEntity.hp / vehicleEntity.maxHp) * 100);
        this.jeepHpFill.style.width = jeepPct + '%';
        this.jeepHpFill.style.background = jeepPct > 50 ? '#48a' : jeepPct > 25 ? '#ca4' : '#c44';
        const vLabel = this.vehicleType === 'helicopter' ? 'Heli' : 'Jeep';
        this.jeepHpText.textContent = `${vLabel}: ${Math.ceil(vehicleEntity.hp)} / ${vehicleEntity.maxHp}`;
      } else {
        this.jeepHpRow.style.display = 'none';
      }
    } else {
      this.jeepHpRow.style.display = 'none';
    }

    // Weapon display
    const primary = this.primaryWeapon;
    const secondary = this.secondaryWeapon;
    let html = '';
    const style = (active: boolean) => active
      ? 'color:#fff;background:rgba(255,255,255,0.15);border:1px solid #0f0;'
      : 'color:#888;background:rgba(0,0,0,0.3);border:1px solid #444;';

    html += `<span style="display:inline-block;padding:4px 12px;border-radius:4px;margin:0 4px;font-size:13px;${style(this.activeSlot === 'primary')}">1. ${primary.name}</span>`;
    if (secondary) {
      html += `<span style="display:inline-block;padding:4px 12px;border-radius:4px;margin:0 4px;font-size:13px;${style(this.activeSlot === 'secondary')}">2. ${secondary.name}</span>`;
      html += `<span style="color:#666;font-size:11px;margin-left:8px;">[Q] swap</span>`;
    } else if (this.armoryUnlocked) {
      html += `<span style="display:inline-block;padding:4px 12px;border-radius:4px;margin:0 4px;font-size:13px;color:#555;border:1px dashed #444;">2. Visit Armory</span>`;
    }
    this.weaponHud.innerHTML = html;

    // Hero ability bar — shows charge level
    if (!this.heroType || !this.abilityBar) {
      if (this.abilityBar) this.abilityBar.style.display = 'none';
    } else {
      this.abilityBar.style.display = '';
      const heroNames: Record<string, string> = { tank: 'Shield', healer: 'Heal Aura', mechanic: 'Repair Aura' };
      const abilityName = heroNames[this.heroType] ?? 'Ability';
      const chargePct = Math.max(0, (this.heroAbilityCharge / this.heroAbilityMaxCharge) * 100);
      if (this.abilityFill && this.abilityText) {
        this.abilityFill.style.width = chargePct + '%';
        if (this.heroAbilityDepleted) {
          // Locked out after full depletion
          this.abilityFill.style.background = '#c44';
          this.abilityText.textContent = `Depleted (${Math.ceil(this.heroAbilityLockout)}s)`;
        } else if (this.heroAbilityActive) {
          // Active — bar draining
          this.abilityFill.style.background = '#cc4';
          this.abilityText.textContent = `${abilityName} Active`;
        } else if (chargePct < 100) {
          // Recharging
          this.abilityFill.style.background = '#48a';
          this.abilityText.textContent = `${abilityName} Recharging`;
        } else {
          // Full charge, ready
          this.abilityFill.style.background = '#4c4';
          this.abilityText.textContent = `[F] ${abilityName} Ready`;
        }
      }
    }

    // Hero level badges
    const badges = document.getElementById('fps-level-badges');
    if (badges) {
      if (this.heroHpLevel > 0 || this.heroDmgLevel > 0 || this.heroRegenActive) {
        badges.style.display = '';
        let html = '';
        if (this.heroHpLevel > 0) {
          html += `<div style="background:rgba(0,80,0,0.7);border:1px solid #4c4;border-radius:4px;padding:2px 6px;margin-bottom:3px;font-size:11px;color:#4c4;">HP Lv${this.heroHpLevel}</div>`;
        }
        if (this.heroDmgLevel > 0) {
          html += `<div style="background:rgba(80,60,0,0.7);border:1px solid #cc4;border-radius:4px;padding:2px 6px;margin-bottom:3px;font-size:11px;color:#cc4;">DMG Lv${this.heroDmgLevel}</div>`;
        }
        if (this.heroRegenActive) {
          html += `<div style="background:rgba(0,40,80,0.7);border:1px solid #48a;border-radius:4px;padding:2px 6px;font-size:11px;color:#48a;">REGEN</div>`;
        }
        badges.innerHTML = html;
      } else {
        badges.style.display = 'none';
      }
    }
  }

  private buildHud(): HTMLDivElement {
    const hud = document.createElement('div');
    hud.id = 'fps-hud';
    hud.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      display: none; z-index: 12; font-family: system-ui, sans-serif;
      pointer-events: none; text-align: center;
    `;

    // Team indicator (top-left)
    const teamBadge = document.createElement('div');
    teamBadge.id = 'fps-team-badge';
    teamBadge.style.cssText = `
      position: fixed; top: 16px; left: 16px;
      padding: 6px 14px; border-radius: 6px; font-size: 14px; font-weight: bold;
      z-index: 12; pointer-events: none; font-family: system-ui, sans-serif;
    `;
    document.body.appendChild(teamBadge);

    // Hero level badges (left of HUD)
    const levelBadges = document.createElement('div');
    levelBadges.id = 'fps-level-badges';
    levelBadges.style.cssText = `
      position: fixed; bottom: 20px; left: calc(50% - 210px);
      display: none; z-index: 12; pointer-events: none;
      font-family: system-ui, sans-serif; text-align: center;
    `;
    document.body.appendChild(levelBadges);

    const hpRow = document.createElement('div');
    hpRow.style.cssText = 'margin-bottom: 8px;';

    const hpBg = document.createElement('div');
    hpBg.style.cssText = 'width: 300px; height: 16px; background: rgba(0,0,0,0.6); border-radius: 4px; overflow: hidden; margin: 0 auto;';
    const hpFill = document.createElement('div');
    hpFill.id = 'fps-hp-fill';
    hpFill.style.cssText = 'height: 100%; background: #4c4; border-radius: 4px; transition: width 0.2s;';
    hpBg.appendChild(hpFill);
    hpRow.appendChild(hpBg);

    const hpText = document.createElement('div');
    hpText.id = 'fps-hp-text';
    hpText.style.cssText = 'color: #fff; font-size: 14px; margin-top: 4px;';
    hpRow.appendChild(hpText);
    hud.appendChild(hpRow);

    // Jeep health bar (hidden by default)
    const jeepHpRow = document.createElement('div');
    jeepHpRow.id = 'fps-jeep-hp-row';
    jeepHpRow.style.cssText = 'margin-bottom: 6px; display: none;';
    const jeepHpBg = document.createElement('div');
    jeepHpBg.style.cssText = 'width: 300px; height: 12px; background: rgba(0,0,0,0.6); border-radius: 4px; overflow: hidden; margin: 0 auto;';
    const jeepHpFill = document.createElement('div');
    jeepHpFill.id = 'fps-jeep-hp-fill';
    jeepHpFill.style.cssText = 'height: 100%; background: #48a; border-radius: 4px; transition: width 0.2s;';
    jeepHpBg.appendChild(jeepHpFill);
    jeepHpRow.appendChild(jeepHpBg);
    const jeepHpText = document.createElement('div');
    jeepHpText.id = 'fps-jeep-hp-text';
    jeepHpText.style.cssText = 'color: #aaddff; font-size: 12px; margin-top: 2px;';
    jeepHpRow.appendChild(jeepHpText);
    hud.appendChild(jeepHpRow);

    const weaponHud = document.createElement('div');
    weaponHud.id = 'fps-weapon-hud';
    weaponHud.style.cssText = 'margin-top: 4px;';
    hud.appendChild(weaponHud);

    // Cooldown bar (thin bar below weapon info, fills right-to-left as cooldown expires)
    const cooldownBg = document.createElement('div');
    cooldownBg.style.cssText = 'width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin: 6px auto 0; overflow: hidden;';
    const cooldownFill = document.createElement('div');
    cooldownFill.id = 'fps-cooldown-fill';
    cooldownFill.style.cssText = 'height: 100%; background: #f84; border-radius: 2px; width: 0%; display: none; transition: none;';
    cooldownBg.appendChild(cooldownFill);
    hud.appendChild(cooldownBg);

    // Hero ability bar
    const abilityBarContainer = document.createElement('div');
    abilityBarContainer.id = 'fps-ability-bar';
    abilityBarContainer.style.cssText = 'margin-top: 6px; display: none;';
    const abilityBg = document.createElement('div');
    abilityBg.style.cssText = 'width: 250px; height: 14px; background: rgba(0,0,0,0.6); border-radius: 4px; overflow: hidden; margin: 0 auto;';
    const abilityFill = document.createElement('div');
    abilityFill.id = 'fps-ability-fill';
    abilityFill.style.cssText = 'height: 100%; background: #4c4; border-radius: 4px; width: 100%; transition: width 0.2s;';
    abilityBg.appendChild(abilityFill);
    abilityBarContainer.appendChild(abilityBg);
    const abilityText = document.createElement('div');
    abilityText.id = 'fps-ability-text';
    abilityText.style.cssText = 'color: #ccc; font-size: 12px; margin-top: 2px;';
    abilityBarContainer.appendChild(abilityText);
    hud.appendChild(abilityBarContainer);

    const interact = document.createElement('div');
    interact.id = 'fps-interact';
    interact.style.cssText = `
      display: none; margin-top: 12px; padding: 8px 16px;
      background: rgba(0,0,0,0.7); color: #ff0; border-radius: 6px;
      font-size: 16px;
    `;
    hud.appendChild(interact);

    const waveTimer = document.createElement('div');
    waveTimer.id = 'fps-wave-timer';
    waveTimer.style.cssText = `
      position: fixed; top: 16px; right: 16px;
      padding: 6px 14px; background: rgba(0,0,0,0.6); color: #ccc;
      border-radius: 6px; font-size: 14px; z-index: 12; pointer-events: none;
    `;
    document.body.appendChild(waveTimer);
    this.waveTimerHud = waveTimer;

    document.body.appendChild(hud);
    return hud;
  }

  private buildRespawnOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; display: none;
      align-items: center; justify-content: center;
      background: rgba(180, 0, 0, 0.4); z-index: 25;
      flex-direction: column; gap: 16px;
      font-family: system-ui, sans-serif; pointer-events: none;
    `;
    const dead = document.createElement('div');
    dead.textContent = 'YOU DIED';
    dead.style.cssText = 'color: #fff; font-size: 48px; font-weight: bold; text-shadow: 0 0 20px rgba(255,0,0,0.5);';
    overlay.appendChild(dead);
    const killedBy = document.createElement('div');
    killedBy.id = 'killed-by';
    killedBy.style.cssText = 'color: #ff8888; font-size: 22px; display: none;';
    overlay.appendChild(killedBy);
    const text = document.createElement('div');
    text.id = 'respawn-text';
    text.style.cssText = 'color: #ccc; font-size: 20px;';
    overlay.appendChild(text);
    document.body.appendChild(overlay);
    return overlay;
  }

  private buildHitMarker(): HTMLDivElement {
    const marker = document.createElement('div');
    marker.style.cssText = `
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 20px; height: 20px;
      pointer-events: none; z-index: 11; opacity: 0;
    `;
    for (const rot of [45, -45]) {
      const line = document.createElement('div');
      line.style.cssText = `
        position: absolute; top: 50%; left: 50%;
        width: 16px; height: 2px; background: #fff;
        transform: translate(-50%, -50%) rotate(${rot}deg);
      `;
      marker.appendChild(line);
    }
    document.body.appendChild(marker);
    return marker;
  }

  private buildArmoryMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    menu.style.cssText = `
      position: fixed; inset: 0; display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.7); z-index: 30;
      font-family: system-ui, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: rgba(20,20,30,0.95); border: 2px solid #666;
      border-radius: 12px; padding: 24px 32px; text-align: center;
    `;

    const title = document.createElement('div');
    title.textContent = 'Choose Secondary Weapon';
    title.style.cssText = 'color: #fff; font-size: 24px; font-weight: bold; margin-bottom: 20px;';
    panel.appendChild(title);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 16px; justify-content: center;';

    btnRow.id = 'armory-btn-row';
    for (const wid of ['rifle', 'shotgun'] as const) {
      const w = WEAPONS[wid];
      const btn = document.createElement('button');
      btn.innerHTML = `
        <div style="font-size:18px;font-weight:bold;margin-bottom:6px;">${w.name}</div>
        <div style="font-size:12px;color:#aaa;">DMG: ${w.damage}${w.pellets > 1 ? ` x${w.pellets}` : ''}</div>
        <div style="font-size:12px;color:#aaa;">Rate: ${w.fireRate}/s</div>
        <div style="font-size:12px;color:#aaa;">Range: ${w.range}</div>
      `;
      btn.style.cssText = `
        padding: 16px 24px; min-width: 140px;
        background: rgba(255,255,255,0.08); color: #fff;
        border: 2px solid #555; border-radius: 8px;
        cursor: pointer; font-family: system-ui, sans-serif;
        transition: border-color 0.2s;
      `;
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('mouseup', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.selectSecondaryWeapon(wid); });
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#0f0'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#555'; });
      btnRow.appendChild(btn);
    }
    panel.appendChild(btnRow);

    const closeBtn = document.createElement('div');
    closeBtn.textContent = 'Press Escape to close';
    closeBtn.style.cssText = 'color: #666; font-size: 13px; margin-top: 16px;';
    panel.appendChild(closeBtn);

    menu.appendChild(panel);

    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.armoryMenuVisible) {
        this.hideArmoryMenu();
        this.canvas.requestPointerLock();
      }
    });

    // Close on clicking background
    menu.addEventListener('click', () => {
      this.hideArmoryMenu();
      this.canvas.requestPointerLock();
    });
    panel.addEventListener('click', (e) => e.stopPropagation());

    document.body.appendChild(menu);
    return menu;
  }
}
