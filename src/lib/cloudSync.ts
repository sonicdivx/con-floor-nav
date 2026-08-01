/**
 * Pull shared catalog from the cloud (server = source of truth) into Dexie.
 * Preserves per-device visitStatus / notes / photos when booth keys match.
 */
import { db, getStoredFloorMapId, setActiveFloorMapId } from '../db/schema'
import type { Rect, VisitStatus } from '../db/types'

export type CatalogBooth = {
  boothKey: string
  label: string
  name?: string
  rect: Rect
  tags?: string[]
}

export type CatalogMap = {
  key: string
  name: string
  width: number
  height: number
  imageUrl: string
  obstacles?: Rect[]
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
  sampleRevision?: number
  updatedAt: number
  events: CatalogEvent[]
}

export type SyncResult =
  | { ok: true; updatedAt: number; events: number; skipped: boolean; maps?: number }
  | { ok: false; error: string }

const LAST_SYNC_KEY = 'cfn-catalog-synced-at'
const LAST_REV_KEY = 'cfn-catalog-sample-revision'

export function lastCatalogSyncAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function lastCatalogSampleRevision(): number | null {
  try {
    const raw = localStorage.getItem(LAST_REV_KEY)
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function resolveSyncUrl(): string | null {
  const raw = import.meta.env.VITE_SYNC_URL as string | undefined
  if (raw?.trim()) return raw.trim().replace(/\/$/, '') + '/api/sync/catalog'
  // Dev Vite has no party-server — skip unless VITE_SYNC_URL / VITE_PARTY_WS_URL host.
  if (import.meta.env.DEV) {
    const party = import.meta.env.VITE_PARTY_WS_URL as string | undefined
    if (party?.trim()) {
      try {
        const u = new URL(party.trim().replace(/^ws/i, 'http'))
        return `${u.origin}/api/sync/catalog`
      } catch {
        return null
      }
    }
    return null
  }
  if (typeof location === 'undefined') return null
  return `${location.origin}/api/sync/catalog`
}

async function fetchImageBlob(imageUrl: string): Promise<Blob> {
  const url = imageUrl.startsWith('http')
    ? imageUrl
    : new URL(imageUrl, location.origin).toString()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Map image HTTP ${res.status}`)
  return res.blob()
}

/**
 * Merge one cloud event into Dexie. Keeps local visitStatus/notes/photos keyed by boothKey+mapKey.
 */
function mapNameMatches(existingName: string | undefined, catalogName: string, mapKey: string) {
  const n = (existingName ?? '').trim().toLowerCase()
  const want = catalogName.trim().toLowerCase()
  if (n === want) return true
  if (mapKey === 'dealers' && n.includes('dealer')) return true
  if (mapKey === 'artist-alley' && (n.includes('artist') || n.includes('alley'))) {
    return true
  }
  return false
}

async function mergeEvent(ev: CatalogEvent): Promise<number> {
  let event =
    (await db.events.filter((e) => e.name === ev.name).first()) ?? null

  // Fold older Otakon local titles into the catalog event name.
  if (!event && /otakon/i.test(ev.name)) {
    event =
      (await db.events.filter((e) => /otakon/i.test(e.name)).first()) ?? null
  }

  let eventId = event?.id ?? null

  if (eventId == null) {
    eventId = (await db.events.add({
      name: ev.name,
      venueNotes: ev.venueNotes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })) as number
  } else {
    await db.events.update(eventId, {
      name: ev.name,
      venueNotes: ev.venueNotes,
      updatedAt: Date.now(),
    })
  }

  for (const map of ev.maps) {
    const imageBlob = await fetchImageBlob(map.imageUrl)
    const existingMaps = await db.floorMaps.where('eventId').equals(eventId).toArray()
    let floorMap: (typeof existingMaps)[number] | null =
      existingMaps.find((m) => mapNameMatches(m.name, map.name, map.key)) ?? null

    // Legacy single-map installs: only fall back when syncing Dealers and there
    // is exactly one map that isn't Artist Alley.
    if (
      !floorMap &&
      map.key === 'dealers' &&
      existingMaps.length === 1 &&
      !/artist|alley/i.test(existingMaps[0]?.name ?? '')
    ) {
      floorMap = existingMaps[0] ?? null
    }

    if (floorMap?.id != null) {
      await db.floorMaps.update(floorMap.id, {
        name: map.name,
        imageBlob,
        width: map.width,
        height: map.height,
        obstacles: map.obstacles,
      })
    } else {
      const id = (await db.floorMaps.add({
        eventId,
        name: map.name,
        imageBlob,
        width: map.width,
        height: map.height,
        obstacles: map.obstacles,
        createdAt: Date.now(),
      })) as number
      floorMap = (await db.floorMaps.get(id)) ?? null
    }

    if (floorMap?.id == null) continue
    const floorMapId = floorMap.id
    // Don't steal the active map on every sync pass — only set when unset.
    if (getStoredFloorMapId(eventId) == null) {
      setActiveFloorMapId(eventId, floorMapId)
    }

    // Snapshot personal overlays before rewriting catalog rows.
    const oldBooths = await db.booths
      .where('floorMapId')
      .equals(floorMapId)
      .toArray()
    const oldVendors = await db.vendors.where('eventId').equals(eventId).toArray()
    const personal = new Map<
      string,
      { visitStatus: VisitStatus; notes?: string }
    >()
    for (const b of oldBooths) {
      if (b.id == null) continue
      const v = oldVendors.find((x) => x.boothId === b.id)
      if (!v) continue
      personal.set(b.boothKey, {
        visitStatus: v.visitStatus,
        notes: v.notes,
      })
    }

    await db.transaction('rw', db.booths, db.vendors, db.itemPhotos, async () => {
      // Keep photos: remapped after vendor recreate via boothKey personal.vendorId → skip delete photos if we update in place.
      for (const b of map.booths) {
        const existing = oldBooths.find((x) => x.boothKey === b.boothKey)
        let boothId: number
        if (existing?.id != null) {
          await db.booths.update(existing.id, {
            label: b.label,
            nameOverride: b.name,
            rect: b.rect,
            floorMapId,
          })
          boothId = existing.id
        } else {
          boothId = (await db.booths.add({
            eventId,
            floorMapId,
            boothKey: b.boothKey,
            label: b.label,
            nameOverride: b.name,
            rect: b.rect,
          })) as number
        }

        const prev = personal.get(b.boothKey)
        const vendor = await db.vendors.where({ eventId, boothId }).first()
        if (vendor?.id != null) {
          await db.vendors.update(vendor.id, {
            name: b.name ?? b.label ?? b.boothKey,
            tags: b.tags ?? vendor.tags,
            visitStatus: prev?.visitStatus ?? vendor.visitStatus,
            notes: prev?.notes ?? vendor.notes,
          })
        } else {
          await db.vendors.add({
            eventId,
            boothId,
            name: b.name ?? b.label ?? b.boothKey,
            tags: b.tags ?? [],
            visitStatus: prev?.visitStatus ?? 'none',
            notes: prev?.notes,
          })
        }
      }

      // Remove booths that disappeared from the cloud catalog (and their vendors/photos).
      const keep = new Set(map.booths.map((b) => b.boothKey))
      for (const b of oldBooths) {
        if (b.id == null || keep.has(b.boothKey)) continue
        const v = await db.vendors.where({ eventId, boothId: b.id }).first()
        if (v?.id != null) {
          await db.itemPhotos.where('vendorId').equals(v.id).delete()
          await db.vendors.delete(v.id)
        }
        await db.booths.delete(b.id)
      }
    })
  }

  return eventId
}

export async function syncCatalogFromCloud(options?: {
  force?: boolean
}): Promise<SyncResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'Offline' }
  }
  const url = resolveSyncUrl()
  if (!url) {
    return { ok: false, error: 'Sync URL not configured (set VITE_SYNC_URL or use production host)' }
  }

  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const bundle = (await res.json()) as CatalogBundle
    if (!bundle?.events || bundle.version !== 1) {
      return { ok: false, error: 'Invalid catalog payload' }
    }

    const last = lastCatalogSyncAt()
    const lastRev = lastCatalogSampleRevision()
    const bundleRev = bundle.sampleRevision ?? 0
    const mapCount = bundle.events.reduce((n, ev) => n + (ev.maps?.length ?? 0), 0)
    const localMapCount = await db.floorMaps.count()
    // Re-pull when catalog content revision changes (e.g. Artist Alley added),
    // not only when updatedAt advances. Also re-pull if local maps are short.
    if (
      !options?.force &&
      last != null &&
      last >= bundle.updatedAt &&
      lastRev != null &&
      lastRev === bundleRev &&
      localMapCount >= mapCount
    ) {
      return {
        ok: true,
        updatedAt: bundle.updatedAt,
        events: bundle.events.length,
        maps: mapCount,
        skipped: true,
      }
    }

    for (const ev of bundle.events) {
      await mergeEvent(ev)
    }

    try {
      localStorage.setItem(LAST_SYNC_KEY, String(bundle.updatedAt))
      localStorage.setItem(LAST_REV_KEY, String(bundleRev))
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      updatedAt: bundle.updatedAt,
      events: bundle.events.length,
      maps: mapCount,
      skipped: false,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
