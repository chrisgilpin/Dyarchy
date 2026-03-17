export type BuildingChoice = 'barracks' | 'armory' | 'tower';

export interface BuildPanelCallbacks {
  onSelect: (building: BuildingChoice) => void;
  onCancel: () => void;
}

export const BUILDING_COSTS: Record<BuildingChoice, number> = {
  barracks: 25,
  armory: 300,
  tower: 150,
};

const BUILDING_INFO: Record<BuildingChoice, { label: string; cost: number; key: string }> = {
  barracks: { label: 'Barracks', cost: 25, key: '1' },
  armory: { label: 'Armory', cost: 300, key: '2' },
  tower: { label: 'Tower', cost: 150, key: '3' },
};

export class BuildPanel {
  private readonly el: HTMLDivElement;
  private callbacks: BuildPanelCallbacks | null = null;
  private activeBuilding: BuildingChoice | null = null;
  private crystals = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'build-panel';
    this.el.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: none;
      gap: 10px;
      z-index: 15;
      font-family: system-ui, sans-serif;
    `;

    for (const [type, info] of Object.entries(BUILDING_INFO) as [BuildingChoice, typeof BUILDING_INFO[BuildingChoice]][]) {
      const btn = document.createElement('button');
      btn.dataset.building = type;
      btn.innerHTML = `<strong>${info.label}</strong><br><small>${info.cost} crystals [${info.key}]</small>`;
      btn.style.cssText = `
        padding: 10px 16px;
        background: rgba(0,0,0,0.7);
        color: #fff;
        border: 2px solid #555;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        min-width: 100px;
      `;
      // Stop propagation so document-level handlers (Selection, onClickPlace) don't fire
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('mouseup', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.selectBuilding(type); });
      btn.addEventListener('mouseenter', () => {
        if (!btn.classList.contains('disabled')) btn.style.borderColor = '#0f0';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = this.activeBuilding === type ? '#0f0' : '#555';
      });
      this.el.appendChild(btn);
    }

    document.body.appendChild(this.el);
  }

  enable(callbacks: BuildPanelCallbacks): void {
    this.callbacks = callbacks;
    this.el.style.display = 'flex';
    document.addEventListener('keydown', this.onKeyDown);
    this.updateButtonStyles();
  }

  disable(): void {
    this.el.style.display = 'none';
    this.callbacks = null;
    this.activeBuilding = null;
    document.removeEventListener('keydown', this.onKeyDown);
  }

  show(): void {
    this.el.style.display = 'flex';
    this.updateButtonStyles();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  getActiveBuilding(): BuildingChoice | null {
    return this.activeBuilding;
  }

  clearActive(): void {
    this.activeBuilding = null;
    this.updateButtonStyles();
  }

  setCrystals(amount: number): void {
    this.crystals = amount;
    this.updateButtonStyles();
  }

  private selectBuilding(type: BuildingChoice): void {
    if (this.crystals < BUILDING_COSTS[type]) return;

    if (this.activeBuilding === type) {
      this.activeBuilding = null;
      this.callbacks?.onCancel();
    } else {
      this.activeBuilding = type;
      this.callbacks?.onSelect(type);
    }
    this.updateButtonStyles();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'Digit1': this.selectBuilding('barracks'); break;
      case 'Digit2': this.selectBuilding('armory'); break;
      case 'Digit3': this.selectBuilding('tower'); break;
      case 'Escape':
        if (this.activeBuilding) {
          this.activeBuilding = null;
          this.callbacks?.onCancel();
          this.updateButtonStyles();
        }
        break;
    }
  };

  private updateButtonStyles(): void {
    for (const btn of this.el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>) {
      const type = btn.dataset.building as BuildingChoice;
      const canAfford = this.crystals >= BUILDING_COSTS[type];
      const isActive = this.activeBuilding === type;

      btn.style.borderColor = isActive ? '#0f0' : '#555';
      btn.style.opacity = canAfford ? '1' : '0.4';
      btn.style.cursor = canAfford ? 'pointer' : 'not-allowed';
      btn.classList.toggle('disabled', !canAfford);
    }
  }
}
