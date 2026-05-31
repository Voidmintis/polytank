# Implementation Roadmap

## Phase 1: Private-Room MVP

Deliverables:
- backend scaffold in `server/`
- shared protocol types
- private room create and join flow
- authoritative simulation loop
- human plus bot match support

Exit criteria:
- two devices can join the same room over the network
- movement, shooting, damage, XP, upgrade spend, death, and respawn are authoritative
- 15-minute room soak test is stable

## Phase 2: Netcode Hardening

Status:
- implemented

Deliverables:
- reconnect grace period
- reconnect token support
- prediction correction smoothing
- latency and validation metrics
- rate limiting and abuse resistance

Exit criteria:
- reconnect resumes a live match correctly
- 100 to 200 ms latency remains playable
- invalid actions are rejected cleanly

## Phase 3: Public FFA

Status:
- implemented

Deliverables:
- quick join or matchmaking on top of the same room system
- room lifecycle automation
- production deploy flow for the backend

Exit criteria:
- public rooms can absorb repeated joins and leaves
- no ghost players or duplicated entities

## Phase 4+: Expanded Modes

Status:
- implemented

Recommended order:
1. 2 teams
2. 4 teams
3. objective-driven arena modes

These should reuse the same authoritative core rather than fork simulation logic.

Current objective-mode status:
- domination snapshot transport is implemented
- domination capture transitions and hold-lock progress are now server-authoritative
- CTF snapshot transport is implemented for authoritative flag/base state hydration
- CTF pickup, return, scoring, and winner state are now server-authoritative
- breakout core state, damage, and winner state are now server-authoritative
- maze wall state and wall collision are now server-authoritative
- tag elimination-based team conversion is now server-authoritative
- mothership cage-wall state and release trigger are now server-authoritative
- mothership post-release volley fire is now server-authoritative
- mothership destruction from authoritative projectile damage is now server-authoritative
- mothership homing volleys, summon spawns, laser sweep state, and post-destruction endgame closers are now server-authoritative
- Phase 4 expanded-mode authority is complete across team modes, objective modes, and the full mothership encounter loop
