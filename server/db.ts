/**
 * Optional Postgres access for catalog + durable party rooms.
 * When DATABASE_URL is unset, callers should use file/sample fallbacks.
 */
import pg from 'pg'

const { Pool } = pg

let pool: pg.Pool | null = null
let initPromise: Promise<boolean> | null = null

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getPool(): pg.Pool | null {
  if (!hasDatabaseUrl()) return null
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === '0'
          ? undefined
          : { rejectUnauthorized: false },
      max: 5,
    })
  }
  return pool
}

export async function ensureDb(): Promise<boolean> {
  if (!hasDatabaseUrl()) return false
  if (initPromise) return initPromise
  initPromise = (async () => {
    const p = getPool()
    if (!p) return false
    await p.query(`
      CREATE TABLE IF NOT EXISTS catalog_meta (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        updated_at BIGINT NOT NULL,
        bundle JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS party_rooms (
        code TEXT PRIMARY KEY,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS party_pins (
        code TEXT NOT NULL REFERENCES party_rooms(code) ON DELETE CASCADE,
        member_key TEXT NOT NULL,
        name TEXT NOT NULL,
        x DOUBLE PRECISION NOT NULL,
        y DOUBLE PRECISION NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (code, member_key)
      );
    `)
    return true
  })().catch((err) => {
    console.error('[db] init failed', err)
    initPromise = null
    return false
  })
  return initPromise
}
