# Deployment And CI

## Deployment Split

- Frontend: GitHub Pages
- Backend: Fly.io
- Source control: same repository

## Current State

The repository already deploys the static client through `.github/workflows/deploy-pages.yml`.

The backend now has a Fly.io deployment path through `.github/workflows/deploy-server.yml`.

Backend deploy automation currently expects:
- `server/fly.toml`
- `server/Dockerfile`
- a Fly app created to match the app name in `server/fly.toml`
- a repository secret named `FLY_API_TOKEN`

## Planned Backend Layout

- `server/package.json`
- `server/tsconfig.json`
- `server/src/index.ts`
- `server/fly.toml`

The current backend runtime serves HTTP health/status on `/` and listens on `PORT`, which Fly maps to internal port `3000`.

## CI Responsibilities

GitHub Pages workflow:
- install root dependencies
- build Vite client
- deploy `dist`

Fly workflow:
- install backend dependencies
- typecheck or build backend
- deploy from `server/`
- build the backend container from `server/Dockerfile`

## Required Secrets

- `FLY_API_TOKEN`
- backend environment variables such as room limits, reconnect timeout, and origin allow-list

## Fly Setup Notes

- create the Fly app once before the first GitHub Actions deploy
- replace the placeholder app name in `server/fly.toml` if the chosen Fly app name differs
- set runtime secrets with `fly secrets set ...` before exposing the service publicly

## Rollback Expectations

- Frontend deploys remain independently reversible from backend deploys
- Backend deploys should support quick rollback through Fly.io release history
