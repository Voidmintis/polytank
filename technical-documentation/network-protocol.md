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
- `roomQuickJoin`
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

`welcome`
- player id
- session id
- reconnect token for grace-window resume

`resume`
- reconnect token
- room id

`roomQuickJoin`
- nickname
- requested room settings used to match or create a public room
- joins an active compatible public room when capacity exists, otherwise creates a new public room

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

## Current Phase 2 Status

- server-issued reconnect tokens are now delivered in `welcome`
- a disconnected live player can `resume` the same room inside the reconnect grace window
- the client now uses `ping` / `pong` for live RTT telemetry instead of a synthetic online-room ping display
- the client predicts the controlled tank locally and smooths authoritative corrections instead of snapping each snapshot

## Current Phase 3 Status

- the server now supports `roomQuickJoin` for public FFA matchmaking on top of the existing room system
- the lobby now treats a blank online room code as a public quick-join request while still supporting direct code joins
- public quick join reuses a compatible active room when available and creates a new public room otherwise
- public quick join now stops assigning players to a room after the preferred live population target and creates the next compatible room instead
- active public rooms now rebalance bot population as humans join and leave so later joins do not inherit ghost players
- abandoned public rooms are retired automatically once the reconnect grace window expires, so later quick joins do not resurrect stale occupancy
