import type { WebSocket } from 'ws';
import type { TeamId, Role, ClientMessage, ServerMessage, SnapshotMsg, FPSInputMsg } from '@dyarchy/shared';
import { TICK_RATE, TICK_INTERVAL_MS } from '@dyarchy/shared';
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
  private players = new Map<string, Player>();
  private state: GameState | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private status: 'waiting' | 'playing' = 'waiting';
  private pendingSwap: PendingSwap | null = null;

  constructor(code: string) {
    this.code = code;
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
    if (this.players.size === 0) this.stop();
    else this.broadcastRoomState();
  }

  handleMessage(playerId: string, msg: ClientMessage): void {
    const player = this.players.get(playerId);
    if (!player) return;

    switch (msg.type) {
      case 'select_role':
        if (this.status !== 'waiting') return;
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
        this.broadcastRoomState();
        break;

      case 'ready':
        if (this.status !== 'waiting') return;
        if (!player.team || !player.role) {
          this.send(player.ws, { type: 'error', message: 'Choose a team and role first' });
          return;
        }
        player.ready = true;
        this.broadcastRoomState();
        this.tryStart();
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
        break;

      case 'fps_hit':
        if (this.status !== 'playing' || !this.state) return;
        this.handleFPSHit(player, msg);
        break;

      case 'rts_command':
        if (this.status !== 'playing' || !this.state || !player.team) return;
        this.state.handleRTSCommand(player.team, msg);
        break;

      case 'rts_train':
        if (this.status !== 'playing' || !this.state || !player.team) return;
        this.state.handleTrain(player.team, msg.baseId);
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
      this.send(requester.ws, { type: 'swap_result', accepted: false });
      this.send(requester.ws, { type: 'error', message: 'No teammate to swap with' });
      return;
    }

    if (!teammate.role) {
      this.send(requester.ws, { type: 'swap_result', accepted: false });
      return;
    }

    // Set pending swap and ask teammate
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

      // Notify both players of their new roles
      this.send(requester.ws, { type: 'swap_result', accepted: true, newRole: requester.role });
      this.send(responder.ws, { type: 'swap_result', accepted: true, newRole: responder.role });
    } else {
      this.send(requester.ws, { type: 'swap_result', accepted: false });
    }
  }

  // ===================== Game Start =====================

  private tryStart(): void {
    // All players must be ready and have team+role
    for (const p of this.players.values()) {
      if (!p.ready || !p.team || !p.role) return;
    }
    // Need at least 1 player
    if (this.players.size === 0) return;

    this.start();
  }

  private start(): void {
    this.status = 'playing';
    this.state = new GameState();

    // Create FPS player entities for both teams
    const team1Fps = this.state.spawnFPSPlayer(1);
    const team2Fps = this.state.spawnFPSPlayer(2);

    for (const player of this.players.values()) {
      if (player.role === 'fps' && player.team === 1) {
        player.fpsEntityId = team1Fps.id;
      } else if (player.role === 'fps' && player.team === 2) {
        player.fpsEntityId = team2Fps.id;
      }

      this.send(player.ws, {
        type: 'game_start',
        yourTeam: player.team!,
        yourRole: player.role!,
        fpsEntityId: player.fpsEntityId,
      });
    }

    this.tickInterval = setInterval(() => this.gameTick(), TICK_INTERVAL_MS);
  }

  private stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.status = 'waiting';
    this.state = null;
  }

  private gameTick(): void {
    if (!this.state) return;

    const dt = 1 / TICK_RATE;
    this.state.updateAll(dt);

    const trainingQueues: Record<number, { baseId: string; queue: { elapsed: number; duration: number }[] }[]> = { 1: [], 2: [] };
    for (const [, tq] of this.state.trainingQueues) {
      trainingQueues[tq.teamId].push({
        baseId: tq.baseId,
        queue: tq.queue.map(s => ({ elapsed: s.elapsed, duration: s.duration })),
      });
    }

    const snapshot: SnapshotMsg = {
      type: 'snapshot',
      tick: this.state.tick,
      entities: this.state.getSnapshot(),
      teamResources: { ...this.state.teamResources },
      teamSupply: {
        1: { ...this.state.teamSupply[1] },
        2: { ...this.state.teamSupply[2] },
      },
      trainingQueues,
      waveTimer: this.state.waveTimer,
      gameTime: this.state.gameTime,
    };

    this.broadcast(snapshot);

    if (this.state.winner) {
      this.broadcast({ type: 'game_over', winnerTeam: this.state.winner });
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
    target.hp -= msg.damage;
    if (target.hp < 0) target.hp = 0;
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
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, team: p.team, role: p.role, ready: p.ready,
      })),
      status: this.status,
    });
  }

  get playerCount(): number { return this.players.size; }
  get isEmpty(): boolean { return this.players.size === 0; }
}
