import { db } from '../db/schema'
import type { TourSessionRecord, VisitStatus } from '../db/types'
import type { NormPoint } from './pathfinding'

export type PersistedTourStatusFilters = Record<
  Exclude<VisitStatus, 'none'>,
  boolean
>

export type PersistedTour = {
  stopIds: number[] | null
  endPin: NormPoint | null
  extraBoothIds: number[]
  statusFilters?: PersistedTourStatusFilters
}

function legacyStorageKey(eventId: number, floorMapId: number) {
  return `cfn-tour:${eventId}:${floorMapId}`
}

function isNormPoint(v: unknown): v is NormPoint {
  if (!v || typeof v !== 'object') return false
  const p = v as NormPoint
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

function normalizeTour(data: Partial<PersistedTour> | TourSessionRecord): PersistedTour | null {
  const stopIds = Array.isArray(data.stopIds)
    ? data.stopIds.filter((id): id is number => Number.isFinite(id))
    : data.stopIds === null
      ? null
      : null
  const endPin = isNormPoint(data.endPin) ? data.endPin : null
  const extraBoothIds = Array.isArray(data.extraBoothIds)
    ? data.extraBoothIds.filter((id): id is number => Number.isFinite(id))
    : []
  const statusFilters =
    data.statusFilters &&
    typeof data.statusFilters === 'object' &&
    typeof data.statusFilters.favorite === 'boolean' &&
    typeof data.statusFilters.look_again === 'boolean' &&
    typeof data.statusFilters.end_of_con === 'boolean'
      ? data.statusFilters
      : undefined
  if (stopIds == null && !endPin && extraBoothIds.length === 0) return null
  return { stopIds, endPin, extraBoothIds, statusFilters }
}

function readLegacyLocalStorage(
  eventId: number,
  floorMapId: number,
): PersistedTour | null {
  try {
    const raw = localStorage.getItem(legacyStorageKey(eventId, floorMapId))
    if (!raw) return null
    return normalizeTour(JSON.parse(raw) as Partial<PersistedTour>)
  } catch {
    return null
  }
}

function clearLegacyLocalStorage(eventId: number, floorMapId: number) {
  try {
    localStorage.removeItem(legacyStorageKey(eventId, floorMapId))
  } catch {
    /* ignore */
  }
}

/** Load a per-map tour session from IndexedDB (migrates legacy localStorage once). */
export async function loadTourSession(
  eventId: number,
  floorMapId: number,
): Promise<PersistedTour | null> {
  try {
    const row = await db.tourSessions
      .where('[eventId+floorMapId]')
      .equals([eventId, floorMapId])
      .first()
    if (row) return normalizeTour(row)

    const legacy = readLegacyLocalStorage(eventId, floorMapId)
    if (legacy) {
      await saveTourSession(eventId, floorMapId, legacy)
      clearLegacyLocalStorage(eventId, floorMapId)
      return legacy
    }
    return null
  } catch (err) {
    console.warn('loadTourSession failed', err)
    return readLegacyLocalStorage(eventId, floorMapId)
  }
}

export async function saveTourSession(
  eventId: number,
  floorMapId: number,
  tour: PersistedTour,
): Promise<void> {
  const empty =
    (tour.stopIds == null || tour.stopIds.length === 0) &&
    !tour.endPin &&
    tour.extraBoothIds.length === 0

  try {
    const existing = await db.tourSessions
      .where('[eventId+floorMapId]')
      .equals([eventId, floorMapId])
      .first()

    if (empty && tour.stopIds == null) {
      if (existing?.id != null) await db.tourSessions.delete(existing.id)
      clearLegacyLocalStorage(eventId, floorMapId)
      return
    }

    const record: TourSessionRecord = {
      ...(existing?.id != null ? { id: existing.id } : {}),
      eventId,
      floorMapId,
      stopIds: tour.stopIds,
      endPin: tour.endPin,
      extraBoothIds: tour.extraBoothIds,
      statusFilters: tour.statusFilters,
      updatedAt: Date.now(),
    }
    await db.tourSessions.put(record)
    clearLegacyLocalStorage(eventId, floorMapId)
  } catch (err) {
    console.warn('saveTourSession failed', err)
    // Last-resort fallback so a route is not silently lost.
    try {
      localStorage.setItem(
        legacyStorageKey(eventId, floorMapId),
        JSON.stringify(tour),
      )
    } catch {
      /* ignore */
    }
  }
}

export async function clearTourSession(
  eventId: number,
  floorMapId: number,
): Promise<void> {
  try {
    const existing = await db.tourSessions
      .where('[eventId+floorMapId]')
      .equals([eventId, floorMapId])
      .first()
    if (existing?.id != null) await db.tourSessions.delete(existing.id)
  } catch (err) {
    console.warn('clearTourSession failed', err)
  }
  clearLegacyLocalStorage(eventId, floorMapId)
}
