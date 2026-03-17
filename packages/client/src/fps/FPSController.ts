import * as THREE from 'three';
import type { InputState } from '@dyarchy/shared';
import { SoundManager } from '../audio/SoundManager.js';
import {
  MOUSE_SENSITIVITY,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  GROUND_Y,
  TEAM_SPAWNS,
} from '@dyarchy/shared';
import { applyMovement } from '@dyarchy/shared';
import { WEAPONS, type WeaponDef, createWeaponModel } from './Weapons.js';
import type { SceneManager, SceneEntity } from '../renderer/SceneManager.js';
import { createFPSPlayer } from '../renderer/MeshFactory.js';

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

  // Weapons: primary (pistol, always) + secondary (chosen at armory)
  private primaryWeapon: WeaponDef = WEAPONS.pistol;
  private secondaryWeapon: WeaponDef | null = null;
  private activeSlot: 'primary' | 'secondary' = 'primary';
  private fireCooldown = 0;
  armoryUnlocked = false;

  /** Callback for online mode: notifies when FPS hits an entity */
  onHit: ((targetId: string, damage: number) => void) | null = null;
  /** When true, this controller doesn't create its own entity (server owns it) */
  isOnline = false;
  /** Callback to send input to server (online mode) */
  onInput: ((keys: { forward: boolean; backward: boolean; left: boolean; right: boolean; jump: boolean }, yaw: number, pitch: number, dt: number) => void) | null = null;
  private inputSeq = 0;

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

  // HUD elements
  private hud: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLDivElement;
  private weaponHud: HTMLDivElement;
  private cooldownFill: HTMLDivElement;
  private interactPrompt: HTMLDivElement;
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
    this.position.y = GROUND_Y + PLAYER_HEIGHT;
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

    // Event listeners
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.hideArmoryMenu();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.armoryMenuVisible) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });

    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (this.armoryMenuVisible) return; // menu is open, don't process game keys
      this.onKey(e.code, true);
      this.onActionKey(e.code);
    });
    document.addEventListener('keyup', (e) => {
      if (this.enabled && !this.armoryMenuVisible) this.onKey(e.code, false);
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.enabled || !this.locked || this.isDead || this.armoryMenuVisible || e.button !== 0) return;
      this.tryShoot();
    });

    // Build HUD elements
    this.hud = this.buildHud();
    this.hpFill = this.hud.querySelector('#fps-hp-fill') as HTMLDivElement;
    this.hpText = this.hud.querySelector('#fps-hp-text') as HTMLDivElement;
    this.weaponHud = this.hud.querySelector('#fps-weapon-hud') as HTMLDivElement;
    this.cooldownFill = this.hud.querySelector('#fps-cooldown-fill') as HTMLDivElement;
    this.interactPrompt = this.hud.querySelector('#fps-interact') as HTMLDivElement;

    this.respawnOverlay = this.buildRespawnOverlay();
    this.respawnText = this.respawnOverlay.querySelector('#respawn-text') as HTMLDivElement;

    this.hitMarker = this.buildHitMarker();
    this.armoryMenu = this.buildArmoryMenu();

    // Set initial weapon model
    this.setWeaponModel(this.primaryWeapon);
  }

  enable(): void {
    this.enabled = true;
    this.hud.style.display = 'block';
    this.playerMesh.visible = false;
    this.updateHud();
  }

  disable(): void {
    this.enabled = false;
    if (this.locked) document.exitPointerLock();
    this.keys.forward = this.keys.backward = this.keys.left = this.keys.right = this.keys.jump = false;
    this.hud.style.display = 'none';
    this.respawnOverlay.style.display = 'none';
    this.hideArmoryMenu();
    this.playerMesh.visible = true;
  }

  destroy(): void {
    this.disable();
    this.hud.remove();
    this.respawnOverlay.remove();
    this.hitMarker.remove();
    this.armoryMenu.remove();
  }

  unlockArmory(): void {
    this.armoryUnlocked = true;
  }

  /** Sync FPS player state from server snapshot (online mode) */
  syncFromServer(serverHp: number, serverMaxHp: number, serverPos: { x: number; y: number; z: number }): void {
    // Detect death from server
    if (serverHp <= 0 && !this.isDead) {
      this.hp = 0;
      this.die();
      return;
    }

    // Detect respawn from server
    if (serverHp > 0 && this.isDead) {
      this.isDead = false;
      this.hp = serverHp;
      this.maxHp = serverMaxHp;
      this.respawnOverlay.style.display = 'none';
      this.position.set(serverPos.x, serverPos.y, serverPos.z);
      this.velocity = { x: 0, y: 0, z: 0 };
      this.updateHud();
      SoundManager.instance().playerRespawn();
      return;
    }

    // Sync HP damage from server (e.g. tower shot us)
    if (serverHp < this.hp && !this.isDead) {
      this.hp = serverHp;
      this.maxHp = serverMaxHp;
      this.updateHud();
      if (this.hp <= 0) {
        this.hp = 0;
        this.die();
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

  isPointerLocked(): boolean {
    return this.locked;
  }

  // ===================== Input =====================

  private onKey(code: string, down: boolean): void {
    switch (code) {
      case 'KeyW': this.keys.forward = down; break;
      case 'KeyS': this.keys.backward = down; break;
      case 'KeyA': this.keys.left = down; break;
      case 'KeyD': this.keys.right = down; break;
      case 'Space': this.keys.jump = down; break;
    }
  }

  private onActionKey(code: string): void {
    if (this.isDead) return;

    // Q to swap weapons
    if (code === 'KeyQ' && this.secondaryWeapon) {
      this.activeSlot = this.activeSlot === 'primary' ? 'secondary' : 'primary';
      this.setWeaponModel(this.getActiveWeapon());
      this.updateHud();
      SoundManager.instance().weaponSwitch();
    }

    // 1 = primary, 2 = secondary
    if (code === 'Digit1') {
      this.activeSlot = 'primary';
      this.setWeaponModel(this.primaryWeapon);
      this.updateHud();
      SoundManager.instance().weaponSwitch();
    }
    if (code === 'Digit2' && this.secondaryWeapon) {
      this.activeSlot = 'secondary';
      this.setWeaponModel(this.secondaryWeapon);
      this.updateHud();
      SoundManager.instance().weaponSwitch();
    }

    // E to interact with armory
    if (code === 'KeyE') {
      this.tryInteractArmory();
    }
  }

  // ===================== Update =====================

  update(dt: number): void {
    if (!this.enabled) return;

    if (this.isDead) {
      this.respawnTimer -= dt;
      this.respawnText.textContent = `Respawning in ${Math.ceil(Math.max(0, this.respawnTimer))}s`;
      // In offline mode, respawn locally. In online mode, server controls respawn via syncFromServer.
      if (!this.isOnline && this.respawnTimer <= 0) this.respawn();
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

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= dt;
      this.hitMarker.style.opacity = this.hitMarkerTimer > 0 ? '1' : '0';
    }

    // Movement
    const input: InputState = {
      forward: this.keys.forward, backward: this.keys.backward,
      left: this.keys.left, right: this.keys.right,
      jump: this.keys.jump, yaw: this.yaw, pitch: this.pitch, dt,
    };

    const prevPos = { x: this.position.x, y: this.position.y - PLAYER_HEIGHT, z: this.position.z };
    const result = applyMovement(prevPos, this.velocity, input, dt);

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

    this.position.set(newX, result.position.y + PLAYER_HEIGHT, newZ);
    this.velocity = result.velocity;
    this.onGround = result.onGround;

    if (!this.isOnline) {
      this.playerMesh.position.set(this.position.x, 0, this.position.z);
    }
    if (this.playerEntity) {
      this.playerEntity.hp = this.hp;
      this.playerEntity.maxHp = this.maxHp;
    }

    this.camera.position.copy(this.position);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);

    // Send input to server (online mode)
    if (this.isOnline && this.onInput) {
      this.onInput(
        { ...this.keys },
        this.yaw, this.pitch, dt,
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
    const cooldownPct = Math.min(1, this.fireCooldown / maxCooldown);
    this.cooldownFill.style.width = (cooldownPct * 100) + '%';
    this.cooldownFill.style.display = cooldownPct > 0 ? 'block' : 'none';

    // Update weapon camera aspect
    this.weaponCamera.aspect = this.canvas.width / this.canvas.height;
    this.weaponCamera.updateProjectionMatrix();

    // Check armory proximity for interact prompt
    this.updateInteractPrompt();
  }

  /** Render the weapon viewmodel on top of the main scene */
  renderWeaponView(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled || this.isDead || !this.currentModel) return;
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
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
    if (this.playerEntity) this.playerEntity.hp = this.hp;
  }

  private die(): void {
    this.isDead = true;
    this.respawnTimer = RESPAWN_TIME;
    this.respawnOverlay.style.display = 'flex';
    if (this.playerEntity) this.playerEntity.hp = 0;
    this.updateHud();
    SoundManager.instance().playerDeath();
  }

  private respawn(): void {
    this.isDead = false;
    this.hp = this.maxHp;
    this.respawnOverlay.style.display = 'none';
    SoundManager.instance().playerRespawn();
    const spawn = TEAM_SPAWNS[1];
    this.position.set(spawn.x, GROUND_Y + PLAYER_HEIGHT, spawn.z);
    this.velocity = { x: 0, y: 0, z: 0 };
    if (this.playerEntity) this.playerEntity.hp = this.hp;
    this.updateHud();
  }

  private tryShoot(): void {
    if (this.fireCooldown > 0) return;

    const weapon = this.getActiveWeapon();
    this.fireCooldown = 1 / weapon.fireRate;
    this.recoilAmount = 1;

    // Weapon-specific sound
    const sm = SoundManager.instance();
    if (weapon.id === 'pistol') sm.shootPistol();
    else if (weapon.id === 'rifle') sm.shootRifle();
    else if (weapon.id === 'shotgun') sm.shootShotgun();

    // Muzzle flash
    if (this.muzzleFlash) {
      this.muzzleFlash.visible = true;
      this.muzzleFlashTimer = 0.06;
    }

    const origin = this.position.clone();
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.camera.quaternion);

    for (let i = 0; i < weapon.pellets; i++) {
      const dir = forward.clone();
      if (weapon.spread > 0) {
        dir.x += (Math.random() - 0.5) * weapon.spread;
        dir.y += (Math.random() - 0.5) * weapon.spread;
        dir.z += (Math.random() - 0.5) * weapon.spread;
        dir.normalize();
      }

      this.raycaster.set(origin, dir);
      this.raycaster.far = weapon.range;

      const targetMeshes: THREE.Mesh[] = [];
      const meshToEntity = new Map<THREE.Mesh, SceneEntity>();

      for (const ent of this.sceneManager.entities) {
        if (ent.id === this.playerEntity?.id) continue;
        if (ent.entityType === 'resource_node') continue;
        if (ent.hp <= 0) continue;
        targetMeshes.push(ent.mesh);
        meshToEntity.set(ent.mesh, ent);
      }

      const intersects = this.raycaster.intersectObjects(targetMeshes, true);
      if (intersects.length > 0) {
        const hit = intersects[0];
        // Walk up to find the root entity mesh (intersect may hit a child)
        let hitObj = hit.object as THREE.Object3D;
        let hitEntity: SceneEntity | undefined;
        while (hitObj) {
          hitEntity = meshToEntity.get(hitObj as THREE.Mesh);
          if (hitEntity) break;
          hitObj = hitObj.parent!;
        }
        if (hitEntity) {
          hitEntity.hp -= weapon.damage;
          if (hitEntity.entityType === 'main_base' && hitEntity.hp < 1 && hitEntity.teamId === 1) {
            hitEntity.hp = 1;
          }
          if (hitEntity.hp < 0) hitEntity.hp = 0;

          this.hitMarkerTimer = 0.2;
          this.hitMarker.style.opacity = '1';
          this.showHitEffect(hit.point);
          SoundManager.instance().bulletImpact(hit.point.x, hit.point.z);

          // Notify server in online mode
          this.onHit?.(hitEntity.id, weapon.damage);
        }
        break;
      }
    }
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

  // ===================== Weapon Model =====================

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
      if (ent.entityType !== 'armory' || ent.teamId !== 1 || ent.status !== 'active') continue;
      const dx = this.position.x - ent.mesh.position.x;
      const dz = this.position.z - ent.mesh.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < ARMORY_INTERACT_RANGE) return ent;
    }
    return null;
  }

  private updateInteractPrompt(): void {
    if (this.armoryUnlocked && this.findNearbyArmory()) {
      this.interactPrompt.style.display = 'block';
      this.interactPrompt.textContent = 'Press E to access Armory';
    } else {
      this.interactPrompt.style.display = 'none';
    }
  }

  private tryInteractArmory(): void {
    if (!this.armoryUnlocked) return;
    if (!this.findNearbyArmory()) return;
    this.showArmoryMenu();
  }

  private showArmoryMenu(): void {
    this.armoryMenuVisible = true;
    this.armoryMenu.style.display = 'flex';
    // Release pointer lock so user can click buttons
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
  }

  private buildHud(): HTMLDivElement {
    const hud = document.createElement('div');
    hud.id = 'fps-hud';
    hud.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      display: none; z-index: 12; font-family: system-ui, sans-serif;
      pointer-events: none; text-align: center;
    `;

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

    const interact = document.createElement('div');
    interact.id = 'fps-interact';
    interact.style.cssText = `
      display: none; margin-top: 12px; padding: 8px 16px;
      background: rgba(0,0,0,0.7); color: #ff0; border-radius: 6px;
      font-size: 16px;
    `;
    hud.appendChild(interact);

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
