import WebSocket from 'ws';
import { createPolytankServer } from '../src/index.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../../src/shared/protocol.js';

interface SoakOptions {
  durationSec: number;
  port: number;
}

function parseOptions(): SoakOptions {
  const npmDuration = Number(process.env.npm_config_durationsec || process.env.npm_config_durationSec);
  const npmPort = Number(process.env.npm_config_port);
  const options: SoakOptions = {
    durationSec: Number.isFinite(npmDuration) && npmDuration > 0 ? Math.floor(npmDuration) : 900,
    port: Number.isFinite(npmPort) && npmPort > 0 ? Math.floor(npmPort) : 3390,
  };

  for (const arg of process.argv.slice(2)) {
    const [rawKey, rawValue] = arg.split('=');
    const key = rawKey.replace(/^--/, '');
    const value = Number(rawValue);
    if (key === 'durationSec' && Number.isFinite(value) && value > 0) {
      options.durationSec = Math.floor(value);
    }
    if (key === 'port' && Number.isFinite(value) && value > 0) {
      options.port = Math.floor(value);
    }
  }

  return options;
}

function send(socket: WebSocket, type: string, payload: Record<string, unknown>): void {
  socket.send(
    JSON.stringify({
      type,
      version: PROTOCOL_VERSION,
      timestamp: Date.now(),
      payload,
    }),
  );
}

async function waitFor(assertion: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (!assertion()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for soak condition.');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const app = createPolytankServer(options.port);
  await new Promise<void>(resolve => app.listen(resolve));

  const socket = new WebSocket(`ws://127.0.0.1:${options.port}`);
  const messages: ServerMessage[] = [];
  let roomId = '';
  let snapshotCount = 0;
  let eventCount = 0;
  let botProjectileCount = 0;
  let maxPlayers = 0;
  let lastSnapshotAt = 0;
  let failure: Error | null = null;

  socket.on('message', raw => {
    const message = JSON.parse(String(raw)) as ServerMessage;
    messages.push(message);
    if (message.type === 'snapshot') {
      snapshotCount += 1;
      lastSnapshotAt = Date.now();
      maxPlayers = Math.max(maxPlayers, message.payload.players.length);
      if (message.payload.projectiles.some(projectile => projectile.ownerId.startsWith('bot_'))) {
        botProjectileCount += 1;
      }
    }
    if (message.type === 'event') {
      eventCount += 1;
    }
    if (message.type === 'error') {
      failure = new Error(`Server error ${message.payload.code}: ${message.payload.message}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  await waitFor(() => messages.some(message => message.type === 'welcome'));

  send(socket, 'roomCreate', {
    nickname: 'Soak Host',
    settings: {
      gameVariant: 'ffa',
      aiEnabled: true,
      hostTeam: 'blue',
    },
  });

  await waitFor(() => messages.some(message => message.type === 'roomState'));
  const roomState = messages.find(message => message.type === 'roomState');
  roomId = String(roomState?.payload.roomId || '');
  if (!roomId) {
    throw new Error('Room id was not assigned during soak startup.');
  }

  send(socket, 'roomReady', { roomId, ready: true });

  await waitFor(() =>
    messages.some(message => message.type === 'matchStart') &&
    messages.some(message => message.type === 'snapshot' && message.payload.players.length > 1),
  );

  const startedAt = Date.now();
  const inputTimer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const angle = elapsed * 0.8;
    send(socket, 'input', {
      sequence: Math.floor(elapsed * 20),
      moveX: Math.cos(elapsed * 0.35),
      moveY: Math.sin(elapsed * 0.35),
      aimAngle: angle,
      firing: true,
    });
  }, 50);

  const progressTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[soak] ${elapsed}s snapshots=${snapshotCount} events=${eventCount} maxPlayers=${maxPlayers} botProjectileFrames=${botProjectileCount}`,
    );
  }, 15_000);

  try {
    while (Date.now() - startedAt < options.durationSec * 1000) {
      if (failure) {
        throw failure;
      }
      if (lastSnapshotAt > 0 && Date.now() - lastSnapshotAt > 5000) {
        throw new Error('Snapshot stream stalled for more than 5 seconds.');
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally {
    clearInterval(inputTimer);
    clearInterval(progressTimer);
    socket.close();
    await app.close();
  }

  if (snapshotCount < options.durationSec * 8) {
    throw new Error(`Snapshot count too low for soak duration: ${snapshotCount}`);
  }
  if (maxPlayers < 2) {
    throw new Error('Soak room never contained bots.');
  }
  if (botProjectileCount === 0) {
    throw new Error('No bot projectile activity observed during soak.');
  }

  console.log(
    `[soak] complete duration=${options.durationSec}s snapshots=${snapshotCount} events=${eventCount} maxPlayers=${maxPlayers} botProjectileFrames=${botProjectileCount}`,
  );
}

main().catch(error => {
  console.error('[soak] failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});