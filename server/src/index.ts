import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from '../../src/shared/protocol.js';
import { RECONNECT_GRACE_MS, SERVER_TICK_RATE } from '../../src/shared/world.js';
import { parseClientMessage } from './protocol-validation.js';
import { RoomManager, type ConnectionContext } from './room-manager.js';

const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
const MESSAGE_RATE_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 64;
const MAX_INPUT_MESSAGES_PER_WINDOW = 40;
const MAX_RATE_LIMIT_VIOLATIONS = 5;

interface ConnectionRateState {
  messageTimestamps: number[];
  inputTimestamps: number[];
  violations: number;
}

interface ServerMetrics {
  validationRejectCount: number;
  messageTooLargeRejectCount: number;
  rateLimitRejectCount: number;
}

function send(message: ServerMessage, socket: WebSocket) {
  socket.send(JSON.stringify(message));
}

function now() {
  return Date.now();
}

function createErrorMessage(code: string, message: string): ServerMessage {
  return {
    type: 'error',
    version: PROTOCOL_VERSION,
    timestamp: now(),
    payload: { code, message },
  };
}

function exceedsRateLimit(
  timestamps: number[],
  currentTime: number,
  windowMs: number,
  limit: number,
): boolean {
  while (timestamps.length > 0 && currentTime - timestamps[0] > windowMs) {
    timestamps.shift();
  }
  timestamps.push(currentTime);
  return timestamps.length > limit;
}

function handleMessage(
  roomManager: RoomManager,
  connection: ConnectionContext,
  message: ClientMessage,
): void {
  switch (message.type) {
    case 'ping': {
      send(
        {
          type: 'pong',
          version: PROTOCOL_VERSION,
          timestamp: now(),
          payload: {
            clientTime: message.payload.clientTime,
            serverTime: now(),
          },
        },
        connection.socket,
      );
      return;
    }
    case 'connect': {
      connection.nickname = message.payload.nickname;
      return;
    }
    case 'resume': {
      const result = roomManager.resumeConnection(connection, message.payload.roomId, message.payload.reconnectToken);
      if (result.error || !result.room) {
        send(createErrorMessage(result.error?.code || 'RESUME_FAILED', result.error?.message || 'Resume failed.'), connection.socket);
        return;
      }
      send(
        {
          type: 'welcome',
          version: PROTOCOL_VERSION,
          timestamp: now(),
          payload: {
            playerId: connection.playerId,
            sessionId: connection.sessionId,
            reconnectToken: connection.reconnectToken,
          },
        },
        connection.socket,
      );
      roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      if (result.room.status === 'active') {
        send(roomManager.createMatchStartMessage(result.room), connection.socket);
        const snapshot = roomManager.createSnapshotMessage(result.room);
        if (snapshot) {
          send(snapshot, connection.socket);
        }
      }
      return;
    }
    case 'roomCreate': {
      const result = roomManager.createRoom(connection, message.payload.nickname, message.payload.settings);
      if (result.error || !result.room) {
        send(createErrorMessage(result.error?.code || 'ROOM_CREATE_FAILED', result.error?.message || 'Room create failed.'), connection.socket);
        return;
      }
      roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      return;
    }
    case 'roomQuickJoin': {
      const result = roomManager.quickJoinRoom(connection, message.payload.nickname, message.payload.settings);
      if (result.error || !result.room) {
        send(createErrorMessage(result.error?.code || 'ROOM_QUICK_JOIN_FAILED', result.error?.message || 'Quick join failed.'), connection.socket);
        return;
      }
      roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      if (result.room.status === 'active') {
        send(roomManager.createMatchStartMessage(result.room), connection.socket);
        const snapshot = roomManager.createSnapshotMessage(result.room);
        if (snapshot) {
          send(snapshot, connection.socket);
        }
      }
      return;
    }
    case 'roomJoin': {
      const result = roomManager.joinRoom(connection, message.payload.roomCode, message.payload.nickname);
      if (result.error || !result.room) {
        send(createErrorMessage(result.error?.code || 'ROOM_JOIN_FAILED', result.error?.message || 'Room join failed.'), connection.socket);
        return;
      }
      roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      return;
    }
    case 'roomConfigure': {
      const result = roomManager.configureRoom(connection, message.payload.roomId, message.payload.settings);
      if (result.error || !result.room) {
        send(createErrorMessage(result.error?.code || 'ROOM_CONFIGURE_FAILED', result.error?.message || 'Room configure failed.'), connection.socket);
        return;
      }
      roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      return;
    }
    case 'roomLeave': {
      const result = roomManager.leaveRoom(connection, message.payload.roomId);
      if (result.error) {
        send(createErrorMessage(result.error.code, result.error.message), connection.socket);
        return;
      }
      if (result.room) {
        roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      }
      return;
    }
    case 'roomReady': {
      const result = roomManager.setReady(connection, message.payload.roomId, message.payload.ready);
      if (result.error || !result.room) {
        send(createErrorMessage(result.error?.code || 'ROOM_READY_FAILED', result.error?.message || 'Room ready failed.'), connection.socket);
        return;
      }
      roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      if (result.started) {
        roomManager.broadcastRoom(result.room, roomManager.createMatchStartMessage(result.room));
      }
      return;
    }
    case 'input': {
      const result = roomManager.applyInput(connection, message.payload);
      if (result.error) {
        send(createErrorMessage(result.error.code, result.error.message), connection.socket);
      }
      return;
    }
    case 'upgrade': {
      const result = roomManager.applyUpgrade(connection, message.payload.roomId, message.payload.upgrade);
      if (result.error) {
        send(createErrorMessage(result.error.code, result.error.message), connection.socket);
      }
      return;
    }
    case 'chooseClass': {
      const result = roomManager.chooseClass(connection, message.payload.roomId, message.payload.classId);
      if (result.error) {
        send(createErrorMessage(result.error.code, result.error.message), connection.socket);
      }
      return;
    }
    default: {
      send(createErrorMessage('UNHANDLED_MESSAGE', 'Message type is not yet implemented on the server.'), connection.socket);
    }
  }
}

export function createPolytankServer(port = Number(process.env.PORT || 3000)) {
  const roomManager = new RoomManager(now);
  const metrics: ServerMetrics = {
    validationRejectCount: 0,
    messageTooLargeRejectCount: 0,
    rateLimitRejectCount: 0,
  };
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        service: 'polytank-server',
        protocolVersion: PROTOCOL_VERSION,
        tickRate: SERVER_TICK_RATE,
        reconnectGraceMs: RECONNECT_GRACE_MS,
        metrics,
      }),
    );
  });
  const wss = new WebSocketServer({ server });

  wss.on('connection', socket => {
    const connection: ConnectionContext = {
      socket,
      playerId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      reconnectToken: crypto.randomUUID(),
      nickname: 'Pilot',
      roomId: null,
    };
    const rateState: ConnectionRateState = {
      messageTimestamps: [],
      inputTimestamps: [],
      violations: 0,
    };

    send(
      {
        type: 'welcome',
        version: PROTOCOL_VERSION,
        timestamp: now(),
        payload: {
          playerId: connection.playerId,
          sessionId: connection.sessionId,
          reconnectToken: connection.reconnectToken,
        },
      },
      socket,
    );

    socket.on('message', raw => {
      const rawText = raw.toString();
      if (Buffer.byteLength(rawText, 'utf8') > MAX_CLIENT_MESSAGE_BYTES) {
        metrics.validationRejectCount += 1;
        metrics.messageTooLargeRejectCount += 1;
        send(createErrorMessage('MESSAGE_TOO_LARGE', 'Client message exceeds the maximum allowed size.'), socket);
        return;
      }

      const currentTime = now();
      if (exceedsRateLimit(rateState.messageTimestamps, currentTime, MESSAGE_RATE_WINDOW_MS, MAX_MESSAGES_PER_WINDOW)) {
        metrics.validationRejectCount += 1;
        metrics.rateLimitRejectCount += 1;
        rateState.violations += 1;
        send(createErrorMessage('RATE_LIMITED', 'Too many client messages received too quickly.'), socket);
        if (rateState.violations >= MAX_RATE_LIMIT_VIOLATIONS) {
          socket.close();
        }
        return;
      }

      const parsed = parseClientMessage(rawText);
      if (!parsed.ok) {
        metrics.validationRejectCount += 1;
        send(createErrorMessage(parsed.error.code, parsed.error.message), socket);
        return;
      }

      if (
        parsed.message.type === 'input' &&
        exceedsRateLimit(rateState.inputTimestamps, currentTime, MESSAGE_RATE_WINDOW_MS, MAX_INPUT_MESSAGES_PER_WINDOW)
      ) {
        metrics.validationRejectCount += 1;
        metrics.rateLimitRejectCount += 1;
        rateState.violations += 1;
        send(createErrorMessage('INPUT_RATE_LIMITED', 'Too many input messages received too quickly.'), socket);
        if (rateState.violations >= MAX_RATE_LIMIT_VIOLATIONS) {
          socket.close();
        }
        return;
      }

      rateState.violations = 0;
      handleMessage(roomManager, connection, parsed.message);
    });

    socket.on('close', () => {
      const result = roomManager.disconnect(connection);
      if (result.room) {
        roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
      }
    });
  });

  return {
    port,
    server,
    wss,
    roomManager,
    metrics,
    listen(callback?: () => void) {
      server.listen(port, callback);
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        roomManager.dispose();
        wss.close(error => {
          if (error) {
            reject(error);
            return;
          }
          server.close(closeError => {
            if (closeError) {
              reject(closeError);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isDirectRun) {
  const app = createPolytankServer();
  app.listen(() => {
    console.log(`polytank-server listening on :${app.port}`);
  });
}

