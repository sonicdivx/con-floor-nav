import type { BoothRecord } from '../db/types'

/** Leading digits from labels like `501a`, `1104a`, `1600`. */
export function parseBoothNumber(label: string): number | null {
  const m = String(label).trim().match(/^(\d+)/i)
  if (!m) return null
  return parseInt(m[1], 10)
}

/** Hundred-row group (100, 200, …). Null if unparseable. */
export function boothHundred(label: string): number | null {
  const n = parseBoothNumber(label)
  if (n == null) return null
  return Math.floor(n / 100) * 100
}

/**
 * Font size in map pixels so `label` fits inside the booth rect.
 * Scales with zoom via the stage transform; clip is applied separately.
 */
export function fitBoothLabelFontSize(
  label: string,
  boothW: number,
  boothH: number,
): number {
  const padX = Math.max(1, boothW * 0.08)
  const padY = Math.max(1, boothH * 0.1)
  const availW = Math.max(1, boothW - padX * 2)
  const availH = Math.max(1, boothH - padY * 2)
  const chars = Math.max(1, label.length)
  // Bold sans approx advance width ≈ 0.58em
  const byWidth = availW / (chars * 0.58)
  const byHeight = availH * 0.9
  return Math.max(2, Math.min(byWidth, byHeight))
}

export interface RowHundredLabel {
  /** Full hundred for zoom-to-section (100, 200, 1100, …). */
  hundred: number
  /** Display text — abbreviated with trailing zeros dropped when compact. */
  text: string
  x: number
  y: number
}

export interface RowHundredBand {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Compact aisle label: drop the last two zeros (divide by 100).
 * 100→`1`, 200→`2`, 1000→`10`, 1100→`11`.
 * Canonical `hundred` (100, 1000, …) stays unchanged for zoom/DB logic.
 */
export function formatRowHundredAbbrev(hundred: number): string {
  const n = Math.round(hundred)
  if (!Number.isFinite(n)) return '0'
  return String(n / 100)
}

/**
 * Prefer abbreviated labels when zoomed out / map is small so neighbors
 * do not overlap; show full hundreds once columns have enough screen space.
 * @param fontSizeScreenPx Approximate label size in CSS pixels (not map units).
 */
export function shouldAbbreviateRowHundreds(
  labels: ReadonlyArray<Pick<RowHundredLabel, 'x'>>,
  scale: number,
  fontSizeScreenPx: number,
): boolean {
  if (labels.length < 2) return scale < 0.85
  let minGap = Infinity
  for (let i = 1; i < labels.length; i++) {
    const gap = Math.abs(labels[i].x - labels[i - 1].x)
    if (gap > 0 && gap < minGap) minGap = gap
  }
  if (!Number.isFinite(minGap)) return scale < 0.85
  // Abbreviated "10"/"11" needs ~2em; full "1000" needs ~4em (screen space).
  const screenGap = minGap * scale
  return screenGap < fontSizeScreenPx * 3.2
}

/**
 * One overlay label per hundred-row group (≥100).
 *
 * Otakon-style dealers halls lay booths in vertical columns (100, 200, …).
 * Labels sit in the shared top margin above every column — clear of booth
 * rects — with a common Y so they form one scan line, each centered on its
 * column (aisle) X. A light band spans the label row for contrast.
 */
export function computeRowHundredLabels(
  booths: BoothRecord[],
  mapWidth: number,
  mapHeight: number,
): { labels: RowHundredLabel[]; band: RowHundredBand | null } {
  const groups = new Map<number, BoothRecord[]>()
  for (const booth of booths) {
    const hundred = boothHundred(booth.label || booth.boothKey)
    if (hundred == null || hundred < 100) continue
    const list = groups.get(hundred)
    if (list) list.push(booth)
    else groups.set(hundred, [booth])
  }

  if (groups.size === 0) return { labels: [], band: null }

  type Col = {
    hundred: number
    minX: number
    maxX: number
    minY: number
    avgH: number
  }

  const cols: Col[] = []
  for (const [hundred, group] of groups) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let hSum = 0
    for (const b of group) {
      const x0 = b.rect.x * mapWidth
      const x1 = (b.rect.x + b.rect.w) * mapWidth
      const y0 = b.rect.y * mapHeight
      const h = b.rect.h * mapHeight
      if (x0 < minX) minX = x0
      if (x1 > maxX) maxX = x1
      if (y0 < minY) minY = y0
      hSum += h
    }
    cols.push({
      hundred,
      minX,
      maxX,
      minY,
      avgH: hSum / group.length,
    })
  }

  cols.sort((a, b) => a.hundred - b.hundred)

  const globalMinY = Math.min(...cols.map((c) => c.minY))
  const typicalH =
    cols.reduce((s, c) => s + c.avgH, 0) / Math.max(1, cols.length)
  // Shared band in the margin above all booth columns (not on booth rects).
  const clearance = Math.max(typicalH * 1.15, 14)
  const labelY = Math.max(clearance * 0.55, globalMinY - clearance)
  const bandH = Math.max(clearance * 0.85, typicalH * 0.95, 16)
  const bandPadX = Math.max(typicalH * 0.35, 8)
  const bandMinX = Math.min(...cols.map((c) => c.minX)) - bandPadX
  const bandMaxX = Math.max(...cols.map((c) => c.maxX)) + bandPadX

  const labels = cols.map((c) => ({
    // Canonical section id (100, 200, 1000…) — never mutate; abbreviate only at display time.
    hundred: c.hundred,
    text: String(c.hundred),
    x: (c.minX + c.maxX) / 2,
    y: labelY,
  }))

  return {
    labels,
    band: {
      x: bandMinX,
      y: labelY - bandH / 2,
      width: Math.max(0, bandMaxX - bandMinX),
      height: bandH,
    },
  }
}
