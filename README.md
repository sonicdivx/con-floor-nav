# Con Floor Nav

Offline-first PWA for navigating convention dealer / artist-alley floors (Otakon-first). Import a floor map + booth JSON, tag vendors, attach item photos, drop a manual “you are here” pin, and aisle-path to a booth.

**Docs for agents & humans:** [AGENTS.md](AGENTS.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PLAN.md](docs/PLAN.md)

## Sync to another laptop (Cursor)

Git is the source of truth (rules and docs are committed).

```bash
git clone https://github.com/sonicdivx/con-floor-nav.git
cd con-floor-nav
git checkout cursor/con-floor-nav-pwa   # active integration / Render branch
npm install
```

Then in Cursor: **File → Open Folder** → this repo. Project rules load from `.cursor/rules/`.

- **Code + Cursor rules + docs** travel with the repo.
- **On-device event data** (IndexedDB) does not. Use **Settings → Backup** export on one machine and import on the other, or re-load the Otakon sample.

## Run locally (Mac)

```bash
cd ~/Projects/con-floor-nav   # or your clone path
npm install
npm run dev
```

Vite binds to **`0.0.0.0`** (`server.host: true`) so phones on the same Wi‑Fi can connect. The terminal prints both:

- Local: `http://localhost:5173/`
- Network: `http://<your-mac-lan-ip>:5173/`

| Script | What it does |
|--------|----------------|
| `npm run dev` / `npm run dev:lan` | HTTP on all interfaces, port **5173** |
| `npm run dev:https` | HTTPS (self-signed) on LAN — needed for camera/GPS on phones |
| `npm run preview` | Production build preview on **4173**, also LAN-reachable |
| `npm run preview:https` | HTTPS preview |

Find your Mac’s LAN IP: **System Settings → Network**, or `ipconfig getifaddr en0`.

## Test on iPhone / Android (same Wi‑Fi)

1. On the Mac: `npm run dev` (or `npm run dev:https` if you need camera/GPS).
2. On the phone, open the **Network** URL from the Vite output.
3. **Install as PWA**
   - **iPhone Safari:** Share → **Add to Home Screen**
   - **Android Chrome:** Menu → **Install app** / **Add to Home screen**
4. Open once on Wi‑Fi so the service worker caches the shell; afterward map data lives in IndexedDB on-device.

### HTTP vs HTTPS (camera / GPS)

| Context | Map, import, tags, photos from library | Camera capture / Geolocation |
|---------|----------------------------------------|------------------------------|
| `http://localhost:5173` on Mac | ✅ | ✅ (secure context) |
| `http://<LAN-IP>:5173` on phone | ✅ enough for most prep/testing | ❌ often blocked on iOS |
| `https://<LAN-IP>:5173` via `npm run dev:https` | ✅ | ✅ after trusting the self-signed cert |

**Practical guidance:** Use plain `npm run dev` over HTTP for UI/map/import testing. For **camera** or **GPS**, use `npm run dev:https`. At the con, after PWA install + cache, the app is offline-first.

## Features

- **Multi-event / multi-map** — Settings → Events & Floor maps; map chips when multiple halls exist
- Floorplan pan/zoom, booth overlays, edit/nudge, color by visit status, filter by tag
- JSON/CSV import + “Copy prompt + schema” for Claude/ChatGPT; Otakon sample seed
- Optional in-app OpenAI/Claude map→JSON (keys in localStorage; review before save)
- Vendor status: favorite / look again / end of con / none
- **Custom tags** — searchable select + “+ Add New” (global on device); defaults included
- Item photos (camera or library) → Dexie blobs; gallery with multi-select
- Manual location pin + optional GPS; aisle nav + Go-tab quick pick
- **Share pin** link (`cfn1:x,y` / `#pin=…`) on the **Go** tab (offline-friendly)
- **Live party** — party codes + WebSocket peer pins (Render / local party server)
- **Event backup** (Settings) — export/import multi-map event JSON + images (`cfn-backup` v2)

## Build

```bash
npm run build
npm run preview
```

### Android APK (Capacitor sideload)

`capacitor.config.ts`, `android/`, and **Settings → Native app (Android)** are in the repo.

```bash
npm run cap:sync    # builds web assets + copies into android/
npm run cap:open    # opens Android Studio
```

Or `npm run android`. App id: `app.confloornav.pwa`. For Live party inside Cap, build with:

```bash
VITE_PARTY_WS_URL=wss://con-floor-nav.onrender.com/party npm run cap:sync
```

iOS/TestFlight needs an Apple Developer account — not scaffolded yet.

### Deploy on Render

One **Web Service** serves the PWA (`dist/`) and the party WebSocket (`/party`). No second instance.

- Blueprint: `render.yaml`
- Build: `npm install && npm run build`
- Start: `npm start`
- Health: `GET /api/health`
- Live party: same-origin `wss://<host>/party` in production (optional `VITE_PARTY_WS_URL`)

Free-tier services sleep when idle; first request after sleep can take ~30s.

**Live URL:** https://con-floor-nav.onrender.com  
**Dashboard:** https://dashboard.render.com/web/srv-d9ln2edbedkc73buug00

Local party server (dev):

```bash
# Terminal A
VITE_PARTY_WS_URL=ws://localhost:8787 npm run dev

# Terminal B
npm run party-server
```

Share-link paste still works offline without Render. Party codes are for friends only — don’t post them publicly.
