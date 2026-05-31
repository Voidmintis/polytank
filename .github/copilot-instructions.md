# GitHub Copilot Instructions

> Location: `.github/copilot_instructions.md`
>
> Project: Polytank
>
> Purpose: These instructions define how GitHub Copilot, Copilot Chat, and other AI coding assistants must work in this repository. The goal is to protect the existing product, preserve gameplay feel, move the architecture forward incrementally, and ensure all changes account for multiplayer, security, maintainability, and UI consistency.

---

# Project Context

Polytank is a 2D browser/mobile game inspired heavily by Diep.io, with a polished modern sci-fi HUD presentation.

The project currently supports or is evolving toward:

- Solo play
- AI-controlled opponents/bots
- Real-time multiplayer
- Private-room FFA first
- Public arenas later, after netcode hardening
- Browser-first deployment
- Future Android/iOS support using the same web client first
- Desktop-first UX with strong mobile support
- Touch controls already present

Current technology and hosting:

- Client: Vite, TypeScript, HTML, CSS
- UI: Plain HTML/CSS/JS components, not a framework
- Rendering: Mixed DOM/CSS and Canvas
- Server: TypeScript on Node.js
- Networking: Plain WebSockets using `ws`
- Server hosting: Fly.io
- Client hosting: GitHub Pages
- Package manager: npm
- Tests/tools: ESLint, Vitest, Playwright
- Repo model: one monorepo

Current repo shape:

```text
repo-root/
  public/
    main.js                 # current mostly monolithic gameplay client
  server/                   # backend scaffold
  src/
    shared/
      protocol.ts           # shared multiplayer protocol types
      world.ts              # shared world types
```

The current gameplay client is largely monolithic and stateful in `public/main.js`. The backend scaffold and shared contracts are the beginning of the future multiplayer architecture, but the existing gameplay client is not yet deeply wired into that model.

The AI must treat this as an incremental product evolution, not a greenfield rewrite.

Additional project defaults:

- Accounts/auth: guest-style sessions first, persistence later
- Progression: do not assume persistent multiplayer progression is required immediately
- Community features: usernames and rooms are in scope; chat, clans, and UGC are not current priorities
- Moderation: do not build large moderation systems prematurely
- Audit logging: lightweight server-side audit logging is desirable before or during public rollout
- Platform strategy: same web client first, no mobile wrapper selected yet
- Controller support: not currently required

---

# Non-Negotiable Rules

1. Preserve current gameplay behavior unless explicitly asked to change it.
2. Prefer targeted patches over large rewrites.
3. Do not impose ECS or any other major paradigm rewrite.
4. Preserve the current product incrementally while steering toward cleaner client/server/shared boundaries.
5. Treat multiplayer as server-authoritative with client prediction and interpolation as the intended direction.
6. Treat the client as untrusted.
7. Prioritize cheating and packet tampering risks first.
8. Keep the visual direction aligned with the existing polished neon/sci-fi HUD.
9. Use existing architecture and style before creating new patterns.
10. Add tests when the touched gameplay or server surface is realistically testable.
11. Use strict, directive engineering judgment. Do not make casual or speculative changes.
12. Work autonomously when possible, making good project-aligned decisions without waiting for clarification on every minor detail.

---

# How AI Should Work in This Repository

Before changing code, the AI must inspect the relevant existing files and identify the current pattern being extended.

The AI must not assume the codebase is already ideal. It must recognize that:

- The current client is still mostly client-authoritative.
- Local storage and browser-local state still own much of the current behavior.
- The server scaffold is the start of an authoritative multiplayer direction.
- Shared protocol/world types exist, but are not yet fully integrated into the gameplay client.
- The desired direction is incremental improvement, not immediate full replacement.

When solving a task, the AI must choose the best architecture for the current stage of the project:

- Preserve behavior now.
- Improve boundaries when safe.
- Avoid duplication.
- Avoid massive rewrites.
- Add shared types/config where it clearly reduces future multiplayer risk.
- Move authority server-side when the feature is multiplayer-impacting.
- Keep UI consistent with the style guide.

---

# Architecture Principles

## Preserve Current Product Incrementally

This project is not a blank slate.

The AI must not rewrite the game into a new architecture just because a new pattern might be cleaner in isolation.

Prefer:

- Small targeted patches
- Extracting helpers from existing code when useful
- Moving repeated logic into shared utilities
- Gradually separating client, server, and shared responsibilities
- Keeping gameplay feel identical during refactors
- Introducing structure around existing code before replacing it

Avoid:

- Full rewrites of `public/main.js` unless explicitly requested
- Replacing plain object/module-driven systems with ECS
- Introducing a UI framework without explicit approval
- Reworking rendering architecture without explicit need
- Broad file moves unrelated to the requested task
- Changing balance, movement, aiming, combat, or spawn behavior during refactors

## Existing Architecture Comes First

Before adding new code, search for existing equivalents.

Do not duplicate:

- Entity state models
- Tank stat definitions
- Projectile definitions
- Upgrade logic
- Vector math
- Collision helpers
- Input handling
- Touch control logic
- WebSocket message shapes
- Protocol definitions
- Shared world types
- UI button/panel/modal patterns
- CSS variables or theme tokens
- Color, font, glow, shadow, or spacing styles
- Storage keys or persistence logic

If an existing pattern exists, extend it. If the existing pattern is messy, improve it locally without changing public behavior.

## Plain Object and Module-Driven Systems

The current architecture is plain object and module-driven. The AI should work within that style unless specifically asked to change it.

Acceptable improvements:

- Extracting pure functions
- Extracting configuration objects
- Moving shared contracts into `src/shared`
- Isolating network protocol handling
- Isolating UI component helpers
- Creating narrow modules around existing responsibilities

Not acceptable by default:

- Introducing ECS
- Introducing class hierarchies for every entity
- Introducing a major framework
- Replacing large gameplay sections without a behavior-preservation plan

## Separation of Concerns

Keep responsibilities clear.

- Rendering code renders; it should not own gameplay rules.
- Input code captures player intent; it should not directly decide authoritative outcomes.
- Client prediction predicts; it does not become truth.
- Server simulation validates and resolves multiplayer outcomes.
- UI components display state and collect intent; they do not contain core gameplay rules.
- Shared files define contracts, constants, and deterministic helpers that both client and server can safely use.
- Network code serializes, validates, dispatches, and applies messages through clear boundaries.

When a change crosses these boundaries, the AI must explain why.

## DRY Without Premature Abstraction

Avoid copy/paste implementation.

Prefer reuse through:

- Shared config
- Shared protocol types
- Shared world types
- Shared validation helpers
- Shared UI components
- CSS variables/design tokens
- Small focused utility functions

However, do not over-abstract code that only looks similar today but is likely to evolve differently.

Use judgment:

- Duplicate logic is bad.
- Premature generic systems are also bad.
- Clear domain boundaries matter more than clever reuse.

---

# TypeScript Standards

Use strict, readable TypeScript.

Prefer:

- Explicit domain names
- Descriptive variable names
- Narrow interfaces
- Discriminated unions for protocol messages
- Runtime validation at network boundaries
- Shared protocol types in `src/shared/protocol.ts`
- Shared world concepts in `src/shared/world.ts`
- Pure functions for deterministic calculations
- Exhaustive `switch` handling for message types and state variants

Avoid:

- `any` unless unavoidable and explained
- Large untyped objects
- Stringly typed protocol values when unions/enums are more appropriate
- Hidden global mutation
- Mixing client-only and server-only concerns
- Scattered magic numbers
- Complex clever code that harms readability

---

# Multiplayer Architecture Direction

The current game is mostly client-authoritative, but the intended architecture is server-authoritative multiplayer with client prediction and interpolation.

The AI must account for this direction in all multiplayer-related changes.

## Phase Priority

Current multiplayer priority:

1. Private-room FFA
2. Netcode hardening
3. Public arenas
4. Persistent accounts/progression later
5. Broader moderation/community tooling later

Do not optimize early work around public matchmaking before private-room FFA is solid.

## Server Authority

The server must become authoritative for multiplayer-impacting outcomes.

The server should own or validate:

- Player identity/session association
- Room membership
- Spawn state
- Position validity
- Movement speed/acceleration limits
- Fire rate/cooldowns
- Projectile creation
- Projectile ownership
- Projectile hits
- Damage
- Death
- XP/score gain
- Upgrade eligibility
- Match state
- Meaningful progression/unlocks/cosmetics/rewards once multiplayer affects them

The client may send intent, not truth.

Good client-to-server messages:

```ts
{
  type: "player-input",
  sequence: 123,
  moveX: 1,
  moveY: 0,
  aimAngle: 1.57,
  firing: true
}
```

Bad client-to-server messages:

```ts
{
  type: "claim-hit",
  targetId: "enemy-1",
  damage: 50,
  xpGained: 10
}
```

The client must not be trusted to claim:

- Hits
- Damage
- XP
- Level-ups
- Rewards
- Movement positions without validation
- Upgrade eligibility
- Cooldown completion

## Client Prediction and Interpolation

Client prediction and interpolation are part of the intended architecture now, not a distant concern.

Prediction may be used for:

- Local movement responsiveness
- Aiming responsiveness
- Fire visual feedback
- Camera feel
- Local HUD responsiveness

Interpolation should be used for:

- Remote player movement
- Remote projectile/entity smoothing
- Snapshot rendering

When adding prediction/reconciliation logic:

- Keep predicted state separate from authoritative state.
- Track input sequence numbers when applicable.
- Reconcile local prediction against server snapshots.
- Avoid permanent consequences until confirmed by the server.
- Do not let predicted state leak into server-authoritative decisions.

## Shared Protocol and World Types

Shared multiplayer contracts already live under `src/shared/`.

The AI should prefer extending:

```text
src/shared/protocol.ts
src/shared/world.ts
```

when adding or changing multiplayer concepts.

Rules:

- Do not define protocol message shapes separately in client and server.
- Do not create duplicate world/entity types in server-only or client-only code when the concept is shared.
- Keep client-only visual/rendering properties out of shared authoritative world types unless intentionally part of the protocol.
- Keep server-only secret/internal state out of shared client-visible contracts.

## Network Protocol

Networking uses plain WebSockets with `ws`.

All protocol changes must be explicit, minimal, version-aware where practical, and validated at runtime.

Each message should have:

- A discriminating `type`
- A minimal payload
- Clear direction: client-to-server, server-to-client, or both
- Runtime validation at the receiving boundary
- Safe handling for unknown/invalid messages

Avoid scattering protocol handling throughout unrelated files.

Prefer a central dispatch/validation path.

---

# Security and Anti-Cheat

This is a multiplayer game. The browser client is untrusted.

The AI must prioritize cheating and packet tampering first.

## Required Security Defaults

For all server/network/multiplayer changes:

- Validate all incoming WebSocket messages at runtime.
- Reject unknown message types safely.
- Enforce message size limits.
- Enforce reasonable message rate limits.
- Validate room membership before applying actions.
- Validate player/session ownership before applying actions.
- Validate movement, fire rate, cooldowns, upgrade eligibility, and hit plausibility server-side.
- Never trust client-supplied score, XP, damage, currency, unlocks, or rewards.
- Do not expose server stack traces or internal errors to clients.
- Sanitize or safely render usernames and room names.
- Avoid unsafe `innerHTML` for user-provided content.
- Do not store secrets in client code or Vite public variables.
- Use Fly.io secrets or secure server environment configuration for server secrets.

## Guest Sessions and Reconnect Tokens

Early multiplayer assumes guest-style sessions and reconnect tokens.

Rules:

- Guest sessions should still have server-issued identity/session state.
- Reconnect tokens must not grant access to other players' rooms or state.
- Tokens should be hard to guess.
- Tokens should expire or be invalidated when appropriate.
- Never trust client-generated identity as authoritative.

## Usernames, Parties, and Rooms

Initial user-generated content includes usernames and parties/rooms.

For usernames and room names:

- Apply length limits.
- Apply character rules or sanitization.
- Render as text, not HTML.
- Prevent layout-breaking names.
- Avoid allowing invisible/control characters where possible.
- Avoid using display names as internal IDs.

Chat, clans, and broad user-generated content are not currently planned. Do not build large moderation systems prematurely, but avoid choices that would block moderation later.

## Audit Logging

Lightweight audit logging is desirable before or during public rollout.

Useful events to log server-side:

- Invalid message type
- Invalid payload shape
- Excessive message rate
- Movement validation failure
- Fire rate validation failure
- Upgrade eligibility failure
- Room/session mismatch
- Reconnect failure

Do not log sensitive secrets or full tokens.

---

# UI/UX Direction

Polytank has an existing polished neon/sci-fi visual identity. The AI must preserve and extend that identity.

Current UI direction:

- Polished modern sci-fi HUD
- Strong neon/sci-fi presentation
- Combat readability remains simple
- Desktop-first with strong mobile support
- Plain HTML/CSS/JS components
- Orbitron and Rajdhani are already in use
- Existing Polytank branding and visual tone should be preserved

## Style Guide Requirement

A formal style guide should live at:

```text
technical-documentation/UI_STYLE_GUIDE.md
```

The AI must consider this guide for all UI/UX changes.

If the style guide does not exist yet and a UI change introduces or standardizes a major pattern, create or update it.

The style guide should document:

- Brand personality
- Visual tone
- Color palette
- Typography
- Font usage: Orbitron and Rajdhani
- Spacing scale
- Border radius scale
- Shadows/glows
- HUD layout rules
- Button variants
- Panel/card variants
- Modal patterns
- Tooltip patterns
- HUD status indicators
- Health/XP/progress bars
- Animation rules
- Mobile/touch behavior
- Accessibility expectations
- Responsive layout behavior

## UI Component Rules

Use reusable, configurable plain HTML/CSS/JS components where practical.

Prefer shared component patterns for:

- Buttons
- Icon buttons
- Cards
- Panels
- Modals
- Tooltips
- HUD modules
- Health bars
- XP/progress bars
- Upgrade cards
- Menus
- Settings rows
- Toasts/notifications
- Room/lobby UI
- Player list UI
- Mobile controls

Components should support configuration for:

- Variant
- Size
- Tone/intent
- Active/selected state
- Disabled state
- Icon placement
- Tooltip text
- Loading/pending state
- Keyboard support
- Touch behavior
- Responsive layout

Avoid:

- One-off CSS for repeated UI patterns
- Hardcoded colors scattered across files
- New visual styles that do not match the sci-fi HUD
- Hover-only interactions that fail on touch devices
- Tiny tap targets
- Large blocking UI over combat without clear intent
- UI logic that mutates core gameplay state directly

## Combat Readability

Even though the UI should feel polished, combat readability must stay simple.

Do not let visual polish obscure:

- Player position
- Enemy position
- Bullet/projectile direction
- Hit feedback
- Health state
- Upgrade choices
- Active room/match state
- Mobile controls

Effects should enhance readability, not compete with gameplay.

---

# Mobile and Platform Standards

No mobile wrapper has been chosen yet. Assume the same web client first.

All UI and gameplay changes should consider:

- Touch controls already exist
- Desktop-first layout
- Strong mobile support
- Safe areas
- Orientation behavior
- Small-screen readability
- Thumb reach zones
- Avoiding hover-only interactions
- Avoiding tiny tap targets
- Lower-powered devices
- Mobile network variability
- Battery/performance impact

Do not introduce platform-specific code paths unless clearly necessary.

Controller support is not currently required.

---

# Gameplay Code Rules

## Preserve Gameplay Feel

Unless explicitly asked, do not change:

- Movement feel
- Acceleration/deceleration feel
- Aiming behavior
- Firing behavior
- Projectile speed/timing
- Collision behavior
- Camera behavior
- Enemy behavior
- AI behavior
- Spawn behavior
- Upgrade balance
- XP/level curves
- Visual identity
- HUD layout
- Touch control feel

For refactors, the correct outcome is: same game, cleaner code.

## Config-Driven Content

Where practical, gameplay tuning should be config-driven.

Prefer configuration for:

- Tank stats
- Weapon stats
- Projectile stats
- Fire rates
- Damage
- Movement speed
- Upgrade definitions
- AI tuning
- Spawn weights
- Match settings
- UI labels/descriptions

Avoid burying tunable values in unrelated procedural code.

## AI/Bot Behavior

AI-controlled opponents should follow the same authoritative model when used in multiplayer.

Rules:

- Server should own multiplayer-impacting AI state.
- AI decisions should be deterministic or controlled server-side where practical.
- AI should not rely on hidden client-only state for multiplayer outcomes.
- AI behavior tuning should be configurable where practical.

---

# Performance Standards

This is a real-time game and must remain performant on desktop and mobile.

The AI must consider performance when touching:

- Game loop
- Rendering
- DOM updates
- Canvas effects
- Collision checks
- Entity updates
- Particles
- Projectiles
- AI logic
- Network snapshots
- Interpolation
- Input handling
- Touch controls
- HUD updates

Prefer:

- Fixed timestep simulation where applicable
- Minimal per-frame allocations
- Reusing objects in hot paths where necessary
- Spatial partitioning once entity counts demand it
- Efficient DOM updates
- Canvas batching where practical
- Snapshot/delta strategies for multiplayer
- Area-of-interest filtering when public arenas scale
- Avoiding full-world updates when not needed

Avoid:

- Heavy DOM manipulation every frame
- Recalculating static data every frame
- Unbounded particles/effects
- Unbounded projectile/entity growth
- Sending unnecessary state over the network
- Allocating large temporary objects in hot loops
- Adding visual effects that harm mobile performance

---

# Testing Requirements

Use existing project tools:

- ESLint
- Vitest
- Playwright
- npm

## Testing Philosophy

Everything should be testable within reason.

This does not mean every line needs a test. It means the AI must shape code so important behavior can be validated through at least one of these layers:

- Static validation
- Unit tests
- Integration tests
- End-to-end tests
- Manual smoke validation when automation is not yet practical

When introducing new code, prefer designs that make testing easier:

- Extract pure functions for deterministic rules
- Isolate validation logic
- Keep protocol parsing and message dispatch narrow
- Separate rendering from gameplay decisions
- Avoid hidden global state where a small injectable dependency would work
- Prefer config-driven values over deeply embedded magic numbers

If a surface is hard to test, the AI should improve the boundary where practical instead of accepting the code as permanently untestable.

## Required Validation Mindset

For every meaningful change, the AI must choose the narrowest realistic validation path.

At least one of the following should happen when applicable:

- Run linting for the touched surface
- Run TypeScript typechecks for the touched surface
- Add or update unit tests
- Add or update integration tests
- Add or update Playwright coverage for user-critical flows
- Run a manual smoke check and describe exactly what was verified

If a change cannot be practically covered by tests yet, the AI should still:

- explain why
- choose the next best executable validation
- avoid claiming a change is fully safe without evidence

## Test Tiers

### 1. Static Validation

Always use when relevant:

- TypeScript typecheck
- ESLint
- Build validation for touched runtime paths

Static validation is the minimum baseline, not the full testing strategy.

### 2. Unit Tests

Prefer unit tests for deterministic logic such as:

- Vector and geometry math
- Collision math
- Damage calculations
- XP and level progression
- Upgrade eligibility
- Spawn weighting and deterministic helpers
- Protocol parsing and validation helpers
- Room state reducers
- Utility formatting and UI state helpers

Unit tests should be:

- small
- deterministic
- readable
- behavior-focused

Avoid unit tests that simply duplicate implementation details line-by-line.

### 3. Integration Tests

Use integration tests when multiple parts must work together, especially for:

- WebSocket message handling
- Room create/join/leave/ready/start flows
- Reconnect token handling
- Server authority checks
- Movement/fire validation pipelines
- Upgrade application through server validation
- Snapshot application and reconciliation boundaries
- Persistence or save/load boundaries

Integration tests should validate system behavior across boundaries, not just single functions.

### 4. End-to-End Tests

Use Playwright or equivalent end-to-end coverage for critical user flows when practical, including:

- App loads correctly
- Main menu and lobby flows work
- Private room creation/join flow works
- Important HUD controls remain usable
- Mobile-sensitive UI flows remain operable
- Regression-prone menus and settings continue to function

Do not overuse end-to-end tests for logic that is better covered at lower levels.

### 5. Manual Smoke Checks

If automation is not practical yet, manual validation is acceptable only when it is explicit.

Manual smoke validation should state:

- what was run
- what environment was used
- what user path was exercised
- what passed
- what remains unverified

## What Must Be Tested By Change Type

### Gameplay Changes

When gameplay logic changes, validate as many of these as are relevant:

- movement behavior
- firing behavior
- collision behavior
- damage
- death/respawn
- upgrade behavior
- spawn behavior
- AI behavior
- deterministic math/helpers

At minimum:

- typecheck
- targeted executable validation
- tests when the touched gameplay logic is reasonably isolatable

### Server and Multiplayer Changes

When server or multiplayer logic changes, validate as many of these as are relevant:

- malformed message rejection
- unknown message handling
- room membership enforcement
- player/session ownership
- movement validation
- fire rate and cooldown validation
- upgrade validation
- reconnect handling
- snapshot correctness
- server/client contract consistency

Server-authoritative behavior should be tested more strictly than cosmetic client changes.

### UI Changes

When UI changes, validate:

- visual consistency with the sci-fi HUD direction
- keyboard and touch behavior when relevant
- responsive behavior when relevant
- no obvious breakage in primary menus/HUD

If a UI change creates a reusable pattern, update the style guide when appropriate.

### Config and Content Changes

When changing configuration-heavy content, validate:

- values parse correctly
- dependent systems still work
- no broken references or missing keys
- no obvious balancing mistakes caused by typo-level errors

## Test Quality Rules

Tests added by the AI should be:

- targeted
- maintainable
- deterministic where possible
- meaningful to the behavior being protected

Avoid:

- snapshot-heavy tests with little signal
- brittle selectors when better hooks exist
- tests that only mirror current implementation structure
- giant multi-purpose tests when smaller focused tests are clearer

## Regression Protection

When fixing a bug, prefer adding the narrowest test that would have caught that bug if the affected surface is testable.

When refactoring risky code, add tests before or during the refactor when practical so behavior can be preserved rather than guessed.

When the touched surface is testable, add or update tests.

Prioritize tests for:

- Shared protocol validation
- Server message handling
- Movement validation
- Fire rate/cooldown validation
- Upgrade eligibility
- Room/session membership
- Reconnect handling
- Collision math
- XP/level calculations
- Deterministic helpers
- UI component states when practical
- Playwright coverage for critical menus/lobby flows when practical

Examples of important multiplayer/security tests:

- Malformed messages are rejected.
- Unknown message types are rejected safely.
- A client cannot move faster than allowed.
- A client cannot fire faster than allowed.
- A client cannot select unavailable upgrades.
- A player cannot act in a room they do not belong to.
- A reconnect token cannot attach to another player's session.

Do not add brittle tests that only duplicate implementation details.

## Feature Completion Standard

A feature is not considered complete unless it has passed appropriate validation for its risk level.

At minimum, a completed feature should have:

- code changes in a coherent finished state
- relevant typecheck/build/lint validation passing
- tests added or updated when the surface is testable
- manual smoke verification when automation is not practical
- documentation updated if architecture, protocol, UI patterns, or workflow expectations changed

The AI must not treat "code compiles" as the same thing as "feature complete" when the feature affects gameplay, multiplayer, or user-facing flows.

## Check-In And Commit Workflow

When feature work is complete and validation has passed, the intended workflow is to check in the work as a coherent commit.

Guidance for AI:

- finish the feature fully
- run the appropriate tests and validations first
- ensure the diff is coherent and scoped to the feature
- summarize what changed and what was validated
- then commit/check in the feature when the current workflow or task explicitly permits source control actions

Commit/check-in quality bar:

- no knowingly broken feature state
- no unvalidated high-risk changes
- no mixed unrelated changes bundled together when avoidable
- no claiming completion before validation

If commit/check-in is not permitted in the current task context, the AI should still prepare the work to that standard and clearly state that it is ready for check-in after tests pass.

---

# Documentation Requirements

Important architecture should not live only in code or chat history.

Recommended documentation:

```text
technical-documentation/
  multiplayer-architecture.md
  network-protocol.md
  deployment-and-ci.md
  implementation-roadmap.md
  testing-and-observability.md
  UI_STYLE_GUIDE.md
  UI_COMPONENTS.md
  GAMEPLAY_CONFIG.md
  PERFORMANCE_GUIDE.md
```

Do not create all of these files just because they are listed. Create or update them when a change makes the documentation useful.

Required documentation behavior:

- Update `technical-documentation/UI_STYLE_GUIDE.md` when introducing or standardizing major UI patterns.
- Update protocol docs when adding/changing network messages.
- Update architecture/client-server docs when moving authority across the boundary.
- Update security docs when adding session, reconnect, validation, or anti-cheat flows.

---

# Deployment and Environment Rules

Client is hosted on GitHub Pages. Server is hosted on Fly.io.

Rules:

- Do not put secrets in client code.
- Do not put secrets in Vite public environment variables.
- Client configuration should only include public values.
- Server secrets belong in Fly.io secrets or secure server-side environment variables.
- Keep client/server URLs configurable by environment where practical.
- Be careful with CORS/WebSocket origin behavior.
- Do not assume localhost-only behavior in production paths.

---

# AI Response and Patch Style

The preferred AI output style for this repo is targeted patches.

When proposing code changes, the AI should:

- Keep changes narrowly scoped.
- Explain what existing pattern it is extending.
- Mention any multiplayer/security implications.
- Mention any UI style guide implications for UI changes.
- Include tests when reasonable.
- Avoid unrelated cleanup.
- Avoid broad rewrites.
- Avoid changing public behavior unless explicitly asked.

When updating code, prefer:

- Targeted patches
- Complete updated functions when helpful
- Small new files only when they create clear boundaries

Avoid:

- Huge generated files
- Broad reformatting
- Rewriting unrelated code
- Introducing a framework
- Changing behavior while claiming it is only a refactor

---

# Final Review Checklist for AI

Before finalizing any change, the AI must check:

## Architecture

- Did I inspect existing patterns first?
- Did I preserve current behavior?
- Did I avoid duplicating existing logic?
- Did I keep the change incremental?
- Did I avoid imposing ECS or a major rewrite?
- Does this improve or preserve client/server/shared boundaries?

## Multiplayer

- Does this affect authoritative game state?
- Should this run on the server?
- Is the client sending intent instead of truth?
- Are prediction/interpolation boundaries respected?
- Are shared protocol/world types updated if needed?

## Security

- Is every client-originated message validated?
- Could this introduce cheating or packet tampering risk?
- Are message size/rate limits relevant here?
- Are usernames/room names safely handled?
- Are secrets kept server-side?
- Are server errors safely handled?

## UI/UX

- Does this match the polished sci-fi HUD direction?
- Does this reuse or create a reusable component pattern?
- Are Orbitron/Rajdhani and existing visual tone respected?
- Does this maintain combat readability?
- Does this work for desktop and mobile/touch?
- Should `docs/UI_STYLE_GUIDE.md` be updated?

## Performance

- Does this run every frame?
- Does it allocate unnecessarily?
- Does it scale with entity/projectile/player count?
- Does it cause excessive DOM work?
- Does it increase network payload size unnecessarily?
- Is mobile performance considered?

## Testing

- Is the touched surface realistically testable?
- Should Vitest or Playwright tests be added/updated?
- Are multiplayer/security edge cases covered?

---

# Project Defaults

Unless the user explicitly says otherwise, assume:

- Preserve current gameplay behavior.
- Use the monorepo structure.
- Use plain WebSockets with `ws`.
- Use TypeScript on Node.js for the server.
- Use shared contracts under `src/shared/`.
- Do not introduce ECS.
- Do not introduce a UI framework.
- Use plain HTML/CSS/JS UI components.
- Preserve the polished neon/sci-fi HUD identity.
- Use desktop-first UX with strong mobile support.
- Prioritize private-room FFA before public arenas.
- Treat multiplayer as server-authoritative with client prediction and interpolation.
- Treat the client as untrusted.
- Prioritize cheating and packet tampering risks.
- Use npm.
- Use ESLint, Vitest, and Playwright.
- Assume guest sessions first, persistent accounts later.
- Assume usernames and rooms exist, but chat/clans/UGC are not current priorities.
- Avoid premature moderation tooling.
- Prefer lightweight audit logging before public rollout.
- Assume the same web client serves browser and mobile first.
- Do not prioritize controller support unless explicitly requested.
- Add tests when practical.
- Prefer targeted patches.
- Be strict and directive.

