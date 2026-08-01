/**
 * Shared catalog (source of truth for events / maps / booths / dealer names).
 * Served to all clients via GET /api/sync/catalog.
 *
 * Backing store: Postgres bundle when DATABASE_URL is set; otherwise built
 * live from public/samples (still identical for every client hitting this host).
 *
 * Bump SAMPLE_REVISION whenever sample maps/booths change so Postgres reseeds.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureDb, getPool, hasDatabaseUrl } from './db.ts'

/** Bump when public/samples catalog content changes (forces DB reseed). */
export const SAMPLE_REVISION = 6

export type CatalogInfo = {
  source?: string
  sourceUrl?: string
  socials?: string
  merch?: string
  categories?: Array<{ label: string; value: string }>
  adultContent?: string
  multiBooth?: string[]
  tablemates?: Array<{
    name: string
    socials?: string
    merch?: string
    categories?: Array<{ label: string; value: string }>
    adultContent?: string
  }>
}

export type CatalogBooth = {
  boothKey: string
  label: string
  name?: string
  rect: { x: number; y: number; w: number; h: number }
  tags?: string[]
  catalogInfo?: CatalogInfo
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
  /** Matches SAMPLE_REVISION when built from samples — used to refresh Postgres. */
  sampleRevision?: number
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
    catalogInfo?: CatalogInfo
  }>
  obstacles?: CatalogBooth['rect'][]
}

function readPngSize(absPath: string, fallback: { width: number; height: number }) {
  try {
    const png = fs.readFileSync(absPath)
    if (png.length > 24 && png[0] === 0x89) {
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    }
  } catch {
    /* keep fallback */
  }
  return fallback
}

function readMapFromSample(
  root: string,
  opts: {
    jsonRel: string
    imageRel: string
    key: string
    name: string
    fallbackSize: { width: number; height: number }
  },
): CatalogMap {
  const jsonPath = path.join(root, opts.jsonRel)
  // imageRel is like /samples/foo.png — file lives under public/
  const imageFile = path.join(
    root,
    'public',
    opts.imageRel.replace(/^\/samples\//, 'samples/'),
  )
  let booths: CatalogBooth[] = []
  let obstacles: CatalogBooth['rect'][] | undefined
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as SampleJson
    obstacles = raw.obstacles
    booths = (raw.booths ?? []).map((b) => ({
      boothKey: b.id,
      label: b.label ?? b.id,
      name: b.name,
      rect: b.rect,
      tags: b.tags,
      ...(b.catalogInfo ? { catalogInfo: b.catalogInfo } : {}),
    }))
  } catch (err) {
    console.warn('[catalog] sample JSON missing', opts.jsonRel, err)
  }

  const { width, height } = readPngSize(imageFile, opts.fallbackSize)

  return {
    key: opts.key,
    name: opts.name,
    width,
    height,
    imageUrl: opts.imageRel,
    obstacles,
    booths,
  }
}

function readSampleBundle(root: string): CatalogBundle {
  const dealers = readMapFromSample(root, {
    jsonRel: 'public/samples/otakon-2026-dealers.json',
    imageRel: '/samples/otakon-2026-dealers-floor.png',
    key: 'dealers',
    name: 'Dealers',
    fallbackSize: { width: 3000, height: 1948 },
  })

  const artistAlley = readMapFromSample(root, {
    jsonRel: 'public/samples/otakon-2026-artist-alley.json',
    imageRel: '/samples/otakon-2026-artist-alley-floor.png',
    key: 'artist-alley',
    name: 'Artist Alley',
    fallbackSize: { width: 2677, height: 3500 },
  })

  return {
    version: 1,
    sampleRevision: SAMPLE_REVISION,
    updatedAt: Date.now(),
    events: [
      {
        slug: 'otakon-2026',
        name: 'Otakon 2026',
        venueNotes: 'Walter E. Washington Convention Center',
        maps: [dealers, artistAlley],
      },
    ],
  }
}

export async function getCatalogBundle(root: string): Promise<CatalogBundle> {
  const seeded = readSampleBundle(root)
  const ready = await ensureDb()
  if (ready && hasDatabaseUrl()) {
    const pool = getPool()!
    const { rows } = await pool.query<{ updated_at: string; bundle: CatalogBundle }>(
      'SELECT updated_at, bundle FROM catalog_meta WHERE id = 1',
    )
    const existing = rows[0]?.bundle
    if (
      existing &&
      existing.sampleRevision === SAMPLE_REVISION &&
      Array.isArray(existing.events) &&
      existing.events.length > 0
    ) {
      return {
        ...existing,
        updatedAt: Number(rows[0]!.updated_at),
      }
    }
    // Missing, stale revision, or empty — reseed from public/samples.
    await pool.query(
      `INSERT INTO catalog_meta (id, updated_at, bundle)
       VALUES (1, $1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, bundle = EXCLUDED.bundle`,
      [seeded.updatedAt, JSON.stringify(seeded)],
    )
    console.log(
      `[catalog] seeded sampleRevision=${SAMPLE_REVISION} maps=${seeded.events[0]?.maps.map((m) => m.name).join(',')}`,
    )
    return seeded
  }
  return seeded
}

/** Publish / replace the shared catalog (admin / seed). */
export async function putCatalogBundle(bundle: CatalogBundle): Promise<boolean> {
  const ready = await ensureDb()
  if (!ready) return false
  const pool = getPool()!
  const updatedAt = Date.now()
  const next = {
    ...bundle,
    version: 1 as const,
    sampleRevision: bundle.sampleRevision ?? SAMPLE_REVISION,
    updatedAt,
  }
  await pool.query(
    `INSERT INTO catalog_meta (id, updated_at, bundle)
     VALUES (1, $1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, bundle = EXCLUDED.bundle`,
    [updatedAt, JSON.stringify(next)],
  )
  return true
}
