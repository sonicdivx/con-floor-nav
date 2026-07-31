/**
 * Con Floor Nav server: static `dist/` + party WebSocket + catalog sync API.
 *
 * Env:
 *   PORT (default 8787)
 *   STALE_MS (default 180000) — drop idle WS members
 *   PARTY_TTL_MS (default 36h) — durable party codes
 *   DATABASE_URL — Postgres for durable parties + catalog SoT
 *   DATABASE_SSL=0 — disable TLS for local Postgres
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { ensureDb, hasDatabaseUrl } from './db.ts'
import { getCatalogBundle } from './catalogStore.ts'
import {
  loadActiveRooms,
  removePin,
  roomExists,
  savePin,
  touchRoomExpiry,
  upsertRoom,
} from './partyStore.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 8787)
const STALE_MS = Number(process.env.STALE_MS || 180_000)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

type Member = {
  id: string
  name: string
  x: number
  y: number
  updatedAt: number
  ws: WebSocket
}

type Room = {
  code: string
  members: Map<string, Member>
}

type ClientMsg =
  | { type: 'create'; name: string; pin?: { x: number; y: number } }
  | { type: 'join'; code: string; name: string; pin?: { x: number; y: number } }
  | { type: 'pin'; x: number; y: number }
  | { type: 'leave' }

const rooms = new Map<string, Room>()
let nextId = 1

function genCode(): string {
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!
  }
  return code
}

function publicMembers(room: Room) {
  return [...room.members.values()].map((m) => ({
    id: m.id,
    name: m.name,
    x: m.x,
    y: m.y,
    updatedAt: m.updatedAt,
  }))
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function broadcast(room: Room, payload: unknown, exceptId?: string) {
  const data = JSON.stringify(payload)
  for (const m of room.members.values()) {
    if (exceptId && m.id === exceptId) continue
    if (m.ws.readyState === m.ws.OPEN) m.ws.send(data)
  }
}

function leaveRoom(ws: WebSocket & { memberId?: string; roomCode?: string }) {
  const { memberId, roomCode } = ws
  if (!memberId || !roomCode) return
  const room = rooms.get(roomCode)
  if (!room) return
  room.members.delete(memberId)
  ws.memberId = undefined
  ws.roomCode = undefined
  void removePin(roomCode, memberId)
  if (room.members.size === 0) {
    // Drop in-memory room only — durable registry keeps the code until TTL.
    rooms.delete(roomCode)
  } else {
    broadcast(room, { type: 'members', members: publicMembers(room) })
  }
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

async function ensureMemoryRoom(code: string): Promise<Room> {
  const normalized = code.trim().toUpperCase()
  let room = rooms.get(normalized)
  if (!room) {
    room = { code: normalized, members: new Map() }
    rooms.set(normalized, room)
  }
  await upsertRoom(normalized)
  return room
}

async function joinRoom(
  ws: WebSocket & { memberId?: string; roomCode?: string },
  code: string,
  name: string,
  pin?: { x: number; y: number },
) {
  leaveRoom(ws)
  const room = await ensureMemoryRoom(code)
  const id = `m${nextId++}`
  const member: Member = {
    id,
    name: name.trim().slice(0, 24) || 'Friend',
    x: pin ? clamp01(pin.x) : 0.5,
    y: pin ? clamp01(pin.y) : 0.5,
    updatedAt: Date.now(),
    ws,
  }
  room.members.set(id, member)
  ws.memberId = id
  ws.roomCode = room.code
  await savePin(room.code, {
    memberKey: id,
    name: member.name,
    x: member.x,
    y: member.y,
    updatedAt: member.updatedAt,
  })
  send(ws, {
    type: 'joined',
    code: room.code,
    selfId: id,
    members: publicMembers(room),
  })
  broadcast(room, { type: 'members', members: publicMembers(room) }, id)
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/')
  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath)
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end('Not found — run npm run build first')
    return
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/api/health')) {
    void (async () => {
      const durable = hasDatabaseUrl()
      const persisted = (await loadActiveRooms()).length
      json(res, 200, {
        ok: true,
        rooms: rooms.size,
        persistedRooms: persisted,
        database: durable,
      })
    })()
    return
  }

  if (url.startsWith('/api/sync/catalog') && req.method === 'GET') {
    void (async () => {
      try {
        const bundle = await getCatalogBundle(ROOT)
        json(res, 200, bundle)
      } catch (err) {
        console.error('[sync/catalog]', err)
        json(res, 500, { error: 'Catalog unavailable' })
      }
    })()
    return
  }

  if (url.startsWith('/api/sync/status') && req.method === 'GET') {
    void (async () => {
      try {
        const bundle = await getCatalogBundle(ROOT)
        json(res, 200, {
          updatedAt: bundle.updatedAt,
          events: bundle.events.length,
          database: hasDatabaseUrl(),
        })
      } catch (err) {
        json(res, 500, { error: String(err) })
      }
    })()
    return
  }

  serveStatic(req, res)
})

const wss = new WebSocketServer({ server, path: '/party' })

wss.on('connection', (ws) => {
  const sock = ws as WebSocket & { memberId?: string; roomCode?: string }

  sock.on('message', (raw) => {
    void (async () => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw)) as ClientMsg
      } catch {
        send(sock, { type: 'error', message: 'Invalid JSON' })
        return
      }

      try {
        if (msg.type === 'create') {
          let code = genCode()
          while (rooms.has(code) || (await roomExists(code))) code = genCode()
          await upsertRoom(code)
          await joinRoom(sock, code, msg.name, msg.pin)
          return
        }

        if (msg.type === 'join') {
          if (!msg.code?.trim()) {
            send(sock, { type: 'error', message: 'Party code required' })
            return
          }
          const code = msg.code.trim().toUpperCase()
          const known = rooms.has(code) || (await roomExists(code))
          if (!known) {
            send(sock, {
              type: 'error',
              message: 'Unknown or expired party code',
            })
            return
          }
          await joinRoom(sock, code, msg.name, msg.pin)
          return
        }

        if (msg.type === 'pin') {
          const room = sock.roomCode ? rooms.get(sock.roomCode) : undefined
          const member = sock.memberId ? room?.members.get(sock.memberId) : undefined
          if (!room || !member) {
            send(sock, { type: 'error', message: 'Join a party first' })
            return
          }
          member.x = clamp01(msg.x)
          member.y = clamp01(msg.y)
          member.updatedAt = Date.now()
          await savePin(room.code, {
            memberKey: member.id,
            name: member.name,
            x: member.x,
            y: member.y,
            updatedAt: member.updatedAt,
          })
          await touchRoomExpiry(room.code)
          broadcast(room, {
            type: 'peer_pin',
            id: member.id,
            name: member.name,
            x: member.x,
            y: member.y,
            updatedAt: member.updatedAt,
          })
          return
        }

        if (msg.type === 'leave') {
          leaveRoom(sock)
          send(sock, { type: 'left' })
          return
        }

        send(sock, { type: 'error', message: 'Unknown message type' })
      } catch (err) {
        console.error('[party]', err)
        send(sock, { type: 'error', message: 'Server error' })
      }
    })()
  })

  sock.on('close', () => leaveRoom(sock))
})

setInterval(() => {
  const now = Date.now()
  for (const room of [...rooms.values()]) {
    for (const [id, m] of room.members) {
      if (now - m.updatedAt > STALE_MS) {
        try {
          m.ws.close()
        } catch {
          /* ignore */
        }
        room.members.delete(id)
        void removePin(room.code, id)
      }
    }
    if (room.members.size === 0) rooms.delete(room.code)
    else broadcast(room, { type: 'members', members: publicMembers(room) })
  }
}, 30_000)

void (async () => {
  const dbOk = await ensureDb()
  if (dbOk) {
    const persisted = await loadActiveRooms()
    console.log(`[db] Postgres ready — ${persisted.length} durable party room(s)`)
  } else {
    console.log('[db] No DATABASE_URL — parties are memory-only; catalog serves samples')
  }
  server.listen(PORT, () => {
    console.log(`Party server on http://0.0.0.0:${PORT}  (ws path /party)`)
    console.log(`Static: ${fs.existsSync(DIST) ? DIST : '(no dist yet)'}`)
    console.log('Sync: GET /api/sync/catalog')
  })
})()
