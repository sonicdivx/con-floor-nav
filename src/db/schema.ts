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
  }
}

export const db = new ConFloorDB()

export { DEFAULT_TAGS }

export async function ensureDefaultEvent(): Promise<number> {
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
}

export async function getActiveEventId(): Promise<number> {
  const stored = localStorage.getItem('cfn-active-event')
  if (stored) {
    const id = Number(stored)
    const ev = await db.events.get(id)
    if (ev) return id
  }
  const id = await ensureDefaultEvent()
  localStorage.setItem('cfn-active-event', String(id))
  return id
}

export function setActiveEventId(id: number) {
  localStorage.setItem('cfn-active-event', String(id))
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
