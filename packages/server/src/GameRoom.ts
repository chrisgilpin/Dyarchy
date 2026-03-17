import type { WebSocket } from 'ws';
import type { TeamId, Role, ClientMessage, ServerMessage, SnapshotMsg, FPSInputMsg, RTSCommandMsg, RTSTrainMsg, RTSCancelTrainMsg } from '@dyarchy/shared';
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

export class GameRoom {
  readonly code: string;
  private players = new Map<string, Player>();
  private state: GameState | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private status: 'waiting' | 'playing' = 'waiting';

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
    if (this.players.size === 0) this.stop();
    else this.broadcastRoomState();
  }

  handleMessage(playerId: string, msg: ClientMessage): void {
    const player = this.players.get(playerId);
    if (!player) return;

    switch (msg.type) {
      case 'select_role':
        if (this.status !== 'waiting') return;
        player.team = msg.team;
        player.role = msg.role;
        this.broadcastRoomState();
        break;

      case 'ready':
        if (this.status !== 'waiting') return;
        player.ready = true;
        this.broadcastRoomState();
        this.tryStart();
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

  private tryStart(): void {
    const readyPlayers = [...this.players.values()].filter(p => p.ready);
    if (readyPlayers.length === 0) return;

    // Auto-assign teams: alternate between team 1 and 2
    let teamToggle: TeamId = 1;
    for (const p of this.players.values()) {
      if (!p.team) {
        p.team = teamToggle;
        teamToggle = teamToggle === 1 ? 2 : 1;
      }
      if (!p.role) p.role = 'rts';
    }

    this.start();
  }

  private start(): void {
    this.status = 'playing';
    this.state = new GameState();

    // Always create FPS player entities for both teams (visible to all)
    const team1Fps = this.state.spawnFPSPlayer(1);
    const team2Fps = this.state.spawnFPSPlayer(2);

    for (const player of this.players.values()) {
      // Link FPS role players to their team's FPS entity
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

    // Broadcast snapshot
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
    // Don't let player damage own team's main base
    if (target.entityType === 'main_base' && target.teamId === player.team) return;

    target.hp -= msg.damage;
    if (target.hp < 0) target.hp = 0;
  }

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
