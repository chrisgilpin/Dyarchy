import type { Selectable } from './Selection.js';
import { BUILDING_COSTS, type BuildingChoice } from './BuildPanel.js';

export interface InfoPanelCallbacks {
  onTrainWorker?: () => void;
  onCancelTraining?: (baseId: string, index: number) => void;
  onUpgradeBase?: () => void;
  onUpgradeArmory?: () => void;
  onUpgradeArmoryLevel3?: () => void;
  onUpgradeUnits?: (barracksId: string) => void;
  onTrainFootSoldier?: (barracksId: string) => void;
  onUpgradeBarracks?: (barracksId: string) => void;
  onUpgradeTower?: (towerId: string) => void;
  onUpgradeTowerDual?: (towerId: string) => void;
  onTrainArcher?: (barracksId: string) => void;
  onTrainJeep?: (garageId: string) => void;
  onTrainHelicopter?: (garageId: string) => void;
  onUpgradeHarvest?: () => void;
  onUpgradeHeroHp?: (buildingId: string) => void;
  onUpgradeHeroDmg?: (buildingId: string) => void;
  onUpgradeHeroRegen?: (buildingId: string) => void;
  onForceAttack?: (unitIds: string[]) => void;
  onPlaceBuilding?: (type: BuildingChoice) => void;
  onCancelBuild?: (buildingId: string) => void;
  /** For multi-building groups: get the building with the shortest queue */
  getShortestQueueId?: (ids: string[]) => string | null;
}

type SubMenu = 'top' | 'build' | 'upgrade';

export class InfoPanel {
  private readonly el: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly hpBarFill: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;
  private readonly queueEl: HTMLDivElement;
  private callbacks: InfoPanelCallbacks = {};
  forceAttackMode = false;
  forceAttackUnitIds: string[] = [];
  baseUpgraded = false;
  harvestBoosted = false;
  armoryLevel2 = false;
  armoryRocketUpgrade = false;
  armoryLevel3 = false;
  unitUpgradeLevel = 0; // 0, 1, 2
  heroHpLevel = 0;
  heroDmgLevel = 0;
  heroRegenUnlocked = false;
  localTeamId: 1 | 2 = 1;
  barracksLevels: Map<string, number> = new Map();
  towerLevels: Map<string, number> = new Map();
  towerDualGuns: Set<string> = new Set();
  crystals = 0;
  needsHQUpgradeForExpansion = false; // true if player has a level-1 HQ and wants to build another

  // Sub-menu state
  private subMenu: SubMenu = 'top';
  private lastItem: Selectable | null = null;
  private lastItems: Selectable[] = [];
  private lastIsUpgrading = false;
  private lastCrystals = -1; // track crystal changes for dynamic updates

  // Active hotkeys for current sub-menu
  private activeHotkeys = new Map<string, () => void>();

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'info-panel';
    this.el.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 20px;
      width: 260px;
      padding: 14px;
      background: rgba(0,0,0,0.8);
      border: 1px solid #555;
      border-radius: 8px;
      color: #fff;
      font-family: system-ui, sans-serif;
      z-index: 15;
      display: none;
    `;

    this.nameEl = document.createElement('div');
    this.nameEl.style.cssText = 'font-size: 16px; font-weight: bold; margin-bottom: 10px;';
    this.el.appendChild(this.nameEl);

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size: 13px; color: #f90; margin-bottom: 8px; display: none;';
    this.el.appendChild(this.statusEl);

    const hpLabel = document.createElement('div');
    hpLabel.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 4px;';
    hpLabel.textContent = 'Health';
    this.el.appendChild(hpLabel);

    const hpBarBg = document.createElement('div');
    hpBarBg.style.cssText = 'width: 100%; height: 14px; background: #333; border-radius: 3px; overflow: hidden; margin-bottom: 4px;';

    this.hpBarFill = document.createElement('div');
    this.hpBarFill.style.cssText = 'height: 100%; background: #4c4; border-radius: 3px; transition: width 0.2s;';
    hpBarBg.appendChild(this.hpBarFill);
    this.el.appendChild(hpBarBg);

    this.hpText = document.createElement('div');
    this.hpText.style.cssText = 'font-size: 13px; color: #ccc; text-align: right; margin-bottom: 10px;';
    this.el.appendChild(this.hpText);

    this.actionsEl = document.createElement('div');
    this.actionsEl.style.cssText = 'display: none; border-top: 1px solid #444; padding-top: 10px;';
    this.el.appendChild(this.actionsEl);

    this.queueEl = document.createElement('div');
    this.queueEl.style.cssText = 'display: none; margin-top: 8px;';
    this.el.appendChild(this.queueEl);

    document.body.appendChild(this.el);
  }

  setCallbacks(callbacks: InfoPanelCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Handle a hotkey press. Returns true if it was consumed. */
  handleHotkey(code: string): boolean {
    const key = code.replace('Key', '').toUpperCase();
    // B = open build, U = open upgrade, Escape/Back
    if (this.subMenu === 'top') {
      if (key === 'B' && this.hasBuildOptions()) { this.openSubMenu('build'); return true; }
      if (key === 'U' && this.hasUpgradeOptions()) { this.openSubMenu('upgrade'); return true; }
      if (key === 'A' && this.hasAttackOption()) { this.triggerForceAttack(); return true; }
      // Check inline upgrade hotkeys on top menu
      const handler = this.activeHotkeys.get(key);
      if (handler) { handler(); return true; }
    } else {
      if (code === 'Escape' || key === 'BACK') { this.openSubMenu('top'); return true; }
      const handler = this.activeHotkeys.get(key);
      if (handler) { handler(); return true; }
    }
    // Cancel hotkey for training queue
    if (key === 'X') {
      const handler = this.activeHotkeys.get('X');
      if (handler) { handler(); return true; }
    }
    return false;
  }

  show(
    items: Selectable[],
    extraStatus?: string,
    queueInfo?: { baseId: string; slots: { unitType: string; progress: number | null }[]; maxSlots: number },
    isUpgrading?: boolean,
  ): void {
    if (items.length === 0) {
      this.el.style.display = 'none';
      return;
    }

    this.el.style.display = 'block';
    this.actionsEl.style.display = 'none';
    this.actionsEl.innerHTML = '';
    this.queueEl.style.display = 'none';
    this.queueEl.innerHTML = '';
    this.activeHotkeys.clear();
    this.subMenu = 'top';
    this.lastItems = items;
    this.lastCrystals = this.crystals;

    if (items.length === 1) {
      const item = items[0];
      this.lastItem = item;
      this.lastIsUpgrading = isUpgrading ?? false;

      this.nameEl.textContent = item.entityType === 'resource_node'
        ? `💎 Field (${Math.ceil(item.hp)} / ${item.maxHp} remaining)`
        : item.name;

      this.lastShownStatus = item.status;
      if (item.status === 'constructing') {
        const pct = Math.round(item.constructionProgress * 100);
        this.statusEl.textContent = `Building... ${pct}%`;
        this.statusEl.style.display = 'block';
      } else if (extraStatus) {
        this.statusEl.textContent = extraStatus;
        this.statusEl.style.display = 'block';
      } else {
        this.statusEl.style.display = 'none';
      }

      const pct = Math.max(0, Math.min(100, (item.hp / item.maxHp) * 100));
      this.hpBarFill.style.width = pct + '%';
      this.hpBarFill.style.background = pct > 50 ? '#4c4' : pct > 25 ? '#cc4' : '#c44';
      this.hpText.textContent = `${Math.ceil(item.hp)} / ${item.maxHp}`;

      // Show actions for own team entities
      if (item.teamId === this.localTeamId && item.status === 'active') {
        this.renderActions(item, isUpgrading ?? false);
      }
      // Show cancel button for own constructing buildings
      if (item.teamId === this.localTeamId && item.status === 'constructing') {
        this.actionsEl.style.display = 'block';
        const cost = BUILDING_COSTS[item.entityType as BuildingChoice];
        const refund = cost ? Math.floor(cost * 0.5) : 0;
        this.addAction(`Cancel Build (refund ${refund} 💎)`, '#c44', () => {
          this.callbacks.onCancelBuild?.(item.id);
        });
      }

      // Queue display
      if (queueInfo) {
        this.renderQueue(queueInfo);
      }
    } else {
      this.lastItem = null;
      this.subMenu = 'top';

      // Check if all selected items are the same building type (for group build UI)
      const allSameType = items.every(i => i.entityType === items[0].entityType);
      const allOwnTeam = items.every(i => i.teamId === this.localTeamId);
      const allActive = items.every(i => i.status === 'active');

      if (allSameType && allOwnTeam && allActive) {
        this.nameEl.textContent = `${items.length}x ${items[0].name}`;
        // Use first item as representative for build/upgrade options
        this.lastItem = items[0];
        this.lastIsUpgrading = isUpgrading ?? false;
        this.renderActions(items[0], isUpgrading ?? false);
      } else {
        this.nameEl.textContent = `${items.length} units selected`;
      }

      this.statusEl.style.display = 'none';
      const totalHp = items.reduce((sum, i) => sum + i.hp, 0);
      const totalMax = items.reduce((sum, i) => sum + i.maxHp, 0);
      const pct = Math.max(0, Math.min(100, (totalHp / totalMax) * 100));
      this.hpBarFill.style.width = pct + '%';
      this.hpBarFill.style.background = pct > 50 ? '#4c4' : pct > 25 ? '#cc4' : '#c44';
      this.hpText.textContent = `${Math.ceil(totalHp)} / ${totalMax}`;
    }
  }

  hide(): void {
    this.el.style.display = 'none';
    this.subMenu = 'top';
    this.lastItem = null;
    this.lastItems = [];
  }

  /** Per-frame refresh. Returns true if a building just completed (needs full rebuild). */
  refreshStats(item: Selectable): boolean {
    if (this.el.style.display === 'none') return false;
    const pct = Math.max(0, Math.min(100, (item.hp / item.maxHp) * 100));
    this.hpBarFill.style.width = pct + '%';
    this.hpBarFill.style.background = pct > 50 ? '#4c4' : pct > 25 ? '#cc4' : '#c44';
    this.hpText.textContent = `${Math.ceil(item.hp)} / ${item.maxHp}`;

    if (item.entityType === 'resource_node') {
      this.nameEl.textContent = `💎 Field (${Math.ceil(item.hp)} / ${item.maxHp} remaining)`;
    }

    if (item.status === 'constructing') {
      const buildPct = Math.round(item.constructionProgress * 100);
      this.statusEl.textContent = `Building... ${buildPct}%`;
      this.statusEl.style.display = 'block';
      this.lastShownStatus = 'constructing';
    } else if (this.lastShownStatus === 'constructing') {
      this.lastShownStatus = 'active';
      return true;
    }

    // Dynamic button enable/disable without full re-render (preserves tooltips)
    if (this.crystals !== this.lastCrystals) {
      this.lastCrystals = this.crystals;
      this.updateButtonStates();
    }

    return false;
  }
  private lastShownStatus: string = '';

  /** Per-frame refresh for multi-selection health bar (#6). */
  refreshGroupStats(items: Selectable[]): void {
    if (this.el.style.display === 'none' || items.length <= 1) return;
    const totalHp = items.reduce((sum, i) => sum + i.hp, 0);
    const totalMax = items.reduce((sum, i) => sum + i.maxHp, 0);
    const pct = Math.max(0, Math.min(100, (totalHp / totalMax) * 100));
    this.hpBarFill.style.width = pct + '%';
    this.hpBarFill.style.background = pct > 50 ? '#4c4' : pct > 25 ? '#cc4' : '#c44';
    this.hpText.textContent = `${Math.ceil(totalHp)} / ${totalMax}`;

    if (this.crystals !== this.lastCrystals) {
      this.lastCrystals = this.crystals;
      this.updateButtonStates();
    }
  }

  getStatusElement(): HTMLDivElement { return this.statusEl; }
  getNameElement(): HTMLDivElement { return this.nameEl; }

  updateQueue(queueInfo: { baseId: string; slots: { unitType: string; progress: number | null }[]; maxSlots: number }): void {
    this.queueEl.innerHTML = '';
    if (queueInfo.slots.length === 0) {
      this.queueEl.style.display = 'none';
      return;
    }
    this.renderQueue(queueInfo);
  }

  private openSubMenu(menu: SubMenu): void {
    this.subMenu = menu;
    if (this.lastItem) {
      this.actionsEl.innerHTML = '';
      this.activeHotkeys.clear();
      this.renderActions(this.lastItem, this.lastIsUpgrading);
    }
  }

  // ===================== Action Rendering =====================

  private renderActions(item: Selectable, isUpgrading: boolean): void {
    this.actionsEl.style.display = 'block';
    this.actionsEl.innerHTML = '';
    this.activeHotkeys.clear();

    if (isUpgrading) {
      this.addLabel('Upgrading in progress...', '#ffcc00');
      return;
    }

    if (this.subMenu === 'top') {
      this.renderTopMenu(item);
    } else if (this.subMenu === 'build') {
      this.renderBuildMenu(item);
    } else if (this.subMenu === 'upgrade') {
      this.renderUpgradeMenu(item);
    }
  }

  private renderTopMenu(item: Selectable): void {
    if (this.hasBuildOptionsFor(item)) {
      this.addAction('Build [B]', '#0f0', () => this.openSubMenu('build'));
    }

    // Count upgrade options — if exactly 1, show inline instead of submenu (#2)
    const upgradeCount = this.countUpgradeOptions(item);
    if (upgradeCount === 1) {
      this.renderSingleUpgradeInline(item);
    } else if (upgradeCount > 1) {
      this.addAction('Upgrade [U]', '#ff0', () => this.openSubMenu('upgrade'));
    }

    // Attack button for military/worker units
    const MILITARY_TYPES = new Set(['foot_soldier', 'archer', 'fighter', 'worker']);
    if (MILITARY_TYPES.has(item.entityType) && item.hp > 0) {
      const label = this.forceAttackMode ? 'Attack Mode: ON — click a friendly' : 'Attack [A]';
      const color = this.forceAttackMode ? '#f44' : '#f90';
      this.addAction(label, color, () => this.triggerForceAttack());
    }
  }

  /** Get the target building ID for training — uses shortest queue for multi-select groups */
  private getTrainTargetId(item: Selectable): string {
    if (this.lastItems.length > 1) {
      const sameType = this.lastItems.filter(i => i.entityType === item.entityType);
      const ids = sameType.map(i => i.id);
      const best = this.callbacks.getShortestQueueId?.(ids);
      if (best) return best;
    }
    return item.id;
  }

  private renderBuildMenu(item: Selectable): void {
    this.addAction('Back [Esc]', '#888', () => this.openSubMenu('top'));

    if (item.entityType === 'main_base') {
      this.addTrainAction('Worker [W]', 'W', 100, '#0f0', () => this.callbacks.onTrainWorker?.(),
        'Harvests 💎, builds and repairs structures');
    }

    if (item.entityType === 'barracks') {
      this.addTrainAction('Foot Soldier [F]', 'F', 100, '#0f0',
        () => this.callbacks.onTrainFootSoldier?.(this.getTrainTargetId(item)),
        'Melee infantry, 60 HP, 8 dmg');
      const level = this.barracksLevels.get(item.id) ?? 1;
      if (level >= 2) {
        this.addTrainAction('Archer [A]', 'A', 150, '#44dd88',
          () => this.callbacks.onTrainArcher?.(this.getTrainTargetId(item)),
          'Ranged unit, 40 HP, 12 dmg, 25 range');
      }
    }

    if (item.entityType === 'garage') {
      this.addTrainAction('Jeep [J]', 'J', 500, '#0f0',
        () => this.callbacks.onTrainJeep?.(this.getTrainTargetId(item)),
        'Fast vehicle, 200 HP, FPS player can drive');
      this.addTrainAction('Helicopter [H]', 'H', 400, '#0f0',
        () => this.callbacks.onTrainHelicopter?.(this.getTrainTargetId(item)),
        'Flying vehicle, 100 HP, FPS player can pilot and shoot');
    }

    if (item.entityType === 'worker') {
      const allBuildings: { type: BuildingChoice; label: string; hotkey: string; requires?: string; tooltip: string }[] = [
        { type: 'farm', label: 'Farm', hotkey: 'F', tooltip: '+5 supply cap' },
        { type: 'barracks', label: 'Barracks', hotkey: 'R', tooltip: 'Train Foot Soldiers, Archers (with upgrade)' },
        { type: 'armory', label: 'Armory', hotkey: 'M', tooltip: 'Unlocks Rifle, Shotgun, Sniper for FPS player' },
        { type: 'tower', label: 'Tower', hotkey: 'T', tooltip: 'Auto-attacks enemies in range (4 dmg)' },
        { type: 'sniper_nest', label: 'Sniper Nest', hotkey: 'N', tooltip: 'Elevated platform for FPS player' },
        { type: 'main_base', label: 'HQ', hotkey: 'Q',
          requires: this.needsHQUpgradeForExpansion ? 'HQ Level 2 (or main HQ destroyed)' : undefined,
          tooltip: 'Train Workers, research upgrades, expansion base' },
        { type: 'hero_academy', label: 'Hero Academy', hotkey: 'E', requires: this.baseUpgraded ? undefined : 'HQ Level 2',
          tooltip: 'Enables Hero selection, Hero HP/Damage/Regen upgrades' },
        { type: 'garage', label: 'Garage', hotkey: 'G', requires: this.baseUpgraded ? undefined : 'HQ Level 2',
          tooltip: 'Train Jeeps and Helicopters' },
        { type: 'turret', label: 'Turret', hotkey: 'U', requires: this.baseUpgraded ? undefined : 'HQ Level 2',
          tooltip: 'Cheaper defensive gun (8 dmg, slower fire rate)' },
      ];
      for (const b of allBuildings) {
        const cost = BUILDING_COSTS[b.type];
        if (b.requires) {
          const btn = this.makeButton(`${b.label} — ${cost} 💎\nMissing: ${b.requires}`, '#666', true);
          this.attachTooltip(btn, b.tooltip);
          this.actionsEl.appendChild(btn);
        } else {
          this.addTrainAction(`${b.label} [${b.hotkey}]`, b.hotkey, cost, '#0f0',
            () => this.callbacks.onPlaceBuilding?.(b.type), b.tooltip);
        }
      }
    }
  }

  private renderUpgradeMenu(item: Selectable): void {
    this.addAction('Back [Esc]', '#888', () => this.openSubMenu('top'));

    if (item.entityType === 'main_base') {
      if (!this.baseUpgraded) {
        this.addUpgradeAction('HQ Tier 2 [H]', 'H', 1000, '#ff0', () => this.callbacks.onUpgradeBase?.(),
          'Hero Academy, Garage, Turret buildings');
      } else {
        this.addLabel('HQ Tier 2 — Turrets unlocked', '#0f0');
      }
      if (!this.harvestBoosted) {
        this.addUpgradeAction('💎 Boost [C]', 'C', 400, '#0ff', () => this.callbacks.onUpgradeHarvest?.(),
          '2x worker harvest speed');
      } else {
        this.addLabel('💎 Boost active — 2x harvest', '#0ff');
      }
    }

    if (item.entityType === 'barracks') {
      const level = this.barracksLevels.get(item.id) ?? 1;
      if (level < 2) {
        this.addUpgradeAction('Tier 2 [T]', 'T', 500, '#ff0', () => this.callbacks.onUpgradeBarracks?.(item.id),
          'Archer unit training');
      } else {
        this.addLabel('Tier 2 — Archers unlocked', '#0f0');
      }
      // Unit upgrades (requires armory level 3)
      if (this.armoryLevel3) {
        const uLvl = this.unitUpgradeLevel;
        if (uLvl > 0) this.addLabel(`Units: Level ${uLvl + 1}`, '#4cf');
        if (uLvl < 2) {
          const cost = uLvl === 0 ? 250 : 750;
          const label = uLvl === 0 ? 'Unit Upgrade Lv2 [V]' : 'Unit Upgrade Lv3 [V]';
          const desc = uLvl === 0 ? '+25% unit HP, speed, damage' : '+100% unit HP, damage (on top of Lv2)';
          this.addUpgradeAction(label, 'V', cost, '#4cf', () => this.callbacks.onUpgradeUnits?.(this.getTrainTargetId(item)), desc);
        } else {
          this.addLabel('Units: Level 3 (MAX)', '#4cf');
        }
      }
    }

    if (item.entityType === 'armory') {
      if (!this.armoryLevel2) {
        this.addUpgradeAction('Level 2 [L]', 'L', 500, '#ff0', () => this.callbacks.onUpgradeArmory?.(),
          'Rocket Launcher weapon for FPS player. Required for Level 3');
      } else {
        this.addLabel('Level 2 — Rocket Launcher unlocked', '#0f0');
        if (!this.armoryRocketUpgrade) {
          this.addUpgradeAction('Upgrade Rockets [R]', 'R', 400, '#ff0', () => this.callbacks.onUpgradeArmory?.(),
            '-50% Rocket Launcher cooldown');
        } else {
          this.addLabel('Rockets enhanced', '#4c4');
        }
        if (!this.armoryLevel3) {
          this.addUpgradeAction('Level 3 [L]', 'L', 600, '#ff0', () => this.callbacks.onUpgradeArmoryLevel3?.(),
            'Unit upgrades at Barracks (+HP/speed/damage)');
        } else {
          this.addLabel('Unit upgrades unlocked', '#4c4');
        }
      }
    }

    if (item.entityType === 'hero_academy') {
      const hpLvl = this.heroHpLevel;
      if (hpLvl < 3) {
        const costs = [200, 500, 1000];
        const labels = ['+25% Hero HP', '+100% Hero HP', '+200% Hero HP'];
        this.addUpgradeAction(`${labels[hpLvl]} [H]`, 'H', costs[hpLvl], '#4c4', () => this.callbacks.onUpgradeHeroHp?.(item.id),
          `Hero max HP multiplier`);
      } else {
        this.addLabel('Hero HP: MAX (+200%)', '#4c4');
      }

      const dmgLvl = this.heroDmgLevel;
      if (dmgLvl < 3) {
        const costs = [200, 500, 1000];
        const labels = ['+25% Hero Damage', '+100% Hero Damage', '+200% Hero Damage'];
        this.addUpgradeAction(`${labels[dmgLvl]} [D]`, 'D', costs[dmgLvl], '#cc4', () => this.callbacks.onUpgradeHeroDmg?.(item.id),
          `Hero weapon damage multiplier`);
      } else {
        this.addLabel('Hero Damage: MAX (+200%)', '#cc4');
      }

      if (!this.heroRegenUnlocked) {
        this.addUpgradeAction('Auto Regen [R]', 'R', 1000, '#48a', () => this.callbacks.onUpgradeHeroRegen?.(item.id),
          '2% HP/s after 7s without damage');
      } else {
        this.addLabel('Auto Regen: Active (2%/s)', '#48a');
      }
    }

    const TOWER_TYPES = new Set(['tower', 'player_tower', 'turret']);
    if (TOWER_TYPES.has(item.entityType)) {
      const towerLevel = this.towerLevels?.get(item.id) ?? 1;
      if (towerLevel > 1) {
        this.addLabel(`Level ${towerLevel}${towerLevel >= 3 ? ' (MAX)' : ''}`, '#0f0');
      }
      if (towerLevel < 3) {
        const cost = towerLevel >= 2 ? 500 : 300;
        const desc = towerLevel === 1 ? '2x tower HP, +50% damage (6 dmg)' : '2x tower damage (8 dmg)';
        this.addUpgradeAction(`Level ${towerLevel + 1} [L]`, 'L', cost, '#ff0',
          () => this.callbacks.onUpgradeTower?.(item.id), desc);
      }
      const hasDualGun = this.towerDualGuns?.has(item.id) ?? false;
      if (!hasDualGun) {
        this.addUpgradeAction('Dual Gun [G]', 'G', 300, '#0ff',
          () => this.callbacks.onUpgradeTowerDual?.(item.id), 'Fire at 2 targets simultaneously');
      } else {
        this.addLabel('Dual guns active', '#0ff');
      }
    }
  }

  // ===================== Inline single upgrade (#2) =====================

  private countUpgradeOptions(item: Selectable): number {
    let count = 0;
    if (item.entityType === 'main_base') {
      if (!this.baseUpgraded) count++;
      if (!this.harvestBoosted) count++;
    }
    if (item.entityType === 'barracks') {
      if ((this.barracksLevels.get(item.id) ?? 1) < 2) count++;
      if (this.armoryLevel3 && this.unitUpgradeLevel < 2) count++;
    }
    if (item.entityType === 'armory') {
      if (!this.armoryLevel2) count++;
      else {
        if (!this.armoryRocketUpgrade) count++;
        if (!this.armoryLevel3) count++;
      }
    }
    if (item.entityType === 'hero_academy') {
      if (this.heroHpLevel < 3) count++;
      if (this.heroDmgLevel < 3) count++;
      if (!this.heroRegenUnlocked) count++;
    }
    const TOWER_TYPES = new Set(['tower', 'player_tower', 'turret']);
    if (TOWER_TYPES.has(item.entityType)) {
      if ((this.towerLevels?.get(item.id) ?? 1) < 3) count++;
      if (!(this.towerDualGuns?.has(item.id) ?? false)) count++;
    }
    return count;
  }

  /** Render the single available upgrade directly on the top menu */
  private renderSingleUpgradeInline(item: Selectable): void {
    if (item.entityType === 'main_base') {
      if (!this.baseUpgraded) {
        this.addUpgradeAction('HQ Tier 2 [U]', 'U', 1000, '#ff0', () => this.callbacks.onUpgradeBase?.(),
          'Hero Academy, Garage, Turret buildings');
      } else if (!this.harvestBoosted) {
        this.addUpgradeAction('💎 Boost [U]', 'U', 400, '#0ff', () => this.callbacks.onUpgradeHarvest?.(),
          '2x worker harvest speed');
      }
    }
    if (item.entityType === 'barracks') {
      if ((this.barracksLevels.get(item.id) ?? 1) < 2) {
        this.addUpgradeAction('Tier 2 [U]', 'U', 500, '#ff0', () => this.callbacks.onUpgradeBarracks?.(item.id),
          'Archer unit training');
      } else if (this.armoryLevel3 && this.unitUpgradeLevel < 2) {
        const cost = this.unitUpgradeLevel === 0 ? 250 : 750;
        const desc = this.unitUpgradeLevel === 0 ? '+25% unit HP, speed, damage' : '+100% unit HP, damage';
        this.addUpgradeAction(`Unit Upgrade [U]`, 'U', cost, '#4cf', () => this.callbacks.onUpgradeUnits?.(item.id), desc);
      }
    }
    if (item.entityType === 'armory') {
      if (!this.armoryLevel2) {
        this.addUpgradeAction('Level 2 [U]', 'U', 500, '#ff0', () => this.callbacks.onUpgradeArmory?.(),
          'Rocket Launcher weapon for FPS player');
      } else if (!this.armoryRocketUpgrade && this.armoryLevel3) {
        // Only rockets left
        this.addUpgradeAction('Upgrade Rockets [U]', 'U', 400, '#ff0', () => this.callbacks.onUpgradeArmory?.(),
          '-50% Rocket Launcher cooldown');
      } else if (this.armoryRocketUpgrade && !this.armoryLevel3) {
        // Only level 3 left
        this.addUpgradeAction('Level 3 [U]', 'U', 600, '#ff0', () => this.callbacks.onUpgradeArmoryLevel3?.(),
          'Unit upgrades at Barracks (+HP/speed/damage)');
      }
    }
    const TOWER_TYPES = new Set(['tower', 'player_tower', 'turret']);
    if (TOWER_TYPES.has(item.entityType)) {
      const lvl = this.towerLevels?.get(item.id) ?? 1;
      const hasDual = this.towerDualGuns?.has(item.id) ?? false;
      if (lvl < 3 && hasDual) {
        const cost = lvl >= 2 ? 500 : 300;
        const desc = lvl === 1 ? '2x tower HP, +50% damage (6 dmg)' : '2x tower damage (8 dmg)';
        this.addUpgradeAction(`Level ${lvl + 1} [U]`, 'U', cost, '#ff0',
          () => this.callbacks.onUpgradeTower?.(item.id), desc);
      } else if (lvl >= 3 && !hasDual) {
        this.addUpgradeAction('Dual Gun [U]', 'U', 300, '#0ff',
          () => this.callbacks.onUpgradeTowerDual?.(item.id), 'Fire at 2 targets simultaneously');
      }
      // If both available (count would be 2), this method isn't called
    }
  }

  // ===================== Helpers =====================

  private hasBuildOptions(): boolean {
    return this.lastItem ? this.hasBuildOptionsFor(this.lastItem) : false;
  }
  private hasBuildOptionsFor(item: Selectable): boolean {
    return ['main_base', 'barracks', 'garage', 'worker'].includes(item.entityType);
  }

  private hasUpgradeOptions(): boolean {
    return this.lastItem ? this.countUpgradeOptions(this.lastItem) > 0 : false;
  }

  private hasAttackOption(): boolean {
    if (!this.lastItem) return false;
    const MILITARY_TYPES = new Set(['foot_soldier', 'archer', 'fighter', 'worker']);
    return MILITARY_TYPES.has(this.lastItem.entityType) && this.lastItem.hp > 0;
  }

  private triggerForceAttack(): void {
    if (!this.lastItem) return;
    this.forceAttackMode = !this.forceAttackMode;
    this.forceAttackUnitIds = this.forceAttackMode ? [this.lastItem.id] : [];
    if (this.lastItem) this.renderActions(this.lastItem, this.lastIsUpgrading);
  }

  private addAction(label: string, color: string, onClick: () => void): void {
    const btn = this.makeButton(label, color, false);
    btn.addEventListener('click', onClick);
    this.actionsEl.appendChild(btn);
  }

  private addTrainAction(label: string, hotkey: string, cost: number, color: string, onClick: () => void, tooltip?: string): void {
    const cant = this.crystals < cost;
    const btn = this.makeButton(`${label} — ${cost} 💎`, color, cant);
    btn.dataset.cost = String(cost);
    if (cant) btn.classList.add('cost-disabled');
    if (tooltip) this.attachTooltip(btn, tooltip);
    if (!cant) {
      btn.addEventListener('click', onClick);
      this.activeHotkeys.set(hotkey, onClick);
    }
    this.actionsEl.appendChild(btn);
  }

  private addUpgradeAction(label: string, hotkey: string, cost: number, color: string, onClick: () => void, description?: string): void {
    const cant = this.crystals < cost;
    const btn = this.makeButton(`${label} — ${cost} 💎`, color, cant);
    btn.dataset.cost = String(cost);
    if (cant) btn.classList.add('cost-disabled');
    if (description) this.attachTooltip(btn, description);
    if (!cant) {
      btn.addEventListener('click', onClick);
      this.activeHotkeys.set(hotkey, onClick);
    }
    this.actionsEl.appendChild(btn);
  }

  private attachTooltip(btn: HTMLButtonElement, text: string): void {
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let tooltip: HTMLDivElement | null = null;
    btn.style.position = 'relative';
    btn.addEventListener('mouseenter', () => {
      hoverTimer = setTimeout(() => {
        if (tooltip) return;
        tooltip = document.createElement('div');
        tooltip.style.cssText = `
          position:absolute; left:calc(100% + 8px); top:50%; transform:translateY(-50%);
          background:rgba(0,0,0,0.9); border:1px solid #666; border-radius:4px;
          padding:6px 10px; font-size:11px; color:#ccc; white-space:nowrap;
          pointer-events:none; z-index:20;
        `;
        tooltip.textContent = text;
        btn.appendChild(tooltip);
      }, 700);
    });
    btn.addEventListener('mouseleave', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (tooltip) { tooltip.remove(); tooltip = null; }
    });
  }

  private addLabel(text: string, color: string): void {
    const label = document.createElement('div');
    label.style.cssText = `color:${color};font-size:12px;margin-bottom:4px;`;
    label.textContent = text;
    this.actionsEl.appendChild(label);
  }

  // ===================== Queue =====================

  private renderQueue(queueInfo: { baseId: string; slots: { unitType: string; progress: number | null }[]; maxSlots: number }): void {
    this.queueEl.style.display = 'block';
    this.queueEl.innerHTML = '';

    const label = document.createElement('div');
    label.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 6px;';
    label.textContent = 'Training Queue';
    this.queueEl.appendChild(label);

    const slotsRow = document.createElement('div');
    slotsRow.style.cssText = 'display: flex; gap: 4px;';

    // Cancel last hotkey
    if (queueInfo.slots.length > 0) {
      this.activeHotkeys.set('X', () => this.callbacks.onCancelTraining?.(queueInfo.baseId, queueInfo.slots.length - 1));
    }

    for (let i = 0; i < queueInfo.maxSlots; i++) {
      const slot = document.createElement('div');
      const filled = i < queueInfo.slots.length;
      slot.style.cssText = `
        width: 40px; height: 40px;
        border: 2px solid ${filled ? '#888' : '#333'};
        border-radius: 4px;
        background: ${filled ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)'};
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        position: relative; font-size: 10px; color: #ccc;
        cursor: ${filled ? 'pointer' : 'default'};
      `;
      if (filled) {
        const info = queueInfo.slots[i];
        const icon = document.createElement('div');
        const ut = info.unitType;
        icon.textContent = ut === 'foot_soldier' ? 'FS' : ut === 'archer' ? 'AR'
          : ut === 'jeep' ? 'JP' : ut === 'helicopter' ? 'HE'
          : ut?.startsWith('upgrade_') ? 'UP' : 'W';
        const ic = ut === 'foot_soldier' ? '#55ccff' : ut === 'archer' ? '#44dd88'
          : ut === 'jeep' || ut === 'helicopter' ? '#88ff88'
          : ut?.startsWith('upgrade_') ? '#ffcc00' : '#66aaff';
        icon.style.cssText = `font-size: 11px; font-weight: bold; color: ${ic};`;
        slot.appendChild(icon);
        if (i === 0 && info.progress !== null) {
          const progBg = document.createElement('div');
          progBg.style.cssText = 'width: 32px; height: 3px; background: #333; border-radius: 1px; margin-top: 2px;';
          const progFill = document.createElement('div');
          progFill.style.cssText = `width: ${info.progress * 100}%; height: 100%; background: #4c4; border-radius: 1px;`;
          progBg.appendChild(progFill);
          slot.appendChild(progBg);
        }
        const cancelX = document.createElement('div');
        cancelX.textContent = 'x';
        cancelX.style.cssText = 'position:absolute;top:-4px;right:-4px;width:14px;height:14px;background:#c44;color:#fff;border-radius:50%;font-size:10px;line-height:14px;text-align:center;display:none;cursor:pointer;';
        slot.appendChild(cancelX);
        const idx = i;
        slot.addEventListener('mousedown', (e) => e.stopPropagation());
        slot.addEventListener('mouseup', (e) => e.stopPropagation());
        slot.addEventListener('mouseenter', () => { cancelX.style.display = 'block'; slot.style.borderColor = '#c44'; });
        slot.addEventListener('mouseleave', () => { cancelX.style.display = 'none'; slot.style.borderColor = '#888'; });
        slot.addEventListener('click', (e) => { e.stopPropagation(); this.callbacks.onCancelTraining?.(queueInfo.baseId, idx); });
      }
      slotsRow.appendChild(slot);
    }
    this.queueEl.appendChild(slotsRow);
  }

  /** Update button enabled/disabled states in-place without re-rendering (preserves tooltips) */
  private updateButtonStates(): void {
    const buttons = this.actionsEl.querySelectorAll('button[data-cost]');
    buttons.forEach((btn) => {
      const cost = parseInt((btn as HTMLElement).dataset.cost ?? '0');
      const wasDisabled = btn.classList.contains('cost-disabled');
      const shouldDisable = this.crystals < cost;
      if (wasDisabled && !shouldDisable) {
        // Enable the button
        btn.classList.remove('cost-disabled');
        (btn as HTMLElement).style.opacity = '1';
        (btn as HTMLElement).style.cursor = 'pointer';
        (btn as HTMLElement).style.color = '#fff';
        (btn as HTMLElement).style.borderColor = '#666';
        (btn as HTMLElement).style.background = 'rgba(255,255,255,0.1)';
        // Need to re-render to attach click handlers — do a full rebuild
        if (this.lastItem) {
          this.actionsEl.innerHTML = '';
          this.activeHotkeys.clear();
          this.renderActions(this.lastItem, this.lastIsUpgrading);
        }
        return;
      } else if (!wasDisabled && shouldDisable) {
        // Disable — full rebuild to remove click handlers
        if (this.lastItem) {
          this.actionsEl.innerHTML = '';
          this.activeHotkeys.clear();
          this.renderActions(this.lastItem, this.lastIsUpgrading);
        }
        return;
      }
    });
  }

  // ===================== Button Factory =====================

  private makeButton(label: string, hoverColor = '#0f0', disabled = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding: 6px 14px;
      background: rgba(255,255,255,${disabled ? '0.03' : '0.1'});
      color: ${disabled ? '#666' : '#fff'};
      border: 1px solid ${disabled ? '#333' : '#666'};
      border-radius: 4px;
      cursor: ${disabled ? 'not-allowed' : 'pointer'};
      font-size: 13px;
      font-family: system-ui, sans-serif;
      width: 100%;
      margin-bottom: 4px;
      opacity: ${disabled ? '0.5' : '1'};
    `;
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('mouseup', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => e.stopPropagation());
    if (!disabled) {
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = hoverColor; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#666'; });
    }
    return btn;
  }
}
