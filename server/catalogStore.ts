/**
 * Shared catalog (source of truth for events / maps / booths / dealer names).
 * Served to all clients via GET /api/sync/catalog.
 *
 * Backing store: Postgres bundle when DATABASE_URL is set; otherwise built
 * live from public/samples (still identical for every client hitting this host).
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureDb, getPool, hasDatabaseUrl } from './db.ts'

export type CatalogBooth = {
  boothKey: string
  label: string
  name?: string
  rect: { x: number; y: number; w: number; h: number }
  tags?: string[]
}

export type CatalogMap = {
  key: string
  name: string
  width: number
  height: number
  /** Same-origin path or absolute URL for the floor image */
  imageUrl: string
  obstacles?: CatalogBooth['rect'][]
  booths: CatalogBooth[]
}

export type CatalogEvent = {
  slug: string
  name: string
  venueNotes: string
  maps: CatalogMap[]
}

export type CatalogBundle = {
  version: 1
  updatedAt: number
  events: CatalogEvent[]
}

type SampleJson = {
  event?: string
  booths?: Array<{
    id: string
    label?: string
    name?: string
    rect: CatalogBooth['rect']
    tags?: string[]
  }>
  obstacles?: CatalogBooth['rect'][]
}

function readSampleBundle(root: string): CatalogBundle {
  const jsonPath = path.join(root, 'public/samples/otakon-2026-dealers.json')
  const imageUrl = '/samples/otakon-2026-dealers-floor.png'
  let booths: CatalogBooth[] = []
  let obstacles: CatalogBooth['rect'][] | undefined
  let eventName = 'Otakon 2026 Dealers'
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as SampleJson
    if (raw.event) eventName = raw.event
    obstacles = raw.obstacles
    booths = (raw.booths ?? []).map((b) => ({
      boothKey: b.id,
      label: b.label ?? b.id,
      name: b.name,
      rect: b.rect,
      tags: b.tags,
    }))
  } catch (err) {
    console.warn('[catalog] sample JSON missing', err)
  }

  // Approximate image dims if we cannot probe; client still loads the real image.
  let width = 2000
  let height = 1400
  try {
    // PNG IHDR is at bytes 16–24 (width/height)
    const png = fs.readFileSync(path.join(root, 'public/samples/otakon-2026-dealers-floor.png'))
    if (png.length > 24 && png[0] === 0x89) {
      width = png.readUInt32BE(16)
      height = png.readUInt32BE(20)
    }
  } catch {
    /* keep defaults */
  }

  return {
    version: 1,
    updatedAt: Date.now(),
    events: [
      {
        slug: 'otakon-2026-dealers',
        name: eventName,
        venueNotes: 'Walter E. Washington Convention Center',
        maps: [
          {
            key: 'dealers',
            name: 'Dealers',
            width,
            height,
            imageUrl,
            obstacles,
            booths,
          },
        ],
      },
    ],
  }
}

export async function getCatalogBundle(root: string): Promise<CatalogBundle> {
  const ready = await ensureDb()
  if (ready && hasDatabaseUrl()) {
    const pool = getPool()!
    const { rows } = await pool.query<{ updated_at: string; bundle: CatalogBundle }>(
      'SELECT updated_at, bundle FROM catalog_meta WHERE id = 1',
    )
    if (rows[0]?.bundle) {
      return {
        ...rows[0].bundle,
        updatedAt: Number(rows[0].updated_at),
      }
    }
    const seeded = readSampleBundle(root)
    await pool.query(
      `INSERT INTO catalog_meta (id, updated_at, bundle)
       VALUES (1, $1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, bundle = EXCLUDED.bundle`,
      [seeded.updatedAt, JSON.stringify(seeded)],
    )
    return seeded
  }
  return readSampleBundle(root)
}

/** Publish / replace the shared catalog (admin / seed). */
export async function putCatalogBundle(bundle: CatalogBundle): Promise<boolean> {
  const ready = await ensureDb()
  if (!ready) return false
  const pool = getPool()!
  const updatedAt = Date.now()
  const next = { ...bundle, version: 1 as const, updatedAt }
  await pool.query(
    `INSERT INTO catalog_meta (id, updated_at, bundle)
     VALUES (1, $1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, bundle = EXCLUDED.bundle`,
    [updatedAt, JSON.stringify(next)],
  )
  return true
}
