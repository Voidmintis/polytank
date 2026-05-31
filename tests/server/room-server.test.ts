import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Root test workspace does not include ws typings; runtime uses the installed ws package.
import WebSocket from 'ws';
import { createPolytankServer } from '../../server/src/index.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../../src/shared/protocol.js';

async function openClient(port: number) {
  const messages: ServerMessage[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);

  socket.on('message', (raw: unknown) => {
    messages.push(JSON.parse(String(raw)) as ServerMessage);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', (error: unknown) => reject(error));
  });

  await waitFor(() => messages.some(message => message.type === 'welcome'));

  return { socket, messages };
}

function send(socket: WebSocket, type: string, payload: Record<string, unknown>) {
  socket.send(
    JSON.stringify({
      type,
      version: PROTOCOL_VERSION,
      timestamp: Date.now(),
      payload,
    }),
  );
}

function createRoomSettings(overrides: Record<string, unknown> = {}) {
  return {
    gameVariant: 'ffa',
    aiEnabled: true,
    hostTeam: 'blue',
    ...overrides,
  };
}

async function waitFor(assertion: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for expected condition.');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('polytank room server', () => {
  const apps: Array<ReturnType<typeof createPolytankServer>> = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
    for (const app of apps.splice(0)) {
      await app.close();
    }
  });

  it('rejects malformed JSON', async () => {
    const app = createPolytankServer(3310);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const client = await openClient(3310);
    sockets.push(client.socket);

    client.socket.send('{bad json');

    await waitFor(() => client.messages.some(message => message.type === 'error'));

    const error = client.messages.find(message => message.type === 'error');
    expect(error).toBeDefined();
    expect(error?.payload.code).toBe('BAD_JSON');
  });

  it('creates and joins a room, then starts once everyone is ready', async () => {
    const app = createPolytankServer(3311);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3311);
    const guest = await openClient(3311);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ aiEnabled: false }),
    });

    await waitFor(() =>
      host.messages.some(
        message => message.type === 'roomState' && message.payload.roster.length === 1,
      ),
    );

    const hostRoomState = host.messages.find(message => message.type === 'roomState');
    expect(hostRoomState).toBeDefined();
    const roomCode = hostRoomState?.payload.roomCode;
    const roomId = hostRoomState?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      host.messages.some(
        message => message.type === 'roomState' && message.payload.roster.length === 2,
      ) &&
      guest.messages.some(
        message => message.type === 'roomState' && message.payload.roster.length === 2,
      ),
    );

    const guestRoomState = guest.messages.find(message => message.type === 'roomState');
    expect(guestRoomState?.payload.settings.gameVariant).toBe('ffa');
    expect(guestRoomState?.payload.settings.hostTeam).toBe('blue');

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(message => message.type === 'matchStart') &&
      guest.messages.some(message => message.type === 'matchStart') &&
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 2,
      ) &&
      guest.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 2,
      ),
    );

    const latestRoomState = host.messages
      .filter(message => message.type === 'roomState')
      .at(-1);
    expect(latestRoomState?.payload.status).toBe('active');

    const snapshot = host.messages.find(message => message.type === 'snapshot');
    expect(snapshot?.payload.tick).toBeGreaterThanOrEqual(0);
    expect(snapshot?.payload.players.map(player => player.nickname).sort()).toEqual([
      'Guest Pilot',
      'Host Pilot',
    ]);
    expect(snapshot?.payload.shapes.length).toBeGreaterThan(0);

    const hostStart = snapshot?.payload.players.find(player => player.nickname === 'Host Pilot');
    expect(hostStart).toBeDefined();

    send(host.socket, 'input', {
      sequence: 1,
      moveX: 1,
      moveY: 0,
      aimAngle: 0,
      firing: false,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(
            player => player.nickname === 'Host Pilot' && player.x > (hostStart?.x ?? 0),
          ),
      ),
    );

    send(host.socket, 'input', {
      sequence: 2,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      firing: true,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.projectiles.some(projectile => projectile.ownerId === hostStart?.id),
      ),
    );

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(
            player => player.id === hostStart?.id && player.xp > (hostStart?.xp ?? 0),
          ),
      ),
    );

    const guestStart = snapshot?.payload.players.find(player => player.nickname === 'Guest Pilot');
    expect(guestStart).toBeDefined();

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<string, { players: Array<{ id: string; x: number; y: number; hp: number; maxHp: number }> }>;
    };
    const liveRuntime = liveManager.activeRooms.get(String(roomId));
    const liveHost = liveRuntime?.players.find(player => player.id === hostStart?.id);
    const liveGuest = liveRuntime?.players.find(player => player.id === guestStart?.id);
    if (liveHost && liveGuest) {
      liveGuest.x = liveHost.x - 96;
      liveGuest.y = liveHost.y;
      liveGuest.hp = liveGuest.maxHp;
    }

    send(host.socket, 'input', {
      sequence: 3,
      moveX: 0,
      moveY: 0,
      aimAngle: Math.PI,
      firing: false,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(
            player => player.id === hostStart?.id && player.angle > 3,
          ),
      ),
    );

    send(host.socket, 'input', {
      sequence: 4,
      moveX: 0,
      moveY: 0,
      aimAngle: Math.PI,
      firing: true,
    });

    await new Promise(resolve => setTimeout(resolve, 350));

    send(host.socket, 'input', {
      sequence: 5,
      moveX: 0,
      moveY: 0,
      aimAngle: Math.PI,
      firing: true,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(
            player => player.id === guestStart?.id && player.hp < (guestStart?.hp ?? 100),
          ),
      ),
    );

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'event' &&
          message.payload.event === 'player-eliminated' &&
          message.payload.data.victimId === guestStart?.id,
      ),
      4000,
    );

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'event' &&
          message.payload.event === 'player-respawned' &&
          message.payload.data.playerId === guestStart?.id,
      ),
      5000,
    );
  }, 12_000);

  it('rejects join for an unknown room code', async () => {
    const app = createPolytankServer(3312);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const client = await openClient(3312);
    sockets.push(client.socket);

    send(client.socket, 'roomJoin', { roomCode: 'ZZZZZ', nickname: 'Pilot' });

    await waitFor(() => client.messages.some(message => message.type === 'error'));
    const error = client.messages.find(message => message.type === 'error');
    expect(error?.payload.code).toBe('ROOM_NOT_FOUND');
  });

  it('starts a solo AI room with server-owned bots', async () => {
    const app = createPolytankServer(3314);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3314);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Solo Host',
      settings: createRoomSettings({ aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(message => message.type === 'roomState');
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(message => message.type === 'matchStart') &&
      host.messages.some(message => message.type === 'snapshot' && message.payload.players.length > 1),
    );

    const firstSnapshot = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' && message.payload.players.length > 1,
    );
    const botPlayer = firstSnapshot?.payload.players.find(player => player.id.startsWith('bot_'));
    expect(botPlayer).toBeDefined();

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.projectiles.some(projectile => projectile.ownerId.startsWith('bot_')),
      ),
      5000,
    );
  }, 8_000);

  it('applies upgrades and class choices authoritatively on the server', async () => {
    const app = createPolytankServer(3313);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3313);
    const guest = await openClient(3313);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const createdRoom = host.messages.find(message => message.type === 'roomState');
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      host.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 2) &&
      guest.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 2),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(message => message.type === 'matchStart') &&
      host.messages.some(message => message.type === 'snapshot' && message.payload.players.length === 2),
    );

    const welcome = host.messages.find(message => message.type === 'welcome');
    const hostPlayerId = welcome?.payload.playerId;
    expect(hostPlayerId).toBeTruthy();

    const manager = app.roomManager as unknown as {
      activeRooms: Map<string, { players: Array<{ id: string; level: number; points: number; xpNext: number; xp: number }> }>;
    };
    const runtime = manager.activeRooms.get(String(roomId));
    expect(runtime).toBeDefined();
    const runtimeHost = runtime?.players.find(player => player.id === hostPlayerId);
    expect(runtimeHost).toBeDefined();
    if (runtimeHost) {
      runtimeHost.level = 30;
      runtimeHost.points = 3;
      runtimeHost.xp = 0;
      runtimeHost.xpNext = 120;
    }

    send(host.socket, 'upgrade', { roomId, upgrade: 'maxHealth' });
    send(host.socket, 'chooseClass', { roomId, classId: 'twin' });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(
            player =>
              player.id === hostPlayerId &&
              player.level === 30 &&
              player.points === 2 &&
              player.classId === 'twin' &&
              player.upgrades.maxHealth === 1 &&
              player.maxHp > 100,
          ),
      ),
    );

    const upgradedSnapshot = host.messages
      .filter(message => message.type === 'snapshot')
      .find(message =>
        message.payload.players.some(
          player =>
            player.id === hostPlayerId &&
            player.classId === 'twin' &&
            player.upgrades.maxHealth === 1,
        ),
      );

    const upgradedHost = upgradedSnapshot?.payload.players.find(player => player.id === hostPlayerId);
    expect(upgradedHost?.points).toBe(2);
    expect(upgradedHost?.classId).toBe('twin');
    expect(upgradedHost?.upgrades.maxHealth).toBe(1);
    expect(upgradedHost?.maxHp).toBeGreaterThan(100);
  });
});