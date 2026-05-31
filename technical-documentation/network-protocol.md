# Network Protocol

## Protocol Principles

- WebSocket transport
- JSON payloads first for inspectability
- Versioned message envelope
- Explicit tick and sequence numbers
- Server authority for game state

## Envelope Shape

```json
{
  "type": "snapshot",
  "version": 1,
  "timestamp": 0,
  "payload": {}
}
```

## Client To Server Messages

- `connect`
- `resume`
- `roomCreate`
- `roomJoin`
- `roomLeave`
- `roomReady`
- `input`
- `upgrade`
- `chooseClass`
- `ping`

## Server To Client Messages

- `welcome`
- `roomState`
- `matchStart`
- `snapshot`
- `event`
- `error`
- `matchEnd`
- `pong`

## Key Payload Expectations

`connect`
- nickname
- client build identifier

`resume`
- reconnect token
- room id

`input`
- sequence number
- movement vector
- aim angle
- fire state

`snapshot`
- server tick
- room id
- players
- bots
- bullets
- shapes
- leaderboard
- match state

`event`
- spawn
- hit
- death
- respawn
- levelUp
- upgradeGranted
- roomClosed

## Versioning Strategy

- Start at version `1`
- Treat breaking payload changes as protocol version bumps
- Reject mismatched major protocol versions during handshake
