import { describe, expect, it } from 'vitest';
import { type ConnectionContext, RoomManager } from '../../server/src/room-manager.js';
import { RECONNECT_GRACE_MS } from '../../src/shared/world.js';

function createRoomSettings(overrides: Record<string, unknown> = {}) {
  return {
    gameVariant: 'ffa',
    aiEnabled: true,
    hostTeam: 'blue',
    ...overrides,
  };
}

function createConnection(label: string): ConnectionContext {
  return {
    socket: {
      readyState: 1,
      send() {},
    } as never,
    playerId: `${label}-player`,
    sessionId: `${label}-session`,
    reconnectToken: `${label}-reconnect`,
    nickname: label,
    roomId: null,
  };
}

describe('room manager public room lifecycle', () => {
  it('creates a fresh public room after an expired quick-join room is pruned', () => {
    let currentTime = 10_000;
    const manager = new RoomManager(() => currentTime);
    const settings = createRoomSettings();

    const alpha = createConnection('alpha');
    const firstJoin = manager.quickJoinRoom(alpha, 'Alpha Pilot', settings);
    expect(firstJoin.error).toBeUndefined();
    expect(firstJoin.room?.access).toBe('public');

    const firstRoomId = String(firstJoin.room?.id || '');
    expect(firstRoomId).toBeTruthy();

    manager.disconnect(alpha);
    currentTime += RECONNECT_GRACE_MS + 1;

    const bravo = createConnection('bravo');
    const secondJoin = manager.quickJoinRoom(bravo, 'Bravo Pilot', settings);
    expect(secondJoin.error).toBeUndefined();
    expect(secondJoin.room?.access).toBe('public');
    expect(secondJoin.room?.id).toBeTruthy();
    expect(secondJoin.room?.id).not.toBe(firstRoomId);

    const roster = secondJoin.room ? manager.createRoomStateMessage(secondJoin.room).payload.roster : [];
    expect(roster.map(member => member.nickname)).toEqual(['Bravo Pilot']);
  });
});