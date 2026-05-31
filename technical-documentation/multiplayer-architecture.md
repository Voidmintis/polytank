# Multiplayer Architecture

## Goals

Build an authoritative multiplayer architecture that fits the current Polytank client without forcing an early renderer rewrite.

Primary goals:
- Keep the client and backend in the same repository
- Preserve the existing GitHub Pages deployment for the static client
- Introduce a Fly.io-hosted Node.js backend for authoritative simulation
- Ship private-room FFA first, then widen scope after validation

## High-Level Topology

- Client: browser-rendered arena, UI, local input capture, prediction, interpolation, cosmetic effects
- Backend: authoritative room lifecycle, world simulation, validation, XP, upgrades, bots, leaderboard, reconnect handling
- Shared modules: protocol types, entity types, deterministic rules that both runtimes need

## Repository Target Shape

```text
.
├── public/
├── src/
│   └── shared/
│       ├── protocol.ts
│       └── world.ts
├── server/
│   ├── src/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
└── technical-documentation/
```

## Authority Boundaries

Server-owned state:
- Room membership and lifecycle
- Match start and end
- Player spawn, HP, XP, level, upgrade points, deaths, respawns
- Bot state and actions
- Bullets, shapes, hits, kills, leaderboard
- Validation of movement bounds, fire rate, upgrade spending, reconnect

Client-owned behavior:
- Menu and HUD rendering
- Camera behavior and interpolation
- Cosmetic particles, shockwave presentation, screen feedback
- Local input buffering and prediction for the controlled tank

Shared logic candidates:
- Entity definitions
- World dimensions and constants
- Upgrade identifiers and caps
- Protocol schemas
- Collision and resolution helpers once extracted from the arena runtime

## Tick Model

Recommended default:
- Server simulation: 60 Hz
- Client input send: 20 to 30 Hz
- Snapshot broadcast: 10 to 20 Hz
- Client interpolation buffer: around 100 ms

The server remains authoritative. Client prediction is limited to local responsiveness and corrected smoothly when the authoritative state diverges.

## Room Lifecycle

1. Host creates a private room
2. Players join by code
3. Host launches match
4. Server snapshots room state and starts authoritative simulation
5. Players may disconnect and reconnect inside a grace window
6. Match ends and room either resets or tears down

## Phase 1 Scope Boundary

Included:
- Private-room FFA
- Humans plus bots
- One authoritative arena loop

Excluded:
- Public matchmaking
- Team modes
- Objective modes
- Sandbox, bosses, admin-only systems
- Fusion-side gameplay modes

## Migration Notes

The current arena implementation in `public/main.js` is the migration baseline. Ownership should move from client to server incrementally rather than through a one-shot rewrite.
