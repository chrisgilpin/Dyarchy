import type { WebSocket } from 'ws';
import type { TeamId, Role, ClientMessage, ServerMessage, SnapshotMsg, FPSInputMsg, MapId, PlayerGameStats } from '@dyarchy/shared';
import { TICK_RATE, TICK_INTERVAL_MS, HERO_ABILITY_MAX_CHARGE } from '@dyarchy/shared';
import { GameState, type FPSPlayerEntity } from './GameState.js';

interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  team: TeamId | null;
  role: Role | null;
  ready: boolean;
  fpsEntityId: string | null;
}

interface PendingSwap {
  requesterId: string;
  teammateId: string;
}

export class GameRoom {
  readonly code: string;
  readonly roomName: string;
  readonly visibility: 'public' | 'private';
  private players = new Map<string, Player>();
  private state: GameState | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private status: 'waiting' | 'playing' = 'waiting';
  private mapId: MapId = 'meadow';
  private pendingSwap: PendingSwap | null = null;
  private gameStats = new Map<string, PlayerGameStats>();

  /** Called when room status changes (for lobby broadcast). Set by index.ts. */
  onStatusChange: (() => void) | null = null;

  constructor(code: string, roomName?: string, visibility?: 'public' | 'private') {
    this.code = code;
    this.roomName = roomName ?? `Room ${code}`;
    this.visibility = visibility ?? 'public';
  }

  get isFull(): boolean { return this.players.size >= 4; }

  toLobbyInfo(): import('@dyarchy/shared').LobbyRoomInfo {
    return {
      roomCode: this.code,
      roomName: this.roomName,
      playerCount: this.players.size,
      maxPlayers: 4,
      status: this.status,
      mapId: this.mapId,
    };
  }

  addPlayer(id: string, name: string, ws: WebSocket): void {
    this.players.set(id, {
      id, name, ws,
      team: null, role: null, ready: false,
      fpsEntityId: null,
    });
    this.broadcastRoomState();
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    if (this.pendingSwap?.requesterId === id || this.pendingSwap?.teammateId === id) {
      this.pendingSwap = null;
    }
    this.cancelCountdown();
    if (this.players.size === 0) this.stop();
    else this.broadcastRoomState();
  }

  private cancelCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
      this.broadcast({ type: 'countdown', seconds: 0 } as any); // 0 = cancelled
    }
  }

  handleMessage(playerId: string, msg: ClientMessage): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // Cheat: add crystals (only if solo player)
    if ((msg as any).type === 'cheat_crystals') {
      if (this.state && player.team) {
        this.state.teamResources[player.team] += 1000;
      }
      return;
    }

    // Cheat: toggle fighter waves (only if solo player)
    if ((msg as any).type === 'cheat_toggle_waves') {
      if (this.state && player.team) {
        const side = (msg as any).side as string;
        const stopped = (msg as any).stopped as boolean;
        if (side === 'friendly') {
          this.state.wavesDisabled[player.team] = stopped;
        } else if (side === 'enemy') {
          const enemyTeam = player.team === 1 ? 2 : 1;
          this.state.wavesDisabled[enemyTeam] = stopped;
        }
      }
      return;
    }

    // Cheat: freeze all units
    if ((msg as any).type === 'cheat_freeze' && this.state) {
      this.state.unitsFrozen = (msg as any).frozen ?? false;
      return;
    }

    // Cheat: instant build/train/upgrade
    if ((msg as any).type === 'cheat_instant_build' && this.state) {
      this.state.instantBuild = (msg as any).enabled ?? false;
      return;
    }

    // Cheat: turbo jeep toggle
    if ((msg as any).type === 'cheat_turbo_jeep' && this.state) {
      this.state.turboJeep = (msg as any).enabled ?? false;
      return;
    }

    // Cheat: spawn jeep near blue (team 1) HQ
    if ((msg as any).type === 'cheat_spawn_jeep' && this.state) {
      const base1 = this.state.mapConfig.initialBuildings[1].mainBase;
      const base2 = this.state.mapConfig.initialBuildings[2].mainBase;
      this.state.spawnJeep(1, base1);
      this.state.spawnJeep(2, base2);
      return;
    }

    if ((msg as any).type === 'cheat_invincible' && this.state) {
      this.state.fpsInvincible = (msg as any).enabled;
      return;
    }

    // Cheat: set hero type (alive, no death required)
    if ((msg as any).type === 'cheat_set_hero' && this.state && player.fpsEntityId) {
      const fps = this.state.entities.get(player.fpsEntityId) as import('./GameState.js').FPSPlayerEntity | undefined;
      if (fps) {
        const heroType = (msg as any).heroType;
        fps.heroType = heroType ?? null;
        fps.heroAbilityActive = false;
        fps.heroAbilityCharge = HERO_ABILITY_MAX_CHARGE;
        fps.heroAbilityDepleted = false;
        fps.heroAbilityLockout = 0;
        fps.shieldHp = 0;
        fps.auraTickTimer = 0;
      }
      return;
    }

    // Cheat: spawn helicopter near both HQs
    if ((msg as any).type === 'cheat_spawn_heli' && this.state) {
      const base1 = this.state.mapConfig.initialBuildings[1].mainBase;
      const base2 = this.state.mapConfig.initialBuildings[2].mainBase;
      this.state.spawnHelicopter(1, base1);
      this.state.spawnHelicopter(2, base2);
      return;
    }

    // Chat: relay to team or all
    if ((msg as any).type === 'send_chat') {
      const text = ((msg as any).text as string || '').trim().slice(0, 200);
      if (!text) return;
      const target = (msg as any).target as string;
      const prefix = target === 'team' ? '[Team] ' : '';
      const chatMsg = JSON.stringify({ type: 'chat', from: player.name, text: prefix + text });
      for (const p of this.players.values()) {
        if (target === 'team' && p.team !== player.team) continue;
        if (p.ws.readyState === p.ws.OPEN) p.ws.send(chatMsg);
      }
      return;
    }

    // Ping: relay to teammates
    if ((msg as any).type === 'ping' && player.team) {
      const pingMsg = JSON.stringify({ type: 'ping', x: (msg as any).x, z: (msg as any).z });
      for (const p of this.players.values()) {
        if (p.id !== playerId && p.team === player.team && p.ws.readyState === p.ws.OPEN) {
          p.ws.send(pingMsg);
        }
      }
      return;
    }

    // Vehicle enter/exit
    if ((msg as any).type === 'enter_vehicle' && this.state && player.fpsEntityId) {
      const vehicleId = (msg as any).vehicleId as string;
      const seat = (msg as any).seat as 'driver' | 'gunner';
      const ok = this.state.enterVehicle(player.fpsEntityId, vehicleId, seat);
      if (ok) {
        this.send(player.ws, { type: 'vehicle_entered', vehicleId, seat } as any);
      }
      return;
    }
    if ((msg as any).type === 'exit_vehicle' && this.state && player.fpsEntityId) {
      const result = this.state.exitVehicle(player.fpsEntityId);
      if (result) {
        const fpsEnt = this.state.entities.get(player.fpsEntityId) as import('./GameState.js').FPSPlayerEntity | undefined;
        if (fpsEnt) {
          fpsEnt.position = { ...result.exitPos, y: result.exitPos.y + 1.5 };
          fpsEnt.velocity = { x: 0, y: 0, z: 0 };
        }
        this.send(player.ws, { type: 'vehicle_exited' } as any);
      }
      return;
    }
    if ((msg as any).type === 'vehicle_input' && this.state && player.fpsEntityId) {
      const veh = this.state.getPlayerVehicle(player.fpsEntityId);
      if (veh && veh.seat === 'driver') {
        const vi = msg as any;
        if (veh.jeep.entityType === 'helicopter') {
          this.state.applyHelicopterInput(veh.jeep.id, vi.forward, vi.backward, vi.cameraYaw, vi.ascend ?? false, vi.descend ?? false, vi.dt);
        } else {
          this.state.applyVehicleInput(veh.jeep.id, vi.forward, vi.backward, vi.cameraYaw, vi.dt);
        }
      }
      return;
    }
    if ((msg as any).type === 'horn_honk' && this.state && player.fpsEntityId) {
      const veh = this.state.getPlayerVehicle(player.fpsEntityId);
      if (veh && veh.seat === 'driver') {
        // Broadcast horn to all other players so they hear it spatially
        for (const p of this.players.values()) {
          if (p.id === player.id) continue;
          this.send(p.ws, { type: 'horn_honk', vehicleId: veh.jeep.id, position: veh.jeep.position } as any);
        }
      }
      return;
    }

    // Hero system: select hero type during respawn
    if ((msg as any).type === 'select_hero' && this.state && player.fpsEntityId) {
      const fps = this.state.entities.get(player.fpsEntityId) as import('./GameState.js').FPSPlayerEntity | undefined;
      if (!fps || !fps.isDead) return; // can only select during respawn
      // Check HQ level >= 2
      const mainBase = [...this.state.entities.values()].find(
        e => e.entityType === 'main_base' && e.teamId === player.team && e.hp > 0,
      );
      if (!mainBase || (mainBase.level ?? 1) < 2) return;
      const heroType = (msg as any).heroType;
      if (heroType === 'tank' || heroType === 'healer' || heroType === 'mechanic') {
        fps.heroType = heroType;
      }
      return;
    }

    // Hero system: activate/deactivate hero ability
    if ((msg as any).type === 'hero_ability' && this.state && player.fpsEntityId) {
      const fps = this.state.entities.get(player.fpsEntityId) as import('./GameState.js').FPSPlayerEntity | undefined;
      if (!fps) return;
      const active = (msg as any).active as boolean;
      if (active) {
        if (fps.isDead || !fps.heroType || fps.heroAbilityActive) return;
        if (fps.heroAbilityDepleted || fps.heroAbilityCharge <= 0) return;
        if (this.state.getPlayerVehicle(fps.id)) return;
        fps.heroAbilityActive = true;
        if (fps.heroType === 'tank') fps.shieldHp = 200;
        fps.auraTickTimer = 0;
      } else {
        if (fps.heroAbilityActive) {
          this.state.deactivateHeroAbility(fps, false);
        }
      }
      return;
    }

    // Sniper nest climb/descend
    if ((msg as any).type === 'climb_nest' && this.state && player.fpsEntityId) {
      const fpsEnt = this.state.entities.get(player.fpsEntityId) as import('./GameState.js').FPSPlayerEntity | undefined;
      if (!fpsEnt) return;
      const action = (msg as any).action as string;
      const nestId = (msg as any).nestId as string;
      const nest = this.state.entities.get(nestId);
      if (!nest || nest.entityType !== 'sniper_nest') return;

      if (action === 'up') {
        fpsEnt.position = { x: nest.position.x, y: 9.5 + 1.5, z: nest.position.z };
        fpsEnt.velocity = { x: 0, y: 0, z: 0 };
      } else if (action === 'down') {
        fpsEnt.position = { x: nest.position.x, y: 1.5, z: nest.position.z + 2.5 };
        fpsEnt.velocity = { x: 0, y: 0, z: 0 };
      }
      return;
    }

    switch (msg.type) {
      case 'change_name':
        if (msg.name && msg.name.trim()) {
          player.name = msg.name.trim().slice(0, 16);
          this.broadcastRoomState();
        }
        break;

      case 'select_map':
        if (this.status !== 'waiting') return;
        if (msg.mapId === 'meadow' || msg.mapId === 'frostpeak') {
          this.mapId = msg.mapId;
          // Reset ready state when map changes
          for (const p of this.players.values()) p.ready = false;
          this.cancelCountdown();
          this.broadcastRoomState();
        }
        break;

      case 'select_role': {
        // Validate: can't pick a slot already taken by someone else
        const conflicting = [...this.players.values()].find(
          p => p.id !== playerId && p.team === msg.team && p.role === msg.role,
        );
        if (conflicting) {
          this.send(player.ws, { type: 'error', message: `That slot is taken by ${conflicting.name}` });
          return;
        }
        player.team = msg.team;
        player.role = msg.role;
        player.ready = false; // reset ready when changing
        if (this.status === 'waiting') {
          this.cancelCountdown();
        }
        this.broadcastRoomState();

        // If game is already in progress, immediately join the player into the game
        if (this.status === 'playing' && this.state && player.team && player.role) {
          this.joinMidGame(player);
        }
        break;
      }

      case 'ready':
        if (!player.team || !player.role) {
          this.send(player.ws, { type: 'error', message: 'Choose a team and role first' });
          return;
        }
        player.ready = true;
        this.broadcastRoomState();
        if (this.status === 'waiting') {
          this.tryStart();
        } else if (this.status === 'playing' && this.state) {
          // Mid-game join: player readied up during an active game
          this.joinMidGame(player);
        }
        break;

      case 'request_swap':
        this.handleSwapRequest(player);
        break;

      case 'respond_swap':
        this.handleSwapResponse(player, msg.accepted);
        break;

      case 'fps_input':
        if (this.status !== 'playing' || !this.state) return;
        if (player.role !== 'fps' || !player.fpsEntityId) return;
        this.handleFPSInput(player, msg);
        break;

      case 'fps_shoot':
        if (this.status === 'playing') this.getStats(player.id).shotsFired++;
        break;

      case 'fps_hit':
        if (this.status !== 'playing' || !this.state) return;
        this.getStats(player.id).shotsHit++;
        this.handleFPSHit(player, msg);
        break;

      case 'rts_command':
        if (this.status !== 'playing' || !this.state || !player.team) return;
        this.state.handleRTSCommand(player.team, msg);
        break;

      case 'rts_train':
        if (this.status !== 'playing' || !this.state || !player.team) return;
        this.state.handleTrain(player.team, msg.baseId, msg.unitType);
        break;

      case 'rts_upgrade':
        if (this.status !== 'playing' || !this.state || !player.team) return;
        this.state.handleUpgrade(player.team, msg.buildingId, msg.upgradeType);
        break;

      case 'rts_cancel_train':
        if (this.status !== 'playing' || !this.state || !player.team) return;
        this.state.handleCancelTrain(player.team, msg.baseId, msg.index);
        break;
    }
  }

  // ===================== Role Swap =====================

  private handleSwapRequest(requester: Player): void {
    if (this.status !== 'playing') return;
    if (!requester.team || !requester.role) return;

    // Find teammate
    const teammate = [...this.players.values()].find(
      p => p.id !== requester.id && p.team === requester.team,
    );

    if (!teammate) {
      // Solo on team — free switch between FPS and RTS
      const newRole: Role = requester.role === 'fps' ? 'rts' : 'fps';

      // If switching to FPS, assign the team's FPS entity
      if (newRole === 'fps' && requester.team && this.state) {
        const fpsEntity = [...this.state.entities.values()].find(
          e => e.entityType === 'fps_player' && e.teamId === requester.team,
        );
        requester.fpsEntityId = fpsEntity?.id ?? null;
      } else {
        requester.fpsEntityId = null;
      }

      requester.role = newRole;
      this.send(requester.ws, { type: 'swap_result', accepted: true, newRole, fpsEntityId: requester.fpsEntityId });
      return;
    }

    if (!teammate.role) {
      this.send(requester.ws, { type: 'swap_result', accepted: false });
      return;
    }

    // Two players on team — ask teammate
    this.pendingSwap = { requesterId: requester.id, teammateId: teammate.id };
    this.send(teammate.ws, {
      type: 'swap_request',
      fromPlayer: requester.name,
      fromRole: requester.role,
      toRole: teammate.role,
    });
  }

  private handleSwapResponse(responder: Player, accepted: boolean): void {
    if (!this.pendingSwap || this.pendingSwap.teammateId !== responder.id) return;

    const requester = this.players.get(this.pendingSwap.requesterId);
    this.pendingSwap = null;

    if (!requester) return;

    if (accepted && requester.role && responder.role) {
      // Swap roles
      const tempRole = requester.role;
      requester.role = responder.role;
      responder.role = tempRole;

      // Swap FPS entity ownership
      const tempFps = requester.fpsEntityId;
      requester.fpsEntityId = responder.fpsEntityId;
      responder.fpsEntityId = tempFps;

      // Notify both players of their new roles (include fpsEntityId so client can sync)
      this.send(requester.ws, { type: 'swap_result', accepted: true, newRole: requester.role, fpsEntityId: requester.fpsEntityId });
      this.send(responder.ws, { type: 'swap_result', accepted: true, newRole: responder.role, fpsEntityId: responder.fpsEntityId });
    } else {
      this.send(requester.ws, { type: 'swap_result', accepted: false });
    }
  }

  // ===================== Game Start =====================

  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  private tryStart(): void {
    // All players must be ready and have team+role
    for (const p of this.players.values()) {
      if (!p.ready || !p.team || !p.role) return;
    }
    // Need at least 1 player
    if (this.players.size === 0) return;
    // Don't start countdown twice
    if (this.countdownTimer) return;

    this.startCountdown();
  }

  private getStats(playerId: string): PlayerGameStats {
    let s = this.gameStats.get(playerId);
    if (!s) {
      const player = this.players.get(playerId);
      s = { playerId, playerName: player?.name ?? 'Unknown', shotsFired: 0, shotsHit: 0, kills: 0, friendlyKills: 0, deaths: 0, buildingsBuilt: 0, jeepKills: 0 };
      this.gameStats.set(playerId, s);
    }
    return s;
  }

  private startCountdown(): void {
    let count = 3;
    this.broadcast({ type: 'countdown', seconds: count } as any);
    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.broadcast({ type: 'countdown', seconds: count } as any);
      } else {
        clearInterval(this.countdownTimer!);
        this.countdownTimer = null;
        this.start();
      }
    }, 1000);
  }

  private start(): void {
    this.status = 'playing';
    this.onStatusChange?.();
    this.state = new GameState(this.mapId);

    // Create FPS player entities for both teams
    const team1Fps = this.state.spawnFPSPlayer(1);
    const team2Fps = this.state.spawnFPSPlayer(2);

    for (const player of this.players.values()) {
      if (player.role === 'fps' && player.team === 1) {
        player.fpsEntityId = team1Fps.id;
      } else if (player.role === 'fps' && player.team === 2) {
        player.fpsEntityId = team2Fps.id;
      }

      const teamCount = [...this.players.values()].filter(p => p.team === player.team).length;
      this.send(player.ws, {
        type: 'game_start',
        yourTeam: player.team!,
        yourRole: player.role!,
        fpsEntityId: player.fpsEntityId,
        mapId: this.mapId,
        teamPlayerCount: teamCount,
      });
    }

    // Notify FPS driver when jeep turret hits
    this.state.onJeepTurretHit = (driverId: string, targetId: string) => {
      const player = [...this.players.values()].find(p => p.fpsEntityId === driverId);
      if (player) this.send(player.ws, { type: 'turret_hit', targetId } as any);
    };

    // Track stats: kills and deaths
    this.gameStats.clear();
    this.state.onEntityKill = (killed, sourceId) => {
      // Find who owns the source
      const sourceEntity = this.state?.entities.get(sourceId);
      if (!sourceEntity) return;

      // Attribute the kill to a human player
      let killerPlayer: Player | undefined;
      if (sourceEntity.entityType === 'fps_player') {
        killerPlayer = [...this.players.values()].find(p => p.fpsEntityId === sourceId);
      } else if (sourceEntity.entityType === 'jeep' || sourceEntity.entityType === 'helicopter') {
        // Credit the driver
        const driverId = (sourceEntity as any).driverId;
        if (driverId) killerPlayer = [...this.players.values()].find(p => p.fpsEntityId === driverId);
      }

      if (killerPlayer) {
        const s = this.getStats(killerPlayer.id);
        const isFriendly = killed.teamId === killerPlayer.team;
        if (isFriendly) {
          s.friendlyKills++;
        } else {
          s.kills++;
          // Road Rage: kill via jeep/helicopter
          if (sourceEntity.entityType === 'jeep' || sourceEntity.entityType === 'helicopter') {
            s.jeepKills++;
          }
        }
      }

      // Track deaths for fps_player victims
      if (killed.entityType === 'fps_player') {
        const victim = [...this.players.values()].find(p => p.fpsEntityId === killed.id);
        if (victim) this.getStats(victim.id).deaths++;
      }
    };

    // Track stats: buildings built
    this.state.onBuildingBuilt = (building) => {
      // Credit the current RTS player on that team
      const rtsPlayer = [...this.players.values()].find(p => p.team === building.teamId && p.role === 'rts');
      if (rtsPlayer) this.getStats(rtsPlayer.id).buildingsBuilt++;
    };

    this.tickInterval = setInterval(() => this.gameTick(), TICK_INTERVAL_MS);
  }

  /** Join a player into an already-running game */
  private joinMidGame(player: Player): void {
    if (!this.state || !player.team || !player.role) return;

    // If FPS role, assign the team's existing FPS entity
    if (player.role === 'fps') {
      const fpsEntity = [...this.state.entities.values()].find(
        e => e.entityType === 'fps_player' && e.teamId === player.team,
      );
      player.fpsEntityId = fpsEntity?.id ?? null;
    } else {
      player.fpsEntityId = null;
    }

    const teamCount = [...this.players.values()].filter(p => p.team === player.team).length;
    this.send(player.ws, {
      type: 'game_start',
      yourTeam: player.team,
      yourRole: player.role,
      fpsEntityId: player.fpsEntityId,
      mapId: this.mapId,
      teamPlayerCount: teamCount,
    });

    // Announce to all players
    const teamLabel = player.team === 1 ? 'Blue' : 'Red';
    this.broadcast({ type: 'chat', from: '', text: `${player.name} has joined the game (${teamLabel} Team)` });

    // Update teammate's teamPlayerCount awareness
    for (const p of this.players.values()) {
      if (p.id !== player.id && p.team === player.team) {
        // Teammate will see the updated player count in subsequent snapshots
      }
    }

    this.onStatusChange?.(); // update lobby listing with new player count
  }

  private stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.status = 'waiting';
    this.state = null;
    this.onStatusChange?.();
  }

  private gameTick(): void {
    if (!this.state) return;

    const dt = 1 / TICK_RATE;
    this.state.updateAll(dt);

    const trainingQueues: Record<number, { baseId: string; queue: { elapsed: number; duration: number; unitType?: string }[] }[]> = { 1: [], 2: [] };
    for (const [, tq] of this.state.trainingQueues) {
      trainingQueues[tq.teamId].push({
        baseId: tq.baseId,
        queue: tq.queue.map(s => ({ elapsed: s.elapsed, duration: s.duration, unitType: s.unitType })),
      });
    }

    const entities = this.state.getSnapshot();

    // Attach player names and killer info to fps_player entities
    for (const entity of entities) {
      if (entity.entityType === 'fps_player') {
        const player = [...this.players.values()].find(p => p.fpsEntityId === entity.id);
        if (player) entity.playerName = player.name;

        // Attach killer info if dead
        const fpsEnt = this.state.entities.get(entity.id) as import('./GameState.js').FPSPlayerEntity | undefined;
        if (fpsEnt?.isDead && fpsEnt.lastDamagedBy) {
          entity.killerEntityId = fpsEnt.lastDamagedBy;
          const killerEntity = this.state.entities.get(fpsEnt.lastDamagedBy);
          if (killerEntity) {
            const teamLabel = killerEntity.teamId === 1 ? "Blue" : "Red";
            if (killerEntity.entityType === 'fps_player') {
              const killerPlayer = [...this.players.values()].find(p => p.fpsEntityId === killerEntity.id);
              entity.killerName = killerPlayer?.name ?? `${teamLabel} Player`;
            } else if (killerEntity.entityType === 'tower' || killerEntity.entityType === 'player_tower') {
              entity.killerName = `${teamLabel}'s Tower`;
            } else if (killerEntity.entityType === 'fighter') {
              entity.killerName = `${teamLabel} Fighter`;
            } else if (killerEntity.entityType === 'foot_soldier') {
              entity.killerName = `${teamLabel} Foot Soldier`;
            } else {
              entity.killerName = `${teamLabel} ${killerEntity.entityType}`;
            }
          }
        }
      }
    }

    const snapshot: SnapshotMsg = {
      type: 'snapshot',
      tick: this.state.tick,
      entities,
      teamResources: { ...this.state.teamResources },
      teamSupply: {
        1: { ...this.state.teamSupply[1] },
        2: { ...this.state.teamSupply[2] },
      },
      trainingQueues,
      waveTimer: this.state.waveTimer,
      gameTime: this.state.gameTime,
      fighterLevel: Math.floor(this.state.gameTime / 120),
      harvestBoost: { ...this.state.harvestBoost },
    };

    this.broadcast(snapshot);

    if (this.state.winner) {
      this.broadcast({ type: 'game_over', winnerTeam: this.state.winner, stats: [...this.gameStats.values()] });
      this.stop();
    }
  }

  // ===================== FPS Handling =====================

  private handleFPSInput(player: Player, msg: FPSInputMsg): void {
    if (!this.state || !player.fpsEntityId) return;
    const newPos = this.state.applyFPSInput(player.fpsEntityId, msg);
    if (newPos) {
      const entity = this.state.entities.get(player.fpsEntityId) as FPSPlayerEntity;
      this.send(player.ws, {
        type: 'fps_correction',
        seq: msg.seq,
        position: { ...newPos },
        velocity: { ...entity.velocity },
      });
    }
  }

  private handleFPSHit(player: Player, msg: any): void {
    if (!this.state) return;
    const target = this.state.entities.get(msg.targetId);
    if (!target || target.hp <= 0) return;
    if (target.entityType === 'main_base' && target.teamId === player.team) return;
    this.state.applyDamage(target, msg.damage, player.fpsEntityId ?? '');
  }

  // ===================== Networking =====================

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.ws.readyState === player.ws.OPEN) player.ws.send(data);
    }
  }

  private broadcastRoomState(): void {
    this.broadcast({
      type: 'room_state',
      roomCode: this.code,
      roomName: this.roomName,
      visibility: this.visibility,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, team: p.team, role: p.role, ready: p.ready,
      })),
      status: this.status,
      mapId: this.mapId,
    });
  }

  get playerCount(): number { return this.players.size; }
  get isEmpty(): boolean { return this.players.size === 0; }
  get currentStatus(): 'waiting' | 'playing' { return this.status; }
}
