import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from '../../src/shared/protocol.js';
import { SERVER_TICK_RATE } from '../../src/shared/world.js';
import { parseClientMessage } from './protocol-validation.js';
import { RoomManager, type ConnectionContext } from './room-manager.js';

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
    case 'roomCreate': {
      const result = roomManager.createRoom(connection, message.payload.nickname, message.payload.settings);
      if (result.error || !result.room) {
        send(createErrorMessage(result.error?.code || 'ROOM_CREATE_FAILED', result.error?.message || 'Room create failed.'), connection.socket);
        return;
      }
      roomManager.broadcastRoom(result.room, roomManager.createRoomStateMessage(result.room));
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
      send(createErrorMessage('UNHANDLED_MESSAGE', `Message type ${message.type} is not yet implemented on the server.`), connection.socket);
    }
  }
}

export function createPolytankServer(port = Number(process.env.PORT || 3000)) {
  const roomManager = new RoomManager(now);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        service: 'polytank-server',
        protocolVersion: PROTOCOL_VERSION,
        tickRate: SERVER_TICK_RATE,
      }),
    );
  });
  const wss = new WebSocketServer({ server });

  wss.on('connection', socket => {
    const connection: ConnectionContext = {
      socket,
      playerId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      nickname: 'Pilot',
      roomId: null,
    };

    send(
      {
        type: 'welcome',
        version: PROTOCOL_VERSION,
        timestamp: now(),
        payload: {
          playerId: connection.playerId,
          sessionId: connection.sessionId,
        },
      },
      socket,
    );

    socket.on('message', raw => {
      const parsed = parseClientMessage(raw.toString());
      if (!parsed.ok) {
        send(createErrorMessage(parsed.error.code, parsed.error.message), socket);
        return;
      }
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

