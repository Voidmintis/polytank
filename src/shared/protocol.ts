import type { PlayerUpgradeState } from './world.js';

export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | ConnectMessage
  | ResumeMessage
  | RoomCreateMessage
  | RoomJoinMessage
  | RoomConfigureMessage
  | RoomLeaveMessage
  | RoomReadyMessage
  | InputMessage
  | UpgradeMessage
  | ChooseClassMessage
  | PingMessage;

export type ServerMessage =
  | WelcomeMessage
  | RoomStateMessage
  | MatchStartMessage
  | SnapshotMessage
  | EventMessage
  | ErrorMessage
  | MatchEndMessage
  | PongMessage;

export interface ProtocolEnvelope<TType extends string, TPayload> {
  type: TType;
  version: typeof PROTOCOL_VERSION;
  timestamp: number;
  payload: TPayload;
}

export interface ConnectPayload {
  nickname: string;
  buildId?: string;
}

export type ConnectMessage = ProtocolEnvelope<'connect', ConnectPayload>;

export interface ResumePayload {
  roomId: string;
  reconnectToken: string;
}

export type ResumeMessage = ProtocolEnvelope<'resume', ResumePayload>;

export interface RoomCreatePayload {
  nickname: string;
  settings: RoomSettings;
}

export type RoomCreateMessage = ProtocolEnvelope<'roomCreate', RoomCreatePayload>;

export interface RoomJoinPayload {
  roomCode: string;
  nickname: string;
}

export type RoomJoinMessage = ProtocolEnvelope<'roomJoin', RoomJoinPayload>;

export interface RoomConfigurePayload {
  roomId: string;
  settings: RoomSettings;
}

export type RoomConfigureMessage = ProtocolEnvelope<'roomConfigure', RoomConfigurePayload>;

export interface RoomLeavePayload {
  roomId: string;
}

export type RoomLeaveMessage = ProtocolEnvelope<'roomLeave', RoomLeavePayload>;

export interface RoomReadyPayload {
  roomId: string;
  ready: boolean;
}

export type RoomReadyMessage = ProtocolEnvelope<'roomReady', RoomReadyPayload>;

export interface InputPayload {
  sequence: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  firing: boolean;
}

export type InputMessage = ProtocolEnvelope<'input', InputPayload>;

export interface UpgradePayload {
  roomId: string;
  upgrade: string;
}

export type UpgradeMessage = ProtocolEnvelope<'upgrade', UpgradePayload>;

export interface ChooseClassPayload {
  roomId: string;
  classId: string;
}

export type ChooseClassMessage = ProtocolEnvelope<'chooseClass', ChooseClassPayload>;

export interface PingPayload {
  clientTime: number;
}

export type PingMessage = ProtocolEnvelope<'ping', PingPayload>;

export interface WelcomePayload {
  playerId: string;
  sessionId: string;
}

export type WelcomeMessage = ProtocolEnvelope<'welcome', WelcomePayload>;

export interface RoomRosterEntry {
  id: string;
  nickname: string;
  ready: boolean;
  isHost: boolean;
}

export interface RoomSettings {
  gameVariant: string;
  aiEnabled: boolean;
  hostTeam: string;
}

export interface RoomStatePayload {
  roomId: string;
  roomCode: string;
  status: 'lobby' | 'starting' | 'active' | 'ended';
  settings: RoomSettings;
  roster: RoomRosterEntry[];
}

export type RoomStateMessage = ProtocolEnvelope<'roomState', RoomStatePayload>;

export interface MatchStartPayload {
  roomId: string;
  seed: number;
  startedAt: number;
}

export type MatchStartMessage = ProtocolEnvelope<'matchStart', MatchStartPayload>;

export interface WorldPlayerState {
  id: string;
  nickname: string;
  team: string;
  classId: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  points: number;
  score: number;
  upgrades: PlayerUpgradeState;
}

export interface WorldProjectileState {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  radius: number;
  ownerId: string;
  ownerTeam: string;
}

export interface WorldShapeState {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  kind: string;
  radius: number;
  color: string;
  sides: number;
  rotation: number;
}

export interface SnapshotPayload {
  roomId: string;
  tick: number;
  players: WorldPlayerState[];
  projectiles: WorldProjectileState[];
  shapes: WorldShapeState[];
}

export type SnapshotMessage = ProtocolEnvelope<'snapshot', SnapshotPayload>;

export interface EventPayload {
  roomId: string;
  event: string;
  data: Record<string, unknown>;
}

export type EventMessage = ProtocolEnvelope<'event', EventPayload>;

export interface ErrorPayload {
  code: string;
  message: string;
}

export type ErrorMessage = ProtocolEnvelope<'error', ErrorPayload>;

export interface MatchEndPayload {
  roomId: string;
  reason: string;
}

export type MatchEndMessage = ProtocolEnvelope<'matchEnd', MatchEndPayload>;

export interface PongPayload {
  clientTime: number;
  serverTime: number;
}

export type PongMessage = ProtocolEnvelope<'pong', PongPayload>;
