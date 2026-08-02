import type { VisitStatus } from '../db/types'
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

function tourStorageKey(eventId: number, floorMapId: number) {
  return `cfn-tour:${eventId}:${floorMapId}`
}

function isNormPoint(v: unknown): v is NormPoint {
  if (!v || typeof v !== 'object') return false
  const p = v as NormPoint
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

/** Load a per-map tour session (survives refresh). */
export function loadTourSession(
  eventId: number,
  floorMapId: number,
): PersistedTour | null {
  try {
    const raw = localStorage.getItem(tourStorageKey(eventId, floorMapId))
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<PersistedTour>
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
  } catch {
    return null
  }
}

export function saveTourSession(
  eventId: number,
  floorMapId: number,
  tour: PersistedTour,
) {
  try {
    const empty =
      (tour.stopIds == null || tour.stopIds.length === 0) &&
      !tour.endPin &&
      tour.extraBoothIds.length === 0
    if (empty && tour.stopIds == null) {
      localStorage.removeItem(tourStorageKey(eventId, floorMapId))
      return
    }
    localStorage.setItem(
      tourStorageKey(eventId, floorMapId),
      JSON.stringify({
        stopIds: tour.stopIds,
        endPin: tour.endPin,
        extraBoothIds: tour.extraBoothIds,
        statusFilters: tour.statusFilters,
      }),
    )
  } catch {
    /* quota / private mode */
  }
}

export function clearTourSession(eventId: number, floorMapId: number) {
  try {
    localStorage.removeItem(tourStorageKey(eventId, floorMapId))
  } catch {
    /* ignore */
  }
}
