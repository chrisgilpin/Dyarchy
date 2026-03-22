import * as THREE from 'three';

interface FlameParticle {
  mesh: THREE.Mesh;
  velocity: { x: number; y: number; z: number };
  life: number;
  maxLife: number;
}

const FLAME_GEO = new THREE.SphereGeometry(0.25, 4, 4);

export class FlameEffect {
  private particles: FlameParticle[] = [];
  private scene: THREE.Scene;
  private position: THREE.Vector3;
  private spread: number;
  private baseY: number;
  private intensity = 0;
  private spawnTimer = 0;

  constructor(scene: THREE.Scene, position: THREE.Vector3, spread: number, baseY: number) {
    this.scene = scene;
    this.position = position.clone();
    this.spread = spread;
    this.baseY = baseY;
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  update(dt: number): void {
    // Spawn new particles
    const spawnRate = 5 + this.intensity * 20; // 5–25 particles/sec
    this.spawnTimer += dt;
    const spawnInterval = 1 / spawnRate;
    while (this.spawnTimer >= spawnInterval && this.particles.length < 50) {
      this.spawnTimer -= spawnInterval;
      this.spawnParticle();
    }

    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        p.mesh.geometry === FLAME_GEO || p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }

      const t = p.life / p.maxLife; // 0–1
      // Move upward with drift
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.y += p.velocity.y * dt;
      p.mesh.position.z += p.velocity.z * dt;

      // Shrink and fade
      const scale = 1 - t * 0.7;
      p.mesh.scale.setScalar(scale);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - t;

      // Color: yellow → orange → red
      if (t < 0.4) {
        mat.color.setHex(0xffcc22);
      } else if (t < 0.7) {
        mat.color.setHex(0xff6611);
      } else {
        mat.color.setHex(0xcc2200);
      }
    }
  }

  private spawnParticle(): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc22,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(FLAME_GEO, mat);

    // Distribute flames: 30% top, 50% walls, 20% windows (mid-height wall gaps)
    const roll = Math.random();
    let spawnY: number;
    let offsetX: number;
    let offsetZ: number;
    let velX: number;
    let velZ: number;
    const halfSpread = this.spread * 0.5;

    if (roll < 0.5) {
      // Wall flames: spawn at the building edge, random height
      spawnY = 0.3 + Math.random() * this.baseY * 0.85;
      // Pick a random wall face (N/S/E/W) for boxy buildings
      const face = Math.floor(Math.random() * 4);
      if (face === 0) { offsetX = halfSpread; offsetZ = (Math.random() - 0.5) * this.spread; }
      else if (face === 1) { offsetX = -halfSpread; offsetZ = (Math.random() - 0.5) * this.spread; }
      else if (face === 2) { offsetZ = halfSpread; offsetX = (Math.random() - 0.5) * this.spread; }
      else { offsetZ = -halfSpread; offsetX = (Math.random() - 0.5) * this.spread; }
      // Flames push outward from the wall
      velX = offsetX * 0.8 + (Math.random() - 0.5) * 0.5;
      velZ = offsetZ * 0.8 + (Math.random() - 0.5) * 0.5;
    } else if (roll < 0.8) {
      // Window flames: mid-height, slightly inset from edge, burst outward
      spawnY = this.baseY * 0.3 + Math.random() * this.baseY * 0.4;
      const angle = Math.random() * Math.PI * 2;
      offsetX = Math.cos(angle) * halfSpread * 0.9;
      offsetZ = Math.sin(angle) * halfSpread * 0.9;
      velX = Math.cos(angle) * 2 + (Math.random() - 0.5);
      velZ = Math.sin(angle) * 2 + (Math.random() - 0.5);
    } else {
      // Top/roof flames
      spawnY = this.baseY + Math.random() * 0.5;
      offsetX = (Math.random() - 0.5) * this.spread;
      offsetZ = (Math.random() - 0.5) * this.spread;
      velX = (Math.random() - 0.5) * 1.5;
      velZ = (Math.random() - 0.5) * 1.5;
    }

    mesh.position.set(
      this.position.x + offsetX,
      spawnY,
      this.position.z + offsetZ,
    );
    this.scene.add(mesh);

    this.particles.push({
      mesh,
      velocity: {
        x: velX,
        y: 1.5 + Math.random() * 2,
        z: velZ,
      },
      life: 0,
      maxLife: 0.4 + Math.random() * 0.6,
    });
  }

  destroy(): void {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles.length = 0;
  }
}
