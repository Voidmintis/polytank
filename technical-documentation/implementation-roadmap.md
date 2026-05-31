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

Recommended order:
1. 2 teams
2. 4 teams
3. objective-driven arena modes

These should reuse the same authoritative core rather than fork simulation logic.
