import type { RTSController } from './RTSController.js';
import type { RTSTouchHandler } from './RTSTouchHandler.js';

const BTN_STYLE = `
  display:flex;align-items:center;justify-content:center;
  width:44px;height:44px;border-radius:8px;
  background:rgba(0,0,0,0.7);color:#fff;
  border:2px solid #555;font-size:13px;font-weight:bold;
  font-family:system-ui,sans-serif;cursor:pointer;
  touch-action:none;user-select:none;
`;

export class RTSMobileHUD {
  private container: HTMLDivElement;
  private multiSelectBtn: HTMLDivElement;
  private cancelBtn: HTMLDivElement;
  private multiSelect = false;

  constructor(
    private controller: RTSController,
    private touchHandler: RTSTouchHandler,
  ) {
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;';

    // Multi-select toggle (top-right)
    this.multiSelectBtn = document.createElement('div');
    this.multiSelectBtn.style.cssText = BTN_STYLE + 'position:absolute;top:60px;right:12px;pointer-events:auto;width:auto;padding:0 12px;';
    this.multiSelectBtn.textContent = 'MULTI';
    this.multiSelectBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.multiSelect = !this.multiSelect;
      this.multiSelectBtn.style.borderColor = this.multiSelect ? '#0f0' : '#555';
      this.touchHandler.multiSelectMode = this.multiSelect;
    });
    this.container.appendChild(this.multiSelectBtn);

    // Cancel placement button (top-left, hidden by default)
    this.cancelBtn = document.createElement('div');
    this.cancelBtn.style.cssText = BTN_STYLE + 'position:absolute;top:60px;left:12px;pointer-events:auto;';
    this.cancelBtn.textContent = '✕';
    this.cancelBtn.style.display = 'none';
    this.cancelBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.controller.publicCancelPlacement();
      this.cancelBtn.style.display = 'none';
    });
    this.container.appendChild(this.cancelBtn);

    document.body.appendChild(this.container);
  }

  /** Call each frame to update button visibility. */
  update(): void {
    const building = this.controller.getActiveBuildType();
    this.cancelBtn.style.display = building ? 'flex' : 'none';
  }

  show(): void { this.container.style.display = 'block'; }
  hide(): void { this.container.style.display = 'none'; }

  destroy(): void {
    this.container.remove();
  }
}
