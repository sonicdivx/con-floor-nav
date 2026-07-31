# Con Floor Nav

Offline-first PWA for navigating convention dealer / artist-alley floors (Otakon-first). Import a floor map + booth JSON, tag vendors, attach item photos, drop a manual “you are here” pin, and draw a straight-line path to a booth.

## Run locally (Mac)

```bash
cd ~/Projects/con-floor-nav
npm install
npm run dev
```

Vite binds to **`0.0.0.0`** (`server.host: true`) so phones on the same Wi‑Fi can connect. The terminal prints both:

- Local: `http://localhost:5173/`
- Network: `http://<your-mac-lan-ip>:5173/`  
  Example: `http://192.168.1.42:5173/`

Same LAN scripts:

| Script | What it does |
|--------|----------------|
| `npm run dev` / `npm run dev:lan` | HTTP on all interfaces, port **5173** |
| `npm run dev:https` | HTTPS (self-signed) on LAN — needed for camera/GPS on phones |
| `npm run preview` | Production build preview on **4173**, also LAN-reachable |
| `npm run preview:https` | HTTPS preview |

Find your Mac’s LAN IP: **System Settings → Network**, or `ipconfig getifaddr en0`.

## Test on iPhone / Android (same Wi‑Fi)

1. On the Mac: `npm run dev` (or `npm run dev:https` if you need camera/GPS).
2. On the phone, open the **Network** URL from the Vite output, e.g. `http://192.168.1.42:5173/` (or `https://…` with `dev:https`).
3. **Install as PWA**
   - **iPhone Safari:** Share → **Add to Home Screen**
   - **Android Chrome:** Menu → **Install app** / **Add to Home screen**
4. Open once on Wi‑Fi so the service worker caches the shell; afterward map data lives in IndexedDB on-device.

### HTTP vs HTTPS (camera / GPS)

| Context | Map, import, tags, photos from library | Camera capture / Geolocation |
|---------|----------------------------------------|------------------------------|
| `http://localhost:5173` on Mac | ✅ | ✅ (secure context) |
| `http://<LAN-IP>:5173` on phone | ✅ enough for most prep/testing | ❌ often blocked (not a secure context on iOS) |
| `https://<LAN-IP>:5173` via `npm run dev:https` | ✅ | ✅ after you accept the self-signed cert warning |

**Practical guidance:** Use plain `npm run dev` over HTTP for UI/map/import testing on phones. When you need **camera** or **GPS**, run `npm run dev:https`, open the `https://<LAN-IP>:5173` URL, trust the certificate warning once, then proceed. Photo **library** picks still work over HTTP.

At the con, after you’ve installed the PWA and cached assets, the app is offline-first and does not need the Mac server.

## Features

- Floorplan pan/zoom, booth overlays, edit/nudge, color by visit status, filter by tag
- JSON/CSV import + “Copy prompt + schema” for Claude/ChatGPT
- Optional in-app OpenAI/Claude map→JSON (keys in localStorage; review before save)
- Vendor status: favorite / look again / end of con / none; default tags
- Item photos (camera or library) → Dexie blobs
- Manual location pin + optional GPS; aisle nav line + quick pick from favorites/look-again
- **Share pin** link (`cfn1:x,y` / `#pin=…`) for SMS/Signal; paste to navigate
- **Live party** (optional): party codes + WebSocket peer pins when Wi‑Fi works
- Photo gallery by vendor; multi-select → set look again / favorite

## Build

```bash
npm run build
npm run preview
```

**Render (static site only):** build command `npm run build`, publish directory `dist`.

### Party WebSocket + static on Render (recommended for live sharing)

1. Build the PWA with the public WebSocket URL baked in:

```bash
# Example — use your Render service hostname
VITE_PARTY_WS_URL=wss://YOUR-SERVICE.onrender.com npm run build
```

Or set `VITE_PARTY_WS_URL` in the Render **build** environment (Vite inlines it at build time).

2. Start command: `npm start` (runs `tsx server/party-server.ts`), which:
   - Serves `dist/` over HTTP
   - Accepts WebSockets at `/party`
   - Health check: `GET /api/health`

3. Local party server (dev):

```bash
# Terminal A — Vite app (optional: point at local party server)
VITE_PARTY_WS_URL=ws://localhost:8787 npm run dev

# Terminal B
npm run party-server
```

Without `VITE_PARTY_WS_URL`, the app still supports **Copy share link / paste** offline; the Live party UI stays hidden.

Party codes are for friends only — don’t post them publicly. Stale members expire after ~3 minutes without pin updates.
