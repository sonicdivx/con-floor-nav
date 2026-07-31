/**
 * Durable party room registry — survives Render restarts when Postgres is configured.
 * Empty rooms are kept until expires_at so overnight codes still work.
 */
import { ensureDb, getPool, hasDatabaseUrl } from './db.ts'

export type StoredPartyPin = {
  memberKey: string
  name: string
  x: number
  y: number
  updatedAt: number
}

export type StoredPartyRoom = {
  code: string
  createdAt: number
  expiresAt: number
  pins: StoredPartyPin[]
}

const DEFAULT_TTL_MS = Number(process.env.PARTY_TTL_MS || 36 * 60 * 60 * 1000)

/** In-process mirror used when DATABASE_URL is absent (dev only — not durable on free Render). */
const memoryRooms = new Map<string, StoredPartyRoom>()

export function partyTtlMs(): number {
  return DEFAULT_TTL_MS
}

export async function loadActiveRooms(): Promise<StoredPartyRoom[]> {
  const now = Date.now()
  const ready = await ensureDb()
  if (ready && hasDatabaseUrl()) {
    const pool = getPool()!
    await pool.query('DELETE FROM party_rooms WHERE expires_at < $1', [now])
    const { rows: roomRows } = await pool.query<{
      code: string
      created_at: string
      expires_at: string
    }>('SELECT code, created_at, expires_at FROM party_rooms WHERE expires_at >= $1', [now])
    const out: StoredPartyRoom[] = []
    for (const r of roomRows) {
      const { rows: pins } = await pool.query<{
        member_key: string
        name: string
        x: number
        y: number
        updated_at: string
      }>('SELECT member_key, name, x, y, updated_at FROM party_pins WHERE code = $1', [
        r.code,
      ])
      out.push({
        code: r.code,
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
        pins: pins.map((p) => ({
          memberKey: p.member_key,
          name: p.name,
          x: p.x,
          y: p.y,
          updatedAt: Number(p.updated_at),
        })),
      })
    }
    return out
  }

  for (const [code, room] of [...memoryRooms]) {
    if (room.expiresAt < now) memoryRooms.delete(code)
  }
  return [...memoryRooms.values()]
}

export async function upsertRoom(code: string, createdAt = Date.now()): Promise<StoredPartyRoom> {
  const expiresAt = createdAt + partyTtlMs()
  const ready = await ensureDb()
  if (ready && hasDatabaseUrl()) {
    const pool = getPool()!
    await pool.query(
      `INSERT INTO party_rooms (code, created_at, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET expires_at = GREATEST(party_rooms.expires_at, EXCLUDED.expires_at)`,
      [code, createdAt, expiresAt],
    )
    const existing = await loadActiveRooms()
    return (
      existing.find((r) => r.code === code) ?? {
        code,
        createdAt,
        expiresAt,
        pins: [],
      }
    )
  }
  const prev = memoryRooms.get(code)
  const room: StoredPartyRoom = {
    code,
    createdAt: prev?.createdAt ?? createdAt,
    expiresAt: Math.max(prev?.expiresAt ?? 0, expiresAt),
    pins: prev?.pins ?? [],
  }
  memoryRooms.set(code, room)
  return room
}

export async function touchRoomExpiry(code: string): Promise<void> {
  const expiresAt = Date.now() + partyTtlMs()
  const ready = await ensureDb()
  if (ready && hasDatabaseUrl()) {
    const pool = getPool()!
    await pool.query(
      'UPDATE party_rooms SET expires_at = GREATEST(expires_at, $2) WHERE code = $1',
      [code, expiresAt],
    )
    return
  }
  const room = memoryRooms.get(code)
  if (room) room.expiresAt = Math.max(room.expiresAt, expiresAt)
}

export async function savePin(
  code: string,
  pin: StoredPartyPin,
): Promise<void> {
  await upsertRoom(code)
  await touchRoomExpiry(code)
  const ready = await ensureDb()
  if (ready && hasDatabaseUrl()) {
    const pool = getPool()!
    await pool.query(
      `INSERT INTO party_pins (code, member_key, name, x, y, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code, member_key) DO UPDATE SET
         name = EXCLUDED.name,
         x = EXCLUDED.x,
         y = EXCLUDED.y,
         updated_at = EXCLUDED.updated_at`,
      [code, pin.memberKey, pin.name, pin.x, pin.y, pin.updatedAt],
    )
    return
  }
  const room = memoryRooms.get(code)
  if (!room) return
  room.pins = [...room.pins.filter((p) => p.memberKey !== pin.memberKey), pin]
}

export async function removePin(code: string, memberKey: string): Promise<void> {
  const ready = await ensureDb()
  if (ready && hasDatabaseUrl()) {
    const pool = getPool()!
    await pool.query('DELETE FROM party_pins WHERE code = $1 AND member_key = $2', [
      code,
      memberKey,
    ])
    return
  }
  const room = memoryRooms.get(code)
  if (!room) return
  room.pins = room.pins.filter((p) => p.memberKey !== memberKey)
}

export async function roomExists(code: string): Promise<boolean> {
  const rooms = await loadActiveRooms()
  return rooms.some((r) => r.code === code)
}
