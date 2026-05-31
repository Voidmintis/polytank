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

## Current Phase 4 Status

- the authoritative server now normalizes incoming room settings to canonical game variants and allowed host teams before storing or echoing them
- `standard` now resolves to `2teams` on the server so older or inconsistent clients do not fork room state semantics
- the first expanded-mode regression coverage now verifies authoritative `2teams` assignment for host and guest players
- authoritative `4teams` rooms now assign the full rotated team set from the selected host team instead of collapsing back to blue/red pairing
- the online client snapshot fallback now mirrors authoritative team rotation rules so transient or partial snapshots do not miscolor `4teams` players back into blue/red-only logic
- domination rooms now stream server-owned dominator and objective state through snapshots, including authoritative dominator capture transitions
- domination hold and lock progress now advance from server-owned objective state so live clients no longer invent online domination timing locally
- CTF rooms now stream authoritative flag state in snapshots so live clients can hydrate base flag positions and scores from the server path instead of relying on local-only setup
- CTF pickup, drop, return, scoring, and winner state now advance on the authoritative server and appear in later snapshots rather than being decided by the client loop
- breakout rooms now stream authoritative core state in snapshots, and core damage plus winner selection now come from server projectile resolution instead of client-side bullet collisions
- maze rooms now stream authoritative wall geometry in snapshots, and the server resolves player/projectile collisions against those walls before publishing positions and bullets
- tag rooms now apply team conversion on the authoritative server at elimination time, so later snapshots carry the converted team instead of relying on client-side respawn mutation
- mothership rooms now stream authoritative cage-wall and encounter boss state, and cage-wall release is now triggered by server projectile damage instead of the client loop
- after release, mothership rooms now emit authoritative boss volley projectiles from server simulation so live clients receive hostile encounter fire through snapshots instead of local boss logic
- blue projectiles can now damage and destroy the authoritative released mothership, and later snapshots remove the boss once server HP reaches zero
- released mothership snapshots now also stream authoritative laser windup or active beam state so clients render the same server-owned sweep timing and aim angle
- the remaining released encounter behaviors are now server-owned as well: homing volleys, summoned red assault tanks, and the post-destruction endgame closer state in `objective`
