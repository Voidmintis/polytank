# Technical Documentation

This folder is the implementation-facing documentation set for Polytank multiplayer.

Current status: Planning and scaffold setup.

Deployment model:
- Static client on GitHub Pages
- Authoritative Node.js backend on Fly.io
- Same repository for client, server, and shared protocol types

Reading order:
1. `copilot-instructions-questionnaire.md`
2. `multiplayer-architecture.md`
3. `network-protocol.md`
4. `deployment-and-ci.md`
5. `implementation-roadmap.md`
6. `testing-and-observability.md`

Phase 1 scope:
- Private-room FFA only
- Movement, aiming, firing, bullets, shapes, XP, upgrades, death, respawn, leaderboard, bots

Phase 1 exclusions:
- Public matchmaking
- Team modes
- Sandbox and admin systems
- Boss and fusion-side modes

For AI instruction generation, start with `copilot-instructions-questionnaire.md` before the architecture and protocol documents.

