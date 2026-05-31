export const WORLD_WIDTH = 6000;
export const WORLD_HEIGHT = 6000;
export const SERVER_TICK_RATE = 60;
export const INPUT_SEND_RATE = 20;
export const SNAPSHOT_RATE = 15;
export const RECONNECT_GRACE_MS = 60_000;

export type RoomStatus = 'lobby' | 'starting' | 'active' | 'ended';

export interface PlayerUpgradeState {
  regen: number;
  maxHealth: number;
  bodyDamage: number;
  bulletSpeed: number;
  bulletPenetration: number;
  bulletDamage: number;
  reload: number;
  moveSpeed: number;
}

export interface PlayerState {
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
  moveSpeed: number;
  bulletSpeed: number;
  bulletDamage: number;
  reload: number;
  bulletRadius: number;
  isBot: boolean;
}

export interface RoomState {
  id: string;
  code: string;
  status: RoomStatus;
  players: PlayerState[];
  tick: number;
}

export function createDefaultUpgrades(): PlayerUpgradeState {
  return {
    regen: 0,
    maxHealth: 0,
    bodyDamage: 0,
    bulletSpeed: 0,
    bulletPenetration: 0,
    bulletDamage: 0,
    reload: 0,
    moveSpeed: 0,
  };
}
