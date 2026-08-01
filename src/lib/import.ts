import type { BoothImportJson, Rect } from '../db/types'
import { normalizeTag, registerCustomTags } from './tags'
import { db } from '../db/schema'

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

export function parseBoothImportJson(text: string): BoothImportJson {
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== 'object') {
    throw new Error('Import must be a JSON object')
  }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.booths)) {
    throw new Error('Import must include a "booths" array')
  }
  const booths = obj.booths.map((b, i) => {
    if (!b || typeof b !== 'object') {
      throw new Error(`Booth at index ${i} is invalid`)
    }
    const booth = b as Record<string, unknown>
    const id = String(booth.id ?? '')
    if (!id) throw new Error(`Booth at index ${i} missing id`)
    if (!isRect(booth.rect)) {
      throw new Error(`Booth ${id} missing valid rect {x,y,w,h}`)
    }
    return {
      id,
      label: booth.label != null ? String(booth.label) : id,
      name: booth.name != null ? String(booth.name) : undefined,
      rect: booth.rect,
      tags: Array.isArray(booth.tags)
        ? booth.tags.map(String)
        : undefined,
    }
  })
  let obstacles: Rect[] | undefined
  if (obj.obstacles != null) {
    if (!Array.isArray(obj.obstacles)) {
      throw new Error('Import "obstacles" must be an array of {x,y,w,h}')
    }
    obstacles = obj.obstacles.map((o, i) => {
      if (!isRect(o)) {
        throw new Error(`Obstacle at index ${i} missing valid rect {x,y,w,h}`)
      }
      return { x: o.x, y: o.y, w: o.w, h: o.h }
    })
  }

  return {
    event: obj.event != null ? String(obj.event) : undefined,
    mapImage: obj.mapImage != null ? String(obj.mapImage) : undefined,
    obstacles,
    booths,
  }
}

/** CSV: booth,name,tags,x,y,w,h  (tags pipe-separated) */
export function parseBoothCsv(text: string): BoothImportJson {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV needs a header and at least one row')

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const idx = (name: string) => header.indexOf(name)

  const idI = idx('booth') >= 0 ? idx('booth') : idx('id')
  const nameI = idx('name')
  const tagsI = idx('tags')
  const xI = idx('x')
  const yI = idx('y')
  const wI = idx('w')
  const hI = idx('h')

  if (idI < 0) throw new Error('CSV must have a booth/id column')

  const booths = lines.slice(1).map((line, row) => {
    const cols = splitCsvLine(line)
    const id = cols[idI]?.trim()
    if (!id) throw new Error(`Row ${row + 2}: missing booth id`)
    const hasCoords =
      xI >= 0 && yI >= 0 && wI >= 0 && hI >= 0 &&
      cols[xI] !== undefined &&
      cols[yI] !== undefined
    const rect: Rect = hasCoords
      ? {
          x: Number(cols[xI]),
          y: Number(cols[yI]),
          w: Number(cols[wI] ?? 0.03),
          h: Number(cols[hI] ?? 0.02),
        }
      : { x: 0.05 + (row % 10) * 0.09, y: 0.1 + Math.floor(row / 10) * 0.08, w: 0.06, h: 0.04 }
    const tags =
      tagsI >= 0 && cols[tagsI]
        ? cols[tagsI].split(/[|;]/).map((t) => t.trim()).filter(Boolean)
        : undefined
    return {
      id,
      label: id,
      name: nameI >= 0 ? cols[nameI]?.trim() || undefined : undefined,
      rect,
      tags,
    }
  })

  return { booths }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (c === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

export async function applyBoothImport(
  eventId: number,
  data: BoothImportJson,
  options: { replace?: boolean; floorMapId?: number } = {},
): Promise<{ booths: number; vendors: number }> {
  if (data.event) {
    const ev = await db.events.get(eventId)
    if (ev) {
      await db.events.update(eventId, {
        name: data.event,
        updatedAt: Date.now(),
      })
    }
  }

  let floorMapId = options.floorMapId
  if (floorMapId == null) {
    const map = await db.floorMaps.where('eventId').equals(eventId).first()
    floorMapId = map?.id
  }

  if (options.replace) {
    if (floorMapId != null) {
      const oldBooths = await db.booths
        .where('floorMapId')
        .equals(floorMapId)
        .toArray()
      const boothIds = oldBooths.map((b) => b.id!).filter(Boolean)
      const oldVendors =
        boothIds.length > 0
          ? await db.vendors.where('boothId').anyOf(boothIds).toArray()
          : []
      const vendorIds = oldVendors.map((v) => v.id!).filter(Boolean)
      if (vendorIds.length) {
        await db.itemPhotos.where('vendorId').anyOf(vendorIds).delete()
      }
      if (boothIds.length) {
        await db.vendors.where('boothId').anyOf(boothIds).delete()
        await db.booths.bulkDelete(boothIds)
      }
    } else {
      const oldVendors = await db.vendors.where('eventId').equals(eventId).toArray()
      const vendorIds = oldVendors.map((v) => v.id!).filter(Boolean)
      await db.itemPhotos.where('vendorId').anyOf(vendorIds).delete()
      await db.vendors.where('eventId').equals(eventId).delete()
      await db.booths.where('eventId').equals(eventId).delete()
    }
  }

  let boothCount = 0
  let vendorCount = 0

  await db.transaction('rw', db.booths, db.vendors, db.floorMaps, async () => {
    for (const b of data.booths) {
      const existing =
        floorMapId != null
          ? await db.booths
              .where('[eventId+floorMapId+boothKey]')
              .equals([eventId, floorMapId, b.id])
              .first()
          : await db.booths.where({ eventId, boothKey: b.id }).first()

      let boothId: number
      if (existing?.id != null) {
        await db.booths.update(existing.id, {
          label: b.label ?? b.id,
          nameOverride: b.name,
          rect: b.rect,
          ...(floorMapId != null ? { floorMapId } : {}),
        })
        boothId = existing.id
      } else {
        boothId = (await db.booths.add({
          eventId,
          floorMapId,
          boothKey: b.id,
          label: b.label ?? b.id,
          nameOverride: b.name,
          rect: b.rect,
        })) as number
        boothCount++
      }

      const vendor = await db.vendors.where({ eventId, boothId }).first()
      const tags = (b.tags ?? []).map((t) => normalizeTag(t)).filter(Boolean)
      if (tags.length) registerCustomTags(tags)

      if (vendor?.id != null) {
        await db.vendors.update(vendor.id, {
          name: b.name ?? vendor.name,
          tags: tags.length ? tags : vendor.tags,
          ...(b.catalogInfo ? { catalogInfo: b.catalogInfo } : {}),
        })
      } else {
        await db.vendors.add({
          eventId,
          boothId,
          name: b.name ?? b.label ?? b.id,
          tags,
          visitStatus: 'none',
          ...(b.catalogInfo ? { catalogInfo: b.catalogInfo } : {}),
        })
        vendorCount++
      }
    }

    // Persist pillars/walls onto the active floor map when the import includes them.
    if (data.obstacles !== undefined && floorMapId != null) {
      await db.floorMaps.update(floorMapId, { obstacles: data.obstacles })
    }
  })

  return { booths: boothCount, vendors: vendorCount }
}

export const IMPORT_SCHEMA_EXAMPLE: BoothImportJson = {
  event: 'Otakon',
  booths: [
    {
      id: 'A12',
      label: 'A12',
      name: 'Vendor Name',
      rect: { x: 0.12, y: 0.34, w: 0.03, h: 0.02 },
      tags: ['kits'],
    },
  ],
}
