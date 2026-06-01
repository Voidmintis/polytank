import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  type EventMessage,
  type MatchStartMessage,
  type WorldBreakoutCoreState,
  type WorldCtfFlagState,
  type WorldMothershipCageState,
  type WorldMothershipState,
  type WorldMazeWallState,
  type RoomAccess,
  type RoomRosterEntry,
  type RoomSettings,
  type RoomStateMessage,
  type SnapshotMessage,
  type ServerMessage,
  type WorldDominatorState,
  type WorldObjectiveState,
  type WorldProjectileState,
  type WorldShapeState,
} from '../../src/shared/protocol.js';
import {
  RECONNECT_GRACE_MS,
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
  reconnectToken: string;
  nickname: string;
  roomId: string | null;
}

interface RoomMember {
  playerId: string;
  sessionId: string;
  reconnectToken: string;
  nickname: string;
  ready: boolean;
  isHost: boolean;
  socket: WebSocket | null;
  disconnectedAt: number | null;
}

interface Room {
  id: string;
  code: string;
  access: RoomAccess;
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
  dominators: ActiveDominator[];
  breakoutCores: ActiveBreakoutCore[];
  mazeWalls: ActiveMazeWall[];
  cageWall: ActiveMothershipCageWall | null;
  enemyMothership: ActiveMothership | null;
  ctfFlags: ActiveCtfFlag[];
  objective: WorldObjectiveState;
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
  homingTurn?: number;
  homingTargetTeam?: string;
}

interface ActiveDominator {
  id: string;
  side: string;
  kind: 'gun' | 'destroyer' | 'trapper';
  label: string;
  team: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  aimAngle: number;
  shotCooldown: number;
}

interface ActiveCtfFlag {
  team: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  carrierId: string;
  atBase: boolean;
  returnTimer: number;
}

interface ActiveBreakoutCore {
  team: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
}

interface ActiveMazeWall {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ActiveMothershipCageWall {
  id: string;
  x1: number;
  x2: number;
  y: number;
  topY: number;
  thickness: number;
  hp: number;
  maxHp: number;
  released: boolean;
}

interface ActiveMothership {
  id: string;
  label: string;
  team: string;
  x: number;
  y: number;
  radius: number;
  renderScale: number;
  hp: number;
  maxHp: number;
  aimAngle: number;
  released: boolean;
  releaseProgress: number;
  releaseStartX: number;
  releaseStartY: number;
  releaseTargetX: number;
  releaseTargetY: number;
  barTimer: number;
  spinAngle: number;
  bodyColor: string;
  barrelColor: string;
  bulletColor: string;
  cagedBodyColor: string;
  cagedBarrelColor: string;
  cagedBulletColor: string;
  targetBodyColor: string;
  targetBarrelColor: string;
  targetBulletColor: string;
  entryDrift: number;
  shotTimer: number;
  homingTimer: number;
  summonTimer: number;
  laserCooldown: number;
  laserWindup: number;
  laserActive: number;
  laserAngle: number;
  laserTurnRate: number;
  laserTick: number;
  laserWidth: number;
  laserRange: number;
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
const PREFERRED_PUBLIC_ROOM_MEMBERS = BOT_TARGET_PLAYERS;
const FFA_TEAM_COLORS = ['blue', 'red', 'green', 'purple', 'yellow'] as const;
const FOUR_TEAM_COLORS = ['blue', 'red', 'green', 'purple'] as const;
const BOT_NAME_PREFIXES = ['Nova', 'Cipher', 'Vector', 'Pulse', 'Drift', 'Ion', 'Shard', 'Orbit'] as const;
const BOT_NAME_SUFFIXES = ['Wing', 'Core', 'Bolt', 'Trace', 'Flux', 'Drive', 'Hex', 'Ray'] as const;
const MOTHERSHIP_MINION_ID_PREFIX = 'mothership_minion_';
const MOTHERSHIP_CLOSER_LEFT_ID = 'mothership_closer_left';
const MOTHERSHIP_CLOSER_RIGHT_ID = 'mothership_closer_right';
const CANONICAL_GAME_VARIANTS = new Set([
  'ffa',
  '2teams',
  '4teams',
  'maze',
  'sandbox',
  'domination',
  'tag',
  'breakout',
  'ctf',
  'mothership',
]);

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
  hexagon: { radius: 38, hp: 220, xp: 48, color: '#9a7cf4', sides: 6 },
} as const;

const DOMINATOR_DEFS = {
  gun: { maxHp: 224000, radius: 198, reload: 0.42, bulletSpeed: 760, bulletDamage: 34, bulletRadius: 13, range: 1080 },
  destroyer: { maxHp: 250000, radius: 206, reload: 1.72, bulletSpeed: 520, bulletDamage: 118, bulletRadius: 24, range: 1220 },
  trapper: { maxHp: 230000, radius: 198, reload: 1.04, bulletSpeed: 360, bulletDamage: 48, bulletRadius: 18, range: 980 },
} as const;

const VALID_CAPTURE_TEAMS = new Set(['blue', 'red', 'green', 'purple', 'yellow']);

export class RoomManager {
  private readonly roomsById = new Map<string, Room>();
  private readonly roomIdByCode = new Map<string, string>();
  private readonly activeRooms = new Map<string, ActiveRoomRuntime>();

  constructor(private readonly now: () => number) {}

  private normalizeGameVariant(value: string): string {
    const key = String(value || '').trim().toLowerCase();
    if (key === 'standard') {
      return '2teams';
    }
    return CANONICAL_GAME_VARIANTS.has(key) ? key : 'ffa';
  }

  private getSelectableTeamsForVariant(gameVariant: string): readonly string[] {
    if (gameVariant === '4teams') {
      return FOUR_TEAM_COLORS;
    }
    if (gameVariant === 'ffa' || gameVariant === 'sandbox' || gameVariant === 'mothership') {
      return ['blue'];
    }
    return ['blue', 'red'];
  }

  private getOrderedTeamsForRoom(room: Room): readonly string[] {
    const selectableTeams = this.getSelectableTeamsForVariant(room.settings.gameVariant);
    const hostTeamIndex = selectableTeams.indexOf(room.settings.hostTeam);
    if (hostTeamIndex <= 0) {
      return selectableTeams;
    }
    return [...selectableTeams.slice(hostTeamIndex), ...selectableTeams.slice(0, hostTeamIndex)];
  }

  private normalizeRoomSettings(settings: RoomSettings): RoomSettings {
    const gameVariant = this.normalizeGameVariant(settings.gameVariant);
    const selectableTeams = this.getSelectableTeamsForVariant(gameVariant);
    const fallbackTeam = selectableTeams[0] || 'blue';
    const hostTeam = selectableTeams.includes(settings.hostTeam) ? settings.hostTeam : fallbackTeam;

    return {
      gameVariant,
      aiEnabled: settings.aiEnabled !== false,
      hostTeam,
    };
  }

  private createRoomRecord(access: RoomAccess, settings: RoomSettings): Room {
    return {
      id: crypto.randomUUID(),
      code: this.generateRoomCode(),
      access,
      status: 'lobby',
      settings: this.normalizeRoomSettings(settings),
      members: [],
      createdAt: this.now(),
    };
  }

  private addMemberToRoom(room: Room, connection: ConnectionContext, nickname: string, isHost: boolean): RoomMember {
    const member: RoomMember = {
      playerId: connection.playerId,
      sessionId: connection.sessionId,
      reconnectToken: connection.reconnectToken,
      nickname,
      ready: room.access === 'public',
      isHost,
      socket: connection.socket,
      disconnectedAt: null,
    };
    room.members.push(member);
    connection.nickname = nickname;
    connection.roomId = room.id;
    return member;
  }

  createRoom(connection: ConnectionContext, nickname: string, settings: RoomSettings): RoomActionResult {
    if (connection.roomId) {
      this.leaveRoom(connection, connection.roomId);
    }

    const room = this.createRoomRecord('private', settings);
    this.addMemberToRoom(room, connection, nickname, true);

    this.roomsById.set(room.id, room);
    this.roomIdByCode.set(room.code, room.id);
    return { room };
  }

  quickJoinRoom(connection: ConnectionContext, nickname: string, settings: RoomSettings): RoomActionResult {
    if (connection.roomId) {
      this.leaveRoom(connection, connection.roomId);
    }

    const candidateRoom = this.findQuickJoinRoom(settings);
    const room = candidateRoom ? (this.pruneExpiredConnections(candidateRoom), this.roomsById.get(candidateRoom.id)) : undefined;
    if (room) {
      if (room.members.length >= MAX_ROOM_MEMBERS) {
        return { error: { code: 'ROOM_FULL', message: 'Public room is already full.' } };
      }
      if (room.members.some(member => member.playerId === connection.playerId)) {
        return { room };
      }

      const member = this.addMemberToRoom(room, connection, nickname, false);
      if (room.status === 'active') {
        this.addActivePlayer(room, member);
      }
      return { room };
    }

    const createdRoom = this.createRoomRecord('public', settings);
    this.addMemberToRoom(createdRoom, connection, nickname, true);
    createdRoom.status = 'active';

    this.roomsById.set(createdRoom.id, createdRoom);
    this.roomIdByCode.set(createdRoom.code, createdRoom.id);
    this.startActiveRoom(createdRoom);
    return { room: createdRoom, started: true };
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

    room.settings = this.normalizeRoomSettings(settings);
    return { room };
  }

  joinRoom(connection: ConnectionContext, roomCode: string, nickname: string): RoomActionResult {
    const room = this.getRoomByCode(roomCode);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room code was not found.' } };
    }
    if (room.access !== 'private') {
      return { error: { code: 'ROOM_NOT_JOINABLE', message: 'Public rooms must be joined through quick join.' } };
    }
    this.pruneExpiredConnections(room);
    if (room.status !== 'lobby') {
      return { error: { code: 'ROOM_NOT_JOINABLE', message: 'Room is no longer joinable.' } };
    }
    if (room.members.length >= MAX_ROOM_MEMBERS) {
      return { error: { code: 'ROOM_FULL', message: 'Room is already full.' } };
    }
    if (room.members.some(member => member.playerId === connection.playerId)) {
      return { room };
    }

    this.addMemberToRoom(room, connection, nickname, false);
    return { room };
  }

  leaveRoom(connection: ConnectionContext, roomId: string): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }

    this.pruneExpiredConnections(room);

    room.members = room.members.filter(member => member.playerId !== connection.playerId);
    this.removeActivePlayer(room.id, connection.playerId);
    this.rebalanceActiveRoomPopulation(room);
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
    const room = this.roomsById.get(connection.roomId);
    if (!room) {
      connection.roomId = null;
      return {};
    }

    if (room.status !== 'active') {
      return this.leaveRoom(connection, connection.roomId);
    }

    const member = room.members.find(entry => entry.playerId === connection.playerId);
    if (!member) {
      connection.roomId = null;
      return {};
    }

    member.socket = null;
    member.disconnectedAt = this.now();
    connection.roomId = null;
    return { room };
  }

  resumeConnection(connection: ConnectionContext, roomId: string, reconnectToken: string): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }

    this.pruneExpiredConnections(room);

    const member = room.members.find(entry => entry.reconnectToken === reconnectToken);
    if (!member) {
      return { error: { code: 'RECONNECT_NOT_FOUND', message: 'Reconnect token is invalid for this room.' } };
    }
    if (member.disconnectedAt === null) {
      return { error: { code: 'RECONNECT_NOT_PENDING', message: 'Player is already connected.' } };
    }
    if (this.now() - member.disconnectedAt > RECONNECT_GRACE_MS) {
      this.pruneExpiredConnections(room);
      return { error: { code: 'RECONNECT_EXPIRED', message: 'Reconnect window has expired.' } };
    }

    member.socket = connection.socket;
    member.disconnectedAt = null;
    connection.playerId = member.playerId;
    connection.sessionId = member.sessionId;
    connection.reconnectToken = member.reconnectToken;
    connection.nickname = member.nickname;
    connection.roomId = room.id;
    return { room };
  }

  setReady(connection: ConnectionContext, roomId: string, ready: boolean): RoomActionResult {
    const room = this.roomsById.get(roomId);
    if (!room) {
      return { error: { code: 'ROOM_NOT_FOUND', message: 'Room was not found.' } };
    }
    this.pruneExpiredConnections(room);
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
    this.pruneExpiredConnections(room);
    return {
      type: 'roomState',
      version: PROTOCOL_VERSION,
      timestamp: this.now(),
      payload: {
        roomId: room.id,
        roomCode: room.code,
        access: room.access,
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
        dominators: runtime.dominators.map<WorldDominatorState>(dominator => ({
          id: dominator.id,
          side: dominator.side,
          kind: dominator.kind,
          label: dominator.label,
          team: dominator.team,
          x: dominator.x,
          y: dominator.y,
          radius: dominator.radius,
          hp: dominator.hp,
          maxHp: dominator.maxHp,
        })),
        breakoutCores: runtime.breakoutCores.map<WorldBreakoutCoreState>(core => ({
          team: core.team,
          x: core.x,
          y: core.y,
          hp: core.hp,
          maxHp: core.maxHp,
          radius: core.radius,
        })),
        mazeWalls: runtime.mazeWalls.map<WorldMazeWallState>(wall => ({
          x: wall.x,
          y: wall.y,
          w: wall.w,
          h: wall.h,
        })),
        cageWall: runtime.cageWall
          ? {
              id: runtime.cageWall.id,
              x1: runtime.cageWall.x1,
              x2: runtime.cageWall.x2,
              y: runtime.cageWall.y,
              topY: runtime.cageWall.topY,
              thickness: runtime.cageWall.thickness,
              hp: runtime.cageWall.hp,
              maxHp: runtime.cageWall.maxHp,
              released: runtime.cageWall.released,
            }
          : null,
        enemyMothership: runtime.enemyMothership
          ? {
              id: runtime.enemyMothership.id,
              label: runtime.enemyMothership.label,
              team: runtime.enemyMothership.team,
              x: runtime.enemyMothership.x,
              y: runtime.enemyMothership.y,
              radius: runtime.enemyMothership.radius,
              renderScale: runtime.enemyMothership.renderScale,
              hp: runtime.enemyMothership.hp,
              maxHp: runtime.enemyMothership.maxHp,
              aimAngle: runtime.enemyMothership.aimAngle,
              released: runtime.enemyMothership.released,
              releaseProgress: runtime.enemyMothership.releaseProgress,
              releaseStartX: runtime.enemyMothership.releaseStartX,
              releaseStartY: runtime.enemyMothership.releaseStartY,
              releaseTargetX: runtime.enemyMothership.releaseTargetX,
              releaseTargetY: runtime.enemyMothership.releaseTargetY,
              barTimer: runtime.enemyMothership.barTimer,
              spinAngle: runtime.enemyMothership.spinAngle,
              bodyColor: runtime.enemyMothership.bodyColor,
              barrelColor: runtime.enemyMothership.barrelColor,
              bulletColor: runtime.enemyMothership.bulletColor,
              laserWindup: runtime.enemyMothership.laserWindup,
              laserActive: runtime.enemyMothership.laserActive,
              laserAngle: runtime.enemyMothership.laserAngle,
              laserWidth: runtime.enemyMothership.laserWidth,
              laserRange: runtime.enemyMothership.laserRange,
            }
          : null,
        ctfFlags: runtime.ctfFlags.map<WorldCtfFlagState>(flag => ({
          team: flag.team,
          x: flag.x,
          y: flag.y,
          homeX: flag.homeX,
          homeY: flag.homeY,
          carrierId: flag.carrierId,
          atBase: flag.atBase,
          returnTimer: flag.returnTimer,
        })),
        objective: { ...runtime.objective, ctfScores: { ...runtime.objective.ctfScores } },
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
    this.pruneExpiredConnections(room);
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
    this.pruneExpiredConnections(room);
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
    this.pruneExpiredConnections(room);
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
      if (!member.socket || member.socket.readyState !== 1) {
        continue;
      }
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
      dominators: this.createInitialDominators(room),
      breakoutCores: this.createInitialBreakoutCores(room),
      mazeWalls: this.createInitialMazeWalls(room),
      cageWall: this.createInitialMothershipCageWall(room),
      enemyMothership: this.createInitialEncounterMothership(room),
      ctfFlags: this.createInitialCtfFlags(room),
      objective: this.createInitialObjectiveState(),
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

    runtime.shapes = this.createInitialShapes(room, runtime);
    this.maintainShapePopulation(room, runtime);

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
    this.updateObjectiveState(room, runtime, dt);
    this.updateMothershipEncounterState(runtime, dt);
    this.updateMothershipEndgameState(room, runtime, dt);
    this.maintainShapePopulation(room, runtime);
    this.updateDominators(room, runtime, dt);

    for (const shape of runtime.shapes) {
      shape.rotation += shape.spin * dt;
    }

    const removedPlayerIds = new Set<string>();
    for (const player of runtime.players) {
      const respawnTimer = runtime.respawnTimers.get(player.id) ?? 0;
      if (player.hp <= 0) {
        if (this.shouldRemoveDefeatedPlayer(player)) {
          removedPlayerIds.add(player.id);
          runtime.inputs.delete(player.id);
          runtime.fireCooldowns.delete(player.id);
          runtime.respawnTimers.delete(player.id);
          continue;
        }

        if (runtime.objective.mothershipEndgame) {
          runtime.inputs.delete(player.id);
          runtime.fireCooldowns.set(player.id, 0);
          runtime.respawnTimers.delete(player.id);
          continue;
        }

        if (respawnTimer > 0) {
          const nextRespawnTimer = Math.max(0, respawnTimer - dt);
          runtime.respawnTimers.set(player.id, nextRespawnTimer);
          if (nextRespawnTimer <= 0) {
            const spawn = this.getSpawnPointForActivePlayer(room, runtime, player.id);
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
      this.resolveMazeTankCollisions(player, runtime.mazeWalls);
      this.resolveMothershipCageCollision(player, runtime.cageWall);
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
      this.updateHomingProjectile(runtime, projectile, dt);
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

      let hitDominator = false;
      for (const dominator of runtime.dominators) {
        if (this.isFriendlyDominatorTarget(projectile.ownerTeam, dominator.team)) {
          continue;
        }
        if (Math.hypot(projectile.x - dominator.x, projectile.y - dominator.y) > projectile.radius + dominator.radius) {
          continue;
        }

        this.damageDominator(room, runtime, dominator, projectile.ownerId, projectile.ownerTeam, projectile.damage);
        runtime.projectiles.splice(index, 1);
        hitDominator = true;
        break;
      }

      if (hitDominator) {
        continue;
      }

      let hitBreakoutCore = false;
      for (const core of runtime.breakoutCores) {
        if (core.team === projectile.ownerTeam || core.hp <= 0) {
          continue;
        }
        if (Math.hypot(projectile.x - core.x, projectile.y - core.y) > projectile.radius + core.radius) {
          continue;
        }

        core.hp = Math.max(0, core.hp - projectile.damage * 1.4);
        if (core.hp <= 0) {
          runtime.objective.breakoutWinner = core.team === 'blue' ? 'red' : 'blue';
        }
        runtime.projectiles.splice(index, 1);
        hitBreakoutCore = true;
        break;
      }

      if (hitBreakoutCore) {
        continue;
      }

      if (this.projectileHitsMazeWall(projectile, runtime.mazeWalls)) {
        runtime.projectiles.splice(index, 1);
        continue;
      }

      if (this.projectileHitsMothershipCage(projectile, runtime.cageWall)) {
        this.damageMothershipCage(runtime, projectile.ownerId, projectile.ownerTeam, projectile.damage);
        runtime.projectiles.splice(index, 1);
        continue;
      }

      if (this.projectileHitsEncounterMothership(projectile, runtime.enemyMothership)) {
        this.damageEncounterMothership(runtime, projectile.ownerId, projectile.ownerTeam, projectile.damage);
        runtime.projectiles.splice(index, 1);
        continue;
      }

      let hitPlayer = false;
      for (const player of runtime.players) {
        if (player.id === projectile.ownerId || player.hp <= 0) {
          continue;
        }
        if (this.isWipeCloserId(player.id)) {
          continue;
        }
        if (projectile.ownerTeam === player.team && projectile.ownerTeam !== 'neutral') {
          continue;
        }
        if (Math.hypot(projectile.x - player.x, projectile.y - player.y) > projectile.radius + 24) {
          continue;
        }

        player.hp = Math.max(0, player.hp - projectile.damage);
        if (player.hp <= 0) {
          const respawnDelayForKill = runtime.objective.mothershipEndgame ? 0 : respawnDelaySeconds;
          if (respawnDelayForKill > 0) {
            runtime.respawnTimers.set(player.id, respawnDelayForKill);
          } else {
            runtime.respawnTimers.delete(player.id);
          }
          const owner = runtime.players.find(entry => entry.id === projectile.ownerId);
          const ownerDominator = runtime.dominators.find(entry => entry.id === projectile.ownerId);
          this.applyTagEliminationConversion(room, owner, player);
          if (owner) {
            owner.score += 1;
          }
          this.broadcastRoom(
            room,
            this.createEventMessage(room.id, 'player-eliminated', {
              victimId: player.id,
              victimNickname: player.nickname,
              attackerId: projectile.ownerId,
              attackerNickname: owner?.nickname || ownerDominator?.label || 'Pilot',
              respawnDelaySeconds: respawnDelayForKill,
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

    if (removedPlayerIds.size > 0) {
      runtime.players = runtime.players.filter(player => !removedPlayerIds.has(player.id));
    }
  }

  private tickActiveRoom(roomId: string): void {
    const room = this.roomsById.get(roomId);
    const runtime = this.activeRooms.get(roomId);
    if (!room || !runtime) {
      this.stopActiveRoom(roomId);
      return;
    }

    this.pruneExpiredConnections(room);
    if (!this.roomsById.has(roomId)) {
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

  private createInitialObjectiveState(): WorldObjectiveState {
    return {
      dominationTeam: '',
      dominationHold: 0,
      dominationLocked: false,
      breakoutWinner: '',
      ctfWinner: '',
      mothershipEndgame: false,
      endgameSpectateId: '',
      ctfScores: {
        blue: 0,
        red: 0,
      },
    };
  }

  private createInitialDominators(room: Room): ActiveDominator[] {
    if (room.settings.gameVariant !== 'domination') {
      return [];
    }

    const offsetX = Math.min(1300, Math.max(920, WORLD_WIDTH * 0.14));
    const offsetY = Math.min(900, Math.max(620, WORLD_HEIGHT * 0.16));
    const configs = [
      { side: 'north-west', x: WORLD_WIDTH * 0.5 - offsetX, y: WORLD_HEIGHT * 0.5 - offsetY, kind: 'gun', label: 'Northwest Gun Dominator' },
      { side: 'north-east', x: WORLD_WIDTH * 0.5 + offsetX, y: WORLD_HEIGHT * 0.5 - offsetY, kind: 'destroyer', label: 'Northeast Destroyer Dominator' },
      { side: 'south-west', x: WORLD_WIDTH * 0.5 - offsetX, y: WORLD_HEIGHT * 0.5 + offsetY, kind: 'trapper', label: 'Southwest Trapper Dominator' },
      { side: 'south-east', x: WORLD_WIDTH * 0.5 + offsetX, y: WORLD_HEIGHT * 0.5 + offsetY, kind: 'gun', label: 'Southeast Gun Dominator' },
    ] as const;

    return configs.map(config => ({
      id: `dominator_${config.side}`,
      side: config.side,
      kind: config.kind,
      label: config.label,
      team: 'neutral',
      x: config.x,
      y: config.y,
      radius: DOMINATOR_DEFS[config.kind].radius,
      hp: DOMINATOR_DEFS[config.kind].maxHp,
      maxHp: DOMINATOR_DEFS[config.kind].maxHp,
      aimAngle: 0,
      shotCooldown: 0.35 + Math.random() * 0.5,
    }));
  }

  private createInitialCtfFlags(room: Room): ActiveCtfFlag[] {
    if (room.settings.gameVariant !== 'ctf') {
      return [];
    }

    return [
      {
        team: 'blue',
        x: 300,
        y: WORLD_HEIGHT / 2,
        homeX: 300,
        homeY: WORLD_HEIGHT / 2,
        carrierId: '',
        atBase: true,
        returnTimer: 0,
      },
      {
        team: 'red',
        x: WORLD_WIDTH - 300,
        y: WORLD_HEIGHT / 2,
        homeX: WORLD_WIDTH - 300,
        homeY: WORLD_HEIGHT / 2,
        carrierId: '',
        atBase: true,
        returnTimer: 0,
      },
    ];
  }

  private createInitialBreakoutCores(room: Room): ActiveBreakoutCore[] {
    if (room.settings.gameVariant !== 'breakout') {
      return [];
    }

    return [
      {
        team: 'blue',
        x: 230,
        y: WORLD_HEIGHT / 2,
        hp: 16000,
        maxHp: 16000,
        radius: 92,
      },
      {
        team: 'red',
        x: WORLD_WIDTH - 230,
        y: WORLD_HEIGHT / 2,
        hp: 16000,
        maxHp: 16000,
        radius: 92,
      },
    ];
  }

  private createInitialMazeWalls(room: Room): ActiveMazeWall[] {
    if (room.settings.gameVariant !== 'maze') {
      return [];
    }

    const halfW = 260;
    const halfH = 220;
    return [
      { x: WORLD_WIDTH * 0.5 - 1200, y: WORLD_HEIGHT * 0.5 - halfH, w: 1900, h: 110 },
      { x: WORLD_WIDTH * 0.5 - 760, y: WORLD_HEIGHT * 0.5 - 1100, w: 110, h: 1500 },
      { x: WORLD_WIDTH * 0.5 + 360, y: WORLD_HEIGHT * 0.5 - 280, w: 1700, h: 110 },
      { x: WORLD_WIDTH * 0.5 + 920, y: WORLD_HEIGHT * 0.5 - 420, w: 110, h: 1600 },
      { x: WORLD_WIDTH * 0.5 - 1800, y: WORLD_HEIGHT * 0.5 + 620, w: 1600, h: 110 },
      { x: WORLD_WIDTH * 0.5 - 120, y: WORLD_HEIGHT * 0.5 + 980, w: 1900, h: 110 },
      { x: WORLD_WIDTH * 0.5 - halfW, y: WORLD_HEIGHT * 0.5 - halfH, w: halfW * 2, h: 95 },
      { x: WORLD_WIDTH * 0.5 - halfW, y: WORLD_HEIGHT * 0.5 + halfH - 95, w: halfW * 2, h: 95 },
      { x: WORLD_WIDTH * 0.5 - halfW, y: WORLD_HEIGHT * 0.5 - halfH, w: 95, h: halfH * 2 },
      { x: WORLD_WIDTH * 0.5 + halfW - 95, y: WORLD_HEIGHT * 0.5 - halfH, w: 95, h: halfH * 2 },
    ];
  }

  private createInitialMothershipCageWall(room: Room): ActiveMothershipCageWall | null {
    if (room.settings.gameVariant !== 'mothership') {
      return null;
    }

    const span = 1180;
    return {
      id: 'mothership_cage_wall',
      x1: WORLD_WIDTH / 2 - span,
      x2: WORLD_WIDTH / 2 + span,
      y: 180,
      topY: -780,
      thickness: 140,
      hp: 550000,
      maxHp: 550000,
      released: false,
    };
  }

  private createInitialEncounterMothership(room: Room): ActiveMothership | null {
    if (room.settings.gameVariant !== 'mothership') {
      return null;
    }

    return {
      id: 'encounter_mothership',
      label: 'Mothership',
      team: 'red',
      x: WORLD_WIDTH / 2,
      y: -320,
      radius: 1360,
      renderScale: 0.415,
      hp: 1540000,
      maxHp: 1540000,
      aimAngle: Math.PI * 0.5,
      released: false,
      releaseProgress: 0,
      releaseStartX: WORLD_WIDTH / 2,
      releaseStartY: -320,
      releaseTargetX: WORLD_WIDTH / 2,
      releaseTargetY: 1120,
      barTimer: 0,
      spinAngle: 0,
      bodyColor: '#7f858d',
      barrelColor: '#b8bec6',
      bulletColor: '#d5d9de',
      cagedBodyColor: '#7f858d',
      cagedBarrelColor: '#b8bec6',
      cagedBulletColor: '#d5d9de',
      targetBodyColor: '#d85872',
      targetBarrelColor: '#ff97a9',
      targetBulletColor: '#ffbbc8',
      entryDrift: 0,
      shotTimer: 1.5,
      homingTimer: 0.7,
      summonTimer: 4.8,
      laserCooldown: 12,
      laserWindup: 0,
      laserActive: 0,
      laserAngle: Math.PI * 0.5,
      laserTurnRate: 0.56,
      laserTick: 0,
      laserWidth: 92,
      laserRange: 3600,
    };
  }

  private resolveMazeTankCollisions(player: PlayerState, mazeWalls: ActiveMazeWall[]): void {
    if (!mazeWalls.length) {
      return;
    }

    for (const wall of mazeWalls) {
      const nearestX = this.clamp(player.x, wall.x, wall.x + wall.w);
      const nearestY = this.clamp(player.y, wall.y, wall.y + wall.h);
      const dx = player.x - nearestX;
      const dy = player.y - nearestY;
      const distanceSq = dx * dx + dy * dy;
      const minDistance = 26;
      if (distanceSq >= minDistance * minDistance) {
        continue;
      }

      const distance = Math.sqrt(Math.max(distanceSq, 0.0001));
      const push = minDistance - distance;
      player.x += (dx / distance) * push;
      player.y += (dy / distance) * push;
    }

    player.x = this.clamp(player.x, 24, WORLD_WIDTH - 24);
    player.y = this.clamp(player.y, 24, WORLD_HEIGHT - 24);
  }

  private projectileHitsMazeWall(projectile: ActiveProjectile, mazeWalls: ActiveMazeWall[]): boolean {
    if (!mazeWalls.length) {
      return false;
    }

    for (const wall of mazeWalls) {
      const nearestX = this.clamp(projectile.x, wall.x, wall.x + wall.w);
      const nearestY = this.clamp(projectile.y, wall.y, wall.y + wall.h);
      if (Math.hypot(projectile.x - nearestX, projectile.y - nearestY) < projectile.radius + 1) {
        return true;
      }
    }
    return false;
  }

  private updateObjectiveState(room: Room, runtime: ActiveRoomRuntime, dt: number): void {
    if (room.settings.gameVariant !== 'mothership') {
      runtime.objective.mothershipEndgame = false;
      runtime.objective.endgameSpectateId = '';
    }

    if (room.settings.gameVariant === 'domination') {
      runtime.objective.breakoutWinner = '';
      const teams = runtime.dominators.map(dominator => dominator.team);
      const heldTeam = teams.length > 0 && teams.every(team => team === teams[0]) && teams[0] !== 'neutral' ? teams[0] : '';

      runtime.objective.ctfWinner = '';
      runtime.objective.ctfScores.blue = 0;
      runtime.objective.ctfScores.red = 0;
      if (heldTeam && heldTeam === runtime.objective.dominationTeam) {
        runtime.objective.dominationHold = Math.min(12, runtime.objective.dominationHold + dt);
        runtime.objective.dominationLocked = runtime.objective.dominationHold >= 12;
        return;
      }

      runtime.objective.dominationTeam = heldTeam;
      runtime.objective.dominationHold = 0;
      runtime.objective.dominationLocked = false;
      return;
    }

    runtime.objective.dominationTeam = '';
    runtime.objective.dominationHold = 0;
    runtime.objective.dominationLocked = false;
    if (room.settings.gameVariant === 'mothership') {
      runtime.objective.breakoutWinner = '';
      runtime.objective.ctfWinner = '';
      runtime.objective.ctfScores.blue = 0;
      runtime.objective.ctfScores.red = 0;
      return;
    }
    if (room.settings.gameVariant === 'breakout') {
      runtime.objective.ctfWinner = '';
      runtime.objective.ctfScores.blue = 0;
      runtime.objective.ctfScores.red = 0;
      return;
    }
    if (room.settings.gameVariant !== 'ctf') {
      runtime.objective.breakoutWinner = '';
      runtime.objective.ctfWinner = '';
      runtime.objective.ctfScores.blue = 0;
      runtime.objective.ctfScores.red = 0;
      return;
    }

    runtime.objective.breakoutWinner = '';
    this.updateCtfObjectiveState(runtime, dt);
  }

  private updateDominators(room: Room, runtime: ActiveRoomRuntime, dt: number): void {
    if (room.settings.gameVariant !== 'domination') {
      return;
    }

    for (const dominator of runtime.dominators) {
      dominator.shotCooldown = Math.max(0, dominator.shotCooldown - dt);
      const target = this.chooseDominatorTarget(runtime, dominator);
      if (!target) {
        dominator.aimAngle += dt * (dominator.kind === 'trapper' ? 0.92 : 0.35);
        continue;
      }

      dominator.aimAngle = Math.atan2(target.y - dominator.y, target.x - dominator.x);
      if (dominator.shotCooldown <= 0) {
        this.fireDominator(runtime, dominator);
      }
    }
  }

  private chooseDominatorTarget(runtime: ActiveRoomRuntime, dominator: ActiveDominator): PlayerState | null {
    let bestTarget: PlayerState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const definition = DOMINATOR_DEFS[dominator.kind];
    for (const player of runtime.players) {
      if (player.hp <= 0) {
        continue;
      }
      if (dominator.team !== 'neutral' && player.team === dominator.team) {
        continue;
      }
      const distance = Math.hypot(player.x - dominator.x, player.y - dominator.y);
      if (distance < bestDistance && distance <= definition.range) {
        bestDistance = distance;
        bestTarget = player;
      }
    }
    return bestTarget;
  }

  private fireDominator(runtime: ActiveRoomRuntime, dominator: ActiveDominator): void {
    const definition = DOMINATOR_DEFS[dominator.kind];
    runtime.projectileSequence += 1;
    runtime.projectiles.push({
      id: `${dominator.id}_p_${runtime.projectileSequence}`,
      x: dominator.x + Math.cos(dominator.aimAngle) * (dominator.radius * 0.62),
      y: dominator.y + Math.sin(dominator.aimAngle) * (dominator.radius * 0.62),
      angle: dominator.aimAngle,
      speed: definition.bulletSpeed,
      radius: definition.bulletRadius,
      ownerId: dominator.id,
      ownerTeam: dominator.team,
      life: dominator.kind === 'trapper' ? 2.1 : 1.6,
      damage: definition.bulletDamage,
    });
    dominator.shotCooldown = definition.reload;
  }

  private updateMothershipEncounterState(runtime: ActiveRoomRuntime, dt: number): void {
    const mothership = runtime.enemyMothership;
    const cageWall = runtime.cageWall;
    if (!mothership || mothership.hp <= 0) {
      return;
    }

    mothership.barTimer = Math.max(0, mothership.barTimer - dt);
    mothership.shotTimer = Math.max(0, mothership.shotTimer - dt);
    mothership.homingTimer = Math.max(0, mothership.homingTimer - dt);
    mothership.summonTimer = Math.max(0, mothership.summonTimer - dt);
    mothership.entryDrift += dt;
    mothership.spinAngle += dt * 0.11;
    if (!mothership.released) {
      mothership.bodyColor = mothership.cagedBodyColor;
      mothership.barrelColor = mothership.cagedBarrelColor;
      mothership.bulletColor = mothership.cagedBulletColor;
      mothership.x = WORLD_WIDTH / 2 + Math.sin(mothership.entryDrift * 0.32) * 140;
      mothership.y = (cageWall ? cageWall.topY : -780) + 430 + Math.sin(mothership.entryDrift * 0.55) * 20;
      const cagedTarget = this.getEncounterTarget(runtime, 'blue', mothership.x, mothership.y, 3400);
      if (cagedTarget) {
        mothership.aimAngle = Math.atan2(cagedTarget.y - mothership.y, cagedTarget.x - mothership.x);
      }
      return;
    }

    if (mothership.releaseProgress < 1) {
      mothership.releaseProgress = Math.min(1, mothership.releaseProgress + dt / 5.4);
      const colorBlend = this.clamp(mothership.releaseProgress / 0.42, 0, 1);
      const moveBlend = this.clamp((mothership.releaseProgress - 0.16) / 0.84, 0, 1);
      const easedMove = 1 - Math.pow(1 - moveBlend, 3);
      mothership.bodyColor = this.blendHexColors(mothership.cagedBodyColor, mothership.targetBodyColor, colorBlend);
      mothership.barrelColor = this.blendHexColors(mothership.cagedBarrelColor, mothership.targetBarrelColor, colorBlend);
      mothership.bulletColor = this.blendHexColors(mothership.cagedBulletColor, mothership.targetBulletColor, colorBlend);
      mothership.x = this.lerpValue(mothership.releaseStartX, mothership.releaseTargetX, easedMove) + Math.sin(runtime.tick * 0.048) * 110 * (1 - easedMove * 0.45);
      mothership.y = this.lerpValue(mothership.releaseStartY, mothership.releaseTargetY, easedMove) + Math.sin(runtime.tick * 0.031) * 34 * (1 - easedMove * 0.35);
      const breakoutTarget = this.getEncounterTarget(runtime, 'blue', mothership.x, mothership.y, 3600);
      if (breakoutTarget) {
        mothership.aimAngle = Math.atan2(breakoutTarget.y - mothership.y, breakoutTarget.x - mothership.x);
      }
      return;
    }

    const travelX = Math.min(1680, WORLD_WIDTH * 0.27);
    mothership.x = this.clamp(WORLD_WIDTH / 2 + Math.sin(runtime.tick * 0.013) * travelX, 520, WORLD_WIDTH - 520);
    mothership.y = this.clamp(1120 + Math.sin(runtime.tick * 0.021) * 180, 540, WORLD_HEIGHT * 0.55);
    mothership.bodyColor = mothership.targetBodyColor;
    mothership.barrelColor = mothership.targetBarrelColor;
    mothership.bulletColor = mothership.targetBulletColor;
    const target = this.getEncounterTarget(runtime, 'blue', mothership.x, mothership.y, 3600);
    if (target) {
      mothership.aimAngle = Math.atan2(target.y - mothership.y, target.x - mothership.x);
    }
    if (mothership.shotTimer <= 0) {
      this.fireEncounterMothershipVolley(runtime, mothership, mothership.aimAngle);
      mothership.shotTimer = 0.92;
      mothership.barTimer = Math.max(mothership.barTimer, 1.2);
    }

    if (mothership.homingTimer <= 0) {
      this.fireEncounterMothershipHoming(runtime, mothership, mothership.aimAngle);
      mothership.homingTimer = 0.52;
      mothership.barTimer = Math.max(mothership.barTimer, 0.9);
    }

    if (mothership.laserActive > 0) {
      mothership.laserActive = Math.max(0, mothership.laserActive - dt);
      mothership.laserAngle = (mothership.laserAngle || mothership.aimAngle) + mothership.laserTurnRate * dt;
      mothership.laserTick = Math.max(0, mothership.laserTick - dt);
      while (mothership.laserTick <= 0 && mothership.laserActive > 0) {
        const renderRadius = mothership.radius * mothership.renderScale;
        const startX = mothership.x + Math.cos(mothership.laserAngle) * (renderRadius - 12);
        const startY = mothership.y + Math.sin(mothership.laserAngle) * (renderRadius - 12);
        const endX = startX + Math.cos(mothership.laserAngle) * mothership.laserRange;
        const endY = startY + Math.sin(mothership.laserAngle) * mothership.laserRange;
        for (const player of runtime.players) {
          if (player.team !== 'blue' || player.hp <= 0 || this.isWipeCloserId(player.id)) {
            continue;
          }
          if (this.pointSegmentDistance(player.x, player.y, startX, startY, endX, endY) < 24 + mothership.laserWidth) {
            player.hp = Math.max(0, player.hp - 75);
          }
        }
        mothership.laserTick += 0.3;
      }
      mothership.barTimer = Math.max(mothership.barTimer, 1.1);
      if (mothership.laserActive <= 0) {
        mothership.laserCooldown = 18 + Math.random() * 8;
      }
    } else if (mothership.laserWindup > 0) {
      mothership.laserWindup = Math.max(0, mothership.laserWindup - dt);
      mothership.laserAngle = mothership.aimAngle;
      mothership.barTimer = Math.max(mothership.barTimer, 0.8);
      if (mothership.laserWindup <= 0) {
        mothership.laserActive = 10;
        mothership.laserTick = 0;
        mothership.laserTurnRate = (Math.random() > 0.5 ? 1 : -1) * (0.34 + Math.random() * 0.18);
      }
    } else {
      mothership.laserCooldown = Math.max(0, mothership.laserCooldown - dt);
      if (mothership.laserCooldown <= 0) {
        mothership.laserWindup = 1.6;
        mothership.laserAngle = mothership.aimAngle;
      }
    }

    const activeMinions = runtime.players.filter(player => this.isMothershipMinionId(player.id) && player.hp > 0).length;
    if (mothership.summonTimer <= 0 && activeMinions < 10) {
      this.spawnEncounterMothershipMinion(runtime, mothership);
      mothership.summonTimer = 3.8 + Math.random() * 1.6;
    }
  }

  private updateMothershipEndgameState(room: Room, runtime: ActiveRoomRuntime, dt: number): void {
    if (!runtime.objective.mothershipEndgame) {
      return;
    }

    for (const closer of runtime.players.filter(player => this.isWipeCloserId(player.id))) {
      closer.hp = closer.maxHp;
      closer.angle = closer.id === MOTHERSHIP_CLOSER_LEFT_ID ? 0 : Math.PI;
      closer.x += (closer.id === MOTHERSHIP_CLOSER_LEFT_ID ? 1 : -1) * closer.moveSpeed * dt * 1.2;
      closer.y = WORLD_HEIGHT * 0.5 + Math.sin(runtime.tick * 0.045 + (closer.id === MOTHERSHIP_CLOSER_LEFT_ID ? 0 : Math.PI)) * 180;

      const purgeRadius = 520;
      runtime.shapes = runtime.shapes.filter(shape => Math.hypot(shape.x - closer.x, shape.y - closer.y) >= purgeRadius + shape.radius);

      for (const player of runtime.players) {
        if (player.id === closer.id || player.hp <= 0 || this.isWipeCloserId(player.id)) {
          continue;
        }
        if (Math.hypot(player.x - closer.x, player.y - closer.y) >= purgeRadius + 40) {
          continue;
        }

        player.hp = 0;
        runtime.respawnTimers.delete(player.id);
        this.broadcastRoom(
          room,
          this.createEventMessage(room.id, 'player-eliminated', {
            victimId: player.id,
            victimNickname: player.nickname,
            attackerId: closer.id,
            attackerNickname: 'Arena Closer',
            respawnDelaySeconds: 0,
          }),
        );
      }
    }
  }

  private getEncounterTarget(
    runtime: ActiveRoomRuntime,
    team: string,
    fromX: number,
    fromY: number,
    maxDistance = Number.POSITIVE_INFINITY,
  ): PlayerState | null {
    let bestTarget: PlayerState | null = null;
    let bestDistance = maxDistance;
    for (const player of runtime.players) {
      if (player.hp <= 0 || player.team !== team) {
        continue;
      }
      const distance = Math.hypot(player.x - fromX, player.y - fromY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = player;
      }
    }
    return bestTarget;
  }

  private fireEncounterMothershipVolley(runtime: ActiveRoomRuntime, mothership: ActiveMothership, targetAngle: number): void {
    const renderRadius = mothership.radius * mothership.renderScale;
    for (let index = 0; index < 5; index += 1) {
      const angle = targetAngle + (index - 2) * 0.11;
      const speed = 430 + Math.abs(index - 2) * 18;
      runtime.projectileSequence += 1;
      runtime.projectiles.push({
        id: `mothership_p_${runtime.projectileSequence}`,
        x: mothership.x + Math.cos(angle) * (renderRadius + 92),
        y: mothership.y + Math.sin(angle) * (renderRadius + 92),
        angle,
        speed,
        radius: 22,
        ownerId: mothership.id,
        ownerTeam: mothership.team,
        life: 3.8,
        damage: 62,
      });
    }
  }

  private fireEncounterMothershipHoming(runtime: ActiveRoomRuntime, mothership: ActiveMothership, targetAngle: number): void {
    const renderRadius = mothership.radius * mothership.renderScale;
    for (let index = 0; index < 6; index += 1) {
      const angle = targetAngle + (index - 2.5) * 0.18;
      const speed = 360 + Math.abs(index - 2.5) * 10;
      runtime.projectileSequence += 1;
      runtime.projectiles.push({
        id: `mothership_h_${runtime.projectileSequence}`,
        x: mothership.x + Math.cos(angle) * (renderRadius + 76),
        y: mothership.y + Math.sin(angle) * (renderRadius + 76),
        angle,
        speed,
        radius: 8,
        ownerId: mothership.id,
        ownerTeam: mothership.team,
        life: 4.5,
        damage: 18,
        homingTurn: 2.8,
        homingTargetTeam: 'blue',
      });
    }
  }

  private spawnEncounterMothershipMinion(runtime: ActiveRoomRuntime, mothership: ActiveMothership): void {
    const orbitAngle = Math.random() * Math.PI * 2;
    const spawnDistance = mothership.radius * mothership.renderScale + 180 + Math.random() * 120;
    const classOptions = ['twin', 'machine_gun', 'sniper', 'destroyer', 'flank_guard'] as const;
    const minion: PlayerState = {
      id: `${MOTHERSHIP_MINION_ID_PREFIX}${crypto.randomUUID()}`,
      nickname: this.createBotName(runtime.players.length),
      team: 'red',
      classId: classOptions[Math.floor(Math.random() * classOptions.length)] || 'twin',
      x: this.clamp(mothership.x + Math.cos(orbitAngle) * spawnDistance, 220, WORLD_WIDTH - 220),
      y: this.clamp(mothership.y + Math.sin(orbitAngle) * spawnDistance, 220, WORLD_HEIGHT - 220),
      angle: Math.PI * 0.5,
      hp: BASE_TANK_HEALTH,
      maxHp: BASE_TANK_HEALTH,
      level: 22 + Math.floor(Math.random() * 16),
      xp: 0,
      xpNext: this.getXpNextForLevel(22),
      points: 0,
      score: 0,
      upgrades: {
        regen: 2,
        maxHealth: 4,
        bodyDamage: 2,
        bulletSpeed: 5,
        bulletPenetration: 4,
        bulletDamage: 5,
        reload: 5,
        moveSpeed: 3,
      },
      moveSpeed: BASE_MOVE_SPEED,
      bulletSpeed: BASE_BULLET_SPEED,
      bulletDamage: BASE_BULLET_DAMAGE,
      reload: BASE_RELOAD,
      bulletRadius: BASE_BULLET_RADIUS,
      isBot: true,
    };
    runtime.players.push(this.applyPlayerDerivedStats(minion, true));
  }

  private spawnWipeCloser(side: 'left' | 'right'): PlayerState {
    return {
      id: side === 'left' ? MOTHERSHIP_CLOSER_LEFT_ID : MOTHERSHIP_CLOSER_RIGHT_ID,
      nickname: 'ARENA CLOSER',
      team: 'red',
      classId: 'destroyer',
      x: side === 'left' ? -220 : WORLD_WIDTH + 220,
      y: WORLD_HEIGHT * 0.5,
      angle: side === 'left' ? 0 : Math.PI,
      hp: 1_000_000,
      maxHp: 1_000_000,
      level: 45,
      xp: 0,
      xpNext: this.getXpNextForLevel(45),
      points: 0,
      score: 0,
      upgrades: createDefaultUpgrades(),
      moveSpeed: 420,
      bulletSpeed: BASE_BULLET_SPEED,
      bulletDamage: BASE_BULLET_DAMAGE,
      reload: BASE_RELOAD,
      bulletRadius: BASE_BULLET_RADIUS,
      isBot: true,
    };
  }

  private resolveMothershipCageCollision(player: PlayerState, cageWall: ActiveMothershipCageWall | null): void {
    if (!cageWall || cageWall.released) {
      return;
    }

    const halfThickness = cageWall.thickness * 0.5;
    if (player.x + 24 < cageWall.x1 || player.x - 24 > cageWall.x2) {
      return;
    }
    if (player.team === 'blue' && player.y - 24 < cageWall.y + halfThickness) {
      player.y = cageWall.y + halfThickness + 24;
    }
    if (player.team === 'red' && player.y + 24 > cageWall.y - halfThickness) {
      player.y = cageWall.y - halfThickness - 24;
    }
  }

  private projectileHitsMothershipCage(projectile: ActiveProjectile, cageWall: ActiveMothershipCageWall | null): boolean {
    if (!cageWall || cageWall.released || projectile.ownerTeam !== 'blue') {
      return false;
    }

    const distanceToWall = this.pointSegmentDistance(projectile.x, projectile.y, cageWall.x1, cageWall.y, cageWall.x2, cageWall.y);
    return distanceToWall < projectile.radius + cageWall.thickness * 0.5;
  }

  private projectileHitsEncounterMothership(projectile: ActiveProjectile, mothership: ActiveMothership | null): boolean {
    if (!mothership || mothership.hp <= 0 || !mothership.released || projectile.ownerTeam !== 'blue') {
      return false;
    }

    return Math.hypot(projectile.x - mothership.x, projectile.y - mothership.y) < projectile.radius + this.getMothershipHitRadius(mothership);
  }

  private damageMothershipCage(runtime: ActiveRoomRuntime, ownerId: string, ownerTeam: string, amount: number): void {
    const cageWall = runtime.cageWall;
    const mothership = runtime.enemyMothership;
    if (!cageWall || !mothership || cageWall.released || amount <= 0 || ownerTeam !== 'blue') {
      return;
    }

    cageWall.hp = Math.max(0, cageWall.hp - amount);
    if (cageWall.hp > 0) {
      return;
    }

    cageWall.hp = 0;
    cageWall.released = true;
    mothership.released = true;
    mothership.releaseProgress = 0;
    mothership.releaseStartX = mothership.x;
    mothership.releaseStartY = mothership.y;
    mothership.releaseTargetX = WORLD_WIDTH / 2;
    mothership.releaseTargetY = this.clamp(cageWall.y + 920, 540, WORLD_HEIGHT * 0.55);
    mothership.barTimer = 5;
  }

  private damageEncounterMothership(runtime: ActiveRoomRuntime, ownerId: string, ownerTeam: string, amount: number): void {
    const mothership = runtime.enemyMothership;
    if (!mothership || mothership.hp <= 0 || amount <= 0 || ownerTeam !== 'blue') {
      return;
    }

    mothership.hp = Math.max(0, mothership.hp - amount);
    mothership.barTimer = Math.max(mothership.barTimer, 2.8);
    if (mothership.hp > 0) {
      return;
    }

    const owner = runtime.players.find(player => player.id === ownerId);
    if (owner) {
      owner.score += 22_000;
    }
    this.startMothershipEndgame(runtime);
    runtime.enemyMothership = null;
  }

  private startMothershipEndgame(runtime: ActiveRoomRuntime): void {
    if (runtime.objective.mothershipEndgame) {
      return;
    }

    runtime.objective.mothershipEndgame = true;
    const leftCloser = this.spawnWipeCloser('left');
    const rightCloser = this.spawnWipeCloser('right');
    runtime.players.push(leftCloser, rightCloser);
    runtime.objective.endgameSpectateId = leftCloser.id || rightCloser.id;
    for (const player of runtime.players) {
      if (!this.isWipeCloserId(player.id)) {
        runtime.respawnTimers.delete(player.id);
      }
    }
  }

  private updateHomingProjectile(runtime: ActiveRoomRuntime, projectile: ActiveProjectile, dt: number): void {
    if (!projectile.homingTurn || !projectile.homingTargetTeam) {
      return;
    }

    const target = this.getEncounterTarget(runtime, projectile.homingTargetTeam, projectile.x, projectile.y, 2200);
    if (!target) {
      return;
    }

    const desiredAngle = Math.atan2(target.y - projectile.y, target.x - projectile.x);
    const delta = this.normalizeAngle(desiredAngle - projectile.angle);
    const maxTurn = projectile.homingTurn * dt;
    projectile.angle += this.clamp(delta, -maxTurn, maxTurn);
  }

  private shouldRemoveDefeatedPlayer(player: PlayerState): boolean {
    return this.isMothershipMinionId(player.id);
  }

  private isMothershipMinionId(playerId: string): boolean {
    return playerId.startsWith(MOTHERSHIP_MINION_ID_PREFIX);
  }

  private isWipeCloserId(playerId: string): boolean {
    return playerId === MOTHERSHIP_CLOSER_LEFT_ID || playerId === MOTHERSHIP_CLOSER_RIGHT_ID;
  }

  private normalizeAngle(angle: number): number {
    let nextAngle = angle;
    while (nextAngle > Math.PI) {
      nextAngle -= Math.PI * 2;
    }
    while (nextAngle < -Math.PI) {
      nextAngle += Math.PI * 2;
    }
    return nextAngle;
  }

  private getMothershipHitRadius(mothership: ActiveMothership): number {
    return Math.max(80, mothership.radius * mothership.renderScale);
  }

  private lerpValue(from: number, to: number, t: number): number {
    return from + (to - from) * t;
  }

  private blendHexColors(from: string, to: string, t: number): string {
    const parse = (value: string) => {
      const normalized = value.replace('#', '');
      return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16),
      };
    };
    const fromColor = parse(from);
    const toColor = parse(to);
    const channel = (left: number, right: number) => Math.round(left + (right - left) * t).toString(16).padStart(2, '0');
    return `#${channel(fromColor.r, toColor.r)}${channel(fromColor.g, toColor.g)}${channel(fromColor.b, toColor.b)}`;
  }

  private pointSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0) {
      return Math.hypot(px - x1, py - y1);
    }
    const t = this.clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1);
    const nearestX = x1 + dx * t;
    const nearestY = y1 + dy * t;
    return Math.hypot(px - nearestX, py - nearestY);
  }

  private updateCtfObjectiveState(runtime: ActiveRoomRuntime, dt: number): void {
    if (runtime.ctfFlags.length !== 2 || runtime.objective.ctfWinner) {
      return;
    }

    const livingPlayers = runtime.players.filter(player => player.hp > 0);
    for (const flag of runtime.ctfFlags) {
      if (flag.carrierId) {
        const carrier = livingPlayers.find(player => player.id === flag.carrierId);
        if (!carrier) {
          flag.carrierId = '';
          flag.atBase = false;
          flag.returnTimer = 6;
          continue;
        }

        flag.x = carrier.x;
        flag.y = carrier.y - 22;
        const ownFlag = runtime.ctfFlags.find(entry => entry.team === carrier.team);
        if (!ownFlag) {
          continue;
        }
        const ownBaseDistance = Math.hypot(carrier.x - ownFlag.homeX, carrier.y - ownFlag.homeY);
        if (carrier.team !== flag.team && ownFlag.atBase && ownBaseDistance < 180) {
          const nextScore = (runtime.objective.ctfScores[carrier.team as 'blue' | 'red'] || 0) + 1;
          runtime.objective.ctfScores[carrier.team as 'blue' | 'red'] = nextScore;
          flag.carrierId = '';
          flag.atBase = true;
          flag.returnTimer = 0;
          flag.x = flag.homeX;
          flag.y = flag.homeY;
          if (nextScore >= 3) {
            runtime.objective.ctfWinner = carrier.team;
          }
        }
        continue;
      }

      if (!flag.atBase) {
        flag.returnTimer = Math.max(0, flag.returnTimer - dt);
        if (flag.returnTimer <= 0) {
          flag.atBase = true;
          flag.x = flag.homeX;
          flag.y = flag.homeY;
        }
      }

      for (const player of livingPlayers) {
        if (player.team === flag.team) {
          continue;
        }
        if (runtime.ctfFlags.some(entry => entry.carrierId === player.id)) {
          continue;
        }
        if (Math.hypot(player.x - flag.x, player.y - flag.y) >= 48) {
          continue;
        }

        flag.carrierId = player.id;
        flag.atBase = false;
        flag.returnTimer = 0;
        flag.x = player.x;
        flag.y = player.y - 22;
        break;
      }
    }
  }

  private applyTagEliminationConversion(room: Room, owner: PlayerState | undefined, victim: PlayerState): void {
    if (room.settings.gameVariant !== 'tag' || !owner) {
      return;
    }
    if (owner.id === victim.id || owner.team === victim.team) {
      return;
    }
    if (owner.team === 'neutral' || owner.team === 'yellow') {
      return;
    }

    victim.team = owner.team;
  }

  private damageDominator(
    room: Room,
    runtime: ActiveRoomRuntime,
    dominator: ActiveDominator,
    ownerId: string,
    ownerTeam: string,
    damage: number,
  ): void {
    if (damage <= 0 || dominator.hp <= 0) {
      return;
    }

    const scaledDamage = damage * 0.18;
    dominator.hp = Math.max(0, dominator.hp - scaledDamage);
    if (dominator.hp > 0) {
      return;
    }

    const captureTeam = this.getDominatorCaptureTeam(room, runtime, ownerId, ownerTeam);
    const previousTeam = dominator.team;
    dominator.hp = dominator.maxHp;

    if (!captureTeam) {
      dominator.team = 'neutral';
      return;
    }

    dominator.team = previousTeam !== 'neutral' && previousTeam !== captureTeam ? 'neutral' : captureTeam;
  }

  private getDominatorCaptureTeam(
    room: Room,
    runtime: ActiveRoomRuntime,
    ownerId: string,
    ownerTeam: string,
  ): string {
    if (VALID_CAPTURE_TEAMS.has(ownerTeam)) {
      return ownerTeam;
    }

    const owner = runtime.players.find(player => player.id === ownerId);
    if (owner && VALID_CAPTURE_TEAMS.has(owner.team)) {
      return owner.team;
    }

    if (ownerId) {
      const fallbackTeam = this.getPlayerTeam(room, ownerId);
      if (VALID_CAPTURE_TEAMS.has(fallbackTeam)) {
        return fallbackTeam;
      }
    }

    return '';
  }

  private pruneExpiredConnections(room: Room): void {
    if (room.status !== 'active') {
      return;
    }

    const expiredPlayerIds: string[] = [];
    room.members = room.members.filter(member => {
      if (member.disconnectedAt === null) {
        return true;
      }
      if (this.now() - member.disconnectedAt <= RECONNECT_GRACE_MS) {
        return true;
      }
      expiredPlayerIds.push(member.playerId);
      return false;
    });

    for (const playerId of expiredPlayerIds) {
      this.removeActivePlayer(room.id, playerId);
    }
    this.rebalanceActiveRoomPopulation(room);

    if (room.members.length === 0) {
      this.stopActiveRoom(room.id);
      this.roomsById.delete(room.id);
      this.roomIdByCode.delete(room.code);
      return;
    }

    if (!room.members.some(member => member.isHost)) {
      room.members[0].isHost = true;
    }
  }

  private createActivePlayers(room: Room): PlayerState[] {
    const humans = room.members.map(member => this.createActiveHumanPlayer(room, member));

    if (room.settings.aiEnabled === false) {
      return humans;
    }

    const botsToCreate = Math.max(0, BOT_TARGET_PLAYERS - humans.length);
    const bots = Array.from({ length: botsToCreate }, (_unused, offset) => {
      const slotIndex = humans.length + offset;
      return this.createActiveBotPlayer(room, slotIndex, humans.length + botsToCreate);
    });

    return [...humans, ...bots];
  }

  private createActiveHumanPlayer(room: Room, member: RoomMember): PlayerState {
    const slotIndex = Math.max(0, room.members.findIndex(entry => entry.playerId === member.playerId));
    const team = this.getAssignedTeam(room, slotIndex);
    const spawn = this.getSpawnPoint(room, member.playerId);
    const player: PlayerState = {
      id: member.playerId,
      nickname: member.nickname,
      team,
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
  }

  private createActiveBotPlayer(room: Room, slotIndex: number, totalSlots: number): PlayerState {
    const team = this.getAssignedTeam(room, slotIndex);
    const slotTeams = Array.from({ length: Math.max(totalSlots, 1) }, (_unused, index) => this.getAssignedTeam(room, index));
    const { teamSlotIndex, teamCount } = this.getTeamSlotInfo(slotTeams, slotIndex, team);
    const spawn = this.getSpawnPointForVariant(room.settings.gameVariant, team, teamSlotIndex, teamCount, slotIndex, Math.max(totalSlots, 1));
    const bot: PlayerState = {
      id: `bot_${crypto.randomUUID()}`,
      nickname: this.createBotName(slotIndex),
      team,
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
  }

  private addActivePlayer(room: Room, member: RoomMember): void {
    const runtime = this.activeRooms.get(room.id);
    if (!runtime) {
      return;
    }
    if (runtime.players.some(player => player.id === member.playerId)) {
      return;
    }

    runtime.players.push(this.createActiveHumanPlayer(room, member));
    this.rebalanceActiveRoomPopulation(room);
  }

  private rebalanceActiveRoomPopulation(room: Room): void {
    const runtime = this.activeRooms.get(room.id);
    if (!runtime) {
      return;
    }

    if (room.settings.aiEnabled === false) {
      const removedBotIds = runtime.players.filter(player => player.isBot).map(player => player.id);
      runtime.players = runtime.players.filter(player => !player.isBot);
      for (const playerId of removedBotIds) {
        runtime.inputs.delete(playerId);
        runtime.fireCooldowns.delete(playerId);
        runtime.respawnTimers.delete(playerId);
      }
      return;
    }

    const humans = runtime.players.filter(player => !player.isBot);
    const specialBots = runtime.players.filter(player => player.isBot && (this.isWipeCloserId(player.id) || this.isMothershipMinionId(player.id)));
    const bots = runtime.players.filter(player => player.isBot && !this.isWipeCloserId(player.id) && !this.isMothershipMinionId(player.id));
    const desiredBotCount = Math.max(0, BOT_TARGET_PLAYERS - room.members.length);

    if (bots.length > desiredBotCount) {
      const keptBots = bots.slice(0, desiredBotCount);
      const removedBotIds = bots.slice(desiredBotCount).map(player => player.id);
      runtime.players = [...humans, ...keptBots, ...specialBots];
      for (const playerId of removedBotIds) {
        runtime.inputs.delete(playerId);
        runtime.fireCooldowns.delete(playerId);
        runtime.respawnTimers.delete(playerId);
      }
      return;
    }

    let nextPlayers = [...humans, ...bots, ...specialBots];
    while (nextPlayers.filter(player => player.isBot && !this.isWipeCloserId(player.id) && !this.isMothershipMinionId(player.id)).length < desiredBotCount) {
      const bot = this.createActiveBotPlayer(room, nextPlayers.length, room.members.length + desiredBotCount);
      nextPlayers = [...nextPlayers, bot];
    }
    runtime.players = nextPlayers;
  }

  private createInitialShapes(room: Room, runtime: ActiveRoomRuntime): ActiveShape[] {
    if (room.settings.gameVariant === 'domination') {
      return [];
    }

    const shapes: ActiveShape[] = [];
    for (const player of runtime.players) {
      const spawn = this.getSpawnPointForActivePlayer(room, runtime, player.id);
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
      if (!player.isBot || player.hp <= 0 || this.isWipeCloserId(player.id)) {
        continue;
      }

      const target = this.chooseBotTarget(room, runtime, player);
      const botSeed = this.hashString(player.id);
      let moveX = 0;
      let moveY = 0;
      let aimAngle = player.angle;
      let firing = false;

      if (target?.type === 'player' || target?.type === 'dominator') {
        const dx = target.entity.x - player.x;
        const dy = target.entity.y - player.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const preferredDistance = 260 + (botSeed % 180);
        const strafeDirection = botSeed % 2 === 0 ? 1 : -1;
        const wave = Math.sin(runtime.tick * 0.045 + (botSeed % 17)) * 0.35;
        aimAngle = Math.atan2(dy, dx);
        firing = distance < (target.type === 'dominator' ? 1120 : 920);

        const forward = distance > preferredDistance + 80 ? 1 : distance < preferredDistance * 0.7 ? -0.85 : 0.1;
        moveX = (dx / distance) * forward + Math.cos(aimAngle + Math.PI / 2 * strafeDirection) * (0.48 + wave);
        moveY = (dy / distance) * forward + Math.sin(aimAngle + Math.PI / 2 * strafeDirection) * (0.48 + wave);
      } else if (target?.type === 'shape') {
        const dx = target.entity.x - player.x;
        const dy = target.entity.y - player.y;
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

  private chooseBotTarget(
    room: Room,
    runtime: ActiveRoomRuntime,
    bot: PlayerState,
  ): { type: 'player'; entity: PlayerState } | { type: 'shape'; entity: ActiveShape } | { type: 'dominator'; entity: ActiveDominator } | null {
    if (room.settings.gameVariant === 'domination') {
      const dominator = this.chooseBotDominatorTarget(runtime, bot);
      const player = this.chooseBotPlayerTarget(room, runtime, bot);
      if (dominator && (!player || Math.hypot(dominator.x - bot.x, dominator.y - bot.y) <= Math.hypot(player.x - bot.x, player.y - bot.y) * 1.15)) {
        return { type: 'dominator', entity: dominator };
      }
      if (player) {
        return { type: 'player', entity: player };
      }
    } else {
      const player = this.chooseBotPlayerTarget(room, runtime, bot);
      if (player) {
        return { type: 'player', entity: player };
      }
    }

    const shape = this.chooseBotShapeTarget(runtime, bot);
    return shape ? { type: 'shape', entity: shape } : null;
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

  private chooseBotDominatorTarget(runtime: ActiveRoomRuntime, bot: PlayerState): ActiveDominator | null {
    let bestTarget: ActiveDominator | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const dominator of runtime.dominators) {
      if (dominator.team === bot.team) {
        continue;
      }
      const distance = Math.hypot(dominator.x - bot.x, dominator.y - bot.y);
      if (distance < bestDistance && distance < 2100) {
        bestDistance = distance;
        bestTarget = dominator;
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

  private maintainShapePopulation(room: Room, runtime: ActiveRoomRuntime): void {
    if (room.settings.gameVariant === 'domination') {
      this.maintainDominationShapePopulation(runtime);
      return;
    }

    const targetCount = Math.max(6, runtime.players.length + 2);
    while (runtime.shapes.length < targetCount) {
      const kind: keyof typeof SHAPE_DEFS = runtime.shapes.length % 5 === 0 ? 'triangle' : runtime.shapes.length % 11 === 0 ? 'pentagon' : 'square';
      const position = this.createOpenShapePosition(runtime, 'wide');
      runtime.shapes.push(this.createShape(runtime, kind, position.x, position.y));
    }
  }

  private maintainDominationShapePopulation(runtime: ActiveRoomRuntime): void {
    const centerBand = 240;
    const leftCounts: Record<keyof typeof SHAPE_DEFS, number> = { square: 0, triangle: 0, pentagon: 0, hexagon: 0 };
    const rightCounts: Record<keyof typeof SHAPE_DEFS, number> = { square: 0, triangle: 0, pentagon: 0, hexagon: 0 };
    const centerCounts: Record<keyof typeof SHAPE_DEFS, number> = { square: 0, triangle: 0, pentagon: 0, hexagon: 0 };

    for (const shape of runtime.shapes) {
      if (!(shape.kind in leftCounts)) {
        continue;
      }
      const kind = shape.kind as keyof typeof SHAPE_DEFS;
      if (shape.x < WORLD_WIDTH / 2 - centerBand) {
        leftCounts[kind] += 1;
      } else if (shape.x > WORLD_WIDTH / 2 + centerBand) {
        rightCounts[kind] += 1;
      } else {
        centerCounts[kind] += 1;
      }
    }

    const mirroredTargets: Array<{ kind: keyof typeof SHAPE_DEFS; perSide: number }> = [
      { kind: 'square', perSide: 8 },
      { kind: 'triangle', perSide: 4 },
    ];

    for (const target of mirroredTargets) {
      while (leftCounts[target.kind] < target.perSide) {
        const position = this.createOpenShapePosition(runtime, 'left');
        runtime.shapes.push(this.createShape(runtime, target.kind, position.x, position.y));
        leftCounts[target.kind] += 1;
      }
      while (rightCounts[target.kind] < target.perSide) {
        const position = this.createOpenShapePosition(runtime, 'right');
        runtime.shapes.push(this.createShape(runtime, target.kind, position.x, position.y));
        rightCounts[target.kind] += 1;
      }
    }

    while (centerCounts.pentagon < 4) {
      const position = this.createOpenShapePosition(runtime, 'center');
      runtime.shapes.push(this.createShape(runtime, 'pentagon', position.x, position.y));
      centerCounts.pentagon += 1;
    }

    while (centerCounts.hexagon < 2) {
      const position = this.createOpenShapePosition(runtime, 'center');
      runtime.shapes.push(this.createShape(runtime, 'hexagon', position.x, position.y));
      centerCounts.hexagon += 1;
    }
  }

  private createOpenShapePosition(runtime: ActiveRoomRuntime, region: 'wide' | 'left' | 'right' | 'center'): { x: number; y: number } {
    let best = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    let bestDistance = -1;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = this.createShapeCandidate(region);
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

  private createShapeCandidate(region: 'wide' | 'left' | 'right' | 'center'): { x: number; y: number } {
    const padding = 240;
    if (region === 'left') {
      return {
        x: padding + Math.random() * Math.max(120, WORLD_WIDTH * 0.5 - 2 * padding),
        y: padding + Math.random() * (WORLD_HEIGHT - 2 * padding),
      };
    }
    if (region === 'right') {
      return {
        x: WORLD_WIDTH * 0.5 + Math.random() * Math.max(120, WORLD_WIDTH * 0.5 - 2 * padding),
        y: padding + Math.random() * (WORLD_HEIGHT - 2 * padding),
      };
    }
    if (region === 'center') {
      return {
        x: WORLD_WIDTH * 0.5 - 760 + Math.random() * 1520,
        y: WORLD_HEIGHT * 0.5 - 660 + Math.random() * 1320,
      };
    }
    return {
      x: padding + Math.random() * (WORLD_WIDTH - 2 * padding),
      y: padding + Math.random() * (WORLD_HEIGHT - 2 * padding),
    };
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
    const team = this.getAssignedTeam(room, memberIndex);
    const slotTeams = room.members.map((_member, index) => this.getAssignedTeam(room, index));
    const { teamSlotIndex, teamCount } = this.getTeamSlotInfo(slotTeams, memberIndex, team);
    return this.getSpawnPointForVariant(room.settings.gameVariant, team, teamSlotIndex, teamCount, memberIndex, room.members.length);
  }

  private getSpawnPointForActivePlayer(room: Room, runtime: ActiveRoomRuntime, playerId: string): { x: number; y: number; angle: number } {
    const index = Math.max(0, runtime.players.findIndex(player => player.id === playerId));
    const team = runtime.players[index]?.team || 'blue';
    const slotTeams = runtime.players.map(player => player.team);
    const { teamSlotIndex, teamCount } = this.getTeamSlotInfo(slotTeams, index, team);
    return this.getSpawnPointForVariant(room.settings.gameVariant, team, teamSlotIndex, teamCount, index, Math.max(1, runtime.players.length));
  }

  private getTeamSlotInfo(teams: readonly string[], targetIndex: number, team: string): { teamSlotIndex: number; teamCount: number } {
    let teamSlotIndex = 0;
    let teamCount = 0;
    for (let index = 0; index < teams.length; index += 1) {
      if (teams[index] !== team) {
        continue;
      }
      if (index < targetIndex) {
        teamSlotIndex += 1;
      }
      teamCount += 1;
    }
    return { teamSlotIndex, teamCount };
  }

  private getSpawnPointForVariant(
    gameVariant: string,
    team: string,
    teamSlotIndex: number,
    teamCount: number,
    globalIndex: number,
    globalCount: number,
  ): { x: number; y: number; angle: number } {
    if (gameVariant === '4teams') {
      const edgeX = 340;
      const edgeY = 300;
      const teamBases: Record<string, Array<{ x: number; y: number }>> = {
        blue: [{ x: edgeX, y: edgeY }],
        red: [{ x: WORLD_WIDTH - edgeX, y: edgeY }],
        green: [{ x: edgeX, y: WORLD_HEIGHT - edgeY }],
        purple: [{ x: WORLD_WIDTH - edgeX, y: WORLD_HEIGHT - edgeY }],
      };
      return this.getSpawnPointOnBases(teamBases[team] || teamBases.blue, teamSlotIndex, teamCount);
    }

    if (gameVariant === '2teams' || gameVariant === 'domination' || gameVariant === 'ctf' || gameVariant === 'breakout' || gameVariant === 'tag' || gameVariant === 'maze') {
      const edge = 250;
      const x = team === 'red' ? WORLD_WIDTH - edge : edge;
      return this.getSpawnPointOnBases(
        [
          { x, y: WORLD_HEIGHT * 0.24 },
          { x, y: WORLD_HEIGHT * 0.76 },
        ],
        teamSlotIndex,
        teamCount,
      );
    }

    if (gameVariant === 'mothership') {
      return this.getSpawnPointOnBases(
        [
          { x: WORLD_WIDTH * 0.22, y: WORLD_HEIGHT - 320 },
          { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT - 280 },
          { x: WORLD_WIDTH * 0.78, y: WORLD_HEIGHT - 320 },
        ],
        teamSlotIndex,
        teamCount,
      );
    }

    if (gameVariant === 'sandbox') {
      return this.getSpawnPointOnBases([{ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }], teamSlotIndex, teamCount);
    }

    return this.getSpawnPointByIndex(globalIndex, globalCount);
  }

  private getSpawnPointOnBases(
    bases: readonly { x: number; y: number }[],
    teamSlotIndex: number,
    teamCount: number,
  ): { x: number; y: number; angle: number } {
    const baseCount = Math.max(1, bases.length);
    const safeTeamSlotIndex = Math.max(0, teamSlotIndex);
    const baseIndex = safeTeamSlotIndex % baseCount;
    const baseSlotIndex = Math.floor(safeTeamSlotIndex / baseCount);
    const baseSlotCount = Math.max(1, Math.ceil(Math.max(1, teamCount) / baseCount));
    const base = bases[baseIndex] || bases[0] || { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    const spread = this.getSpawnSpreadOffset(baseSlotIndex, baseSlotCount);
    const x = this.clamp(base.x + spread.x, 24, WORLD_WIDTH - 24);
    const y = this.clamp(base.y + spread.y, 24, WORLD_HEIGHT - 24);
    return {
      x,
      y,
      angle: Math.atan2(WORLD_HEIGHT / 2 - y, WORLD_WIDTH / 2 - x),
    };
  }

  private getSpawnSpreadOffset(slotIndex: number, slotCount: number): { x: number; y: number } {
    if (slotCount <= 1) {
      return { x: 0, y: 0 };
    }
    const angle = (Math.PI * 2 * slotIndex) / slotCount;
    return {
      x: Math.cos(angle) * 48,
      y: Math.sin(angle) * 48,
    };
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
    const orderedTeams = this.getOrderedTeamsForRoom(room);
    const fallbackTeam = orderedTeams[0] || 'blue';
    const memberIndex = room.members.findIndex(member => member.playerId === playerId);
    if (memberIndex <= 0) {
      return fallbackTeam;
    }
    return orderedTeams[memberIndex % orderedTeams.length] || fallbackTeam;
  }

  private isFriendlyTarget(room: Room, attackerId: string, targetId: string, runtime: ActiveRoomRuntime): boolean {
    if (room.settings.gameVariant === 'ffa') {
      return false;
    }
    const attacker = runtime.players.find(player => player.id === attackerId);
    const target = runtime.players.find(player => player.id === targetId);
    return !!attacker && !!target && attacker.team === target.team;
  }

  private isFriendlyDominatorTarget(attackerTeam: string, dominatorTeam: string): boolean {
    return dominatorTeam !== 'neutral' && attackerTeam === dominatorTeam;
  }

  private getAssignedTeam(room: Room, slotIndex: number): string {
    if (room.settings.gameVariant === 'ffa') {
      return FFA_TEAM_COLORS[slotIndex % FFA_TEAM_COLORS.length];
    }
    const orderedTeams = this.getOrderedTeamsForRoom(room);
    return orderedTeams[slotIndex % orderedTeams.length] || 'blue';
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

  private findQuickJoinRoom(settings: RoomSettings): Room | undefined {
    const normalizedSettings = this.normalizeRoomSettings(settings);
    const candidates = [...this.roomsById.values()]
      .filter(room => room.access === 'public')
      .filter(room => room.settings.gameVariant === normalizedSettings.gameVariant)
      .filter(room => room.settings.aiEnabled === normalizedSettings.aiEnabled)
      .filter(room => room.settings.hostTeam === normalizedSettings.hostTeam)
      .filter(room => room.members.length < MAX_ROOM_MEMBERS);

    const preferredActiveRoom = candidates
      .filter(room => room.status === 'active')
      .filter(room => room.members.length < PREFERRED_PUBLIC_ROOM_MEMBERS)
      .sort((left, right) => {
        if (right.members.length !== left.members.length) {
          return right.members.length - left.members.length;
        }
        return left.createdAt - right.createdAt;
      })[0];

    if (preferredActiveRoom) {
      return preferredActiveRoom;
    }

    return candidates
      .filter(room => room.status === 'lobby')
      .sort((left, right) => left.createdAt - right.createdAt)[0];
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
