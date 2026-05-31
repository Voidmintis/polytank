# Deployment And CI

## Deployment Split

- Frontend: GitHub Pages
- Backend: Fly.io
- Source control: same repository

## Current State

The repository already deploys the static client through `.github/workflows/deploy-pages.yml`.

The backend does not exist yet. Fly.io should target a future `server/` service in this repo, not the repository root.

## Planned Backend Layout

- `server/package.json`
- `server/tsconfig.json`
- `server/src/index.ts`
- `server/fly.toml`

## CI Responsibilities

GitHub Pages workflow:
- install root dependencies
- build Vite client
- deploy `dist`

Fly workflow:
- install backend dependencies
- typecheck or build backend
- deploy from `server/`

## Required Secrets

- `FLY_API_TOKEN`
- backend environment variables such as room limits, reconnect timeout, and origin allow-list

## Rollback Expectations

- Frontend deploys remain independently reversible from backend deploys
- Backend deploys should support quick rollback through Fly.io release history
