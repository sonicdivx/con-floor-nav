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
  if (existing && existing.eventId === eventId) return existing

  const booth = await db.booths.get(boothId)
  const name =
    booth?.nameOverride?.trim() ||
    (booth?.label ? `Booth ${booth.label}` : `Booth ${boothId}`)
  const record: VendorRecord = {
    eventId,
    boothId,
    name,
    tags: [],
    visitStatus: 'none',
  }
  const id = await db.vendors.add(record)
  return { ...record, id: id as number }
}
