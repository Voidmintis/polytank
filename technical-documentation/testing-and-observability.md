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
