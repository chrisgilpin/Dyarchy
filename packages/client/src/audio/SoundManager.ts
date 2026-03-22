/** Procedural sound effects using Web Audio API with spatial attenuation. Singleton. */
export class SoundManager {
  private static _instance: SoundManager | null = null;
  private audioCtx: AudioContext;
  private masterGain: GainNode;
  private _muted = false;
  private _volume = 0.5;
  private noiseBuffer: AudioBuffer | null = null;
  private lastTowerFireTime = 0;
  private hornBuffers: AudioBuffer[] = [];
  private hornCooldown = 0;

  // Listener position (updated each frame from the active camera)
  private listenerPos = { x: 0, y: 0, z: 0 };
  private isFPSMode = false;

  // FPS: sounds beyond this distance are silent
  private static readonly FPS_MAX_HEAR_RANGE = 60;
  // RTS: sounds beyond this distance from camera center are silent
  private static readonly RTS_MAX_HEAR_RANGE = 80;

  private constructor() {
    this.audioCtx = new AudioContext();
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = this._volume;
    this.masterGain.connect(this.audioCtx.destination);
  }

  static instance(): SoundManager {
    if (!SoundManager._instance) {
      SoundManager._instance = new SoundManager();
    }
    return SoundManager._instance;
  }

  /** Call each frame to update listener position for spatial audio */
  setListenerPosition(x: number, y: number, z: number, fps: boolean): void {
    this.listenerPos = { x, y, z };
    this.isFPSMode = fps;
  }

  /** Calculate volume multiplier based on distance from listener. Returns 0 if too far. */
  private spatialVolume(worldX?: number, worldZ?: number): number {
    if (worldX === undefined || worldZ === undefined) return 1; // no position = full volume (UI sounds)
    const dx = worldX - this.listenerPos.x;
    const dz = worldZ - this.listenerPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const maxRange = this.isFPSMode ? SoundManager.FPS_MAX_HEAR_RANGE : SoundManager.RTS_MAX_HEAR_RANGE;
    if (dist > maxRange) return 0;
    // Linear falloff: full volume at 0, zero at maxRange
    return Math.max(0, 1 - dist / maxRange);
  }

  get muted(): boolean { return this._muted; }

  toggleMute(): void {
    this._muted = !this._muted;
    this.masterGain.gain.value = this._muted ? 0 : this._volume;
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (!this._muted) this.masterGain.gain.value = this._volume;
  }

  private resume(): void {
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }

  // ===================== Gun Sounds (position = FPS player, always full volume for own shots) =====================

  shootPistol(): void {
    this.resume();
    this.playTone('square', 800, 200, 0.08, 0.001, 0.07, 0.3);
    this.playNoise(0.06, 0.001, 0.05, 3000, 'bandpass', 0.2);
  }

  shootRifle(): void {
    this.resume();
    this.playTone('sawtooth', 400, 100, 0.12, 0.001, 0.11, 0.3);
    this.playNoise(0.10, 0.001, 0.09, 2000, 'bandpass', 0.25);
  }

  shootShotgun(): void {
    this.resume();
    this.playTone('square', 200, 60, 0.15, 0.001, 0.14, 0.35);
    this.playNoise(0.18, 0.001, 0.17, 1500, 'lowpass', 0.4);
  }

  bulletImpact(worldX?: number, worldZ?: number): void {
    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return;
    this.resume();
    this.playTone('sine', 1200, 400, 0.05, 0.001, 0.04, 0.15 * sv);
    this.playNoise(0.03, 0.001, 0.025, 4000, 'highpass', 0.1 * sv);
  }

  // ===================== Melee / Unit Combat (spatial) =====================

  private lastMeleeTime = 0;

  /** Fighter sword clash — short metallic clang */
  fighterAttack(worldX?: number, worldZ?: number): void {
    const now = performance.now();
    if (now - this.lastMeleeTime < 200) return; // throttle
    this.lastMeleeTime = now;

    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return;
    this.resume();
    this.playTone('sine', 2000, 800, 0.04, 0.001, 0.035, 0.12 * sv);
    this.playNoise(0.03, 0.001, 0.025, 3000, 'highpass', 0.08 * sv);
  }

  /** Grunt attack — dull thud */
  workerAttack(worldX?: number, worldZ?: number): void {
    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return;
    this.resume();
    this.playTone('sine', 300, 100, 0.06, 0.001, 0.05, 0.12 * sv);
    this.playNoise(0.04, 0.001, 0.035, 800, 'lowpass', 0.08 * sv);
  }

  // ===================== Player Events (always full volume — it's YOU) =====================

  playerDeath(): void {
    this.resume();
    this.playTone('sawtooth', 300, 50, 0.6, 0.01, 0.55, 0.3);
    this.playTone('sine', 150, 30, 0.8, 0.01, 0.75, 0.2);
    this.playNoise(0.5, 0.01, 0.45, 500, 'lowpass', 0.15);
  }

  playerRespawn(): void {
    this.resume();
    const t = this.audioCtx.currentTime;
    this.playToneAt('sine', 400, 800, 0.3, 0.01, 0.25, 0.2, t);
    this.playToneAt('sine', 600, 1200, 0.3, 0.01, 0.22, 0.15, t + 0.05);
    this.playToneAt('triangle', 800, 1600, 0.25, 0.01, 0.12, 0.1, t + 0.1);
  }

  // ===================== Building Events (spatial) =====================

  buildingPlaced(worldX?: number, worldZ?: number): void {
    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return;
    this.resume();
    this.playTone('square', 250, 150, 0.1, 0.001, 0.09, 0.2 * sv);
    this.playNoise(0.08, 0.001, 0.07, 1000, 'bandpass', 0.15 * sv);
  }

  buildingComplete(worldX?: number, worldZ?: number): void {
    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return;
    this.resume();
    const t = this.audioCtx.currentTime;
    this.playToneAt('sine', 523, 523, 0.2, 0.01, 0.18, 0.25 * sv, t);
    this.playToneAt('sine', 659, 659, 0.25, 0.01, 0.22, 0.25 * sv, t + 0.15);
    this.playToneAt('sine', 784, 784, 0.3, 0.01, 0.27, 0.2 * sv, t + 0.25);
  }

  // ===================== Unit Events =====================

  workerSpawned(worldX?: number, worldZ?: number): void {
    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return;
    this.resume();
    this.playTone('sine', 600, 900, 0.1, 0.005, 0.08, 0.2 * sv);
  }

  /** UI sound — always full volume */
  unitSelected(): void {
    this.resume();
    this.playTone('sine', 1000, 1000, 0.04, 0.001, 0.035, 0.12);
    this.playTone('sine', 1500, 1500, 0.03, 0.001, 0.025, 0.08);
  }

  /** UI sound — always full volume */
  unitCommand(): void {
    this.resume();
    this.playTone('triangle', 700, 500, 0.06, 0.001, 0.05, 0.15);
  }

  // ===================== Tower (spatial) =====================

  towerFire(worldX?: number, worldZ?: number): void {
    const now = performance.now();
    if (now - this.lastTowerFireTime < 150) return;
    this.lastTowerFireTime = now;

    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return;
    this.resume();
    this.playTone('sawtooth', 600, 200, 0.1, 0.001, 0.09, 0.2 * sv);
    this.playTone('sine', 1200, 400, 0.08, 0.001, 0.07, 0.1 * sv);
  }

  // ===================== Wave / Game Events (always full volume — global alerts) =====================

  fighterWaveSpawned(): void {
    this.resume();
    this.playTone('sawtooth', 220, 220, 0.4, 0.02, 0.35, 0.2);
    this.playTone('sawtooth', 330, 330, 0.4, 0.02, 0.35, 0.15);
  }

  gameOver(): void {
    this.resume();
    this.playTone('sawtooth', 440, 220, 0.8, 0.02, 0.75, 0.25);
    this.playTone('sawtooth', 330, 165, 0.8, 0.02, 0.75, 0.2);
  }

  victory(): void {
    this.resume();
    const t = this.audioCtx.currentTime;
    this.playToneAt('sine', 523, 523, 0.15, 0.01, 0.12, 0.25, t);
    this.playToneAt('sine', 659, 659, 0.15, 0.01, 0.12, 0.25, t + 0.12);
    this.playToneAt('sine', 784, 784, 0.15, 0.01, 0.12, 0.25, t + 0.24);
    this.playToneAt('sine', 1047, 1047, 0.4, 0.01, 0.35, 0.3, t + 0.36);
  }

  // ===================== Weapon (UI — always full volume) =====================

  weaponSwitch(): void {
    this.resume();
    this.playNoise(0.08, 0.001, 0.07, 2500, 'bandpass', 0.15);
    this.playTone('square', 400, 300, 0.05, 0.001, 0.04, 0.1);
  }

  // ===================== Helpers =====================

  private playTone(
    type: OscillatorType, freqStart: number, freqEnd: number,
    duration: number, attack: number, decay: number, volume: number,
  ): void {
    this.playToneAt(type, freqStart, freqEnd, duration, attack, decay, volume, this.audioCtx.currentTime);
  }

  private playToneAt(
    type: OscillatorType, freqStart: number, freqEnd: number,
    duration: number, attack: number, decay: number, volume: number,
    startTime: number,
  ): void {
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), startTime + duration);
    }

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + attack + decay);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  private playNoise(
    duration: number, attack: number, decay: number,
    filterFreq: number, filterType: BiquadFilterType, volume: number,
  ): void {
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    if (!this.noiseBuffer) {
      const len = ctx.sampleRate * 2;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(t);
    source.stop(t + duration + 0.01);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  // ===================== Horn (audio file samples) =====================

  /** Load horn MP3 samples from URLs. Call once at startup. */
  async loadHornSamples(urls: string[]): Promise<void> {
    const ctx = this.audioCtx;
    const buffers = await Promise.all(
      urls.map(async (url) => {
        const resp = await fetch(url);
        const arrayBuf = await resp.arrayBuffer();
        return ctx.decodeAudioData(arrayBuf);
      }),
    );
    this.hornBuffers = buffers;
  }

  /** Play a random horn sample. Returns true if played, false if on cooldown or no samples. */
  playHorn(worldX?: number, worldZ?: number): boolean {
    if (this.hornBuffers.length === 0) return false;
    if (this.hornCooldown > 0) return false;
    this.resume();
    const sv = this.spatialVolume(worldX, worldZ);
    if (sv <= 0) return false;

    const buf = this.hornBuffers[Math.floor(Math.random() * this.hornBuffers.length)];
    const source = this.audioCtx.createBufferSource();
    source.buffer = buf;
    const gain = this.audioCtx.createGain();
    gain.gain.value = 0.7 * sv;
    source.connect(gain);
    gain.connect(this.masterGain);
    source.start();
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    this.hornCooldown = 0.8; // seconds between honks
    return true;
  }

  /** Call each frame to tick down horn cooldown. */
  tickHornCooldown(dt: number): void {
    if (this.hornCooldown > 0) this.hornCooldown -= dt;
  }
}
