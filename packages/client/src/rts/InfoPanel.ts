import type { Selectable } from './Selection.js';

export interface InfoPanelCallbacks {
  onTrainGrunt?: () => void;
  onCancelTraining?: (baseId: string, index: number) => void;
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
      this.nameEl.textContent = item.name;

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
      if (item.entityType === 'main_base' && item.teamId === 1 && item.status === 'active') {
        this.actionsEl.style.display = 'block';

        const trainBtn = this.makeButton('Train Grunt [G]');
        trainBtn.addEventListener('click', () => this.callbacks.onTrainGrunt?.());
        this.actionsEl.appendChild(trainBtn);
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

            // Unit icon text
            const iconText = document.createElement('div');
            iconText.textContent = 'G';
            iconText.style.cssText = 'font-size: 14px; font-weight: bold; color: #66aaff;';
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

  private makeButton(label: string, hoverColor = '#0f0'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding: 6px 14px;
      background: rgba(255,255,255,0.1);
      color: #fff;
      border: 1px solid #666;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      width: 100%;
      margin-bottom: 4px;
    `;
    // Stop propagation so document-level handlers don't fire
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('mouseup', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => e.stopPropagation());
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = hoverColor; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#666'; });
    return btn;
  }
}
