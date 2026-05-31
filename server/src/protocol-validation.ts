import { PROTOCOL_VERSION, type ClientMessage } from '../../src/shared/protocol.js';

export interface ValidationFailure {
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseClientMessage(raw: string):
  | { ok: true; message: ClientMessage }
  | { ok: false; error: ValidationFailure } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: {
        code: 'BAD_JSON',
        message: 'Message could not be parsed as JSON.',
      },
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: {
        code: 'BAD_MESSAGE',
        message: 'Message must be a JSON object.',
      },
    };
  }

  if (parsed.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: 'BAD_VERSION',
        message: 'Protocol version mismatch.',
      },
    };
  }

  if (!isString(parsed.type) || !isRecord(parsed.payload) || !isNumber(parsed.timestamp)) {
    return {
      ok: false,
      error: {
        code: 'BAD_SHAPE',
        message: 'Message is missing required envelope fields.',
      },
    };
  }

  const payload = parsed.payload;

  switch (parsed.type) {
    case 'connect':
      if (!isString(payload.nickname)) {
        return invalidPayload('Connect payload requires a nickname.');
      }
      break;
    case 'resume':
      if (!isString(payload.roomId) || !isString(payload.reconnectToken)) {
        return invalidPayload('Resume payload requires roomId and reconnectToken.');
      }
      break;
    case 'roomCreate':
      if (!isString(payload.nickname) || !isRoomSettings(payload.settings)) {
        return invalidPayload('Room create payload requires a nickname and room settings.');
      }
      break;
    case 'roomJoin':
      if (!isString(payload.roomCode) || !isString(payload.nickname)) {
        return invalidPayload('Room join payload requires roomCode and nickname.');
      }
      break;
    case 'roomConfigure':
      if (!isString(payload.roomId) || !isRoomSettings(payload.settings)) {
        return invalidPayload('Room configure payload requires roomId and room settings.');
      }
      break;
    case 'roomLeave':
      if (!isString(payload.roomId)) {
        return invalidPayload('Room leave payload requires roomId.');
      }
      break;
    case 'roomReady':
      if (!isString(payload.roomId) || !isBoolean(payload.ready)) {
        return invalidPayload('Room ready payload requires roomId and ready.');
      }
      break;
    case 'input':
      if (
        !isNumber(payload.sequence) ||
        !isNumber(payload.moveX) ||
        !isNumber(payload.moveY) ||
        !isNumber(payload.aimAngle) ||
        !isBoolean(payload.firing)
      ) {
        return invalidPayload('Input payload is invalid.');
      }
      break;
    case 'upgrade':
      if (!isString(payload.roomId) || !isString(payload.upgrade)) {
        return invalidPayload('Upgrade payload requires roomId and upgrade.');
      }
      break;
    case 'chooseClass':
      if (!isString(payload.roomId) || !isString(payload.classId)) {
        return invalidPayload('Choose class payload requires roomId and classId.');
      }
      break;
    case 'ping':
      if (!isNumber(payload.clientTime)) {
        return invalidPayload('Ping payload requires clientTime.');
      }
      break;
    default:
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_MESSAGE',
          message: `Unknown message type: ${String(parsed.type)}`,
        },
      };
  }

  return { ok: true, message: parsed as unknown as ClientMessage };
}

function invalidPayload(message: string) {
  return {
    ok: false as const,
    error: {
      code: 'BAD_PAYLOAD',
      message,
    },
  };
}

function isRoomSettings(value: unknown): value is {
  gameVariant: string;
  aiEnabled: boolean;
  hostTeam: string;
} {
  return (
    isRecord(value) &&
    isString(value.gameVariant) &&
    isBoolean(value.aiEnabled) &&
    isString(value.hostTeam)
  );
}
