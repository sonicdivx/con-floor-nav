import { Capacitor } from '@capacitor/core'
import { db, setActiveFloorMapId } from '../db/schema'
import type { Rect, VisitStatus } from '../db/types'
import { VISIT_STATUSES } from './statusColors'
import { registerCustomTags } from './tags'

export const BACKUP_FORMAT = 'cfn-backup' as const
export const BACKUP_VERSION = 2 as const

export interface FloorMapBackup {
  /** Stable key linking booths to this map within the backup file. */
  key: string
  name?: string
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

export interface EventBackup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION | 1
  exportedAt: number
  event: {
    name: string
    venueNotes: string
    createdAt: number
    updatedAt: number
  }
  /** v2+: all floor maps for the event. */
  floorMaps: FloorMapBackup[]
  /**
   * v1 only (singular). Still accepted on import; converted to `floorMaps`.
   * New exports leave this undefined.
   */
  floorMap?: FloorMapBackup | null
  booths: Array<{
    boothKey: string
    /** Links to `floorMaps[].key`. Defaults to the first map when missing (v1). */
    mapKey?: string
    label: string
    nameOverride?: string
    rect: Rect
  }>
  vendors: Array<{
    boothKey: string
    mapKey?: string
    name: string
    tags: string[]
    visitStatus: VisitStatus
    notes?: string
  }>
  photos: Array<{
    boothKey: string
    mapKey?: string
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

/** @deprecated Use EventBackup */
export type EventBackupV1 = EventBackup

function isRect(r: unknown): r is Rect {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return (
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.w === 'number' &&
    typeof o.h === 'number'
  )
}

function isVisitStatus(v: unknown): v is VisitStatus {
  return typeof v === 'string' && (VISIT_STATUSES as string[]).includes(v)
}

async function blobToBase64(blob: Blob): Promise<{ mime: string; base64: string }> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  const mime = blob.type || 'application/octet-stream'
  return { mime, base64: btoa(binary) }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

function parseFloorMapPayload(fm: Record<string, unknown>, key: string): FloorMapBackup {
  if (typeof fm.width !== 'number' || typeof fm.height !== 'number') {
    throw new Error('Backup floorMap missing width/height')
  }
  if (typeof fm.imageBase64 !== 'string' || !fm.imageBase64) {
    throw new Error('Backup floorMap missing imageBase64')
  }
  const obstacles = Array.isArray(fm.obstacles) ? fm.obstacles.filter(isRect) : undefined
  return {
    key,
    name: typeof fm.name === 'string' ? fm.name : undefined,
    width: fm.width,
    height: fm.height,
    obstacles,
    calibration:
      fm.calibration && typeof fm.calibration === 'object'
        ? (fm.calibration as FloorMapBackup['calibration'])
        : undefined,
    imageMime: typeof fm.imageMime === 'string' ? fm.imageMime : 'image/png',
    imageBase64: fm.imageBase64,
    createdAt: typeof fm.createdAt === 'number' ? fm.createdAt : Date.now(),
  }
}

function boothLinkKey(boothKey: string, mapKey: string | undefined): string {
  return mapKey ? `${mapKey}::${boothKey}` : boothKey
}

export async function buildEventBackup(eventId: number): Promise<EventBackup> {
  const event = await db.events.get(eventId)
  if (!event) throw new Error('Event not found')

  const [maps, booths, vendors, photos, userLocation] = await Promise.all([
    db.floorMaps.where('eventId').equals(eventId).sortBy('createdAt'),
    db.booths.where('eventId').equals(eventId).toArray(),
    db.vendors.where('eventId').equals(eventId).toArray(),
    db.itemPhotos.where('eventId').equals(eventId).toArray(),
    db.userLocations.where('eventId').equals(eventId).first(),
  ])

  const mapIdToKey = new Map<number, string>()
  const floorMaps: FloorMapBackup[] = []
  for (let i = 0; i < maps.length; i++) {
    const floorMap = maps[i]!
    if (floorMap.id == null || !floorMap.imageBlob) continue
    const key = `map-${floorMap.id}`
    mapIdToKey.set(floorMap.id, key)
    const { mime, base64 } = await blobToBase64(floorMap.imageBlob)
    floorMaps.push({
      key,
      name: floorMap.name,
      width: floorMap.width,
      height: floorMap.height,
      obstacles: floorMap.obstacles,
      calibration: floorMap.calibration,
      imageMime: mime,
      imageBase64: base64,
      createdAt: floorMap.createdAt,
    })
  }
  const defaultMapKey = floorMaps[0]?.key

  const boothIdToLink = new Map<number, { boothKey: string; mapKey?: string }>()
  for (const b of booths) {
    if (b.id == null) continue
    const mapKey =
      b.floorMapId != null ? mapIdToKey.get(b.floorMapId) : defaultMapKey
    boothIdToLink.set(b.id, { boothKey: b.boothKey, mapKey })
  }

  const vendorIdToLink = new Map<number, { boothKey: string; mapKey?: string }>()
  for (const v of vendors) {
    if (v.id == null) continue
    const link = boothIdToLink.get(v.boothId)
    if (link) vendorIdToLink.set(v.id, link)
  }

  const photoPayload: EventBackup['photos'] = []
  for (const p of photos) {
    const link = vendorIdToLink.get(p.vendorId)
    if (!link) continue
    const { mime, base64 } = await blobToBase64(p.imageBlob)
    photoPayload.push({
      boothKey: link.boothKey,
      mapKey: link.mapKey,
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
    floorMaps,
    booths: booths.map((b) => {
      const mapKey =
        b.floorMapId != null ? mapIdToKey.get(b.floorMapId) : defaultMapKey
      return {
        boothKey: b.boothKey,
        mapKey,
        label: b.label,
        nameOverride: b.nameOverride,
        rect: b.rect,
      }
    }),
    vendors: vendors
      .map((v) => {
        const link = boothIdToLink.get(v.boothId)
        if (!link) return null
        return {
          boothKey: link.boothKey,
          mapKey: link.mapKey,
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

export function parseEventBackup(raw: unknown): EventBackup {
  if (!raw || typeof raw !== 'object') throw new Error('Backup must be a JSON object')
  const obj = raw as Record<string, unknown>
  if (obj.format !== BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format (expected ${BACKUP_FORMAT})`)
  }
  const version = obj.version
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported backup version (expected 1 or 2)`)
  }

  const eventRaw = obj.event
  if (!eventRaw || typeof eventRaw !== 'object') throw new Error('Backup missing event')
  const eventObj = eventRaw as Record<string, unknown>
  if (typeof eventObj.name !== 'string' || !eventObj.name.trim()) {
    throw new Error('Backup event.name is required')
  }
  const event = {
    name: eventObj.name.trim(),
    venueNotes: typeof eventObj.venueNotes === 'string' ? eventObj.venueNotes : '',
    createdAt: typeof eventObj.createdAt === 'number' ? eventObj.createdAt : Date.now(),
    updatedAt: typeof eventObj.updatedAt === 'number' ? eventObj.updatedAt : Date.now(),
  }

  if (!Array.isArray(obj.booths)) throw new Error('Backup missing booths array')
  if (!Array.isArray(obj.vendors)) throw new Error('Backup missing vendors array')
  if (!Array.isArray(obj.photos)) throw new Error('Backup missing photos array')

  let floorMaps: FloorMapBackup[] = []
  if (version === 2 && Array.isArray(obj.floorMaps)) {
    floorMaps = obj.floorMaps.map((entry, i) => {
      if (!entry || typeof entry !== 'object') throw new Error(`floorMaps[${i}] is invalid`)
      const fm = entry as Record<string, unknown>
      const key =
        typeof fm.key === 'string' && fm.key.trim() ? fm.key.trim() : `map-${i}`
      return parseFloorMapPayload(fm, key)
    })
  } else if (obj.floorMap != null) {
    if (typeof obj.floorMap !== 'object') throw new Error('Backup floorMap is invalid')
    floorMaps = [parseFloorMapPayload(obj.floorMap as Record<string, unknown>, 'default')]
  }

  const defaultMapKey = floorMaps[0]?.key

  const booths: EventBackup['booths'] = obj.booths.map((b, i) => {
    if (!b || typeof b !== 'object') throw new Error(`Booth ${i} is invalid`)
    const row = b as Record<string, unknown>
    if (typeof row.boothKey !== 'string' || !row.boothKey) {
      throw new Error(`Booth ${i} missing boothKey`)
    }
    if (!isRect(row.rect)) throw new Error(`Booth ${row.boothKey} has invalid rect`)
    const mapKey =
      typeof row.mapKey === 'string' && row.mapKey.trim()
        ? row.mapKey.trim()
        : defaultMapKey
    return {
      boothKey: row.boothKey,
      mapKey,
      label: typeof row.label === 'string' ? row.label : row.boothKey,
      nameOverride: typeof row.nameOverride === 'string' ? row.nameOverride : undefined,
      rect: row.rect,
    }
  })

  const vendors: EventBackup['vendors'] = obj.vendors.map((v, i) => {
    if (!v || typeof v !== 'object') throw new Error(`Vendor ${i} is invalid`)
    const row = v as Record<string, unknown>
    if (typeof row.boothKey !== 'string' || !row.boothKey) {
      throw new Error(`Vendor ${i} missing boothKey`)
    }
    if (typeof row.name !== 'string' || !row.name.trim()) {
      throw new Error(`Vendor ${i} missing name`)
    }
    const visitStatus = isVisitStatus(row.visitStatus) ? row.visitStatus : 'none'
    const mapKey =
      typeof row.mapKey === 'string' && row.mapKey.trim()
        ? row.mapKey.trim()
        : defaultMapKey
    return {
      boothKey: row.boothKey,
      mapKey,
      name: row.name.trim(),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      visitStatus,
      notes: typeof row.notes === 'string' ? row.notes : undefined,
    }
  })

  const photos: EventBackup['photos'] = obj.photos.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`Photo ${i} is invalid`)
    const row = p as Record<string, unknown>
    if (typeof row.boothKey !== 'string' || !row.boothKey) {
      throw new Error(`Photo ${i} missing boothKey`)
    }
    if (typeof row.imageBase64 !== 'string' || !row.imageBase64) {
      throw new Error(`Photo ${i} missing imageBase64`)
    }
    const mapKey =
      typeof row.mapKey === 'string' && row.mapKey.trim()
        ? row.mapKey.trim()
        : defaultMapKey
    return {
      boothKey: row.boothKey,
      mapKey,
      note: typeof row.note === 'string' ? row.note : undefined,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      imageMime: typeof row.imageMime === 'string' ? row.imageMime : 'image/jpeg',
      imageBase64: row.imageBase64,
    }
  })

  let userLocation: EventBackup['userLocation'] = null
  if (obj.userLocation != null) {
    if (typeof obj.userLocation !== 'object') throw new Error('Backup userLocation is invalid')
    const loc = obj.userLocation as Record<string, unknown>
    if (typeof loc.x !== 'number' || typeof loc.y !== 'number') {
      throw new Error('Backup userLocation missing x/y')
    }
    const source = loc.source === 'gps' ? 'gps' : 'manual'
    userLocation = {
      x: loc.x,
      y: loc.y,
      source,
      accuracy: typeof loc.accuracy === 'number' ? loc.accuracy : undefined,
      updatedAt: typeof loc.updatedAt === 'number' ? loc.updatedAt : Date.now(),
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: version === 1 ? 1 : BACKUP_VERSION,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
    event,
    floorMaps,
    booths,
    vendors,
    photos,
    userLocation,
  }
}

export async function restoreEventBackup(
  eventId: number,
  backup: EventBackup,
): Promise<{ booths: number; vendors: number; photos: number; maps: number }> {
  const event = await db.events.get(eventId)
  if (!event?.id) throw new Error('Event not found')

  let boothCount = 0
  let vendorCount = 0
  let photoCount = 0
  let mapCount = 0

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

      const mapKeyToId = new Map<string, number>()
      for (const fm of backup.floorMaps) {
        const id = (await db.floorMaps.add({
          eventId,
          name: fm.name?.trim() || 'Floor map',
          imageBlob: base64ToBlob(fm.imageBase64, fm.imageMime),
          width: fm.width,
          height: fm.height,
          obstacles: fm.obstacles,
          calibration: fm.calibration,
          createdAt: fm.createdAt || Date.now(),
        })) as number
        mapKeyToId.set(fm.key, id)
        mapCount++
      }
      const firstMapId = backup.floorMaps[0]
        ? mapKeyToId.get(backup.floorMaps[0].key)
        : undefined
      if (firstMapId != null) setActiveFloorMapId(eventId, firstMapId)

      const boothLinkToId = new Map<string, number>()
      for (const b of backup.booths) {
        const mapKey = b.mapKey ?? backup.floorMaps[0]?.key
        const floorMapId = mapKey != null ? mapKeyToId.get(mapKey) : firstMapId
        const id = (await db.booths.add({
          eventId,
          floorMapId,
          boothKey: b.boothKey,
          label: b.label,
          nameOverride: b.nameOverride,
          rect: b.rect,
        })) as number
        boothLinkToId.set(boothLinkKey(b.boothKey, mapKey), id)
        boothCount++
      }

      const boothLinkToVendorId = new Map<string, number>()
      for (const v of backup.vendors) {
        const mapKey = v.mapKey ?? backup.floorMaps[0]?.key
        const boothId = boothLinkToId.get(boothLinkKey(v.boothKey, mapKey))
        if (boothId == null) continue
        const id = (await db.vendors.add({
          eventId,
          boothId,
          name: v.name,
          tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
          visitStatus: v.visitStatus ?? 'none',
          notes: v.notes,
        })) as number
        boothLinkToVendorId.set(boothLinkKey(v.boothKey, mapKey), id)
        vendorCount++
      }

      for (const p of backup.photos) {
        const mapKey = p.mapKey ?? backup.floorMaps[0]?.key
        const vendorId = boothLinkToVendorId.get(boothLinkKey(p.boothKey, mapKey))
        if (vendorId == null) continue
        await db.itemPhotos.add({
          eventId,
          vendorId,
          imageBlob: base64ToBlob(p.imageBase64, p.imageMime),
          note: p.note,
          createdAt: p.createdAt || Date.now(),
        })
        photoCount++
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

  registerCustomTags(backup.vendors.flatMap((v) => v.tags))

  return {
    booths: boothCount,
    vendors: vendorCount,
    photos: photoCount,
    maps: mapCount,
  }
}

export async function downloadBackupJson(
  backup: EventBackup,
  filename?: string,
): Promise<void> {
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10)
  const name = filename ?? `cfn-backup-${stamp}.json`
  const text = JSON.stringify(backup)
  const blob = new Blob([text], { type: 'application/json' })
  const file = new File([blob], name, { type: 'application/json' })

  // Prefer share sheet when available (mobile / Cap WebView).
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
  }
  if (typeof nav.share === 'function') {
    try {
      const data: ShareData = { files: [file], title: 'Con Floor Nav backup' }
      if (!nav.canShare || nav.canShare(data)) {
        await nav.share(data)
        return
      }
    } catch (err) {
      // User cancel → stop; other errors fall through to <a download>.
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }

  if (Capacitor.isNativePlatform()) {
    // Last-resort native path without Filesystem plugin: open data URL.
    const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`
    window.open(dataUrl, '_blank')
    return
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Delay revoke so Safari/WebKit can finish the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
