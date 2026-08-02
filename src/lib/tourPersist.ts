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

function isTourEmpty(tour: PersistedTour): boolean {
  return (
    (tour.stopIds == null || tour.stopIds.length === 0) &&
    !tour.endPin &&
    tour.extraBoothIds.length === 0
  )
}

function writeLocalStorage(eventId: number, floorMapId: number, tour: PersistedTour) {
  try {
    localStorage.setItem(
      legacyStorageKey(eventId, floorMapId),
      JSON.stringify(tour),
    )
  } catch {
    /* ignore quota / private mode */
  }
}

function readLocalStorage(
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

function clearLocalStorage(eventId: number, floorMapId: number) {
  try {
    localStorage.removeItem(legacyStorageKey(eventId, floorMapId))
  } catch {
    /* ignore */
  }
}

/** Latest tour pending write — flushed on pagehide so refresh cannot race async IDB. */
let pendingFlush:
  | { eventId: number; floorMapId: number; tour: PersistedTour }
  | null = null

function rememberPending(
  eventId: number,
  floorMapId: number,
  tour: PersistedTour,
) {
  pendingFlush = { eventId, floorMapId, tour }
}

/** Sync localStorage + kick IndexedDB; safe to call from pagehide. */
export function flushTourSessionSync(
  eventId: number,
  floorMapId: number,
  tour: PersistedTour,
): void {
  rememberPending(eventId, floorMapId, tour)
  if (isTourEmpty(tour) && tour.stopIds == null) {
    clearLocalStorage(eventId, floorMapId)
  } else {
    writeLocalStorage(eventId, floorMapId, tour)
  }
  void saveTourSession(eventId, floorMapId, tour)
}

/** Flush whatever was last scheduled (pagehide / visibilitychange). */
export function flushPendingTourSession(): void {
  if (!pendingFlush) return
  const { eventId, floorMapId, tour } = pendingFlush
  flushTourSessionSync(eventId, floorMapId, tour)
}

let flushListenersBound = false

/** Bind once: keep tours durable across refresh / backgrounding. */
export function bindTourPersistLifecycle(): () => void {
  if (flushListenersBound || typeof window === 'undefined') {
    return () => undefined
  }
  flushListenersBound = true
  const onFlush = () => flushPendingTourSession()
  window.addEventListener('pagehide', onFlush)
  window.addEventListener('beforeunload', onFlush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onFlush()
  })
  return () => {
    window.removeEventListener('pagehide', onFlush)
    window.removeEventListener('beforeunload', onFlush)
    flushListenersBound = false
  }
}

/** Load a per-map tour session (IndexedDB first, then localStorage). */
export async function loadTourSession(
  eventId: number,
  floorMapId: number,
): Promise<PersistedTour | null> {
  try {
    const row = await db.tourSessions
      .where('[eventId+floorMapId]')
      .equals([eventId, floorMapId])
      .first()
    if (row) {
      const fromIdb = normalizeTour(row)
      if (fromIdb) return fromIdb
    }
  } catch (err) {
    console.warn('loadTourSession IndexedDB failed', err)
  }

  const legacy = readLocalStorage(eventId, floorMapId)
  if (legacy) {
    // Best-effort promote into IndexedDB without clearing localStorage first.
    void saveTourSession(eventId, floorMapId, legacy)
    return legacy
  }
  return null
}

export async function saveTourSession(
  eventId: number,
  floorMapId: number,
  tour: PersistedTour,
): Promise<void> {
  rememberPending(eventId, floorMapId, tour)

  const empty = isTourEmpty(tour)

  // Always mirror to localStorage first so a refresh mid-IDB-write still restores.
  if (empty && tour.stopIds == null) {
    clearLocalStorage(eventId, floorMapId)
  } else {
    writeLocalStorage(eventId, floorMapId, tour)
  }

  try {
    const existing = await db.tourSessions
      .where('[eventId+floorMapId]')
      .equals([eventId, floorMapId])
      .first()

    if (empty && tour.stopIds == null) {
      if (existing?.id != null) await db.tourSessions.delete(existing.id)
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
  } catch (err) {
    console.warn('saveTourSession IndexedDB failed', err)
    // localStorage already written above.
  }
}

export async function clearTourSession(
  eventId: number,
  floorMapId: number,
): Promise<void> {
  pendingFlush = {
    eventId,
    floorMapId,
    tour: { stopIds: null, endPin: null, extraBoothIds: [] },
  }
  clearLocalStorage(eventId, floorMapId)
  try {
    const existing = await db.tourSessions
      .where('[eventId+floorMapId]')
      .equals([eventId, floorMapId])
      .first()
    if (existing?.id != null) await db.tourSessions.delete(existing.id)
  } catch (err) {
    console.warn('clearTourSession failed', err)
  }
}
