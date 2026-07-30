export type VisitStatus = 'favorite' | 'look_again' | 'end_of_con' | 'none'

export const DEFAULT_TAGS = [
  'video',
  'models',
  'toys',
  'kits',
  'prints',
  'apparel',
  'other',
] as const

export type DefaultTag = (typeof DEFAULT_TAGS)[number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Normalized 0–1 map coordinates (same shape as Rect). */
export type NormalizedRect = Rect

export interface EventRecord {
  id?: number
  name: string
  venueNotes: string
  createdAt: number
  updatedAt: number
}

export interface FloorMapRecord {
  id?: number
  eventId: number
  imageBlob: Blob
  width: number
  height: number
  /**
   * Optional impassable regions (pillars, walls) in normalized 0–1 coords.
   * Used by aisle pathfinding together with booth rects.
   */
  obstacles?: Rect[]
  /** Optional GPS calibration corners (image space ↔ lat/lng) — reserved */
  calibration?: {
    topLeft?: { lat: number; lng: number }
    topRight?: { lat: number; lng: number }
    bottomLeft?: { lat: number; lng: number }
    bottomRight?: { lat: number; lng: number }
  }
  createdAt: number
}

export interface BoothRecord {
  id?: number
  eventId: number
  boothKey: string
  label: string
  nameOverride?: string
  rect: Rect
}

export interface VendorRecord {
  id?: number
  eventId: number
  boothId: number
  name: string
  tags: string[]
  visitStatus: VisitStatus
  notes?: string
}

export interface ItemPhotoRecord {
  id?: number
  eventId: number
  vendorId: number
  imageBlob: Blob
  note?: string
  createdAt: number
}

export interface UserLocationRecord {
  id?: number
  eventId: number
  /** Normalized 0–1 image coordinates */
  x: number
  y: number
  source: 'manual' | 'gps'
  accuracy?: number
  updatedAt: number
}

/** Import JSON schema (plan spec) */
export interface BoothImportJson {
  event?: string
  mapImage?: string
  /** Optional impassable pillars / walls (normalized 0–1) */
  obstacles?: Rect[]
  booths: Array<{
    id: string
    label?: string
    name?: string
    rect: Rect
    tags?: string[]
  }>
}
