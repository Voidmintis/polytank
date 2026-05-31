# Testing And Observability

## Unit Testing Targets

- geometry helpers
- collision checks
- XP and level progression
- upgrade validation
- room state reducers

## Integration Testing Targets

- connect and welcome flow
- room create and join flow
- public quick join and room reuse flow
- match start
- input loop
- hit resolution
- death and respawn
- reconnect inside grace window

Current coverage now includes:
- reconnecting a live player by token inside the server grace window while preserving authoritative player identity
- quick joining a public FFA room, leaving it, and reusing that same room without ghost players in later snapshots
- creating a second public room once quick join reaches the preferred live population target for the first room
- pruning an expired disconnected public-room member before the next quick join so a fresh room is created instead of reviving stale occupancy
- normalizing non-canonical two-team room settings on the server and assigning opposing host/guest teams authoritatively in snapshots
- rejecting friendly-fire outcomes in authoritative `2teams` projectile simulation while still allowing opposing-team damage
- assigning four distinct authoritative teams in `4teams` rooms, including non-default host-team rotation
- rejecting friendly-fire outcomes in authoritative `4teams` projectile simulation for same-team players that share the rotated team assignment
- streaming initial neutral domination-point state and objective payloads in authoritative snapshots for domination rooms
- capturing a domination point authoritatively on the server and advancing domination lock state from snapshot-owned objective progress
- streaming initial authoritative CTF flag state and zeroed flag scores in snapshots for CTF rooms
- applying authoritative CTF pickup and score progression in snapshots, including winner-state publication at the score cap
- streaming authoritative breakout core state and winner progression in snapshots after server projectile damage resolves against enemy cores
- streaming authoritative maze wall state in snapshots and rejecting player/projectile movement through those walls in server simulation
- applying authoritative tag-team conversion in snapshots after a defeating player eliminates an opposing player in tag mode
- streaming authoritative mothership cage/boss state and validating server-owned cage release after a blue-team projectile breaks the wall
- validating that a released authoritative mothership emits hostile volley projectiles into snapshots from server simulation
- validating that blue-team projectiles can destroy the authoritative released mothership and remove it from subsequent snapshots
- validating that the released authoritative mothership also emits homing projectiles, laser-state snapshots, and summoned red assault tanks from server simulation
- validating that destroying the authoritative mothership starts the no-respawn endgame closer flow on the server

Manual smoke target for the client slice:
- blank room code plus Join should quick join a public online room when the room server is reachable

## Soak Testing

- 15-minute room stability test
- humans plus bots
- memory growth monitoring
- leaderboard consistency checks

## Latency Testing

- 100 to 200 ms artificial delay
- jitter
- packet loss
- measure prediction correction severity

## Runtime Telemetry

- active rooms
- active players
- tick duration
- snapshot size
- reconnect count
- validation reject count
- websocket disconnect rate

Current Phase 2 observability now includes:
- live client RTT via `ping` / `pong`
- client-side jitter estimation from RTT deltas
- snapshot age tracking after each authoritative snapshot
- client-side prediction correction smoothing for the controlled tank plus remote tank interpolation between snapshots
- server-side validation reject counters for malformed, oversized, and rate-limited client traffic

Current hardening now includes:
- maximum client message size enforcement at the websocket boundary
- per-connection burst limits for total messages and input spam

## Operational Alerts

- sustained high tick duration
- room count spikes
- repeated disconnect storms
- backend crash loops
