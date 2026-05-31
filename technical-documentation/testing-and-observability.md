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
- match start
- input loop
- hit resolution
- death and respawn
- reconnect inside grace window

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

## Operational Alerts

- sustained high tick duration
- room count spikes
- repeated disconnect storms
- backend crash loops
