import type { Rect } from '../db/types'
import { db, setActiveFloorMapId } from '../db/schema'
import { applyBoothImport, parseBoothImportJson } from './import'
import { getOtakon2026DealersObstacles } from './obstacles'

export const OTAKON_2026_DEALERS_SAMPLE = {
  id: 'otakon-2026-dealers',
  label: 'Otakon 2026 Dealers',
  mapName: 'Dealers',
  imageUrl: '/samples/otakon-2026-dealers-floor.png',
  jsonUrl: '/samples/otakon-2026-dealers.json',
} as const

export const OTAKON_2026_ARTIST_ALLEY_SAMPLE = {
  id: 'otakon-2026-artist-alley',
  label: 'Artist Alley',
  mapName: 'Artist Alley',
  imageUrl: '/samples/otakon-2026-artist-alley-floor.png',
  jsonUrl: '/samples/otakon-2026-artist-alley.json',
} as const

async function readImageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('Could not read sample map image'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export type SaveFloorMapMode = 'replace-active' | 'add' | 'replace-all'

/**
 * Save a floor map image for an event.
 * - `replace-active` (default): update the active map, or create one if none
 * - `add`: always create a new map and make it active
 * - `replace-all`: wipe all maps for the event, then create one (sample load)
 */
export async function saveFloorMapBlob(
  eventId: number,
  imageBlob: Blob,
  options: {
    obstacles?: Rect[]
    name?: string
    mode?: SaveFloorMapMode
  } = {},
): Promise<{ width: number; height: number; floorMapId: number }> {
  const dims = await readImageDimensions(imageBlob)
  const mode = options.mode ?? 'replace-active'
  const name = options.name?.trim() || 'Floor map'

  const floorMapId = await db.transaction('rw', db.floorMaps, db.booths, async () => {
    if (mode === 'replace-all') {
      const existing = await db.floorMaps.where('eventId').equals(eventId).toArray()
      const ids = existing.map((m) => m.id).filter((id): id is number => id != null)
      if (ids.length) {
        await db.booths.where('floorMapId').anyOf(ids).modify((b) => {
          delete b.floorMapId
        })
        await db.floorMaps.bulkDelete(ids)
      }
      const id = (await db.floorMaps.add({
        eventId,
        name,
        imageBlob,
        width: dims.width,
        height: dims.height,
        obstacles: options.obstacles,
        createdAt: Date.now(),
      })) as number
      setActiveFloorMapId(eventId, id)
      return id
    }

    if (mode === 'add') {
      const id = (await db.floorMaps.add({
        eventId,
        name,
        imageBlob,
        width: dims.width,
        height: dims.height,
        obstacles: options.obstacles,
        createdAt: Date.now(),
      })) as number
      setActiveFloorMapId(eventId, id)
      return id
    }

    // replace-active
    const maps = await db.floorMaps.where('eventId').equals(eventId).sortBy('createdAt')
    const storedRaw = localStorage.getItem(`cfn-active-map:${eventId}`)
    const stored = storedRaw ? Number(storedRaw) : null
    let activeId =
      stored != null && maps.some((m) => m.id === stored)
        ? stored
        : (maps[0]?.id ?? null)

    if (activeId == null) {
      activeId = (await db.floorMaps.add({
        eventId,
        name,
        imageBlob,
        width: dims.width,
        height: dims.height,
        obstacles: options.obstacles,
        createdAt: Date.now(),
      })) as number
      setActiveFloorMapId(eventId, activeId)
      return activeId
    }

    const patch: Partial<{
      imageBlob: Blob
      width: number
      height: number
      name: string
      obstacles: Rect[]
    }> = {
      imageBlob,
      width: dims.width,
      height: dims.height,
      name,
    }
    if (options.obstacles !== undefined) patch.obstacles = options.obstacles
    await db.floorMaps.update(activeId, patch)
    return activeId
  })

  return { ...dims, floorMapId }
}

type SampleLoadResult = {
  booths: number
  vendors: number
  width: number
  height: number
  totalBooths: number
  obstacles: number
  floorMapId: number
}

/** Deduplicate concurrent sample loads (auto-seed + Setup button / Strict Mode). */
const inflightSampleLoads = new Map<string, Promise<SampleLoadResult>>()
const inflightAutoSeeds = new Map<number, Promise<boolean>>()

async function loadSampleMap(
  eventId: number,
  sample: { mapName: string; imageUrl: string; jsonUrl: string },
  options: {
    replace?: boolean
    mode: SaveFloorMapMode
    obstaclesFallback?: Rect[]
    inflightKey: string
  },
): Promise<SampleLoadResult> {
  const key = `${options.inflightKey}:${eventId}`
  const existing = inflightSampleLoads.get(key)
  if (existing) return existing

  const pending = (async (): Promise<SampleLoadResult> => {
    const [imageRes, jsonRes] = await Promise.all([
      fetch(sample.imageUrl),
      fetch(sample.jsonUrl),
    ])
    if (!imageRes.ok) {
      throw new Error(`Failed to fetch sample map (${imageRes.status})`)
    }
    if (!jsonRes.ok) {
      throw new Error(`Failed to fetch sample JSON (${jsonRes.status})`)
    }

    const [imageBlob, text] = await Promise.all([imageRes.blob(), jsonRes.text()])
    const data = parseBoothImportJson(text)
    const obstacles = data.obstacles?.length
      ? data.obstacles
      : (options.obstaclesFallback ?? [])
    const dims = await saveFloorMapBlob(eventId, imageBlob, {
      obstacles,
      name: sample.mapName,
      mode: options.mode,
    })
    const result = await applyBoothImport(eventId, data, {
      replace: options.replace ?? true,
      floorMapId: dims.floorMapId,
    })

    return {
      booths: result.booths,
      vendors: result.vendors,
      width: dims.width,
      height: dims.height,
      totalBooths: data.booths.length,
      obstacles: obstacles.length,
      floorMapId: dims.floorMapId,
    }
  })()

  inflightSampleLoads.set(key, pending)
  try {
    return await pending
  } finally {
    inflightSampleLoads.delete(key)
  }
}

/** Fetch Dealers sample — replaces all maps on the event (legacy setup). */
export async function loadOtakon2026DealersSample(
  eventId: number,
  options: { replace?: boolean } = {},
): Promise<SampleLoadResult> {
  return loadSampleMap(eventId, OTAKON_2026_DEALERS_SAMPLE, {
    replace: options.replace ?? true,
    mode: 'replace-all',
    obstaclesFallback: getOtakon2026DealersObstacles(),
    inflightKey: 'dealers',
  })
}

/** Add Artist Alley as another floor map (does not wipe Dealers). */
export async function loadOtakon2026ArtistAlleySample(
  eventId: number,
): Promise<SampleLoadResult> {
  // If Artist Alley already exists, replace that map's image/booths in place.
  const existing = await db.floorMaps.where('eventId').equals(eventId).toArray()
  const alley = existing.find((m) => /artist|alley/i.test(m.name ?? ''))
  if (alley?.id != null) {
    setActiveFloorMapId(eventId, alley.id)
    return loadSampleMap(eventId, OTAKON_2026_ARTIST_ALLEY_SAMPLE, {
      replace: true,
      mode: 'replace-active',
      inflightKey: 'artist-alley',
    })
  }
  return loadSampleMap(eventId, OTAKON_2026_ARTIST_ALLEY_SAMPLE, {
    replace: true,
    mode: 'add',
    inflightKey: 'artist-alley',
  })
}

/** Auto-seed Dealers once if this event has no floor map yet. */
export async function maybeAutoSeedOtakonSample(eventId: number): Promise<boolean> {
  const existing = inflightAutoSeeds.get(eventId)
  if (existing) return existing

  const pending = (async () => {
    const map = await db.floorMaps.where('eventId').equals(eventId).first()
    if (map?.imageBlob) return false
    await loadOtakon2026DealersSample(eventId, { replace: true })
    return true
  })()

  inflightAutoSeeds.set(eventId, pending)
  try {
    return await pending
  } finally {
    inflightAutoSeeds.delete(eventId)
  }
}
