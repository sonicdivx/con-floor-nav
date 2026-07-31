# Plan — Con Floor Nav

Living roadmap. Architecture detail: [ARCHITECTURE.md](ARCHITECTURE.md).

## Goals

- Offline-first floor map + vendor tracker for Otakon and future cons
- PWA-first (no Apple Developer account required for testing)
- Optional Android sideload via Capacitor; optional Live party on Render

## Completed phases

| Phase | Status | Notes |
|-------|--------|-------|
| Scaffold Vite React TS PWA | Done | Service worker / installable |
| Dexie data layer | Done | Now multi-event / multi-map (schema v4) |
| Map UI + booth edit | Done | Pan/zoom, overlays, Settings → edit booths |
| JSON/CSV import + AI prompt | Done | Sample Otakon 2026 Dealers included |
| Vendor status / tags / photos | Done | Custom global tags + searchable select |
| Pin + aisle navigation | Done | A* around booths/pillars; Go tab quick pick |
| Optional in-app AI extract | Done | Keys in localStorage; review before save |
| Phase 2 — Gallery | Done | Multi-select → favorite / look again |
| Phase 2 — Backup | Done | `cfn-backup` v2 multi-map |
| Phase 3 — Capacitor Android | Done | `npm run cap:sync` / Settings → Native app |
| Phase 4 — Render deploy | Done | PWA + `/party` on one web service |
| Multi-event / multi-map | Done | Settings Events + Floor maps panels |
| Pinned details booth switch | Done | Keep-open pin stays; selection updates |

## Active branch / deploy

- Primary integration branch: `cursor/phase2-3-backup`
- Render auto-deploys that branch
- `main` may lag; open PRs toward `main` when ready to stabilize

## Follow-ups (not blocking)

- [ ] iOS / TestFlight Capacitor target (needs Apple Developer account)
- [ ] GPS → image calibration UI (schema reserved; halls still need manual pin)
- [ ] Include custom tag catalog inside backup JSON explicitly (catalog also inferred from vendors today)
- [ ] Capacitor default `VITE_PARTY_WS_URL` for Live party without rebuild guessing
- [ ] Stronger onboarding for Go tab share / party when opening native app
- [ ] Dependabot / dependency hygiene on default branch

## Prep workflow (Otakon)

1. On Wi‑Fi: create/select event, load sample or import map + booths
2. Nudge booths if needed (Settings → Customize → Map)
3. Tag / favorite vendors; add item photos as you shop
4. Install PWA once so the shell caches; use offline at the con
5. Optional: Live party on Render for friend pins; or Share pin links offline

## Success criteria

- Map + booths usable with airplane mode after first visit
- Multiple cons and multiple halls without wiping unrelated data
- Backup round-trip restores maps, booths, vendors, photos
- Path from My pin to a favorite avoids booth boxes / pillars when possible
