/**
 * Personal device login sync — no password, unique code only.
 * Pulls/pushes visit status, notes, tags, pin, custom tags, and item photos.
 * Shared floor maps stay on catalog sync.
 */
import { db, ensureVendorForBooth, getOrCreateUserLocation } from '../db/schema'
import type { VisitStatus } from '../db/types'
import { VISIT_STATUSES } from './statusColors'
import { loadCustomTags, registerCustomTags } from './tags'

export const PERSONAL_FORMAT = 'cfn-personal' as const
export const PERSONAL_VERSION = 1 as const

const DEVICE_CODE_KEY = 'cfn-device-code'

export type PersonalPhoto = {
  note?: string
  createdAt: number
  imageMime: string
  imageBase64: string
}

export type PersonalVendor = {
  mapKey: string
  boothKey: string
  name?: string
  visitStatus: VisitStatus
  notes?: string
  tags?: string[]
  photos?: PersonalPhoto[]
}

export type PersonalEvent = {
  name: string
  userLocation?: {
    x: number
    y: number
    source: 'manual' | 'gps'
    accuracy?: number
    updatedAt: number
  } | null
  vendors: PersonalVendor[]
}

export type PersonalBundle = {
  format: typeof PERSONAL_FORMAT
  version: typeof PERSONAL_VERSION
  updatedAt: number
  customTags: string[]
  events: PersonalEvent[]
}

export type DeviceSaveResult = {
  code: string
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export type DeviceLoadResult = DeviceSaveResult & {
  payload: PersonalBundle
}

export type ApplyPersonalResult = {
  events: number
  vendors: number
  photos: number
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

export function loadStoredDeviceCode(): string | null {
  try {
    const raw = localStorage.getItem(DEVICE_CODE_KEY)
    return raw?.trim() ? raw.trim().toUpperCase() : null
  } catch {
    return null
  }
}

export function storeDeviceCode(code: string): void {
  localStorage.setItem(DEVICE_CODE_KEY, code.trim().toUpperCase())
}

export function clearStoredDeviceCode(): void {
  localStorage.removeItem(DEVICE_CODE_KEY)
}

function resolveApiBase(): string | null {
  const raw = import.meta.env.VITE_SYNC_URL as string | undefined
  if (raw?.trim()) return raw.trim().replace(/\/$/, '')
  if (import.meta.env.DEV) {
    const party = import.meta.env.VITE_PARTY_WS_URL as string | undefined
    if (party?.trim()) {
      try {
        const u = new URL(party.trim().replace(/^ws/i, 'http'))
        return u.origin
      } catch {
        return null
      }
    }
    return null
  }
  if (typeof location === 'undefined') return null
  return location.origin
}

export function isDeviceSyncConfigured(): boolean {
  return resolveApiBase() != null
}

/** Build personal overlay for every event on this device. */
export async function buildPersonalBundle(): Promise<PersonalBundle> {
  const events = await db.events.orderBy('createdAt').toArray()
  const outEvents: PersonalEvent[] = []

  for (const event of events) {
    if (event.id == null) continue
    const eventId = event.id
    const [maps, booths, vendors, photos, userLocation] = await Promise.all([
      db.floorMaps.where('eventId').equals(eventId).toArray(),
      db.booths.where('eventId').equals(eventId).toArray(),
      db.vendors.where('eventId').equals(eventId).toArray(),
      db.itemPhotos.where('eventId').equals(eventId).toArray(),
      db.userLocations.where('eventId').equals(eventId).first(),
    ])

    const mapIdToKey = new Map<number, string>()
    for (const m of maps) {
      if (m.id == null) continue
      mapIdToKey.set(m.id, (m.name ?? '').trim() || `map-${m.id}`)
    }

    const personalVendors: PersonalVendor[] = []
    for (const v of vendors) {
      if (v.id == null) continue
      const booth = booths.find((b) => b.id === v.boothId)
      if (!booth) continue
      const mapKey =
        booth.floorMapId != null
          ? mapIdToKey.get(booth.floorMapId) ?? 'Floor map'
          : maps[0]?.name?.trim() || 'Floor map'

      const vendorPhotos = photos.filter((p) => p.vendorId === v.id)
      const photoPayload: PersonalPhoto[] = []
      for (const p of vendorPhotos) {
        if (!p.imageBlob) continue
        const { mime, base64 } = await blobToBase64(p.imageBlob)
        photoPayload.push({
          note: p.note,
          createdAt: p.createdAt,
          imageMime: mime,
          imageBase64: base64,
        })
      }

      const interesting =
        v.visitStatus !== 'none' ||
        Boolean(v.notes?.trim()) ||
        (v.tags?.length ?? 0) > 0 ||
        photoPayload.length > 0
      if (!interesting) continue

      personalVendors.push({
        mapKey,
        boothKey: booth.boothKey,
        name: v.name,
        visitStatus: v.visitStatus,
        notes: v.notes,
        tags: v.tags,
        photos: photoPayload.length ? photoPayload : undefined,
      })
    }

    outEvents.push({
      name: event.name,
      userLocation: userLocation
        ? {
            x: userLocation.x,
            y: userLocation.y,
            source: userLocation.source,
            accuracy: userLocation.accuracy,
            updatedAt: userLocation.updatedAt,
          }
        : null,
      vendors: personalVendors,
    })
  }

  return {
    format: PERSONAL_FORMAT,
    version: PERSONAL_VERSION,
    updatedAt: Date.now(),
    customTags: loadCustomTags(),
    events: outEvents,
  }
}

export function parsePersonalBundle(raw: unknown): PersonalBundle {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid personal payload')
  const o = raw as Record<string, unknown>
  if (o.format !== PERSONAL_FORMAT) throw new Error('Not a cfn-personal payload')
  if (o.version !== 1) throw new Error(`Unsupported personal version: ${String(o.version)}`)
  if (!Array.isArray(o.events)) throw new Error('Personal payload missing events')

  const customTags = Array.isArray(o.customTags)
    ? o.customTags.filter((t): t is string => typeof t === 'string')
    : []

  const events: PersonalEvent[] = []
  for (const ev of o.events) {
    if (!ev || typeof ev !== 'object') continue
    const e = ev as Record<string, unknown>
    if (typeof e.name !== 'string' || !e.name.trim()) continue
    const vendors: PersonalVendor[] = []
    if (Array.isArray(e.vendors)) {
      for (const v of e.vendors) {
        if (!v || typeof v !== 'object') continue
        const row = v as Record<string, unknown>
        if (typeof row.boothKey !== 'string' || !row.boothKey) continue
        if (!isVisitStatus(row.visitStatus)) continue
        const photos: PersonalPhoto[] = []
        if (Array.isArray(row.photos)) {
          for (const p of row.photos) {
            if (!p || typeof p !== 'object') continue
            const ph = p as Record<string, unknown>
            if (typeof ph.imageBase64 !== 'string' || !ph.imageBase64) continue
            photos.push({
              note: typeof ph.note === 'string' ? ph.note : undefined,
              createdAt: typeof ph.createdAt === 'number' ? ph.createdAt : Date.now(),
              imageMime: typeof ph.imageMime === 'string' ? ph.imageMime : 'image/jpeg',
              imageBase64: ph.imageBase64,
            })
          }
        }
        vendors.push({
          mapKey: typeof row.mapKey === 'string' ? row.mapKey : 'Floor map',
          boothKey: row.boothKey,
          name: typeof row.name === 'string' ? row.name : undefined,
          visitStatus: row.visitStatus,
          notes: typeof row.notes === 'string' ? row.notes : undefined,
          tags: Array.isArray(row.tags)
            ? row.tags.filter((t): t is string => typeof t === 'string')
            : undefined,
          photos: photos.length ? photos : undefined,
        })
      }
    }

    let userLocation: PersonalEvent['userLocation'] = null
    if (e.userLocation && typeof e.userLocation === 'object') {
      const ul = e.userLocation as Record<string, unknown>
      if (typeof ul.x === 'number' && typeof ul.y === 'number') {
        userLocation = {
          x: ul.x,
          y: ul.y,
          source: ul.source === 'gps' ? 'gps' : 'manual',
          accuracy: typeof ul.accuracy === 'number' ? ul.accuracy : undefined,
          updatedAt: typeof ul.updatedAt === 'number' ? ul.updatedAt : Date.now(),
        }
      }
    }

    events.push({
      name: e.name.trim(),
      userLocation,
      vendors,
    })
  }

  return {
    format: PERSONAL_FORMAT,
    version: PERSONAL_VERSION,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    customTags,
    events,
  }
}

/** Merge personal overlays into local Dexie (catalog maps/booths must already exist). */
export async function applyPersonalBundle(
  bundle: PersonalBundle,
): Promise<ApplyPersonalResult> {
  registerCustomTags(bundle.customTags)
  let vendorCount = 0
  let photoCount = 0
  let eventCount = 0

  for (const ev of bundle.events) {
    const event = await db.events.filter((e) => e.name === ev.name).first()
    if (event?.id == null) continue
    const eventId = event.id
    eventCount++

    const maps = await db.floorMaps.where('eventId').equals(eventId).toArray()
    const booths = await db.booths.where('eventId').equals(eventId).toArray()

    for (const pv of ev.vendors) {
      const map =
        maps.find((m) => (m.name ?? '').trim() === pv.mapKey.trim()) ??
        maps[0]
      if (!map?.id) continue
      const booth = booths.find(
        (b) =>
          b.boothKey === pv.boothKey &&
          (b.floorMapId == null || b.floorMapId === map.id),
      )
      if (booth?.id == null) continue

      const vendor = await ensureVendorForBooth(eventId, booth.id)
      if (vendor.id == null) continue

      await db.vendors.update(vendor.id, {
        visitStatus: pv.visitStatus,
        notes: pv.notes,
        tags: pv.tags ?? vendor.tags,
        ...(pv.name ? { name: pv.name } : {}),
      })
      vendorCount++

      if (pv.photos) {
        await db.itemPhotos.where('vendorId').equals(vendor.id).delete()
        for (const ph of pv.photos) {
          await db.itemPhotos.add({
            eventId,
            vendorId: vendor.id,
            imageBlob: base64ToBlob(ph.imageBase64, ph.imageMime),
            note: ph.note,
            createdAt: ph.createdAt,
          })
          photoCount++
        }
      }
    }

    if (ev.userLocation) {
      const loc = await getOrCreateUserLocation(eventId)
      if (loc.id != null) {
        await db.userLocations.update(loc.id, {
          x: ev.userLocation.x,
          y: ev.userLocation.y,
          source: ev.userLocation.source,
          accuracy: ev.userLocation.accuracy,
          updatedAt: ev.userLocation.updatedAt,
        })
      }
    }
  }

  return { events: eventCount, vendors: vendorCount, photos: photoCount }
}

export async function savePersonalToCloud(
  existingCode?: string | null,
): Promise<DeviceSaveResult> {
  const base = resolveApiBase()
  if (!base) throw new Error('Cloud not available in this environment')

  const payload = await buildPersonalBundle()
  const res = await fetch(`${base}/api/sync/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: existingCode?.trim() || undefined,
      payload,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    code?: string
    createdAt?: number
    updatedAt?: number
    expiresAt?: number
  }
  if (!res.ok) throw new Error(data.error || `Save failed (HTTP ${res.status})`)
  if (!data.code) throw new Error('Server did not return a device code')
  storeDeviceCode(data.code)
  return {
    code: data.code,
    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
    expiresAt: data.expiresAt ?? Date.now(),
  }
}

export async function loadPersonalFromCloud(codeRaw: string): Promise<ApplyPersonalResult> {
  const base = resolveApiBase()
  if (!base) throw new Error('Cloud not available in this environment')

  const code = codeRaw.trim().toUpperCase()
  if (code.length < 5) throw new Error('Enter a valid device code')

  const res = await fetch(`${base}/api/sync/device/${encodeURIComponent(code)}`)
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    code?: string
    payload?: unknown
  }
  if (!res.ok) throw new Error(data.error || `Load failed (HTTP ${res.status})`)
  const bundle = parsePersonalBundle(data.payload)
  const result = await applyPersonalBundle(bundle)
  if (data.code) storeDeviceCode(data.code)
  else storeDeviceCode(code)
  return result
}
