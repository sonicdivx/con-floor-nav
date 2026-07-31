# AGENTS.md — Con Floor Nav

Guidance for Cursor (and other) agents working in this repository.

## Project

**Con Floor Nav** is an offline-first PWA for navigating convention dealer floors. Primary use: Otakon (and other cons). Data stays on-device in IndexedDB (Dexie). Optional Live party WebSocket runs on the same Render service that hosts the static build.

## Read first

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, schema, deploy
2. [docs/PLAN.md](docs/PLAN.md) — roadmap / completed phases / follow-ups
3. [README.md](README.md) — run, PWA, Capacitor, Render

Cursor project rules (committed): `.cursor/rules/*.mdc`.

## Working agreements

- Prefer small, focused changes that match existing patterns in `src/`.
- Do not commit secrets, API keys, or `.env` files. AI keys live in `localStorage` only.
- Do not force-push `main`. Feature work is typically on `cursor/*` branches; Render auto-deploys `cursor/con-floor-nav-pwa`.
- Only commit when the user asks. When committing, follow the repo’s recent message style.
- Do not add unsolicited markdown docs; this `docs/` set is intentional project context.

## Quick map of the codebase

```
src/
  App.tsx              # tabs, event/map state, wiring
  components/          # MapViewer, VendorPanel, Settings panels, SharePartyPanel
  db/                  # Dexie schema + types
  lib/                 # import, backup, pathfinding, party, tags, sample
  hooks/               # useObjectUrl
server/
  party-server.ts      # HTTP static + /party WebSocket + /api/health
android/               # Capacitor Android project
public/samples/        # Otakon 2026 Dealers sample assets
docs/                  # architecture + plan
```

## Laptop sync

Clone from GitHub, check out the active branch, `npm install`, open the folder in Cursor. Committed rules under `.cursor/rules/` load automatically. Local IndexedDB data does **not** sync via git — use Settings → Backup export/import for event data.

## Cursor Cloud specific instructions

Standard scripts live in `package.json` / `README.md`. Non-obvious notes for cloud agents:

- Core UI/dev loop: `npm run dev` → `http://localhost:5173/` (Vite binds `0.0.0.0:5173`, `strictPort`). Lint: `npm run lint` (oxlint). Build: `npm run build`. Preview: `npm run preview` (port 4173). Production/static + Live party + catalog sync API: `npm start` / `npm run party-server` (serves `dist/` + `/party` WS + `/api/sync/catalog`).
- Local live party + sync against the Node server: `VITE_PARTY_WS_URL=http://localhost:8787 npm run dev` (also enables catalog pull from that host). Without it, Vite skips cloud sync and hides Live party.
- Durable overnight parties require `DATABASE_URL` (Render Postgres from `render.yaml`). Without it, party codes are memory-only and die on process restart.
- PWA service worker is disabled in Vite dev (`devOptions.enabled: false`), so hot reload is fine — no stale SW cache gotcha while on `npm run dev`. Update toast / Refresh only appear under `npm run preview` or production (`registerType: 'prompt'`). Changelog + version live in the map hamburger footer; source text is `src/lib/changelog.ts` (`APP_VERSION`). **Update to latest** / Refresh: activates waiting SW when present, otherwise clears Cache Storage + unregisters SW and navigates with a `__cfn_r` bust token (stripped on next boot).
- Device login (Settings): no-password unique code; `src/lib/personalSync.ts` + `/api/sync/device*` (needs `DATABASE_URL`). Local Vite alone cannot save/load — use `npm start` or production.
- Camera / GPS need a secure context. On plain `http://<LAN-IP>` they are often blocked; use `npm run dev:https` for those. Map/import/tags/library photos/manual pin work over `http://localhost:5173`.
- Live party UI only appears when `isPartyLiveEnabled()` is true (prod same-origin, or set `VITE_PARTY_WS_URL`). Local party testing: run `npm run build` then `npm start`, or point the Vite app at a local party server via `VITE_PARTY_WS_URL`.
- App state is IndexedDB, not git. Shared catalog (maps/dealers) syncs from `/api/sync/catalog` when online; favorites/notes/photos stay on-device. Reset by clearing site data for `localhost:5173`. Cross-machine personal data: Settings → Backup export/import (or Otakon sample).
