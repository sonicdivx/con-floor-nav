export type VisitStatus = 'favorite' | 'look_again' | 'end_of_con' | 'none'

export const DEFAULT_TAGS = [
  'artist',
  'video',
  'models',
  'toys',
  'kits',
  'prints',
  'apparel',
  'plush',
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
  /** Display name (e.g. "Dealers", "Artist Alley"). */
  name?: string
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

/** Shared catalog extras (fan masterlists) — not personal notes. */
export type VendorCatalogInfo = {
  source?: string
  sourceUrl?: string
  /** Sheet tab name (e.g. "Row A", "100s", "1-36 (NSFW)"). */
  sheet?: string
  /** Display name from the sheet (mirrors Name column). */
  name?: string
  socials?: string
  merch?: string
  /**
   * Full fandom/media columns from the sheet. Empty cells are stored as ""
   * so Booth info can still show every column offline.
   */
  categories?: Array<{ label: string; value: string }>
  adultContent?: string
  /** When one listing spans multiple booth numbers (e.g. 606+609). */
  multiBooth?: string[]
  tablemates?: Array<{
    name: string
    socials?: string
    merch?: string
    categories?: Array<{ label: string; value: string }>
    adultContent?: string
  }>
}

/** Full unofficial sheet dump (also stamped onto each booth as catalogInfo). */
export type CatalogMasterlist = {
  source: string
  sourceUrl?: string
  booths: Array<{
    booth: string
    sheet?: string
    name?: string
    socials?: string
    merch?: string
    /** Includes blank columns as value: "" for offline full-row display. */
    categories?: Array<{ label: string; value: string }>
    adultContent?: string
    multiBooth?: string[]
    tablemates?: VendorCatalogInfo['tablemates']
  }>
}

export interface BoothRecord {
  id?: number
  eventId: number
  /** Which floor map this booth belongs to (required for multi-map events). */
  floorMapId?: number
  boothKey: string
  label: string
  nameOverride?: string
  rect: Rect
  /** Fan/catalog profile mirrored from sync (fallback for vendor details). */
  catalogInfo?: VendorCatalogInfo
}

export interface VendorRecord {
  id?: number
  eventId: number
  boothId: number
  name: string
  tags: string[]
  visitStatus: VisitStatus
  notes?: string
  /** Fan/catalog profile (merch, fandoms, tablemates). Overwritten by catalog sync. */
  catalogInfo?: VendorCatalogInfo
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
    catalogInfo?: VendorCatalogInfo
  }>
}
