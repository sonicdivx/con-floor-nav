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
- Do not force-push `main`. Feature work is typically on `cursor/*` branches; Render auto-deploys `cursor/phase2-3-backup`.
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
