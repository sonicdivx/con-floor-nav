/**
 * Durable device login codes → personal overlay payloads (no password).
 * Uses Postgres when DATABASE_URL is set; otherwise an in-memory map (dev / no DB).
 */
import { ensureDb, getPool } from './db.ts'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** Default 90 days — recover after a hung browser / switch to a larger device. */
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000

export type DeviceBackupRow = {
  code: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  payload: unknown
}

const memoryBackups = new Map<string, DeviceBackupRow>()

export function deviceTtlMs(): number {
  const raw = Number(process.env.DEVICE_TTL_MS || DEFAULT_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS
}

/** Always available — Postgres when configured, otherwise process memory. */
export function isDeviceSyncAvailable(): boolean {
  return true
}

function genCode(length = 8): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!
  }
  return code
}

export function normalizeDeviceCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function purgeMemory(): void {
  const now = Date.now()
  for (const [code, row] of memoryBackups) {
    if (row.expiresAt < now) memoryBackups.delete(code)
  }
}

async function purgeExpired(p: NonNullable<ReturnType<typeof getPool>>): Promise<void> {
  await p.query(`DELETE FROM device_backups WHERE expires_at < $1`, [Date.now()])
}

function memoryCreate(payload: unknown): DeviceBackupRow {
  purgeMemory()
  const now = Date.now()
  const expiresAt = now + deviceTtlMs()
  let code = genCode()
  for (let i = 0; i < 12; i++) {
    if (!memoryBackups.has(code)) {
      const row = { code, createdAt: now, updatedAt: now, expiresAt, payload }
      memoryBackups.set(code, row)
      return row
    }
    code = genCode()
  }
  throw new Error('Could not allocate a device code')
}

function memoryUpsert(codeRaw: string, payload: unknown): DeviceBackupRow {
  purgeMemory()
  const code = normalizeDeviceCode(codeRaw)
  if (code.length < 5) throw new Error('Invalid device code')
  const now = Date.now()
  const expiresAt = now + deviceTtlMs()
  const existing = memoryBackups.get(code)
  const row: DeviceBackupRow = {
    code,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    expiresAt,
    payload,
  }
  memoryBackups.set(code, row)
  return row
}

function memoryGet(codeRaw: string): DeviceBackupRow | null {
  purgeMemory()
  const code = normalizeDeviceCode(codeRaw)
  return memoryBackups.get(code) ?? null
}

export async function createDeviceBackup(payload: unknown): Promise<DeviceBackupRow> {
  if (!(await ensureDb())) {
    return memoryCreate(payload)
  }
  const p = getPool()
  if (!p) return memoryCreate(payload)
  await purgeExpired(p)

  const now = Date.now()
  const expiresAt = now + deviceTtlMs()
  let code = genCode()
  for (let i = 0; i < 12; i++) {
    try {
      await p.query(
        `INSERT INTO device_backups (code, created_at, updated_at, expires_at, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [code, now, now, expiresAt, JSON.stringify(payload)],
      )
      return { code, createdAt: now, updatedAt: now, expiresAt, payload }
    } catch (err) {
      const e = err as { code?: string }
      if (e.code === '23505') {
        code = genCode()
        continue
      }
      throw err
    }
  }
  throw new Error('Could not allocate a device code')
}

export async function upsertDeviceBackup(
  codeRaw: string,
  payload: unknown,
): Promise<DeviceBackupRow> {
  if (!(await ensureDb())) {
    return memoryUpsert(codeRaw, payload)
  }
  const p = getPool()
  if (!p) return memoryUpsert(codeRaw, payload)
  const code = normalizeDeviceCode(codeRaw)
  if (code.length < 5) throw new Error('Invalid device code')

  await purgeExpired(p)
  const now = Date.now()
  const expiresAt = now + deviceTtlMs()

  const existing = await p.query<{
    code: string
    created_at: string
  }>(`SELECT code, created_at FROM device_backups WHERE code = $1`, [code])

  if (existing.rowCount && existing.rows[0]) {
    await p.query(
      `UPDATE device_backups
       SET updated_at = $2, expires_at = $3, payload = $4::jsonb
       WHERE code = $1`,
      [code, now, expiresAt, JSON.stringify(payload)],
    )
    return {
      code,
      createdAt: Number(existing.rows[0].created_at),
      updatedAt: now,
      expiresAt,
      payload,
    }
  }

  await p.query(
    `INSERT INTO device_backups (code, created_at, updated_at, expires_at, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [code, now, now, expiresAt, JSON.stringify(payload)],
  )
  return { code, createdAt: now, updatedAt: now, expiresAt, payload }
}

export async function getDeviceBackup(codeRaw: string): Promise<DeviceBackupRow | null> {
  if (!(await ensureDb())) {
    return memoryGet(codeRaw)
  }
  const p = getPool()
  if (!p) return memoryGet(codeRaw)
  const code = normalizeDeviceCode(codeRaw)
  if (!code) return null

  await purgeExpired(p)
  const result = await p.query<{
    code: string
    created_at: string
    updated_at: string
    expires_at: string
    payload: unknown
  }>(
    `SELECT code, created_at, updated_at, expires_at, payload
     FROM device_backups WHERE code = $1`,
    [code],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    code: row.code,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: Number(row.expires_at),
    payload: row.payload,
  }
}
