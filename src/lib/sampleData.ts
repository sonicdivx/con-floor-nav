import type { Rect } from '../db/types'
import { db } from '../db/schema'
import { applyBoothImport, parseBoothImportJson } from './import'
import { getOtakon2026DealersObstacles } from './obstacles'

export const OTAKON_2026_DEALERS_SAMPLE = {
  id: 'otakon-2026-dealers',
  label: 'Otakon 2026 Dealers',
  imageUrl: '/samples/otakon-2026-dealers-floor.png',
  jsonUrl: '/samples/otakon-2026-dealers.json',
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

export async function saveFloorMapBlob(
  eventId: number,
  imageBlob: Blob,
  options: { obstacles?: Rect[] } = {},
): Promise<{ width: number; height: number }> {
  const dims = await readImageDimensions(imageBlob)
  const patch: {
    imageBlob: Blob
    width: number
    height: number
    obstacles?: Rect[]
  } = {
    imageBlob,
    width: dims.width,
    height: dims.height,
  }
  if (options.obstacles !== undefined) {
    patch.obstacles = options.obstacles
  }
  await db.transaction('rw', db.floorMaps, async () => {
    const existing = await db.floorMaps.where('eventId').equals(eventId).toArray()
    if (existing.length > 0) {
      const [keep, ...extras] = existing
      if (keep.id != null) {
        await db.floorMaps.update(keep.id, patch)
      }
      const extraIds = extras.map((m) => m.id).filter((id): id is number => id != null)
      if (extraIds.length) await db.floorMaps.bulkDelete(extraIds)
    } else {
      await db.floorMaps.add({
        eventId,
        ...patch,
        createdAt: Date.now(),
      })
    }
  })
  return dims
}

type SampleLoadResult = {
  booths: number
  vendors: number
  width: number
  height: number
  totalBooths: number
  obstacles: number
}

/** Deduplicate concurrent sample loads (auto-seed + Setup button / Strict Mode). */
const inflightSampleLoads = new Map<number, Promise<SampleLoadResult>>()
const inflightAutoSeeds = new Map<number, Promise<boolean>>()

/** Fetch public sample assets, cache the map image in IndexedDB, import booths/vendors. */
export async function loadOtakon2026DealersSample(
  eventId: number,
  options: { replace?: boolean } = {},
): Promise<SampleLoadResult> {
  const existing = inflightSampleLoads.get(eventId)
  if (existing) return existing

  const pending = (async (): Promise<SampleLoadResult> => {
    const { imageUrl, jsonUrl } = OTAKON_2026_DEALERS_SAMPLE
    const [imageRes, jsonRes] = await Promise.all([fetch(imageUrl), fetch(jsonUrl)])
    if (!imageRes.ok) {
      throw new Error(`Failed to fetch sample map (${imageRes.status})`)
    }
    if (!jsonRes.ok) {
      throw new Error(`Failed to fetch sample JSON (${jsonRes.status})`)
    }

    const [imageBlob, text] = await Promise.all([imageRes.blob(), jsonRes.text()])
    const data = parseBoothImportJson(text)
    const obstacles =
      data.obstacles?.length ? data.obstacles : getOtakon2026DealersObstacles()
    const dims = await saveFloorMapBlob(eventId, imageBlob, { obstacles })
    const result = await applyBoothImport(eventId, data, {
      replace: options.replace ?? true,
    })

    return {
      booths: result.booths,
      vendors: result.vendors,
      width: dims.width,
      height: dims.height,
      totalBooths: data.booths.length,
      obstacles: obstacles.length,
    }
  })()

  inflightSampleLoads.set(eventId, pending)
  try {
    return await pending
  } finally {
    inflightSampleLoads.delete(eventId)
  }
}

/**
 * If the active event has no floor map yet, load the Otakon dealers sample.
 * After success the image lives in IndexedDB so the app stays offline-capable.
 *
 * Uses a synchronous sessionStorage latch so React Strict Mode (double effect)
 * cannot start two imports before the async lock is registered.
 */
export async function maybeAutoSeedOtakonSample(
  eventId: number,
): Promise<boolean> {
  const flagKey = `cfn-otakon-autoseed:${eventId}`
  const existingLock = inflightAutoSeeds.get(eventId)
  if (existingLock) return existingLock

  if (sessionStorage.getItem(flagKey)) {
    return false
  }
  // Latch before any await — Strict Mode remount must not start a second seed.
  sessionStorage.setItem(flagKey, 'pending')

  const pending = (async () => {
    try {
      const existing = await db.floorMaps.where('eventId').equals(eventId).first()
      if (existing?.imageBlob) {
        sessionStorage.setItem(flagKey, 'done')
        return false
      }
      await loadOtakon2026DealersSample(eventId, { replace: true })
      sessionStorage.setItem(flagKey, 'done')
      return true
    } catch (err) {
      sessionStorage.removeItem(flagKey)
      throw err
    }
  })()

  inflightAutoSeeds.set(eventId, pending)
  try {
    return await pending
  } finally {
    inflightAutoSeeds.delete(eventId)
  }
}
