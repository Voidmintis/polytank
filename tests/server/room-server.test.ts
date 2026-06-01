import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Root test workspace does not include ws typings; runtime uses the installed ws package.
import WebSocket from 'ws';
import { createPolytankServer } from '../../server/src/index.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../../src/shared/protocol.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../src/shared/world.js';

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

  it('rejects oversized client messages', async () => {
    const app = createPolytankServer(3317);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const client = await openClient(3317);
    sockets.push(client.socket);

    client.socket.send(
      JSON.stringify({
        type: 'connect',
        version: PROTOCOL_VERSION,
        timestamp: Date.now(),
        payload: {
          nickname: 'X'.repeat(10_000),
        },
      }),
    );

    await waitFor(() => client.messages.some(message => message.type === 'error'));

    const error = client.messages.find(message => message.type === 'error');
    expect(error?.payload.code).toBe('MESSAGE_TOO_LARGE');
  });

  it('responds to ping with pong and echoed client time', async () => {
    const app = createPolytankServer(3316);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const client = await openClient(3316);
    sockets.push(client.socket);

    const clientTime = Date.now();
    send(client.socket, 'ping', { clientTime });

    await waitFor(() => client.messages.some(message => message.type === 'pong'));

    const pong = client.messages.find(message => message.type === 'pong');
    expect(pong?.payload.clientTime).toBe(clientTime);
    expect(typeof pong?.payload.serverTime).toBe('number');
    expect((pong?.payload.serverTime || 0) >= clientTime).toBe(true);
  });

  it('rate limits burst client traffic safely', async () => {
    const app = createPolytankServer(3318);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const client = await openClient(3318);
    sockets.push(client.socket);

    for (let index = 0; index < 90; index += 1) {
      send(client.socket, 'ping', { clientTime: Date.now() + index });
    }

    await waitFor(() =>
      client.messages.some(
        message => message.type === 'error' && message.payload.code === 'RATE_LIMITED',
      ),
    );

    const error = client.messages.find(
      message => message.type === 'error' && message.payload.code === 'RATE_LIMITED',
    );
    expect(error).toBeDefined();
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

  it('normalizes 2-team room settings and assigns opposing teams authoritatively', async () => {
    const app = createPolytankServer(3322);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3322);
    const guest = await openClient(3322);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'standard', hostTeam: 'green', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));

    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    expect(createdRoom?.payload.settings.gameVariant).toBe('2teams');
    expect(createdRoom?.payload.settings.hostTeam).toBe('blue');

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
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 2,
      ),
    );

    const snapshot = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        message.payload.roomId === roomId &&
        message.payload.players.length === 2,
    );

    const hostPlayer = snapshot?.payload.players.find(player => player.nickname === 'Host Pilot');
    const guestPlayer = snapshot?.payload.players.find(player => player.nickname === 'Guest Pilot');
    expect(hostPlayer?.team).toBe('blue');
    expect(guestPlayer?.team).toBe('red');
  }, 10_000);

  it('does not apply friendly fire in 2-team rooms', async () => {
    const app = createPolytankServer(3323);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3323);
    const guest = await openClient(3323);
    const wing = await openClient(3323);
    sockets.push(host.socket, guest.socket, wing.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: '2teams', hostTeam: 'blue', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));

    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });
    send(wing.socket, 'roomJoin', { roomCode, nickname: 'Wing Pilot' });

    await waitFor(() =>
      host.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 3) &&
      guest.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 3) &&
      wing.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 3),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(wing.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 3,
      ),
    );

    const initialSnapshot = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        message.payload.roomId === roomId &&
        message.payload.players.length === 3,
    );

    const hostPlayer = initialSnapshot?.payload.players.find(player => player.nickname === 'Host Pilot');
    const guestPlayer = initialSnapshot?.payload.players.find(player => player.nickname === 'Guest Pilot');
    const wingPlayer = initialSnapshot?.payload.players.find(player => player.nickname === 'Wing Pilot');
    expect(hostPlayer?.team).toBe('blue');
    expect(guestPlayer?.team).toBe('red');
    expect(wingPlayer?.team).toBe('blue');

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<string, { players: Array<{ id: string; x: number; y: number; hp: number; maxHp: number }> }>;
    };
    const liveRuntime = liveManager.activeRooms.get(String(roomId));
    const liveHost = liveRuntime?.players.find(player => player.id === hostPlayer?.id);
    const liveGuest = liveRuntime?.players.find(player => player.id === guestPlayer?.id);
    const liveWing = liveRuntime?.players.find(player => player.id === wingPlayer?.id);

    if (liveHost && liveGuest && liveWing) {
      liveGuest.x = liveHost.x - 96;
      liveGuest.y = liveHost.y;
      liveGuest.hp = liveGuest.maxHp;
      liveWing.x = liveHost.x + 96;
      liveWing.y = liveHost.y;
      liveWing.hp = liveWing.maxHp;
    }

    send(host.socket, 'input', {
      sequence: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      firing: false,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(player => player.id === hostPlayer?.id && Math.abs(player.angle) < 0.2),
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
          message.payload.projectiles.some(projectile => projectile.ownerId === hostPlayer?.id),
      ),
    );

    await new Promise(resolve => setTimeout(resolve, 600));

    const latestSnapshot = host.messages
      .filter((message): message is Extract<ServerMessage, { type: 'snapshot' }> => message.type === 'snapshot' && message.payload.roomId === roomId)
      .at(-1);

    const latestGuest = latestSnapshot?.payload.players.find(player => player.id === guestPlayer?.id);
    const latestWing = latestSnapshot?.payload.players.find(player => player.id === wingPlayer?.id);

    expect(latestGuest?.hp).toBe(guestPlayer?.hp);
    expect(latestWing?.hp).toBe(wingPlayer?.hp);
    expect(
      host.messages.some(
        message =>
          message.type === 'event' &&
          message.payload.event === 'player-eliminated' &&
          (message.payload.data.victimId === guestPlayer?.id || message.payload.data.victimId === wingPlayer?.id),
      ),
    ).toBe(false);
  }, 10_000);

  it('assigns four distinct teams authoritatively in 4-team rooms', async () => {
    const app = createPolytankServer(3324);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const alpha = await openClient(3324);
    const bravo = await openClient(3324);
    const charlie = await openClient(3324);
    const delta = await openClient(3324);
    sockets.push(alpha.socket, bravo.socket, charlie.socket, delta.socket);

    send(alpha.socket, 'roomCreate', {
      nickname: 'Alpha Pilot',
      settings: createRoomSettings({ gameVariant: '4teams', hostTeam: 'purple', aiEnabled: false }),
    });

    await waitFor(() => alpha.messages.some(message => message.type === 'roomState'));

    const createdRoom = alpha.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    expect(createdRoom?.payload.settings.gameVariant).toBe('4teams');
    expect(createdRoom?.payload.settings.hostTeam).toBe('purple');

    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(bravo.socket, 'roomJoin', { roomCode, nickname: 'Bravo Pilot' });
    send(charlie.socket, 'roomJoin', { roomCode, nickname: 'Charlie Pilot' });
    send(delta.socket, 'roomJoin', { roomCode, nickname: 'Delta Pilot' });

    await waitFor(() =>
      alpha.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 4) &&
      bravo.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 4) &&
      charlie.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 4) &&
      delta.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 4),
    );

    send(bravo.socket, 'roomReady', { roomId, ready: true });
    send(charlie.socket, 'roomReady', { roomId, ready: true });
    send(delta.socket, 'roomReady', { roomId, ready: true });
    send(alpha.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      alpha.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 4,
      ),
    );

    const snapshot = alpha.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        message.payload.roomId === roomId &&
        message.payload.players.length === 4,
    );

    const teams = snapshot?.payload.players.map(player => player.team).sort() || [];
    expect(teams).toEqual(['blue', 'green', 'purple', 'red']);
  }, 10_000);

  it('does not apply friendly fire in 4-team rooms', async () => {
    const app = createPolytankServer(3325);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const alpha = await openClient(3325);
    const bravo = await openClient(3325);
    const charlie = await openClient(3325);
    const delta = await openClient(3325);
    const echo = await openClient(3325);
    sockets.push(alpha.socket, bravo.socket, charlie.socket, delta.socket, echo.socket);

    send(alpha.socket, 'roomCreate', {
      nickname: 'Alpha Pilot',
      settings: createRoomSettings({ gameVariant: '4teams', hostTeam: 'purple', aiEnabled: false }),
    });

    await waitFor(() => alpha.messages.some(message => message.type === 'roomState'));

    const createdRoom = alpha.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(bravo.socket, 'roomJoin', { roomCode, nickname: 'Bravo Pilot' });
    send(charlie.socket, 'roomJoin', { roomCode, nickname: 'Charlie Pilot' });
    send(delta.socket, 'roomJoin', { roomCode, nickname: 'Delta Pilot' });
    send(echo.socket, 'roomJoin', { roomCode, nickname: 'Echo Pilot' });

    await waitFor(() =>
      alpha.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 5) &&
      echo.messages.some(message => message.type === 'roomState' && message.payload.roster.length === 5),
    );

    send(bravo.socket, 'roomReady', { roomId, ready: true });
    send(charlie.socket, 'roomReady', { roomId, ready: true });
    send(delta.socket, 'roomReady', { roomId, ready: true });
    send(echo.socket, 'roomReady', { roomId, ready: true });
    send(alpha.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      alpha.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 5,
      ),
    );

    const initialSnapshot = alpha.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        message.payload.roomId === roomId &&
        message.payload.players.length === 5,
    );

    const alphaPlayer = initialSnapshot?.payload.players.find(player => player.nickname === 'Alpha Pilot');
    const echoPlayer = initialSnapshot?.payload.players.find(player => player.nickname === 'Echo Pilot');
    expect(alphaPlayer?.team).toBe('purple');
    expect(echoPlayer?.team).toBe('purple');

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<string, { players: Array<{ id: string; x: number; y: number; hp: number; maxHp: number }> }>;
    };
    const liveRuntime = liveManager.activeRooms.get(String(roomId));
    const liveAlpha = liveRuntime?.players.find(player => player.id === alphaPlayer?.id);
    const liveEcho = liveRuntime?.players.find(player => player.id === echoPlayer?.id);

    if (liveAlpha && liveEcho) {
      liveEcho.x = liveAlpha.x + 96;
      liveEcho.y = liveAlpha.y;
      liveEcho.hp = liveEcho.maxHp;
    }

    send(alpha.socket, 'input', {
      sequence: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      firing: false,
    });

    await waitFor(() =>
      alpha.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(player => player.id === alphaPlayer?.id && Math.abs(player.angle) < 0.2),
      ),
    );

    send(alpha.socket, 'input', {
      sequence: 2,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      firing: true,
    });

    await waitFor(() =>
      alpha.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.projectiles.some(projectile => projectile.ownerId === alphaPlayer?.id),
      ),
    );

    await new Promise(resolve => setTimeout(resolve, 600));

    const latestSnapshot = alpha.messages
      .filter((message): message is Extract<ServerMessage, { type: 'snapshot' }> => message.type === 'snapshot' && message.payload.roomId === roomId)
      .at(-1);
    const latestEcho = latestSnapshot?.payload.players.find(player => player.id === echoPlayer?.id);

    expect(latestEcho?.hp).toBe(echoPlayer?.hp);
    expect(
      alpha.messages.some(
        message =>
          message.type === 'event' &&
          message.payload.event === 'player-eliminated' &&
          message.payload.data.victimId === echoPlayer?.id,
      ),
    ).toBe(false);
  }, 10_000);

  it('includes authoritative domination objective state in snapshots', async () => {
    const app = createPolytankServer(3326);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3326);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'domination', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.dominators.length === 4,
      ),
      6000,
    );

    const snapshot = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        message.payload.roomId === roomId &&
        message.payload.dominators.length === 4,
    );

    expect(snapshot?.payload.objective.dominationTeam).toBe('');
    expect(snapshot?.payload.objective.dominationHold).toBe(0);
    expect(snapshot?.payload.objective.dominationLocked).toBe(false);
    expect(snapshot?.payload.world).toEqual({ w: WORLD_WIDTH, h: WORLD_HEIGHT });
    expect(snapshot?.payload.dominators.every(dominator => dominator.team === 'neutral')).toBe(true);
    expect(snapshot?.payload.dominators.map(dominator => dominator.kind).sort()).toEqual(['destroyer', 'gun', 'gun', 'trapper']);
    expect(snapshot?.payload.shapes.length ?? 0).toBeGreaterThanOrEqual(60);
    expect(snapshot?.payload.shapes.some(shape => shape.kind === 'octagon')).toBe(true);
    expect(snapshot?.payload.shapes.some(shape => shape.kind === 'decagon')).toBe(true);
    const leftShapes = snapshot?.payload.shapes.filter(shape => shape.x < WORLD_WIDTH / 2 - 240).length ?? 0;
    const rightShapes = snapshot?.payload.shapes.filter(shape => shape.x > WORLD_WIDTH / 2 + 240).length ?? 0;
    expect(Math.abs(leftShapes - rightShapes)).toBeLessThanOrEqual(2);
    const rightDominators = snapshot?.payload.dominators.filter(dominator => dominator.x > WORLD_WIDTH / 2).length ?? 0;
    const leftDominators = snapshot?.payload.dominators.filter(dominator => dominator.x < WORLD_WIDTH / 2).length ?? 0;
    expect(leftDominators).toBe(2);
    expect(rightDominators).toBe(2);
  }, 10_000);

  it('spawns domination teams on their side of the map', async () => {
    const app = createPolytankServer(3328);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3328);
    const guest = await openClient(3328);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'domination', hostTeam: 'blue', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      host.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ) &&
      guest.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.some(player => player.nickname === 'Host Pilot') &&
          message.payload.players.some(player => player.nickname === 'Guest Pilot'),
      ),
      6000,
    );

    const snapshot = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        message.payload.roomId === roomId &&
        message.payload.players.some(player => player.nickname === 'Host Pilot') &&
        message.payload.players.some(player => player.nickname === 'Guest Pilot'),
    );

    const hostPlayer = snapshot?.payload.players.find(player => player.nickname === 'Host Pilot');
    const guestPlayer = snapshot?.payload.players.find(player => player.nickname === 'Guest Pilot');

    expect(hostPlayer?.team).toBe('blue');
    expect(guestPlayer?.team).toBe('red');
    expect(hostPlayer?.x ?? WORLD_WIDTH).toBeLessThan(WORLD_WIDTH * 0.35);
    expect(guestPlayer?.x ?? 0).toBeGreaterThan(WORLD_WIDTH * 0.65);
    expect(hostPlayer?.y ?? WORLD_HEIGHT).toBeLessThan(WORLD_HEIGHT * 0.4);
    expect(guestPlayer?.y ?? WORLD_HEIGHT).toBeLessThan(WORLD_HEIGHT * 0.4);
  }, 10_000);

  it('captures dominators authoritatively and locks domination progress from snapshots', async () => {
    const app = createPolytankServer(3327);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3327);
    const guest = await openClient(3327);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'domination', hostTeam: 'blue', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      guest.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.some(player => player.nickname === 'Host Pilot') &&
          message.payload.dominators.length === 4,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; x: number; y: number; angle: number; team: string }>;
          dominators: Array<{ id: string; x: number; y: number; hp: number; maxHp: number; team: string }>;
          objective: { dominationTeam: string; dominationHold: number; dominationLocked: boolean };
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostSnapshot = host.messages
      .filter((message): message is Extract<ServerMessage, { type: 'snapshot' }> => message.type === 'snapshot' && message.payload.roomId === roomId)
      .at(-1);
    const hostPlayer = runtime?.players.find(player => player.id === hostSnapshot?.payload.players.find(entry => entry.nickname === 'Host Pilot')?.id);
    const targetDominator = runtime?.dominators[0];
    expect(hostPlayer).toBeDefined();
    expect(targetDominator).toBeDefined();

    if (hostPlayer && targetDominator && runtime) {
      hostPlayer.x = targetDominator.x - 260;
      hostPlayer.y = targetDominator.y;
      hostPlayer.angle = 0;
      targetDominator.hp = 1;
    }

    send(host.socket, 'input', {
      sequence: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      firing: true,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.dominators.some(dominator => dominator.id === targetDominator?.id && dominator.team === 'blue'),
      ),
      6000,
    );

    if (runtime) {
      for (const dominator of runtime.dominators) {
        dominator.team = 'blue';
      }
      runtime.objective.dominationTeam = 'blue';
      runtime.objective.dominationHold = 11.95;
      runtime.objective.dominationLocked = false;
    }

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.objective.dominationTeam === 'blue' &&
          message.payload.objective.dominationLocked === true &&
          message.payload.objective.dominationHold === 12,
      ),
      6000,
    );
  }, 10_000);

  it('lets domination dominators damage nearby enemies authoritatively', async () => {
    const app = createPolytankServer(3329);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3329);
    const guest = await openClient(3329);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'domination', hostTeam: 'blue', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      guest.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.some(player => player.nickname === 'Guest Pilot') &&
          message.payload.dominators.length === 4,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; nickname: string; x: number; y: number; hp: number; maxHp: number; team: string }>;
          dominators: Array<{ id: string; x: number; y: number; team: string; aimAngle: number; shotCooldown: number }>;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const guestPlayer = runtime?.players.find(player => player.nickname === 'Guest Pilot');
    const targetDominator = runtime?.dominators[0];
    expect(hostPlayer).toBeDefined();
    expect(guestPlayer).toBeDefined();
    expect(targetDominator).toBeDefined();

    if (hostPlayer && guestPlayer && targetDominator) {
      targetDominator.team = 'blue';
      hostPlayer.x = WORLD_WIDTH - 260;
      hostPlayer.y = WORLD_HEIGHT - 260;
      guestPlayer.x = targetDominator.x + 320;
      guestPlayer.y = targetDominator.y;
      guestPlayer.hp = guestPlayer.maxHp;
    }

    await waitFor(() => {
      const currentRuntime = liveManager.activeRooms.get(String(roomId));
      const currentGuest = currentRuntime?.players.find(player => player.nickname === 'Guest Pilot');
      return !!currentGuest && currentGuest.hp < currentGuest.maxHp;
    }, 6000);
  }, 10_000);

  it('includes authoritative CTF flag state in snapshots', async () => {
    const app = createPolytankServer(3328);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3328);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'ctf', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.ctfFlags.length === 2,
      ),
      6000,
    );

    const snapshot = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        message.payload.roomId === roomId &&
        message.payload.ctfFlags.length === 2,
    );

    expect(snapshot?.payload.objective.ctfScores.blue).toBe(0);
    expect(snapshot?.payload.objective.ctfScores.red).toBe(0);
    expect(snapshot?.payload.ctfFlags.map(flag => flag.team).sort()).toEqual(['blue', 'red']);
    expect(snapshot?.payload.ctfFlags.every(flag => flag.atBase && !flag.carrierId && flag.returnTimer === 0)).toBe(true);
  }, 10_000);

  it('applies authoritative CTF pickup and score progress in snapshots', async () => {
    const app = createPolytankServer(3329);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3329);
    const guest = await openClient(3329);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'ctf', hostTeam: 'blue', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      guest.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 2 &&
          message.payload.ctfFlags.length === 2,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; nickname: string; x: number; y: number; team: string }>;
          ctfFlags: Array<{ team: string; x: number; y: number; homeX: number; homeY: number; carrierId: string; atBase: boolean; returnTimer: number }>;
          objective: { ctfScores: { blue: number; red: number }; ctfWinner: string };
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const redFlag = runtime?.ctfFlags.find(flag => flag.team === 'red');
    const blueFlag = runtime?.ctfFlags.find(flag => flag.team === 'blue');
    expect(hostPlayer).toBeDefined();
    expect(redFlag).toBeDefined();
    expect(blueFlag).toBeDefined();

    if (hostPlayer && redFlag && blueFlag) {
      hostPlayer.x = redFlag.x;
      hostPlayer.y = redFlag.y;
    }

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.ctfFlags.some(flag => flag.team === 'red' && flag.carrierId === hostPlayer?.id && !flag.atBase),
      ),
      6000,
    );

    if (hostPlayer && blueFlag && runtime) {
      runtime.objective.ctfScores.blue = 2;
      hostPlayer.x = blueFlag.homeX;
      hostPlayer.y = blueFlag.homeY;
    }

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.objective.ctfScores.blue === 3 &&
          message.payload.objective.ctfWinner === 'blue' &&
          message.payload.ctfFlags.some(flag => flag.team === 'red' && flag.atBase && flag.carrierId === ''),
      ),
      6000,
    );
  }, 10_000);

  it('streams authoritative breakout core state and winner progression in snapshots', async () => {
    const app = createPolytankServer(3330);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3330);
    const guest = await openClient(3330);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'breakout', hostTeam: 'blue', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      guest.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.breakoutCores.length === 2,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; nickname: string; x: number; y: number; angle: number }>;
          breakoutCores: Array<{ team: string; x: number; y: number; hp: number; maxHp: number; radius: number }>;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const redCore = runtime?.breakoutCores.find(core => core.team === 'red');
    expect(hostPlayer).toBeDefined();
    expect(redCore).toBeDefined();

    if (hostPlayer && redCore) {
      hostPlayer.x = redCore.x - 220;
      hostPlayer.y = redCore.y;
      hostPlayer.angle = 0;
      redCore.hp = 1;
    }

    send(host.socket, 'input', {
      sequence: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      firing: true,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.objective.breakoutWinner === 'blue' &&
          message.payload.breakoutCores.some(core => core.team === 'red' && core.hp === 0),
      ),
      6000,
    );
  }, 10_000);

  it('streams authoritative maze walls and blocks movement/projectiles against them', async () => {
    const app = createPolytankServer(3331);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3331);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'maze', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.mazeWalls.length === 10,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; nickname: string; x: number; y: number; angle: number }>;
          mazeWalls: Array<{ x: number; y: number; w: number; h: number }>;
          projectiles: Array<{ id: string }>;
          projectileSequence: number;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const wall = runtime?.mazeWalls[0];
    expect(hostPlayer).toBeDefined();
    expect(wall).toBeDefined();

    if (hostPlayer && wall) {
      hostPlayer.x = wall.x - 12;
      hostPlayer.y = wall.y + wall.h * 0.5;
    }

    send(host.socket, 'input', {
      sequence: 1,
      moveX: 1,
      moveY: 0,
      aimAngle: 0,
      firing: false,
    });

    await waitFor(() => !!(hostPlayer && wall && hostPlayer.x <= wall.x - 20), 6000);

    if (hostPlayer && wall) {
      hostPlayer.x = wall.x - 80;
      hostPlayer.y = wall.y + wall.h * 0.5;
      hostPlayer.angle = 0;
    }

    send(host.socket, 'input', {
      sequence: 2,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      firing: true,
    });

    await waitFor(() => !!(runtime && runtime.projectileSequence >= 1 && runtime.projectiles.length === 0), 6000);
  }, 10_000);

  it('applies authoritative team conversion after a tag elimination', async () => {
    const app = createPolytankServer(3332);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3332);
    const guest = await openClient(3332);
    sockets.push(host.socket, guest.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'tag', hostTeam: 'blue', aiEnabled: false }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const createdRoom = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomCode = createdRoom?.payload.roomCode;
    const roomId = createdRoom?.payload.roomId;
    expect(roomCode).toBeTruthy();
    expect(roomId).toBeTruthy();

    send(guest.socket, 'roomJoin', { roomCode, nickname: 'Guest Pilot' });

    await waitFor(() =>
      guest.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ),
    );

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.players.length === 2,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<string, { players: Array<{ id: string; nickname: string; x: number; y: number; angle: number; hp: number; team: string; maxHp: number }> }>;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const guestPlayer = runtime?.players.find(player => player.nickname === 'Guest Pilot');
    expect(hostPlayer?.team).toBe('blue');
    expect(guestPlayer?.team).toBe('red');

    if (hostPlayer && guestPlayer) {
      guestPlayer.x = hostPlayer.x - 96;
      guestPlayer.y = hostPlayer.y;
      guestPlayer.hp = 1;
    }

    send(host.socket, 'input', {
      sequence: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: Math.PI,
      firing: true,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.players.find(player => player.nickname === 'Guest Pilot' && player.team === 'blue'),
      ),
      6000,
    );
  }, 10_000);

  it('streams authoritative mothership cage state and releases the encounter from server damage', async () => {
    const app = createPolytankServer(3333);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3333);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'mothership', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.cageWall &&
          !!message.payload.enemyMothership &&
          message.payload.enemyMothership.released === false,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; nickname: string; x: number; y: number; angle: number }>;
          cageWall: { x1: number; x2: number; y: number; hp: number; released: boolean } | null;
          enemyMothership: { released: boolean; releaseProgress: number } | null;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    expect(hostPlayer).toBeDefined();
    expect(runtime?.cageWall).toBeDefined();
    expect(runtime?.enemyMothership).toBeDefined();

    if (hostPlayer && runtime?.cageWall) {
      hostPlayer.x = (runtime.cageWall.x1 + runtime.cageWall.x2) * 0.5;
      hostPlayer.y = runtime.cageWall.y + 80;
      hostPlayer.angle = -Math.PI * 0.5;
      runtime.cageWall.hp = 1;
    }

    send(host.socket, 'input', {
      sequence: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: -Math.PI * 0.5,
      firing: true,
    });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.cageWall?.released &&
          !!message.payload.enemyMothership?.released,
      ),
      6000,
    );
  }, 10_000);

  it('fires authoritative mothership volleys after release', async () => {
    const app = createPolytankServer(3334);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3334);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'mothership', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.enemyMothership,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ nickname: string; x: number; y: number }>;
          enemyMothership: { released: boolean; releaseProgress: number; shotTimer: number; x: number; y: number } | null;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const enemyMothership = runtime?.enemyMothership;
    expect(hostPlayer).toBeDefined();
    expect(enemyMothership).toBeDefined();

    if (hostPlayer && enemyMothership) {
      enemyMothership.released = true;
      enemyMothership.releaseProgress = 1;
      enemyMothership.shotTimer = 0;
      hostPlayer.x = enemyMothership.x;
      hostPlayer.y = enemyMothership.y + 900;
    }

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.projectiles.some(projectile => projectile.ownerId === 'encounter_mothership' && projectile.ownerTeam === 'red'),
      ),
      6000,
    );
  }, 10_000);

  it('applies authoritative damage and destruction to the released mothership', async () => {
    const app = createPolytankServer(3335);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3335);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'mothership', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.enemyMothership,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; nickname: string; x: number; y: number; angle: number }>;
          projectileSequence: number;
          projectiles: Array<{ id: string; x: number; y: number; angle: number; speed: number; radius: number; ownerId: string; ownerTeam: string; life: number; damage: number }>;
          enemyMothership: { released: boolean; releaseProgress: number; hp: number; x: number; y: number; radius: number; renderScale: number } | null;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const enemyMothership = runtime?.enemyMothership;
    expect(hostPlayer).toBeDefined();
    expect(enemyMothership).toBeDefined();

    if (hostPlayer && enemyMothership) {
      enemyMothership.released = true;
      enemyMothership.releaseProgress = 1;
      enemyMothership.hp = 1;
      enemyMothership.x = 3000;
      enemyMothership.y = 1120;
      runtime.projectileSequence += 1;
      runtime.projectiles.push({
        id: `test_mothership_hit_${runtime.projectileSequence}`,
        x: enemyMothership.x,
        y: enemyMothership.y,
        angle: -Math.PI * 0.5,
        speed: 0,
        radius: 10,
        ownerId: hostPlayer.id,
        ownerTeam: 'blue',
        life: 0.5,
        damage: 5,
      });
    }

    await waitFor(() => liveManager.activeRooms.get(String(roomId))?.enemyMothership === null, 6000);
  }, 10_000);

  it('runs authoritative mothership homing, laser, and summon behaviors after release', async () => {
    const app = createPolytankServer(3336);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3336);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'mothership', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.enemyMothership,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ nickname: string; x: number; y: number }>;
          enemyMothership: {
            released: boolean;
            releaseProgress: number;
            homingTimer: number;
            summonTimer: number;
            laserCooldown: number;
            x: number;
            y: number;
          } | null;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const enemyMothership = runtime?.enemyMothership;
    expect(hostPlayer).toBeDefined();
    expect(enemyMothership).toBeDefined();

    if (hostPlayer && enemyMothership) {
      enemyMothership.released = true;
      enemyMothership.releaseProgress = 1;
      enemyMothership.homingTimer = 0;
      enemyMothership.summonTimer = 0;
      enemyMothership.laserCooldown = 0;
      hostPlayer.x = enemyMothership.x;
      hostPlayer.y = enemyMothership.y + 900;
    }

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          message.payload.projectiles.some(projectile => projectile.ownerId === 'encounter_mothership' && projectile.radius === 8) &&
          !!message.payload.enemyMothership &&
          (message.payload.enemyMothership.laserWindup > 0 || message.payload.enemyMothership.laserActive > 0) &&
          message.payload.players.some(player => player.id.startsWith('mothership_minion_')),
      ),
      6000,
    );
  }, 10_000);

  it('starts authoritative mothership endgame closers with no respawns after boss destruction', async () => {
    const app = createPolytankServer(3337);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3337);
    sockets.push(host.socket);

    send(host.socket, 'roomCreate', {
      nickname: 'Host Pilot',
      settings: createRoomSettings({ gameVariant: 'mothership', hostTeam: 'blue', aiEnabled: true }),
    });

    await waitFor(() => host.messages.some(message => message.type === 'roomState'));
    const roomState = host.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState',
    );
    const roomId = roomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.enemyMothership,
      ),
      6000,
    );

    const liveManager = app.roomManager as unknown as {
      activeRooms: Map<
        string,
        {
          players: Array<{ id: string; nickname: string; x: number; y: number; angle: number; hp: number }>;
          projectileSequence: number;
          projectiles: Array<{ id: string; x: number; y: number; angle: number; speed: number; radius: number; ownerId: string; ownerTeam: string; life: number; damage: number }>;
          enemyMothership: { released: boolean; releaseProgress: number; hp: number; x: number; y: number; radius: number; renderScale: number } | null;
        }
      >;
    };
    const runtime = liveManager.activeRooms.get(String(roomId));
    const hostPlayer = runtime?.players.find(player => player.nickname === 'Host Pilot');
    const enemyMothership = runtime?.enemyMothership;
    expect(hostPlayer).toBeDefined();
    expect(enemyMothership).toBeDefined();

    if (hostPlayer && enemyMothership) {
      enemyMothership.released = true;
      enemyMothership.releaseProgress = 1;
      enemyMothership.hp = 1;
      enemyMothership.x = 3000;
      enemyMothership.y = 1120;
      runtime.projectileSequence += 1;
      runtime.projectiles.push({
        id: `test_mothership_endgame_${runtime.projectileSequence}`,
        x: enemyMothership.x,
        y: enemyMothership.y,
        angle: -Math.PI * 0.5,
        speed: 0,
        radius: 10,
        ownerId: hostPlayer.id,
        ownerTeam: 'blue',
        life: 0.5,
        damage: 5,
      });
    }

    await waitFor(() => {
      const activeRuntime = liveManager.activeRooms.get(String(roomId));
      return activeRuntime?.enemyMothership === null
        && activeRuntime.players.some(player => player.id === 'mothership_closer_left')
        && activeRuntime.players.some(player => player.id === 'mothership_closer_right');
    }, 6000);

    if (hostPlayer) {
      hostPlayer.hp = 100;
      hostPlayer.x = -160;
      hostPlayer.y = 3000;
    }

    await waitFor(() =>
      host.messages.some(
        message =>
          message.type === 'event' &&
          message.payload.event === 'player-eliminated' &&
          message.payload.data.victimNickname === 'Host Pilot' &&
          message.payload.data.attackerNickname === 'Arena Closer' &&
          message.payload.data.respawnDelaySeconds === 0,
      ),
      6000,
    );

    await new Promise(resolve => setTimeout(resolve, 3200));

    expect(
      host.messages.some(
        message =>
          message.type === 'event' &&
          message.payload.event === 'player-respawned' &&
          message.payload.data.nickname === 'Host Pilot',
      ),
    ).toBe(false);
  }, 14_000);

  it('quick joins a public FFA room and reuses it after a leave without ghost players', async () => {
    const app = createPolytankServer(3319);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const alpha = await openClient(3319);
    const bravo = await openClient(3319);
    sockets.push(alpha.socket, bravo.socket);

    send(alpha.socket, 'roomQuickJoin', {
      nickname: 'Alpha Pilot',
      settings: createRoomSettings({ aiEnabled: true }),
    });

    await waitFor(() =>
      alpha.messages.some(message => message.type === 'roomState' && message.payload.access === 'public') &&
      alpha.messages.some(message => message.type === 'matchStart') &&
      alpha.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(player => player.nickname === 'Alpha Pilot'),
      ),
    );

    const alphaRoomState = alpha.messages.find(
      (message): message is Extract<ServerMessage, { type: 'roomState' }> =>
        message.type === 'roomState' && message.payload.access === 'public',
    );
    const roomId = alphaRoomState?.payload.roomId;
    expect(roomId).toBeTruthy();

    send(bravo.socket, 'roomQuickJoin', {
      nickname: 'Bravo Pilot',
      settings: createRoomSettings({ aiEnabled: true }),
    });

    await waitFor(() =>
      alpha.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ) &&
      bravo.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ) &&
      bravo.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.players.find(player => player.nickname === 'Alpha Pilot') &&
          !!message.payload.players.find(player => player.nickname === 'Bravo Pilot'),
      ),
    );

    send(bravo.socket, 'roomLeave', { roomId });

    await waitFor(() =>
      alpha.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 1,
      ) &&
      alpha.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.players.find(player => player.nickname === 'Alpha Pilot') &&
          !message.payload.players.some(player => player.nickname === 'Bravo Pilot'),
      ),
    );

    const charlie = await openClient(3319);
    sockets.push(charlie.socket);

    send(charlie.socket, 'roomQuickJoin', {
      nickname: 'Charlie Pilot',
      settings: createRoomSettings({ aiEnabled: true }),
    });

    await waitFor(() =>
      charlie.messages.some(
        message => message.type === 'roomState' && message.payload.roomId === roomId && message.payload.roster.length === 2,
      ) &&
      charlie.messages.some(
        message =>
          message.type === 'snapshot' &&
          message.payload.roomId === roomId &&
          !!message.payload.players.find(player => player.nickname === 'Alpha Pilot') &&
          !!message.payload.players.find(player => player.nickname === 'Charlie Pilot') &&
          !message.payload.players.some(player => player.nickname === 'Bravo Pilot'),
      ),
    );
  }, 10_000);

  it('creates a second public room once the preferred quick-join room reaches its target population', async () => {
    const app = createPolytankServer(3320);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const clients = [] as Array<Awaited<ReturnType<typeof openClient>>>;
    for (let index = 0; index < 7; index += 1) {
      const client = await openClient(3320);
      clients.push(client);
      sockets.push(client.socket);
      send(client.socket, 'roomQuickJoin', {
        nickname: `Pilot ${index + 1}`,
        settings: createRoomSettings({ aiEnabled: true }),
      });
    }

    await waitFor(() =>
      clients.every(client => client.messages.some(message => message.type === 'roomState' && message.payload.access === 'public')),
      6000,
    );

    const roomIds = clients.map(client => {
      const latestRoomState = client.messages
        .filter((message): message is Extract<ServerMessage, { type: 'roomState' }> => message.type === 'roomState' && message.payload.access === 'public')
        .at(-1);
      return String(latestRoomState?.payload.roomId || '');
    });

    const uniqueRoomIds = [...new Set(roomIds.filter(Boolean))];
    expect(uniqueRoomIds.length).toBe(2);

    const roomCounts = uniqueRoomIds.map(roomId => roomIds.filter(candidate => candidate === roomId).length).sort((left, right) => left - right);
    expect(roomCounts).toEqual([1, 6]);
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

  it('resumes a disconnected live player within the reconnect grace window', async () => {
    const app = createPolytankServer(3315);
    apps.push(app);
    await new Promise<void>(resolve => app.listen(resolve));

    const host = await openClient(3315);
    const guest = await openClient(3315);
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

    const guestWelcome = guest.messages.find(message => message.type === 'welcome');
    const reconnectToken = guestWelcome?.payload.reconnectToken;
    expect(reconnectToken).toBeTruthy();

    send(guest.socket, 'roomReady', { roomId, ready: true });
    send(host.socket, 'roomReady', { roomId, ready: true });

    await waitFor(() =>
      guest.messages.some(message => message.type === 'matchStart') &&
      guest.messages.some(message => message.type === 'snapshot' && message.payload.players.length === 2),
    );

    const initialSnapshot = guest.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' && message.payload.players.length === 2,
    );
    const guestPlayer = initialSnapshot?.payload.players.find(player => player.nickname === 'Guest Pilot');
    expect(guestPlayer).toBeDefined();

    guest.socket.close();

    const resumed = await openClient(3315);
    sockets.push(resumed.socket);
    send(resumed.socket, 'resume', { roomId, reconnectToken });

    await waitFor(() =>
      resumed.messages.some(message => message.type === 'roomState' && message.payload.roomId === roomId) &&
      resumed.messages.some(message => message.type === 'matchStart' && message.payload.roomId === roomId) &&
      resumed.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(player => player.id === guestPlayer?.id && player.nickname === 'Guest Pilot'),
      ),
    );

    const resumedSnapshot = resumed.messages.find(
      (message): message is Extract<ServerMessage, { type: 'snapshot' }> =>
        message.type === 'snapshot' &&
        !!message.payload.players.find(player => player.id === guestPlayer?.id && player.nickname === 'Guest Pilot'),
    );
    const resumedPlayer = resumedSnapshot?.payload.players.find(player => player.id === guestPlayer?.id);
    expect(resumedPlayer?.id).toBe(guestPlayer?.id);

    send(resumed.socket, 'input', {
      sequence: 1,
      moveX: -1,
      moveY: 0,
      aimAngle: Math.PI,
      firing: false,
    });

    await waitFor(() =>
      resumed.messages.some(
        message =>
          message.type === 'snapshot' &&
          !!message.payload.players.find(
            player => player.id === guestPlayer?.id && player.x < (resumedPlayer?.x ?? Number.POSITIVE_INFINITY),
          ),
      ),
    );
  }, 10_000);

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