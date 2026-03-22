# Dyarchy - Game Overview

## What is Dyarchy?

Dyarchy is a browser-based 2v2 multiplayer game that combines first-person shooter (FPS) and real-time strategy (RTS) gameplay. Each team of two players splits responsibilities: one player fights on the ground as an FPS soldier, while the other commands an army and builds a base from an overhead RTS view. Both roles are essential — the FPS player provides direct firepower while the RTS player manages the economy, builds defenses, and trains reinforcements.

## How to Win

A team wins by **destroying all of the enemy team's buildings** — their main base (HQ) and both starting towers. As long as the enemy has any building standing, the game continues.

## Teams & Roles

- **2 teams**: Blue (Team 1) and Red (Team 2)
- **2 roles per team**: FPS and RTS
- Players can swap roles mid-game (solo players swap freely; duo teams require mutual agreement)

---

## Starting State (Per Team)

| Resource | Starting Value |
|----------|---------------|
| Crystals | 1,000 |
| Supply | 2 / 10 (2 workers deployed) |
| Buildings | 1 HQ + 2 Towers |
| Units | 2 Workers |

---

## The FPS Role

The FPS player is a first-person shooter on the battlefield. They can fight enemy units, capture key positions, enter vehicles, and use an armory to equip weapons.

### FPS Player Stats

| Stat | Value |
|------|-------|
| Max HP | 100 |
| Movement Speed | 12 units/sec |
| Jump Velocity | 10 units/sec |
| Player Height | 1.5 units |
| Respawn Time | 7 seconds |
| Respawn Location | Team HQ |

### FPS Weapons

The FPS player always has a **Pistol** as their primary weapon. A secondary weapon can be chosen at the Armory building (press E when nearby).

| Weapon | Slot | Damage | Fire Rate | Range | Spread | Pellets | Unlock |
|--------|------|--------|-----------|-------|--------|---------|--------|
| Pistol | Primary | 8 | 4/sec | 100 | 0.02 | 1 | Always available |
| Rifle | Secondary | 15 | 3/sec | 200 | 0.01 | 1 | Armory built |
| Shotgun | Secondary | 8 per pellet | 1/sec | 30 | 0.08 | 6 | Armory built |
| Rocket Launcher | Secondary | 80 (splash) | 1 per 20s | 150 | 0.005 | 1 | Armory Level 2 |
| Sniper Rifle | Secondary | 40 | 1 per 3s | 500 | 0 (perfect) | 1 | Armory Level 2 |

**Notes:**
- Shotgun fires 6 pellets per shot (max 48 damage at point blank)
- Rocket Launcher fires a projectile that explodes on contact with terrain, buildings, or units, dealing splash damage in a 10-unit radius with linear falloff
- Sniper Rifle has a scope (right-click to toggle) with perfect accuracy at any range
- On death, the player respawns with only the Pistol — secondary weapon must be re-equipped at the Armory

### FPS Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Space | Jump |
| Left Click | Shoot |
| Right Click | Toggle sniper scope |
| Q | Swap primary/secondary weapon |
| 1 / 2 | Switch to primary / secondary |
| E | Enter/exit vehicle, use armory, climb sniper nest |
| F | Honk horn (in vehicle, driver only) |
| Tab | Request role swap with teammate |
| M | Mute/unmute audio |

---

## The RTS Role

The RTS player has an overhead view of the battlefield. They manage the economy by directing workers to harvest crystals, build structures, train units, and research upgrades. They command all ground units (except autonomous wave fighters).

### RTS Controls

| Input | Action |
|-------|--------|
| Left Click | Select unit/building |
| Double Click | Select all nearby same-type units |
| Drag Box | Select multiple units |
| Right Click | Move / Attack / Harvest (context-sensitive) |
| Shift + Place | Queue multiple buildings for a worker |
| G | Train Worker (with HQ selected) |
| H | Crystal Boost upgrade (with HQ selected) |
| U | Upgrade building |
| F | Train Foot Soldier (with Barracks selected) |
| A | Train Archer (with Barracks selected) |
| X | Cancel last training queue item |
| 1-7 | Select building type to place |
| Ctrl+1-9 | Assign control group |
| 1-9 | Recall control group |
| Escape | Cancel building placement |

---

## Units

### Autonomous Wave Fighters

Every **30 seconds**, each team automatically spawns **10 fighters** (max 30 per team on the map). These are AI-controlled — the RTS player cannot command them. Fighters march toward enemy towers and the HQ, engaging any enemy units they encounter along the way.

Fighters scale over time: every 2 minutes, they gain **+15% HP** and **+10% speed**.

### Trainable Units

| Unit | HP | Cost | Train Time | Supply | Speed | Damage | Attack Rate | Range | Trained From |
|------|-----|------|------------|--------|-------|--------|-------------|-------|-------------|
| Worker | 50 | 100 | 3s | 1 | 8 | 1 | 2.0s | 2.8 (melee) | HQ |
| Foot Soldier | 60 | 100 | 5s | 1 | 6 | 8 | 0.8s | 2.8 (melee) | Barracks |
| Archer | 40 | 150 | 6s | 1 | 5 | 12 | 1.5s | 25 (ranged) | Barracks Lv2 |
| Jeep | 200 | 500 | 10s | 3 | 35 max | Speed-based | Collision | Vehicle | Garage |

### Wave Fighters (AI-Controlled)

| Stat | Value |
|------|-------|
| HP | 30 (scales +15% per 2 min) |
| Speed | 5 (scales +10% per 2 min) |
| Damage vs Units | 5 |
| Damage vs Buildings | 1 |
| Attack Rate | 1.0s |
| Range | 2.8 (melee) |
| Aggro Range | 12 |

### Workers

Workers are the backbone of the economy. They harvest crystals from resource nodes (8 nodes on the map, each with 3,000 HP worth of crystals). Each harvest trip takes **5 seconds** and yields **10 crystals** (20 with Crystal Boost upgrade). Workers can also build structures and repair damaged buildings.

### Jeep (Vehicle)

The Jeep is a drivable vehicle with two seats:
- **Driver**: Controls movement. Can honk horn (F key). Steers toward camera direction.
- **Gunner**: Can shoot from an elevated position.

Jeeps deal collision damage based on speed — at max speed (35), they instantly kill infantry. The FPS player enters by pressing E near a friendly jeep. When the jeep is destroyed, it deals **60 splash damage** in a 12-unit radius with linear falloff.

Players inside a jeep take only 20% of incoming damage (the jeep absorbs the rest). If the FPS player dies inside a jeep, they respawn at HQ (not back in the jeep).

---

## Buildings

| Building | Cost | HP | Build Time | Function |
|----------|------|-----|------------|----------|
| HQ (Main Base) | — | 100 | Starting | Trains workers, researches upgrades. Has turret (43.75 range). |
| Tower | — | 400 | Starting | Defensive turret. 2 per team at game start. |
| Farm | 24 | 100 | 10s | Adds +5 supply cap |
| Barracks | 150 | 100 | 10s | Trains Foot Soldiers; Archers at Level 2 |
| Armory | 300 | 100 | 10s | Unlocks secondary weapons for FPS player |
| Turret | 200 | 100 | 10s | Defensive turret (requires HQ Tier 2) |
| Sniper Nest | 250 | 100 | 10s | 9.5-unit elevated platform for FPS player |
| Garage | 300 | 100 | 20s | Trains Jeeps (requires HQ Tier 2) |
| Player Tower | 500 | 100 | 10s | Defensive turret (same as Tower) |

### Tower/Turret Combat Stats

| Stat | Tower | Player Tower | Turret (Building) | HQ Turret |
|------|-------|-------------|-------------------|-----------|
| Range | 25 | 25 | 25 | 43.75 (75% bonus) |
| Damage | 40 | 4 (10%) | 80 (2x) | 40 |
| Fire Rate | 1.5s | 1.5s | 3.0s | 1.5s |
| Hit Chance | 50% | 50% | 50% | 50% |

All tower-type buildings prioritize targeting enemy FPS players within 30 units.

---

## Tech Tree

```
HQ (Main Base)
├── Train Workers (100 crystals, 1 supply)
├── Crystal Boost Upgrade (400 crystals) → 2x worker harvest rate
├── HQ Tier 2 Upgrade (1,000 crystals) → Unlocks Turrets & Garages
│   ├── Turret (200 crystals) → Defensive tower
│   └── Garage (300 crystals) → Trains Jeeps (500 crystals, 3 supply)
├── Global Tower Upgrade Lv2 (400 crystals) → All towers +20% dmg/range, 2x HP
└── Global Tower Upgrade Lv3 (800 crystals) → All towers +100% dmg, 2x range

Farm (24 crystals)
└── +5 Supply Cap (stackable)

Barracks (150 crystals)
├── Train Foot Soldiers (100 crystals, 1 supply)
└── Barracks Lv2 Upgrade (500 crystals) → Unlocks Archers
    └── Train Archers (150 crystals, 1 supply)

Armory (300 crystals)
├── FPS Weapons: Rifle, Shotgun (available immediately)
├── Armory Lv2 Upgrade (500 crystals) → Unlocks Rocket Launcher, Sniper Rifle
└── Rocket Upgrade (400 crystals) → Reduced Rocket Launcher cooldown

Individual Tower Upgrades:
├── Tower Lv2 (300 crystals) → 2x HP, +20% damage/range
├── Tower Lv3 (500 crystals) → +100% damage, 2x range
└── Dual Gun (300 crystals) → Tower fires at 2 targets

Sniper Nest (250 crystals)
└── Elevated FPS platform (no upgrades)
```

## Upgrades Summary

| Upgrade | Building | Cost | Duration | Effect |
|---------|----------|------|----------|--------|
| Crystal Boost | HQ | 400 | 8s | Workers collect 2x crystals (20 per trip) |
| HQ Tier 2 | HQ | 1,000 | 10s | Unlocks Turret and Garage buildings |
| Barracks Lv2 | Barracks | 500 | 10s | Unlocks Archer training |
| Armory Lv2 | Armory | 500 | 10s | Unlocks Rocket Launcher and Sniper Rifle |
| Rocket Upgrade | Armory Lv3 | 400 | 10s | Reduces Rocket Launcher cooldown by 50% |
| Tower Lv2 (individual) | Tower | 300 | 10s | 2x HP, +20% damage and range |
| Tower Lv3 (individual) | Tower | 500 | 10s | +100% damage, 2x range |
| Tower Dual Gun | Tower | 300 | Instant | Fires at 2 separate targets |
| Global Tower Lv2 | HQ | 400 | Instant | All towers upgraded to Lv2 |
| Global Tower Lv3 | HQ | 800 | Instant | All towers upgraded to Lv3 |

---

## Supply System

Each unit costs supply to maintain. The supply cap starts at **10** and increases by **5** per Farm built.

| Unit | Supply Cost |
|------|-------------|
| Worker | 1 |
| Foot Soldier | 1 |
| Archer | 1 |
| Jeep | 3 |

Wave fighters do **not** cost supply.

---

## Economy

### Crystal Income
- Workers harvest from crystal nodes scattered across the map
- Each trip: 5 seconds of harvesting, then return to base to deposit
- Base yield: **10 crystals per trip** (20 with Crystal Boost)
- Crystal nodes have 3,000 HP — each harvest depletes them by the amount collected
- 8 crystal nodes on Meadow map (6 near bases, 2 high-value center nodes)

### Crystal Expenses
Buildings, units, and upgrades all cost crystals. Balancing economy (workers + farms) against military spending is the core strategic tension.

---

## Maps

### Meadow (Default)
- **Size**: 240 x 150 units
- Rolling green hills with gentle elevation (max ~2.5 units)
- Flat center arena for FPS combat
- 6 obstacles for cover in the center
- 8 crystal nodes

### Frostpeak
- **Size**: 360 x 225 units (50% larger)
- Dramatic mountain terrain with steep elevation changes (up to 45 units)
- Larger distances between bases
- 10 crystal nodes, 10 obstacles

---

## Game Flow

1. **Early Game (0-2 min)**: Build Farms for supply, train Workers for economy, build Barracks. FPS player fights with Pistol. First fighter wave at 30 seconds.
2. **Mid Game (2-5 min)**: Build Armory for FPS weapon upgrades. Train Foot Soldiers/Archers. Upgrade HQ to Tier 2 for Turrets and Garage. Push with combined army + FPS.
3. **Late Game (5+ min)**: Fighter waves scale increasingly strong. Upgrade towers to Level 3. Build Jeeps. FPS player uses Rocket Launcher or Sniper Rifle. Push to destroy enemy buildings.

The game ends when one team loses all their buildings (HQ + both towers). There is no time limit.
