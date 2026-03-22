import type { Selectable } from './Selection.js';

export interface InfoPanelCallbacks {
  onTrainWorker?: () => void;
  onCancelTraining?: (baseId: string, index: number) => void;
  onUpgradeBase?: () => void;
  onUpgradeArmory?: () => void;
  onTrainFootSoldier?: (barracksId: string) => void;
  onUpgradeBarracks?: (barracksId: string) => void;
  onUpgradeTower?: (towerId: string) => void;
  onUpgradeTowerDual?: (towerId: string) => void;
  onTrainArcher?: (barracksId: string) => void;
  onTrainJeep?: (garageId: string) => void;
  onTrainHelicopter?: (garageId: string) => void;
  onUpgradeHarvest?: () => void;
}

export class InfoPanel {
  private readonly el: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly hpBarFill: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;
  private readonly queueEl: HTMLDivElement;
  private callbacks: InfoPanelCallbacks = {};
  baseUpgraded = false;
  harvestBoosted = false;
  armoryLevel2 = false;
  armoryRocketUpgrade = false;
  localTeamId: 1 | 2 = 1;
  barracksLevels: Map<string, number> = new Map();
  towerLevels: Map<string, number> = new Map();
  towerDualGuns: Set<string> = new Set();
  crystals = 0;

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

    if (items.length === 1) {
      const item = items[0];
      this.nameEl.textContent = item.entityType === 'resource_node'
        ? `Crystal Field (${Math.ceil(item.hp)} / ${item.maxHp} remaining)`
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

      // Actions for main base
      if (item.entityType === 'main_base' && item.teamId === this.localTeamId && item.status === 'active') {
        this.actionsEl.style.display = 'block';

        if (isUpgrading) {
          const msg = document.createElement('div');
          msg.style.cssText = 'color:#ffcc00;font-size:12px;margin-top:4px;';
          msg.textContent = 'Upgrading in progress — training disabled';
          this.actionsEl.appendChild(msg);
        } else {
          const cantTrain = this.crystals < 100;
          const trainBtn = this.makeButton('Train Worker [G] — 100 crystals', '#0f0', cantTrain);
          if (!cantTrain) trainBtn.addEventListener('click', () => this.callbacks.onTrainWorker?.());
          this.actionsEl.appendChild(trainBtn);

          if (!this.baseUpgraded) {
            const cantUpgrade = this.crystals < 1000;
            const upgradeBtn = this.makeButton('Upgrade HQ to Tier 2 [U] — 1000 crystals', '#ff0', cantUpgrade);
            if (!cantUpgrade) upgradeBtn.addEventListener('click', () => this.callbacks.onUpgradeBase?.());
            this.actionsEl.appendChild(upgradeBtn);
          } else {
            const label = document.createElement('div');
            label.style.cssText = 'color:#0f0;font-size:12px;margin-top:4px;';
            label.textContent = 'HQ Tier 2 — Turrets unlocked';
            this.actionsEl.appendChild(label);
          }

          if (!this.harvestBoosted) {
            const cantHarvest = this.crystals < 400;
            const harvestBtn = this.makeButton('Crystal Boost [H] — 400 crystals\n2x worker harvest rate', '#0ff', cantHarvest);
            if (!cantHarvest) harvestBtn.addEventListener('click', () => this.callbacks.onUpgradeHarvest?.());
            this.actionsEl.appendChild(harvestBtn);
          } else {
            const label = document.createElement('div');
            label.style.cssText = 'color:#0ff;font-size:12px;margin-top:4px;';
            label.textContent = 'Crystal Boost active — 2x harvest rate';
            this.actionsEl.appendChild(label);
          }
        }
      }

      // Actions for armory
      if (item.entityType === 'armory' && item.teamId === this.localTeamId && item.status === 'active') {
        this.actionsEl.style.display = 'block';
        if (isUpgrading) {
          const msg = document.createElement('div');
          msg.style.cssText = 'color:#ffcc00;font-size:12px;margin-top:4px;';
          msg.textContent = 'Upgrading in progress...';
          this.actionsEl.appendChild(msg);
        } else if (!this.armoryLevel2) {
          const cantUpgradeA = this.crystals < 500;
          const upgradeBtn = this.makeButton('Upgrade to Level 2 — 500 crystals', '#ff0', cantUpgradeA);
          if (!cantUpgradeA) upgradeBtn.addEventListener('click', () => this.callbacks.onUpgradeArmory?.());
          this.actionsEl.appendChild(upgradeBtn);
        } else if (!this.armoryRocketUpgrade) {
          const label = document.createElement('div');
          label.style.cssText = 'color:#0f0;font-size:12px;margin-top:4px;';
          label.textContent = 'Level 2 — Rocket Launcher unlocked';
          this.actionsEl.appendChild(label);

          const cantUpgradeR = this.crystals < 400;
          const rocketBtn = this.makeButton('Upgrade Rockets — 400 crystals\n-50% cooldown', '#ff0', cantUpgradeR);
          if (!cantUpgradeR) rocketBtn.addEventListener('click', () => this.callbacks.onUpgradeArmory?.());
          this.actionsEl.appendChild(rocketBtn);
        } else {
          const label = document.createElement('div');
          label.style.cssText = 'color:#0f0;font-size:12px;margin-top:4px;';
          label.textContent = 'Fully upgraded — Rockets enhanced';
          this.actionsEl.appendChild(label);
        }
      }

      // Actions for barracks
      if (item.entityType === 'barracks' && item.teamId === this.localTeamId && item.status === 'active') {
        this.actionsEl.style.display = 'block';
        if (isUpgrading) {
          const msg = document.createElement('div');
          msg.style.cssText = 'color:#ffcc00;font-size:12px;margin-top:4px;';
          msg.textContent = 'Upgrading in progress — training disabled';
          this.actionsEl.appendChild(msg);
        } else {
          const level = this.barracksLevels.get(item.id) ?? 1;

          // Foot Soldiers — available at tier 1
          const cantTrainFS = this.crystals < 100;
          const trainFSBtn = this.makeButton('Train Foot Soldier [F] — 100 crystals', '#0f0', cantTrainFS);
          if (!cantTrainFS) trainFSBtn.addEventListener('click', () => this.callbacks.onTrainFootSoldier?.(item.id));
          this.actionsEl.appendChild(trainFSBtn);

          if (level < 2) {
            // Upgrade to tier 2
            const cantUpgradeB = this.crystals < 500;
            const upgradeBtn = this.makeButton('Upgrade to Tier 2 [U] — 500 crystals\nUnlocks Archers', '#ff0', cantUpgradeB);
            if (!cantUpgradeB) upgradeBtn.addEventListener('click', () => this.callbacks.onUpgradeBarracks?.(item.id));
            this.actionsEl.appendChild(upgradeBtn);
          } else {
            const label = document.createElement('div');
            label.style.cssText = 'color:#0f0;font-size:12px;margin-top:2px;';
            label.textContent = 'Tier 2 — Archers unlocked';
            this.actionsEl.appendChild(label);

            // Archers — available at tier 2
            const cantTrainArch = this.crystals < 150;
            const trainArchBtn = this.makeButton('Train Archer [A] — 150 crystals', '#44dd88', cantTrainArch);
            if (!cantTrainArch) trainArchBtn.addEventListener('click', () => this.callbacks.onTrainArcher?.(item.id));
            this.actionsEl.appendChild(trainArchBtn);
          }
        }
      }

      // Actions for garage
      if (item.entityType === 'garage' && item.teamId === this.localTeamId && item.status === 'active') {
        this.actionsEl.style.display = 'block';
        const cantTrainJeep = this.crystals < 500;
        const trainBtn = this.makeButton('Train Jeep [J] — 500 crystals (3 supply)', '#0f0', cantTrainJeep);
        if (!cantTrainJeep) trainBtn.addEventListener('click', () => this.callbacks.onTrainJeep?.(item.id));
        this.actionsEl.appendChild(trainBtn);

        const cantTrainHeli = this.crystals < 400;
        const heliBtn = this.makeButton('Train Helicopter [H] — 400 crystals (3 supply)', '#0f0', cantTrainHeli);
        if (!cantTrainHeli) heliBtn.addEventListener('click', () => this.callbacks.onTrainHelicopter?.(item.id));
        this.actionsEl.appendChild(heliBtn);
      }

      // Actions for towers/turrets
      const TOWER_TYPES = new Set(['tower', 'player_tower', 'turret']);
      if (TOWER_TYPES.has(item.entityType) && item.teamId === this.localTeamId && item.status === 'active') {
        this.actionsEl.style.display = 'block';
        const towerLevel = this.towerLevels?.get(item.id) ?? 1;
        if (isUpgrading) {
          const msg = document.createElement('div');
          msg.style.cssText = 'color:#ffcc00;font-size:12px;margin-top:4px;';
          msg.textContent = 'Upgrading in progress...';
          this.actionsEl.appendChild(msg);
        } else {
          // Level info
          if (towerLevel > 1) {
            const lvlLabel = document.createElement('div');
            lvlLabel.style.cssText = 'color:#0f0;font-size:12px;margin-bottom:4px;';
            lvlLabel.textContent = `Level ${towerLevel}${towerLevel >= 3 ? ' (MAX)' : ''}`;
            this.actionsEl.appendChild(lvlLabel);
          }

          // Level upgrade button (up to level 3)
          if (towerLevel < 3) {
            const cost = towerLevel >= 2 ? 500 : 300;
            const bonus = towerLevel >= 2 ? '+100% range & damage' : '+20% range & damage';
            const cantUp = this.crystals < cost;
            const upBtn = this.makeButton(`Upgrade to Lv.${towerLevel + 1} [U] — ${cost} crystals\n${bonus}`, '#ff0', cantUp);
            if (!cantUp) upBtn.addEventListener('click', () => this.callbacks.onUpgradeTower?.(item.id));
            this.actionsEl.appendChild(upBtn);
          }

          // Dual gun upgrade (300 crystals, one-time)
          const hasDualGun = this.towerDualGuns?.has(item.id) ?? false;
          if (!hasDualGun) {
            const cantDual = this.crystals < 300;
            const dualBtn = this.makeButton('Add 2nd Gun — 300 crystals\nTargets 2 enemies', '#0ff', cantDual);
            if (!cantDual) dualBtn.addEventListener('click', () => this.callbacks.onUpgradeTowerDual?.(item.id));
            this.actionsEl.appendChild(dualBtn);
          } else {
            const dualLabel = document.createElement('div');
            dualLabel.style.cssText = 'color:#0ff;font-size:12px;margin-top:2px;';
            dualLabel.textContent = 'Dual guns active';
            this.actionsEl.appendChild(dualLabel);
          }
        }
      }

      // Queue display
      if (queueInfo) {
        this.queueEl.style.display = 'block';

        const label = document.createElement('div');
        label.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 6px;';
        label.textContent = 'Training Queue';
        this.queueEl.appendChild(label);

        const slotsRow = document.createElement('div');
        slotsRow.style.cssText = 'display: flex; gap: 4px;';

        for (let i = 0; i < queueInfo.maxSlots; i++) {
          const slot = document.createElement('div');
          const filled = i < queueInfo.slots.length;

          slot.style.cssText = `
            width: 40px;
            height: 40px;
            border: 2px solid ${filled ? '#888' : '#333'};
            border-radius: 4px;
            background: ${filled ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)'};
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
            cursor: ${filled ? 'pointer' : 'default'};
            font-size: 10px;
            color: #ccc;
          `;

          if (filled) {
            const info = queueInfo.slots[i];

            // Unit icon text — varies by unit type
            const iconText = document.createElement('div');
            const ut = info.unitType;
            iconText.textContent = ut === 'foot_soldier' ? 'FS' : ut?.startsWith('upgrade_') ? 'UP' : 'G';
            const iconColor = ut === 'foot_soldier' ? '#55ccff' : ut?.startsWith('upgrade_') ? '#ffcc00' : '#66aaff';
            iconText.style.cssText = `font-size: ${ut === 'foot_soldier' ? '11' : '14'}px; font-weight: bold; color: ${iconColor};`;
            slot.appendChild(iconText);

            // Progress bar for the first slot
            if (i === 0 && info.progress !== null) {
              const progBg = document.createElement('div');
              progBg.style.cssText = 'width: 32px; height: 3px; background: #333; border-radius: 1px; margin-top: 2px;';
              const progFill = document.createElement('div');
              progFill.style.cssText = `width: ${info.progress * 100}%; height: 100%; background: #4c4; border-radius: 1px;`;
              progBg.appendChild(progFill);
              slot.appendChild(progBg);
            }

            // Cancel X on hover
            const cancelX = document.createElement('div');
            cancelX.textContent = 'x';
            cancelX.style.cssText = `
              position: absolute;
              top: -4px; right: -4px;
              width: 14px; height: 14px;
              background: #c44;
              color: #fff;
              border-radius: 50%;
              font-size: 10px;
              line-height: 14px;
              text-align: center;
              display: none;
              cursor: pointer;
            `;
            slot.appendChild(cancelX);

            const idx = i;
            slot.addEventListener('mousedown', (e) => e.stopPropagation());
            slot.addEventListener('mouseup', (e) => e.stopPropagation());
            slot.addEventListener('mouseenter', () => {
              cancelX.style.display = 'block';
              slot.style.borderColor = '#c44';
            });
            slot.addEventListener('mouseleave', () => {
              cancelX.style.display = 'none';
              slot.style.borderColor = '#888';
            });
            slot.addEventListener('click', (e) => { e.stopPropagation();
              this.callbacks.onCancelTraining?.(queueInfo.baseId, idx);
            });
          }

          slotsRow.appendChild(slot);
        }

        this.queueEl.appendChild(slotsRow);
      }
    } else {
      this.nameEl.textContent = `${items.length} units selected`;
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
  }

  /** Lightweight per-frame refresh of HP bar and construction status for the currently shown item.
   *  Returns true if the panel needs a full rebuild (e.g. building just completed). */
  refreshStats(item: Selectable): boolean {
    if (this.el.style.display === 'none') return false;
    const pct = Math.max(0, Math.min(100, (item.hp / item.maxHp) * 100));
    this.hpBarFill.style.width = pct + '%';
    this.hpBarFill.style.background = pct > 50 ? '#4c4' : pct > 25 ? '#cc4' : '#c44';
    this.hpText.textContent = `${Math.ceil(item.hp)} / ${item.maxHp}`;

    if (item.entityType === 'resource_node') {
      this.nameEl.textContent = `Crystal Field (${Math.ceil(item.hp)} / ${item.maxHp} remaining)`;
    }

    if (item.status === 'constructing') {
      const buildPct = Math.round(item.constructionProgress * 100);
      this.statusEl.textContent = `Building... ${buildPct}%`;
      this.statusEl.style.display = 'block';
      this.lastShownStatus = 'constructing';
    } else if (this.lastShownStatus === 'constructing') {
      // Building just finished — needs full rebuild to show action buttons
      this.lastShownStatus = 'active';
      return true;
    }
    return false;
  }
  private lastShownStatus: string = '';

  /** Get the status text element for direct updates (avoids rebuilding buttons) */
  getStatusElement(): HTMLDivElement {
    return this.statusEl;
  }

  getNameElement(): HTMLDivElement {
    return this.nameEl;
  }

  /** Update just the queue display without rebuilding buttons */
  updateQueue(queueInfo: { baseId: string; slots: { unitType: string; progress: number | null }[]; maxSlots: number }): void {
    this.queueEl.innerHTML = '';
    if (queueInfo.slots.length === 0) {
      this.queueEl.style.display = 'none';
      return;
    }
    this.queueEl.style.display = 'block';

    const label = document.createElement('div');
    label.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 6px;';
    label.textContent = 'Training Queue';
    this.queueEl.appendChild(label);

    const slotsRow = document.createElement('div');
    slotsRow.style.cssText = 'display: flex; gap: 4px;';

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
        const ut2 = info.unitType;
        icon.textContent = ut2 === 'foot_soldier' ? 'FS' : ut2?.startsWith('upgrade_') ? 'UP' : 'G';
        const ic2 = ut2 === 'foot_soldier' ? '#55ccff' : ut2?.startsWith('upgrade_') ? '#ffcc00' : '#66aaff';
        icon.style.cssText = `font-size: ${ut2 === 'foot_soldier' ? '11' : '14'}px; font-weight: bold; color: ${ic2};`;
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
    // Stop propagation so document-level handlers don't fire
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
