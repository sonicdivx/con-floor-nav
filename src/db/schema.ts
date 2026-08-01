import Dexie, { type EntityTable } from 'dexie'
import type {
  BoothRecord,
  EventRecord,
  FloorMapRecord,
  ItemPhotoRecord,
  UserLocationRecord,
  VendorRecord,
} from './types'
import { DEFAULT_TAGS } from './types'

export class ConFloorDB extends Dexie {
  events!: EntityTable<EventRecord, 'id'>
  floorMaps!: EntityTable<FloorMapRecord, 'id'>
  booths!: EntityTable<BoothRecord, 'id'>
  vendors!: EntityTable<VendorRecord, 'id'>
  itemPhotos!: EntityTable<ItemPhotoRecord, 'id'>
  userLocations!: EntityTable<UserLocationRecord, 'id'>

  constructor() {
    super('con-floor-nav')
    this.version(1).stores({
      events: '++id, name, createdAt',
      floorMaps: '++id, eventId, createdAt',
      booths: '++id, eventId, boothKey',
      vendors: '++id, eventId, boothId, visitStatus, name',
      itemPhotos: '++id, eventId, vendorId, createdAt',
      userLocations: '++id, eventId',
    })
    this.version(2).stores({
      booths: '++id, eventId, boothKey, [eventId+boothKey]',
      vendors: '++id, eventId, boothId, visitStatus, name, [eventId+boothId]',
    })
    this.version(3)
      .stores({
        floorMaps: '++id, eventId, createdAt',
        booths:
          '++id, eventId, boothKey, floorMapId, [eventId+boothKey], [eventId+floorMapId]',
      })
      .upgrade(async (tx) => {
        const maps = await tx.table('floorMaps').toArray()
        const firstByEvent = new Map<number, number>()
        for (const m of maps) {
          const id = m.id as number | undefined
          if (id == null) continue
          if (!firstByEvent.has(m.eventId as number)) {
            firstByEvent.set(m.eventId as number, id)
          }
          if (!(m as FloorMapRecord).name) {
            await tx.table('floorMaps').update(id, { name: 'Floor map' })
          }
        }
        await tx
          .table('booths')
          .toCollection()
          .modify((b: BoothRecord) => {
            if (b.floorMapId == null) {
              const mapId = firstByEvent.get(b.eventId)
              if (mapId != null) b.floorMapId = mapId
            }
          })
      })
    // Same boothKey allowed on different maps (Dealers A12 vs Alley A12).
    this.version(4).stores({
      booths:
        '++id, eventId, boothKey, floorMapId, [eventId+boothKey], [eventId+floorMapId], [eventId+floorMapId+boothKey]',
    })
  }
}

export const db = new ConFloorDB()

export { DEFAULT_TAGS }

let defaultEventLock: Promise<number> | null = null

export async function ensureDefaultEvent(): Promise<number> {
  if (defaultEventLock) return defaultEventLock

  defaultEventLock = (async () => {
    const existing = await db.events.orderBy('createdAt').first()
    if (existing?.id != null) return existing.id

    const now = Date.now()
    const id = await db.events.add({
      name: 'Otakon',
      venueNotes: 'Walter E. Washington Convention Center',
      createdAt: now,
      updatedAt: now,
    })
    return id as number
  })()

  try {
    return await defaultEventLock
  } catch (err) {
    defaultEventLock = null
    throw err
  }
}

let activeEventLock: Promise<number> | null = null

export async function getActiveEventId(): Promise<number> {
  if (activeEventLock) return activeEventLock

  activeEventLock = (async () => {
    const stored = localStorage.getItem('cfn-active-event')
    if (stored) {
      const id = Number(stored)
      const ev = await db.events.get(id)
      if (ev) return id
    }
    const id = await ensureDefaultEvent()
    localStorage.setItem('cfn-active-event', String(id))
    return id
  })()

  try {
    return await activeEventLock
  } catch (err) {
    activeEventLock = null
    throw err
  }
}

export function setActiveEventId(id: number) {
  localStorage.setItem('cfn-active-event', String(id))
  activeEventLock = Promise.resolve(id)
}

function mapStorageKey(eventId: number) {
  return `cfn-active-map:${eventId}`
}

export function getStoredFloorMapId(eventId: number): number | null {
  const raw = localStorage.getItem(mapStorageKey(eventId))
  if (!raw) return null
  const id = Number(raw)
  return Number.isFinite(id) ? id : null
}

export function setActiveFloorMapId(eventId: number, floorMapId: number) {
  localStorage.setItem(mapStorageKey(eventId), String(floorMapId))
}

export async function resolveActiveFloorMapId(
  eventId: number,
): Promise<number | null> {
  const maps = await db.floorMaps.where('eventId').equals(eventId).sortBy('createdAt')
  if (maps.length === 0) return null
  const stored = getStoredFloorMapId(eventId)
  if (stored != null && maps.some((m) => m.id === stored)) return stored
  const firstId = maps[0]!.id!
  setActiveFloorMapId(eventId, firstId)
  return firstId
}

export async function createEvent(input: {
  name: string
  venueNotes?: string
}): Promise<number> {
  const now = Date.now()
  const id = (await db.events.add({
    name: input.name.trim() || 'Untitled event',
    venueNotes: input.venueNotes?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
  })) as number
  setActiveEventId(id)
  return id
}

/** Delete an event and all related rows. */
export async function deleteEventCascade(eventId: number): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.events,
      db.floorMaps,
      db.booths,
      db.vendors,
      db.itemPhotos,
      db.userLocations,
    ],
    async () => {
      const vendors = await db.vendors.where('eventId').equals(eventId).toArray()
      const vendorIds = vendors
        .map((v) => v.id)
        .filter((id): id is number => id != null)
      if (vendorIds.length) {
        await db.itemPhotos.where('vendorId').anyOf(vendorIds).delete()
      }
      await db.itemPhotos.where('eventId').equals(eventId).delete()
      await db.vendors.where('eventId').equals(eventId).delete()
      await db.booths.where('eventId').equals(eventId).delete()
      await db.floorMaps.where('eventId').equals(eventId).delete()
      await db.userLocations.where('eventId').equals(eventId).delete()
      await db.events.delete(eventId)
    },
  )
  localStorage.removeItem(mapStorageKey(eventId))
}

export async function getOrCreateUserLocation(
  eventId: number,
): Promise<UserLocationRecord> {
  const existing = await db.userLocations.where('eventId').equals(eventId).first()
  if (existing) return existing
  const record: UserLocationRecord = {
    eventId,
    x: 0.5,
    y: 0.5,
    source: 'manual',
    updatedAt: Date.now(),
  }
  const id = await db.userLocations.add(record)
  return { ...record, id }
}

/** Ensure a vendor row exists for a booth so the details panel can open. */
export async function ensureVendorForBooth(
  eventId: number,
  boothId: number,
): Promise<VendorRecord> {
  const existing = await db.vendors.where('boothId').equals(boothId).first()
  const booth = await db.booths.get(boothId)

  if (existing && existing.eventId === eventId) {
    // Backfill catalogInfo from booth when vendor row predates masterlist sync.
    if (!existing.catalogInfo && booth?.catalogInfo) {
      await db.vendors.update(existing.id!, { catalogInfo: booth.catalogInfo })
      return { ...existing, catalogInfo: booth.catalogInfo }
    }
    return existing
  }

  const name =
    booth?.nameOverride?.trim() ||
    (booth?.label ? `Booth ${booth.label}` : `Booth ${boothId}`)
  const record: VendorRecord = {
    eventId,
    boothId,
    name,
    tags: [],
    visitStatus: 'none',
    ...(booth?.catalogInfo ? { catalogInfo: booth.catalogInfo } : {}),
  }
  const id = await db.vendors.add(record)
  return { ...record, id: id as number }
}
