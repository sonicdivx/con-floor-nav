import { db } from '../db/schema'
import type { Rect, VisitStatus } from '../db/types'

export const BACKUP_FORMAT = 'cfn-backup' as const
export const BACKUP_VERSION = 1 as const

export interface EventBackupV1 {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: number
  event: {
    name: string
    venueNotes: string
    createdAt: number
    updatedAt: number
  }
  floorMap: null | {
    width: number
    height: number
    obstacles?: Rect[]
    calibration?: {
      topLeft?: { lat: number; lng: number }
      topRight?: { lat: number; lng: number }
      bottomLeft?: { lat: number; lng: number }
      bottomRight?: { lat: number; lng: number }
    }
    imageMime: string
    imageBase64: string
    createdAt: number
  }
  booths: Array<{
    boothKey: string
    label: string
    nameOverride?: string
    rect: Rect
  }>
  vendors: Array<{
    boothKey: string
    name: string
    tags: string[]
    visitStatus: VisitStatus
    notes?: string
  }>
  photos: Array<{
    boothKey: string
    note?: string
    createdAt: number
    imageMime: string
    imageBase64: string
  }>
  userLocation: null | {
    x: number
    y: number
    source: 'manual' | 'gps'
    accuracy?: number
    updatedAt: number
  }
}

async function blobToBase64(blob: Blob): Promise<{ mime: string; base64: string }> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return {
    mime: blob.type || 'application/octet-stream',
    base64: btoa(binary),
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

export async function buildEventBackup(eventId: number): Promise<EventBackupV1> {
  const event = await db.events.get(eventId)
  if (!event) throw new Error('Event not found')

  const [floorMap, booths, vendors, photos, userLocation] = await Promise.all([
    db.floorMaps.where('eventId').equals(eventId).first(),
    db.booths.where('eventId').equals(eventId).toArray(),
    db.vendors.where('eventId').equals(eventId).toArray(),
    db.itemPhotos.where('eventId').equals(eventId).toArray(),
    db.userLocations.where('eventId').equals(eventId).first(),
  ])

  const boothIdToKey = new Map<number, string>()
  for (const b of booths) {
    if (b.id != null) boothIdToKey.set(b.id, b.boothKey)
  }

  const vendorIdToBoothKey = new Map<number, string>()
  for (const v of vendors) {
    if (v.id == null) continue
    const key = boothIdToKey.get(v.boothId)
    if (key) vendorIdToBoothKey.set(v.id, key)
  }

  let floorPayload: EventBackupV1['floorMap'] = null
  if (floorMap?.imageBlob) {
    const { mime, base64 } = await blobToBase64(floorMap.imageBlob)
    floorPayload = {
      width: floorMap.width,
      height: floorMap.height,
      obstacles: floorMap.obstacles,
      calibration: floorMap.calibration,
      imageMime: mime,
      imageBase64: base64,
      createdAt: floorMap.createdAt,
    }
  }

  const photoPayload: EventBackupV1['photos'] = []
  for (const p of photos) {
    const boothKey = vendorIdToBoothKey.get(p.vendorId)
    if (!boothKey) continue
    const { mime, base64 } = await blobToBase64(p.imageBlob)
    photoPayload.push({
      boothKey,
      note: p.note,
      createdAt: p.createdAt,
      imageMime: mime,
      imageBase64: base64,
    })
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    event: {
      name: event.name,
      venueNotes: event.venueNotes,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    },
    floorMap: floorPayload,
    booths: booths.map((b) => ({
      boothKey: b.boothKey,
      label: b.label,
      nameOverride: b.nameOverride,
      rect: b.rect,
    })),
    vendors: vendors
      .map((v) => {
        const boothKey = boothIdToKey.get(v.boothId)
        if (!boothKey) return null
        return {
          boothKey,
          name: v.name,
          tags: v.tags,
          visitStatus: v.visitStatus,
          notes: v.notes,
        }
      })
      .filter((v): v is NonNullable<typeof v> => v != null),
    photos: photoPayload,
    userLocation: userLocation
      ? {
          x: userLocation.x,
          y: userLocation.y,
          source: userLocation.source,
          accuracy: userLocation.accuracy,
          updatedAt: userLocation.updatedAt,
        }
      : null,
  }
}

export function parseEventBackup(raw: unknown): EventBackupV1 {
  if (!raw || typeof raw !== 'object') throw new Error('Backup must be a JSON object')
  const obj = raw as Record<string, unknown>
  if (obj.format !== BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format (expected ${BACKUP_FORMAT})`)
  }
  if (obj.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version (expected ${BACKUP_VERSION})`)
  }
  if (!obj.event || typeof obj.event !== 'object') throw new Error('Backup missing event')
  if (!Array.isArray(obj.booths)) throw new Error('Backup missing booths array')
  if (!Array.isArray(obj.vendors)) throw new Error('Backup missing vendors array')
  if (!Array.isArray(obj.photos)) throw new Error('Backup missing photos array')
  return obj as unknown as EventBackupV1
}

export async function restoreEventBackup(
  eventId: number,
  backup: EventBackupV1,
): Promise<{ booths: number; vendors: number; photos: number }> {
  const event = await db.events.get(eventId)
  if (!event?.id) throw new Error('Event not found')

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
      await db.itemPhotos.where('eventId').equals(eventId).delete()
      await db.vendors.where('eventId').equals(eventId).delete()
      await db.booths.where('eventId').equals(eventId).delete()
      await db.floorMaps.where('eventId').equals(eventId).delete()
      await db.userLocations.where('eventId').equals(eventId).delete()

      await db.events.update(eventId, {
        name: backup.event.name,
        venueNotes: backup.event.venueNotes,
        updatedAt: Date.now(),
      })

      if (backup.floorMap) {
        await db.floorMaps.add({
          eventId,
          imageBlob: base64ToBlob(backup.floorMap.imageBase64, backup.floorMap.imageMime),
          width: backup.floorMap.width,
          height: backup.floorMap.height,
          obstacles: backup.floorMap.obstacles,
          calibration: backup.floorMap.calibration,
          createdAt: backup.floorMap.createdAt || Date.now(),
        })
      }

      const boothKeyToId = new Map<string, number>()
      for (const b of backup.booths) {
        const id = (await db.booths.add({
          eventId,
          boothKey: b.boothKey,
          label: b.label,
          nameOverride: b.nameOverride,
          rect: b.rect,
        })) as number
        boothKeyToId.set(b.boothKey, id)
      }

      const boothKeyToVendorId = new Map<string, number>()
      for (const v of backup.vendors) {
        const boothId = boothKeyToId.get(v.boothKey)
        if (boothId == null) continue
        const id = (await db.vendors.add({
          eventId,
          boothId,
          name: v.name,
          tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
          visitStatus: v.visitStatus ?? 'none',
          notes: v.notes,
        })) as number
        boothKeyToVendorId.set(v.boothKey, id)
      }

      for (const p of backup.photos) {
        const vendorId = boothKeyToVendorId.get(p.boothKey)
        if (vendorId == null) continue
        await db.itemPhotos.add({
          eventId,
          vendorId,
          imageBlob: base64ToBlob(p.imageBase64, p.imageMime),
          note: p.note,
          createdAt: p.createdAt || Date.now(),
        })
      }

      if (backup.userLocation) {
        await db.userLocations.add({
          eventId,
          x: backup.userLocation.x,
          y: backup.userLocation.y,
          source: backup.userLocation.source,
          accuracy: backup.userLocation.accuracy,
          updatedAt: backup.userLocation.updatedAt || Date.now(),
        })
      }
    },
  )

  return {
    booths: backup.booths.length,
    vendors: backup.vendors.length,
    photos: backup.photos.length,
  }
}

export function downloadBackupJson(backup: EventBackupV1, filename?: string) {
  const text = JSON.stringify(backup)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10)
  a.href = url
  a.download = filename ?? `cfn-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
