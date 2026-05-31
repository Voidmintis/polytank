import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  type EventMessage,
  type MatchStartMessage,
  type RoomRosterEntry,
  type RoomSettings,
  type RoomStateMessage,
  type SnapshotMessage,
  type ServerMessage,
  type WorldProjectileState,
  type WorldShapeState,
} from '../../src/shared/protocol.js';
import {
  SNAPSHOT_RATE,
  SERVER_TICK_RATE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createDefaultUpgrades,
  type PlayerUpgradeState,
  type PlayerState,
} from '../../src/shared/world.js';
import type { InputPayload } from '../../src/shared/protocol.js';

export interface ConnectionContext {
  socket: WebSocket;
  playerId: string;
  sessionId: string;
  nickname: string;
  roomId: string | null;
}

interface RoomMember {
  playerId: string;
  sessionId: string;
  nickname: string;
  ready: boolean;
  isHost: boolean;
  socket: WebSocket;
}

interface Room {
  id: string;
  code: string;
  status: 'lobby' | 'starting' | 'active' | 'ended';
  settings: RoomSettings;
  members: RoomMember[];
  createdAt: number;
}

interface ActiveRoomRuntime {
  tick: number;
  startedAt: number;
  players: PlayerState[];
  inputs: Map<string, InputPayload>;
  fireCooldowns: Map<string, number>;
  respawnTimers: Map<string, number>;
  shapes: ActiveShape[];
  projectiles: ActiveProjectile[];
  projectileSequence: number;
  shapeSequence: number;
  simulationTimer: ReturnType<typeof setInterval>;
  snapshotTimer: ReturnType<typeof setInterval>;
}

interface ActiveShape {
  id: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  xp: number;
  color: string;
  sides: number;
  rotation: number;
  spin: number;
}

interface ActiveProjectile {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  radius: number;
  ownerId: string;
  ownerTeam: string;
  life: number;
  damage: number;
}

interface RoomActionResult {
  room?: Room;
  error?: { code: string; message: string };
  started?: boolean;
}

const MAX_ROOM_MEMBERS = 8;
const BASE_TANK_HEALTH = 100;
const BASE_MOVE_SPEED = 240;
const BASE_BULLET_SPEED = 620;
const BASE_BULLET_DAMAGE = 34;
const BASE_RELOAD = 0.28;
const BASE_BULLET_RADIUS = 8;
const UPGRADE_UNLOCK_LEVEL = 5;
const UPGRADE_MAX_LEVEL = 10;
const BOT_TARGET_PLAYERS = 6;
const FFA_TEAM_COLORS = ['blue', 'red', 'green', 'purple', 'yellow'] as const;
const BOT_NAME_PREFIXES = ['Nova', 'Cipher', 'Vector', 'Pulse', 'Drift', 'Ion', 'Shard', 'Orbit'] as const;
const BOT_NAME_SUFFIXES = ['Wing', 'Core', 'Bolt', 'Trace', 'Flux', 'Drive', 'Hex', 'Ray'] as const;

type UpgradeKey = keyof PlayerUpgradeState;

interface ServerClassDef {
  hpScale?: number;
  bodyScale?: number;
  bulletSpeedScale?: number;
  bulletDamageScale?: number;
  bulletRadiusScale?: number;
  reloadScale?: number;
  moveSpeedScale?: number;
}

const CLASS_DEFS: Record<string, ServerClassDef> = {
  basic: {},
  twin: { reloadScale: 0.88, bulletDamageScale: 0.82, bulletRadiusScale: 1.15 },
  sniper: { reloadScale: 1.22, bulletSpeedScale: 1.55, bulletDamageScale: 1.12, bulletRadiusScale: 1.2 },
  machine_gun: { reloadScale: 0.52, bulletDamageScale: 0.68, bulletSpeedScale: 0.92 },
  flank_guard: { reloadScale: 0.94, moveSpeedScale: 1.08 },
  triple_shot: { reloadScale: 0.96, bulletDamageScale: 0.92, bulletRadiusScale: 1.16 },
  quad_tank: { reloadScale: 1.06, bulletDamageScale: 0.86 },
  twin_flank: { reloadScale: 0.98, bulletDamageScale: 0.84 },
  assassin: { reloadScale: 1.32, bulletSpeedScale: 1.72, bulletDamageScale: 1.28, bulletRadiusScale: 1.3 },
  overseer: { reloadScale: 1.1, bulletDamageScale: 0.65 },
  hunter: { reloadScale: 1.1, bulletSpeedScale: 1.58, bulletDamageScale: 1.18, bulletRadiusScale: 1.22 },
  trapper: { reloadScale: 1.14, bulletSpeedScale: 0.48, bulletDamageScale: 1.18, bulletRadiusScale: 2.4 },
  destroyer: { reloadScale: 1.9, bulletSpeedScale: 0.74, bulletDamageScale: 6, bulletRadiusScale: 4 },
  gunner: { reloadScale: 0.42, bulletDamageScale: 0.46, bulletSpeedScale: 1.04, bulletRadiusScale: 0.72 },
  tri_angle: { reloadScale: 0.98, bulletDamageScale: 0.88, moveSpeedScale: 1.24 },
  auto_3: { reloadScale: 0.96 },
  smasher: { bodyScale: 1.22, moveSpeedScale: 1.12 },
  triplet: { reloadScale: 0.78, bulletDamageScale: 1.04, bulletRadiusScale: 1.18 },
  penta_shot: { reloadScale: 0.86, bulletDamageScale: 0.82, bulletRadiusScale: 1.08 },
  spread_shot: { reloadScale: 1.02, bulletDamageScale: 0.94, bulletRadiusScale: 1.12 },
  octo_tank: { reloadScale: 0.98, bulletDamageScale: 0.76 },
  auto_5: { reloadScale: 0.92 },
  triple_twin: { reloadScale: 0.92, bulletDamageScale: 0.82 },
  battleship: { reloadScale: 1.04, moveSpeedScale: 0.94 },
  ranger: { reloadScale: 1.38, bulletSpeedScale: 1.9, bulletDamageScale: 1.36, bulletRadiusScale: 1.3 },
  stalker: { reloadScale: 1.28, bulletSpeedScale: 1.72, bulletDamageScale: 1.32, bulletRadiusScale: 1.24 },
  overlord: { reloadScale: 0.94 },
  necromancer: { reloadScale: 1.02 },
  manager: { reloadScale: 0.98 },
  factory: { reloadScale: 0.88, bulletDamageScale: 1.1 },
  overtrapper: { reloadScale: 1.08, bulletRadiusScale: 1.8 },
  predator: { reloadScale: 1.12, bulletSpeedScale: 1.72, bulletDamageScale: 1.26, bulletRadiusScale: 1.24 },
  streamliner: { reloadScale: 0.44, bulletDamageScale: 0.58, bulletSpeedScale: 1.42, bulletRadiusScale: 0.82 },
  tri_trapper: { reloadScale: 1.14, bulletSpeedScale: 0.44, bulletDamageScale: 1.08, bulletRadiusScale: 2.1 },
  mega_trapper: { reloadScale: 1.28, bulletSpeedScale: 0.38, bulletDamageScale: 1.42, bulletRadiusScale: 2.9 },
  gunner_trapper: { reloadScale: 0.68, bulletDamageScale: 0.72, bulletRadiusScale: 1.32 },
  auto_trapper: { reloadScale: 1.06, bulletRadiusScale: 1.9 },
  hybrid: { reloadScale: 1.78, bulletDamageScale: 5.2, bulletSpeedScale: 0.74, bulletRadiusScale: 3.6 },
  annihilator: { reloadScale: 2.02, bulletDamageScale: 6.6, bulletSpeedScale: 0.74, bulletRadiusScale: 4.6 },
  skimmer: { reloadScale: 1.66, bulletDamageScale: 4.8, bulletSpeedScale: 0.74, bulletRadiusScale: 3.4 },
  rocketeer: { reloadScale: 1.72, bulletDamageScale: 5.1, bulletSpeedScale: 0.74, bulletRadiusScale: 3.6 },
  auto_gunner: { reloadScale: 0.44, bulletDamageScale: 0.48, bulletRadiusScale: 0.76 },
  sprayer: { reloadScale: 0.34, bulletDamageScale: 0.56 },
  booster: { reloadScale: 0.9, bulletDamageScale: 0.82, moveSpeedScale: 1.38 },
  fighter: { reloadScale: 0.84, bulletDamageScale: 1.02, moveSpeedScale: 1.24 },
  landmine: { bodyScale: 1.16, moveSpeedScale: 1.06 },
  auto_smasher: { bodyScale: 1.2, moveSpeedScale: 1.08 },
  spike: { bodyScale: 1.28, moveSpeedScale: 1.02 },
  auto_tank: { reloadScale: 0.86, bulletDamageScale: 0.92 },
};

const CLASS_CHOICE_TREE: Record<string, { level: number; options: string[] }[]> = {
  basic: [
    { level: 15, options: ['twin', 'sniper', 'machine_gun', 'flank_guard'] },
    { level: 30, options: ['smasher'] },
    { level: 45, options: ['auto_tank'] },
  ],
  twin: [
    { level: 30, options: ['triple_shot', 'quad_tank', 'twin_flank'] },
    { level: 45, options: ['triplet', 'penta_shot', 'spread_shot', 'octo_tank', 'auto_5', 'triple_twin'] },
  ],
  sniper: [
    { level: 30, options: ['assassin', 'overseer', 'hunter', 'trapper'] },
    { level: 45, options: ['ranger', 'stalker', 'overlord', 'necromancer', 'manager', 'factory', 'overtrapper', 'predator', 'streamliner'] },
  ],
  machine_gun: [
    { level: 30, options: ['destroyer', 'gunner'] },
    { level: 45, options: ['hybrid', 'annihilator', 'skimmer', 'rocketeer', 'auto_gunner', 'sprayer'] },
  ],
  flank_guard: [
    { level: 30, options: ['tri_angle', 'auto_3'] },
    { level: 45, options: ['booster', 'fighter'] },
  ],
  trapper: [{ level: 45, options: ['tri_trapper', 'mega_trapper', 'gunner_trapper', 'auto_trapper'] }],
  smasher: [{ level: 45, options: ['landmine', 'auto_smasher', 'spike'] }],
};

const SHAPE_DEFS = {
  square: { radius: 18, hp: 30, xp: 6, color: '#ffe36d', sides: 4 },
  triangle: { radius: 22, hp: 56, xp: 12, color: '#ef7076', sides: 3 },
  pentagon: { radius: 31, hp: 120, xp: 24, color: '#7f94f4', sides: 5 },
} as const;

export class RoomManager {
  private readonly roomsById = new Map<string, Room>();
  private readonly roomIdByCode = new Map<string, string>();
  private readonly activeRooms = new Map<string, ActiveRoomRuntime>();

  constructor(private readonly now: () => number) {}

  createRoom(connection: ConnectionContext, nickname: string, settings: RoomSettings): RoomActionResult {
    if (connection.roomId) {
      this.leaveRoom(connection, connection.roomId);
    }

    const room: Room = {
      id: crypto.randomUUID(),
      code: this.generateRoomCode(),
      status: 'lobby',
      settings: { ...settings },
      members: [
        {
          playerId: connection.playerId,
          sessionId: connection.sessionId,
          nickname,
          ready: false,
          isHost: true,
          socket: connection.socket,
        },
      ],
      createdAt: this.now(),
    };

    this.roomsById.set(room.id, room);
    this.roomIdByCode.set(room.code, room.id);
    connection.nickname = nickname;
    connection.roomId = room.id;
    return { room };
  }

  configureRoom(connection: ConnectionContext, roomId: string, settings: RoomSettings): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }

    const member = room.members.find(entry => entry.playerId === connection.playerId);
    if (!member) {
      return { error: { code: 'NOT_IN_ROOM', message: 'Player is not in the requested room.' } };
    }
    if (!member.isHost) {
      return { error: { code: 'HOST_ONLY', message: 'Only the host can change room settings.' } };
    }
    if (room.status !== 'lobby') {
      return { error: { code: 'ROOM_NOT_CONFIGURABLE', message: 'Room settings can no longer be changed.' } };
    }

    room.settings = { ...settings };
    return { room };
  }

  joinRoom(connection: ConnectionContext, roomCode: string, nickname: string): RoomActionResult {
    const room = this.getRoomByCode(roomCode);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room code was not found.' } };
    }
    if (room.status !== 'lobby') {
      return { error: { code: 'ROOM_NOT_JOINABLE', message: 'Room is no longer joinable.' } };
    }
    if (room.members.length >= MAX_ROOM_MEMBERS) {
      return { error: { code: 'ROOM_FULL', message: 'Room is already full.' } };
    }
    if (room.members.some(member => member.playerId === connection.playerId)) {
      return { room };
    }

    room.members.push({
      playerId: connection.playerId,
      sessionId: connection.sessionId,
      nickname,
      ready: false,
      isHost: false,
      socket: connection.socket,
    });
    connection.nickname = nickname;
    connection.roomId = room.id;
    return { room };
  }

  leaveRoom(connection: ConnectionContext, roomId: string): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }

    room.members = room.members.filter(member => member.playerId !== connection.playerId);
    this.removeActivePlayer(room.id, connection.playerId);
    connection.roomId = null;

    if (room.members.length === 0) {
      this.stopActiveRoom(room.id);
      this.roomsById.delete(room.id);
      this.roomIdByCode.delete(room.code);
      return {};
    }

    if (!room.members.some(member => member.isHost)) {
      room.members[0].isHost = true;
    }

    return { room };
  }

  disconnect(connection: ConnectionContext): RoomActionResult {
    if (!connection.roomId) {
      return {};
    }
    return this.leaveRoom(connection, connection.roomId);
  }

  setReady(connection: ConnectionContext, roomId: string, ready: boolean): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }
    const member = room.members.find(entry => entry.playerId === connection.playerId);
    if (!member) {
      return { error: { code: 'NOT_IN_ROOM', message: 'Player is not in the requested room.' } };
    }

    member.ready = ready;

    const enoughParticipants = room.members.length > 1 || room.settings.aiEnabled !== false;
    const everyoneReady = enoughParticipants && room.members.length >= 1 && room.members.every(entry => entry.ready);
    if (everyoneReady) {
      room.status = 'active';
      this.startActiveRoom(room);
      return { room, started: true };
    }

    return { room };
  }

  createRoomStateMessage(room: Room): RoomStateMessage {
    return {
      type: 'roomState',
      version: PROTOCOL_VERSION,
      timestamp: this.now(),
      payload: {
        roomId: room.id,
        roomCode: room.code,
        status: room.status,
        settings: { ...room.settings },
        roster: room.members.map<RoomRosterEntry>(member => ({
          id: member.playerId,
          nickname: member.nickname,
          ready: member.ready,
          isHost: member.isHost,
        })),
      },
    };
  }

  createMatchStartMessage(room: Room): MatchStartMessage {
    return {
      type: 'matchStart',
      version: PROTOCOL_VERSION,
      timestamp: this.now(),
      payload: {
        roomId: room.id,
        seed: this.now(),
        startedAt: this.now(),
      },
    };
  }

  createEventMessage(roomId: string, event: string, data: Record<string, unknown>): EventMessage {
    return {
      type: 'event',
      version: PROTOCOL_VERSION,
      timestamp: this.now(),
      payload: {
        roomId,
        event,
        data,
      },
    };
  }

  createSnapshotMessage(room: Room): SnapshotMessage | null {
    const runtime = this.activeRooms.get(room.id);
    if (!runtime) {
      return null;
    }

    return {
      type: 'snapshot',
      version: PROTOCOL_VERSION,
      timestamp: this.now(),
      payload: {
        roomId: room.id,
        tick: runtime.tick,
        players: runtime.players.map(player => ({
          id: player.id,
          nickname: player.nickname,
          team: player.team,
          classId: player.classId,
          x: player.x,
          y: player.y,
          angle: player.angle,
          hp: player.hp,
          maxHp: player.maxHp,
          level: player.level,
          xp: player.xp,
          xpNext: player.xpNext,
          points: player.points,
          score: player.score,
          upgrades: this.cloneUpgrades(player.upgrades),
        })),
        projectiles: runtime.projectiles.map<WorldProjectileState>(projectile => ({
          id: projectile.id,
          x: projectile.x,
          y: projectile.y,
          angle: projectile.angle,
          speed: projectile.speed,
          radius: projectile.radius,
          ownerId: projectile.ownerId,
          ownerTeam: projectile.ownerTeam,
        })),
        shapes: runtime.shapes.map<WorldShapeState>(shape => ({
          id: shape.id,
          x: shape.x,
          y: shape.y,
          hp: shape.hp,
          maxHp: shape.maxHp,
          kind: shape.kind,
          radius: shape.radius,
          color: shape.color,
          sides: shape.sides,
          rotation: shape.rotation,
        })),
      },
    };
  }

  applyInput(connection: ConnectionContext, payload: InputPayload): RoomActionResult {
    if (!connection.roomId) {
      return { error: { code: 'NOT_IN_ROOM', message: 'Player is not in an active room.' } };
    }

    const room = this.roomsById.get(connection.roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }
    if (room.status !== 'active') {
      return { error: { code: 'ROOM_NOT_ACTIVE', message: 'Room is not active yet.' } };
    }

    const runtime = this.activeRooms.get(room.id);
    if (!runtime) {
      return { error: { code: 'ROOM_RUNTIME_MISSING', message: 'Room simulation is not running.' } };
    }

    const player = runtime.players.find(entry => entry.id === connection.playerId);
    if (!player) {
      return { error: { code: 'NOT_IN_ROOM', message: 'Player is not in the requested room.' } };
    }

    runtime.inputs.set(connection.playerId, {
      sequence: Math.max(0, Math.floor(payload.sequence)),
      moveX: this.clamp(payload.moveX, -1, 1),
      moveY: this.clamp(payload.moveY, -1, 1),
      aimAngle: Number.isFinite(payload.aimAngle) ? payload.aimAngle : player.angle,
      firing: !!payload.firing,
    });
    return { room };
  }

  applyUpgrade(connection: ConnectionContext, roomId: string, upgradeKey: string): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }
    if (connection.roomId !== roomId || room.status !== 'active') {
      return { error: { code: 'ROOM_NOT_ACTIVE', message: 'Room is not active yet.' } };
    }

    const runtime = this.activeRooms.get(room.id);
    if (!runtime) {
      return { error: { code: 'ROOM_RUNTIME_MISSING', message: 'Room simulation is not running.' } };
    }

    const player = runtime.players.find(entry => entry.id === connection.playerId);
    if (!player) {
      return { error: { code: 'NOT_IN_ROOM', message: 'Player is not in the requested room.' } };
    }
    if (!(upgradeKey in player.upgrades)) {
      return { error: { code: 'BAD_UPGRADE', message: 'Upgrade key is invalid.' } };
    }
    if (player.level < UPGRADE_UNLOCK_LEVEL) {
      return { error: { code: 'UPGRADES_LOCKED', message: 'Upgrades are not unlocked yet.' } };
    }
    if (player.points <= 0) {
      return { error: { code: 'NO_UPGRADE_POINTS', message: 'No upgrade points are available.' } };
    }

    const typedKey = upgradeKey as UpgradeKey;
    if (player.upgrades[typedKey] >= UPGRADE_MAX_LEVEL) {
      return { error: { code: 'UPGRADE_MAXED', message: 'Upgrade is already maxed.' } };
    }

    player.points -= 1;
    player.upgrades[typedKey] += 1;
    this.applyPlayerDerivedStats(player, false);
    if (typedKey === 'maxHealth') {
      player.hp = Math.min(player.maxHp, player.hp + 26);
    }
    if (typedKey === 'regen') {
      player.hp = Math.min(player.maxHp, player.hp + 12);
    }

    return { room };
  }

  chooseClass(connection: ConnectionContext, roomId: string, classId: string): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }
    if (connection.roomId !== roomId || room.status !== 'active') {
      return { error: { code: 'ROOM_NOT_ACTIVE', message: 'Room is not active yet.' } };
    }

    const runtime = this.activeRooms.get(room.id);
    if (!runtime) {
      return { error: { code: 'ROOM_RUNTIME_MISSING', message: 'Room simulation is not running.' } };
    }

    const player = runtime.players.find(entry => entry.id === connection.playerId);
    if (!player) {
      return { error: { code: 'NOT_IN_ROOM', message: 'Player is not in the requested room.' } };
    }

    const options = this.getClassChoicesFor(player);
    if (!options.includes(classId)) {
      return { error: { code: 'CLASS_NOT_AVAILABLE', message: 'Class choice is not available.' } };
    }

    player.classId = classId;
    this.applyPlayerDerivedStats(player, false);
    return { room };
  }

  broadcastRoom(room: Room, message: ServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const member of room.members) {
      member.socket.send(serialized);
    }
  }

  dispose(): void {
    for (const roomId of this.activeRooms.keys()) {
      this.stopActiveRoom(roomId);
    }
  }

  private startActiveRoom(room: Room): void {
    this.stopActiveRoom(room.id);

    const startedAt = this.now();
    const runtime: ActiveRoomRuntime = {
      tick: 0,
      startedAt,
      players: this.createActivePlayers(room),
      inputs: new Map(),
      fireCooldowns: new Map(),
      respawnTimers: new Map(),
      shapes: [],
      projectiles: [],
      projectileSequence: 0,
      shapeSequence: 0,
      simulationTimer: setInterval(() => {
        this.simulateActiveRoom(room.id);
      }, Math.max(1, Math.floor(1000 / SERVER_TICK_RATE))),
      snapshotTimer: setInterval(() => {
        this.tickActiveRoom(room.id);
      }, Math.max(1, Math.floor(1000 / SNAPSHOT_RATE))),
    };

    runtime.shapes = this.createInitialShapes(runtime);

    this.activeRooms.set(room.id, runtime);

    const initialSnapshot = this.createSnapshotMessage(room);
    if (initialSnapshot) {
      this.broadcastRoom(room, initialSnapshot);
    }
  }

  private stopActiveRoom(roomId: string): void {
    const runtime = this.activeRooms.get(roomId);
    if (!runtime) {
      return;
    }

    clearInterval(runtime.snapshotTimer);
    clearInterval(runtime.simulationTimer);
    this.activeRooms.delete(roomId);
  }

  private simulateActiveRoom(roomId: string): void {
    const room = this.roomsById.get(roomId);
    const runtime = this.activeRooms.get(roomId);
    if (!room || !runtime) {
      this.stopActiveRoom(roomId);
      return;
    }

    const dt = 1 / SERVER_TICK_RATE;
    const projectileLife = 1.6;
    const respawnDelaySeconds = 2.5;

    this.updateBotInputs(room, runtime);
    this.maintainShapePopulation(runtime);

    for (const shape of runtime.shapes) {
      shape.rotation += shape.spin * dt;
    }

    for (const player of runtime.players) {
      const respawnTimer = runtime.respawnTimers.get(player.id) ?? 0;
      if (player.hp <= 0) {
        if (respawnTimer > 0) {
          const nextRespawnTimer = Math.max(0, respawnTimer - dt);
          runtime.respawnTimers.set(player.id, nextRespawnTimer);
          if (nextRespawnTimer <= 0) {
            const spawn = this.getSpawnPointForActivePlayer(runtime, player.id);
            player.x = spawn.x;
            player.y = spawn.y;
            player.angle = spawn.angle;
            player.hp = player.maxHp;
            this.broadcastRoom(
              room,
              this.createEventMessage(room.id, 'player-respawned', {
                playerId: player.id,
                nickname: player.nickname,
              }),
            );
          }
        } else {
          runtime.respawnTimers.set(player.id, respawnDelaySeconds);
        }
        runtime.inputs.delete(player.id);
        runtime.fireCooldowns.set(player.id, 0);
        continue;
      }

      const input = runtime.inputs.get(player.id);
      const nextCooldown = Math.max(0, (runtime.fireCooldowns.get(player.id) ?? 0) - dt);
      runtime.fireCooldowns.set(player.id, nextCooldown);
      if (!input) {
        continue;
      }

      const moveLength = Math.hypot(input.moveX, input.moveY);
      const moveScale = moveLength > 1 ? 1 / moveLength : 1;
      const velocityX = input.moveX * moveScale * player.moveSpeed;
      const velocityY = input.moveY * moveScale * player.moveSpeed;
      player.x = this.clamp(player.x + velocityX * dt, 24, WORLD_WIDTH - 24);
      player.y = this.clamp(player.y + velocityY * dt, 24, WORLD_HEIGHT - 24);
      player.angle = input.aimAngle;

      if (input.firing && nextCooldown <= 0) {
        runtime.projectileSequence += 1;
        runtime.projectiles.push({
          id: `${room.id}_p_${runtime.projectileSequence}`,
          x: player.x + Math.cos(player.angle) * 34,
          y: player.y + Math.sin(player.angle) * 34,
          angle: player.angle,
          speed: player.bulletSpeed,
          radius: player.bulletRadius,
          ownerId: player.id,
          ownerTeam: player.team,
          life: projectileLife,
          damage: player.bulletDamage,
        });
        runtime.fireCooldowns.set(player.id, player.reload);
      }
    }

    for (let index = runtime.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = runtime.projectiles[index];
      projectile.x += Math.cos(projectile.angle) * projectile.speed * dt;
      projectile.y += Math.sin(projectile.angle) * projectile.speed * dt;
      projectile.life -= dt;

      let hitShape = false;
      for (let shapeIndex = runtime.shapes.length - 1; shapeIndex >= 0; shapeIndex -= 1) {
        const shape = runtime.shapes[shapeIndex];
        if (Math.hypot(projectile.x - shape.x, projectile.y - shape.y) > projectile.radius + shape.radius) {
          continue;
        }

        const owner = runtime.players.find(entry => entry.id === projectile.ownerId);
        const actualDamage = Math.min(shape.hp, projectile.damage);
        shape.hp = Math.max(0, shape.hp - projectile.damage);
        if (owner) {
          this.awardDamageXp(owner, actualDamage, shape.maxHp, shape.xp);
        }
        if (shape.hp <= 0) {
          runtime.shapes.splice(shapeIndex, 1);
          if (owner) {
            owner.score += Math.round(shape.xp * 7.5);
          }
        }
        runtime.projectiles.splice(index, 1);
        hitShape = true;
        break;
      }

      if (hitShape) {
        continue;
      }

      let hitPlayer = false;
      for (const player of runtime.players) {
        if (player.id === projectile.ownerId || player.hp <= 0) {
          continue;
        }
        if (this.isFriendlyTarget(room, projectile.ownerId, player.id, runtime)) {
          continue;
        }
        if (Math.hypot(projectile.x - player.x, projectile.y - player.y) > projectile.radius + 24) {
          continue;
        }

        player.hp = Math.max(0, player.hp - projectile.damage);
        if (player.hp <= 0) {
          runtime.respawnTimers.set(player.id, respawnDelaySeconds);
          const owner = runtime.players.find(entry => entry.id === projectile.ownerId);
          if (owner) {
            owner.score += 1;
          }
          this.broadcastRoom(
            room,
            this.createEventMessage(room.id, 'player-eliminated', {
              victimId: player.id,
              victimNickname: player.nickname,
              attackerId: projectile.ownerId,
              attackerNickname: owner?.nickname || 'Pilot',
              respawnDelaySeconds,
            }),
          );
        }
        runtime.projectiles.splice(index, 1);
        hitPlayer = true;
        break;
      }

      if (hitPlayer) {
        continue;
      }

      if (
        projectile.life <= 0 ||
        projectile.x < -64 ||
        projectile.y < -64 ||
        projectile.x > WORLD_WIDTH + 64 ||
        projectile.y > WORLD_HEIGHT + 64
      ) {
        runtime.projectiles.splice(index, 1);
      }
    }
  }

  private tickActiveRoom(roomId: string): void {
    const room = this.roomsById.get(roomId);
    const runtime = this.activeRooms.get(roomId);
    if (!room || !runtime) {
      this.stopActiveRoom(roomId);
      return;
    }

    runtime.tick += 1;
    const snapshot = this.createSnapshotMessage(room);
    if (snapshot) {
      this.broadcastRoom(room, snapshot);
    }
  }

  private removeActivePlayer(roomId: string, playerId: string): void {
    const runtime = this.activeRooms.get(roomId);
    if (!runtime) {
      return;
    }

    runtime.players = runtime.players.filter(player => player.id !== playerId);
    runtime.inputs.delete(playerId);
    runtime.fireCooldowns.delete(playerId);
    runtime.respawnTimers.delete(playerId);
  }

  private createActivePlayers(room: Room): PlayerState[] {
    const humans = room.members.map((member, index) => {
      const spawn = this.getSpawnPointByIndex(index, Math.max(room.members.length, 1));
      const player: PlayerState = {
        id: member.playerId,
        nickname: member.nickname,
        team: this.getAssignedTeam(room, index),
        classId: 'basic',
        x: spawn.x,
        y: spawn.y,
        angle: spawn.angle,
        hp: BASE_TANK_HEALTH,
        maxHp: BASE_TANK_HEALTH,
        level: 1,
        xp: 0,
        xpNext: this.getXpNextForLevel(1),
        points: 0,
        score: 0,
        upgrades: createDefaultUpgrades(),
        moveSpeed: BASE_MOVE_SPEED,
        bulletSpeed: BASE_BULLET_SPEED,
        bulletDamage: BASE_BULLET_DAMAGE,
        reload: BASE_RELOAD,
        bulletRadius: BASE_BULLET_RADIUS,
        isBot: false,
      };
      return this.applyPlayerDerivedStats(player, true);
    });

    if (room.settings.aiEnabled === false) {
      return humans;
    }

    const botsToCreate = Math.max(0, BOT_TARGET_PLAYERS - humans.length);
    const totalSlots = humans.length + botsToCreate;
    const bots = Array.from({ length: botsToCreate }, (_unused, offset) => {
      const index = humans.length + offset;
      const spawn = this.getSpawnPointByIndex(index, Math.max(totalSlots, 1));
      const bot: PlayerState = {
        id: `bot_${crypto.randomUUID()}`,
        nickname: this.createBotName(index),
        team: this.getAssignedTeam(room, index),
        classId: 'basic',
        x: spawn.x,
        y: spawn.y,
        angle: spawn.angle,
        hp: BASE_TANK_HEALTH,
        maxHp: BASE_TANK_HEALTH,
        level: 1,
        xp: 0,
        xpNext: this.getXpNextForLevel(1),
        points: 0,
        score: 0,
        upgrades: createDefaultUpgrades(),
        moveSpeed: BASE_MOVE_SPEED,
        bulletSpeed: BASE_BULLET_SPEED,
        bulletDamage: BASE_BULLET_DAMAGE,
        reload: BASE_RELOAD,
        bulletRadius: BASE_BULLET_RADIUS,
        isBot: true,
      };
      return this.applyPlayerDerivedStats(bot, true);
    });

    return [...humans, ...bots];
  }

  private createInitialShapes(runtime: ActiveRoomRuntime): ActiveShape[] {
    const shapes: ActiveShape[] = [];
    for (const player of runtime.players) {
      const spawn = this.getSpawnPointForActivePlayer(runtime, player.id);
      shapes.push(this.createShape(runtime, 'square', spawn.x + Math.cos(spawn.angle) * 130, spawn.y + Math.sin(spawn.angle) * 130));
    }
    shapes.push(this.createShape(runtime, 'pentagon', WORLD_WIDTH / 2, WORLD_HEIGHT / 2));
    return shapes;
  }

  private createShape(runtime: ActiveRoomRuntime, kind: keyof typeof SHAPE_DEFS, x: number, y: number): ActiveShape {
    const definition = SHAPE_DEFS[kind];
    runtime.shapeSequence += 1;
    return {
      id: `shape_${runtime.shapeSequence}`,
      kind,
      x,
      y,
      radius: definition.radius,
      hp: definition.hp,
      maxHp: definition.hp,
      xp: definition.xp,
      color: definition.color,
      sides: definition.sides,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() > 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.7),
    };
  }

  private awardDamageXp(player: PlayerState, damageAmount: number, maxHp: number, totalXp: number): void {
    if (damageAmount <= 0 || maxHp <= 0 || totalXp <= 0) {
      return;
    }

    const reward = (damageAmount / maxHp) * totalXp;
    if (reward <= 0) {
      return;
    }

    this.gainPlayerXp(player, reward);
  }

  private gainPlayerXp(player: PlayerState, amount: number): void {
    player.xp += Math.max(0, amount * 3);
    while (player.xp >= player.xpNext) {
      player.xp -= player.xpNext;
      player.level += 1;
      player.points += 1;
      player.xpNext = Math.round(player.xpNext * 1.2 + 8);
      player.score += 160 + player.level * 22;
      this.applyPlayerDerivedStats(player, false);
    }
    if (player.isBot) {
      this.advanceBotBuild(player);
    }
  }

  private updateBotInputs(room: Room, runtime: ActiveRoomRuntime): void {
    for (const player of runtime.players) {
      if (!player.isBot || player.hp <= 0) {
        continue;
      }

      const target = this.chooseBotPlayerTarget(room, runtime, player);
      const shape = target ? null : this.chooseBotShapeTarget(runtime, player);
      const botSeed = this.hashString(player.id);
      let moveX = 0;
      let moveY = 0;
      let aimAngle = player.angle;
      let firing = false;

      if (target) {
        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const preferredDistance = 260 + (botSeed % 180);
        const strafeDirection = botSeed % 2 === 0 ? 1 : -1;
        const wave = Math.sin(runtime.tick * 0.045 + (botSeed % 17)) * 0.35;
        aimAngle = Math.atan2(dy, dx);
        firing = distance < 920;

        const forward = distance > preferredDistance + 80 ? 1 : distance < preferredDistance * 0.7 ? -0.85 : 0.1;
        moveX = (dx / distance) * forward + Math.cos(aimAngle + Math.PI / 2 * strafeDirection) * (0.48 + wave);
        moveY = (dy / distance) * forward + Math.sin(aimAngle + Math.PI / 2 * strafeDirection) * (0.48 + wave);
      } else if (shape) {
        const dx = shape.x - player.x;
        const dy = shape.y - player.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        aimAngle = Math.atan2(dy, dx);
        moveX = dx / distance;
        moveY = dy / distance;
        firing = distance < 760;
      } else {
        const dx = WORLD_WIDTH / 2 - player.x;
        const dy = WORLD_HEIGHT / 2 - player.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        aimAngle = Math.atan2(dy, dx);
        moveX = dx / distance;
        moveY = dy / distance;
      }

      runtime.inputs.set(player.id, {
        sequence: runtime.tick,
        moveX: this.clamp(moveX, -1, 1),
        moveY: this.clamp(moveY, -1, 1),
        aimAngle,
        firing,
      });
    }
  }

  private chooseBotPlayerTarget(room: Room, runtime: ActiveRoomRuntime, bot: PlayerState): PlayerState | null {
    let bestTarget: PlayerState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of runtime.players) {
      if (candidate.id === bot.id || candidate.hp <= 0) {
        continue;
      }
      if (this.isFriendlyTarget(room, bot.id, candidate.id, runtime)) {
        continue;
      }
      const distance = Math.hypot(candidate.x - bot.x, candidate.y - bot.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = candidate;
      }
    }
    return bestTarget;
  }

  private chooseBotShapeTarget(runtime: ActiveRoomRuntime, bot: PlayerState): ActiveShape | null {
    let bestShape: ActiveShape | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const shape of runtime.shapes) {
      const distance = Math.hypot(shape.x - bot.x, shape.y - bot.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestShape = shape;
      }
    }
    return bestShape;
  }

  private maintainShapePopulation(runtime: ActiveRoomRuntime): void {
    const targetCount = Math.max(6, runtime.players.length + 2);
    while (runtime.shapes.length < targetCount) {
      const kind: keyof typeof SHAPE_DEFS = runtime.shapes.length % 5 === 0 ? 'triangle' : runtime.shapes.length % 11 === 0 ? 'pentagon' : 'square';
      const position = this.createOpenShapePosition(runtime);
      runtime.shapes.push(this.createShape(runtime, kind, position.x, position.y));
    }
  }

  private createOpenShapePosition(runtime: ActiveRoomRuntime): { x: number; y: number } {
    let best = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    let bestDistance = -1;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = {
        x: 240 + Math.random() * (WORLD_WIDTH - 480),
        y: 240 + Math.random() * (WORLD_HEIGHT - 480),
      };
      const nearestPlayer = runtime.players.reduce((closest, player) => Math.min(closest, Math.hypot(candidate.x - player.x, candidate.y - player.y)), Number.POSITIVE_INFINITY);
      const nearestShape = runtime.shapes.reduce((closest, shape) => Math.min(closest, Math.hypot(candidate.x - shape.x, candidate.y - shape.y)), Number.POSITIVE_INFINITY);
      const score = Math.min(nearestPlayer, nearestShape);
      if (score > bestDistance) {
        bestDistance = score;
        best = candidate;
      }
    }
    return best;
  }

  private advanceBotBuild(player: PlayerState): void {
    const preferredUpgrades: UpgradeKey[] = ['bulletDamage', 'reload', 'bulletSpeed', 'moveSpeed', 'maxHealth', 'bulletPenetration', 'bodyDamage', 'regen'];
    const seed = this.hashString(player.id);
    while (player.points > 0 && player.level >= UPGRADE_UNLOCK_LEVEL) {
      let applied = false;
      for (let index = 0; index < preferredUpgrades.length; index += 1) {
        const key = preferredUpgrades[(seed + index) % preferredUpgrades.length];
        if (player.upgrades[key] >= UPGRADE_MAX_LEVEL) {
          continue;
        }
        player.upgrades[key] += 1;
        player.points -= 1;
        applied = true;
        break;
      }
      if (!applied) {
        break;
      }
    }

    for (let branchPass = 0; branchPass < 4; branchPass += 1) {
      const options = this.getClassChoicesFor(player);
      if (!options.length) {
        break;
      }
      const nextClass = options[seed % options.length];
      if (nextClass === player.classId) {
        break;
      }
      player.classId = nextClass;
    }

    this.applyPlayerDerivedStats(player, false);
  }

  private applyPlayerDerivedStats(player: PlayerState, refillHealth: boolean): PlayerState {
    const previousMax = player.maxHp || BASE_TANK_HEALTH;
    const classDef = CLASS_DEFS[player.classId] || CLASS_DEFS.basic;

    player.maxHp = Math.round((BASE_TANK_HEALTH + player.level * 2 + player.upgrades.maxHealth * 8) * (classDef.hpScale || classDef.bodyScale || 1));
    player.moveSpeed = (BASE_MOVE_SPEED + player.upgrades.moveSpeed * 12) * (classDef.moveSpeedScale || 1);
    player.bulletSpeed = (BASE_BULLET_SPEED + player.upgrades.bulletSpeed * 35) * (classDef.bulletSpeedScale || 1);
    player.bulletDamage = (BASE_BULLET_DAMAGE + player.level * 0.35 + player.upgrades.bulletDamage * 3.5) * (classDef.bulletDamageScale || 1);
    player.reload = Math.max(0.08, BASE_RELOAD * Math.pow(0.92, player.upgrades.reload) * (classDef.reloadScale || 1));
    player.bulletRadius = Math.max(4, Math.round((BASE_BULLET_RADIUS + Math.min(4, Math.floor(player.level / 15))) * (classDef.bulletRadiusScale || 1)));

    if (refillHealth) {
      player.hp = player.maxHp;
    } else {
      player.hp = this.clamp((player.hp || previousMax) + (player.maxHp - previousMax) * 0.5, 1, player.maxHp);
    }

    return player;
  }

  private getClassChoicesFor(player: PlayerState): string[] {
    const choices = CLASS_CHOICE_TREE[player.classId] || [];
    return choices.filter(choice => player.level >= choice.level).flatMap(choice => choice.options);
  }

  private cloneUpgrades(upgrades: PlayerUpgradeState): PlayerUpgradeState {
    return {
      regen: upgrades.regen,
      maxHealth: upgrades.maxHealth,
      bodyDamage: upgrades.bodyDamage,
      bulletSpeed: upgrades.bulletSpeed,
      bulletPenetration: upgrades.bulletPenetration,
      bulletDamage: upgrades.bulletDamage,
      reload: upgrades.reload,
      moveSpeed: upgrades.moveSpeed,
    };
  }

  private getXpNextForLevel(level: number): number {
    let xpNext = 24;
    const capped = Math.max(1, Math.floor(level || 1));
    for (let current = 1; current < capped; current += 1) {
      xpNext = Math.round(xpNext * 1.2 + 8);
    }
    return xpNext;
  }

  private getSpawnPoint(room: Room, playerId: string): { x: number; y: number; angle: number } {
    const memberIndex = Math.max(0, room.members.findIndex(member => member.playerId === playerId));
    return this.getSpawnPointByIndex(memberIndex, room.members.length);
  }

  private getSpawnPointForActivePlayer(runtime: ActiveRoomRuntime, playerId: string): { x: number; y: number; angle: number } {
    const index = Math.max(0, runtime.players.findIndex(player => player.id === playerId));
    return this.getSpawnPointByIndex(index, Math.max(1, runtime.players.length));
  }

  private getSpawnPointByIndex(index: number, memberCount: number): { x: number; y: number; angle: number } {
    const centerX = WORLD_WIDTH / 2;
    const centerY = WORLD_HEIGHT / 2;
    const radius = 220;
    const count = Math.max(1, memberCount);
    const angle = (Math.PI * 2 * index) / count;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      angle,
    };
  }

  private getPlayerTeam(room: Room, playerId: string): string {
    const runtime = this.activeRooms.get(room.id);
    const runtimePlayer = runtime?.players.find(player => player.id === playerId);
    if (runtimePlayer) {
      return runtimePlayer.team;
    }
    const hostTeam = room.settings.hostTeam === 'red' ? 'red' : 'blue';
    const alternateTeam = hostTeam === 'red' ? 'blue' : 'red';
    const memberIndex = room.members.findIndex(member => member.playerId === playerId);
    if (memberIndex <= 0) {
      return hostTeam;
    }
    return memberIndex % 2 === 1 ? alternateTeam : hostTeam;
  }

  private isFriendlyTarget(room: Room, attackerId: string, targetId: string, runtime: ActiveRoomRuntime): boolean {
    if (room.settings.gameVariant === 'ffa') {
      return false;
    }
    const attacker = runtime.players.find(player => player.id === attackerId);
    const target = runtime.players.find(player => player.id === targetId);
    return !!attacker && !!target && attacker.team === target.team;
  }

  private getAssignedTeam(room: Room, slotIndex: number): string {
    if (room.settings.gameVariant === 'ffa') {
      return FFA_TEAM_COLORS[slotIndex % FFA_TEAM_COLORS.length];
    }
    const hostTeam = room.settings.hostTeam === 'red' ? 'red' : 'blue';
    const alternateTeam = hostTeam === 'red' ? 'blue' : 'red';
    return slotIndex % 2 === 0 ? hostTeam : alternateTeam;
  }

  private createBotName(index: number): string {
    const prefix = BOT_NAME_PREFIXES[index % BOT_NAME_PREFIXES.length];
    const suffix = BOT_NAME_SUFFIXES[Math.floor(index / BOT_NAME_PREFIXES.length) % BOT_NAME_SUFFIXES.length];
    return `${prefix} ${suffix}`;
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getRoomByCode(code: string): Room | undefined {
    const normalizedCode = String(code).trim().toUpperCase();
    const roomId = this.roomIdByCode.get(normalizedCode);
    return roomId ? this.roomsById.get(roomId) : undefined;
  }

  private generateRoomCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 24; attempt += 1) {
      let code = '';
      for (let index = 0; index < 5; index += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.roomIdByCode.has(code)) {
        return code;
      }
    }
    return `P${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
}
