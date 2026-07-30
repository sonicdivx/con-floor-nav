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
  hundred: number
  text: string
  x: number
  y: number
}

/**
 * One overlay label per hundred-row group (≥100), placed near the row.
 * Vertical aisles (typical dealers hall): above the column at median X.
 */
export function computeRowHundredLabels(
  booths: BoothRecord[],
  mapWidth: number,
  mapHeight: number,
): RowHundredLabel[] {
  const groups = new Map<number, BoothRecord[]>()
  for (const booth of booths) {
    const hundred = boothHundred(booth.label || booth.boothKey)
    if (hundred == null || hundred < 100) continue
    const list = groups.get(hundred)
    if (list) list.push(booth)
    else groups.set(hundred, [booth])
  }

  const out: RowHundredLabel[] = []
  for (const [hundred, group] of groups) {
    const xs = group
      .map((b) => (b.rect.x + b.rect.w / 2) * mapWidth)
      .sort((a, b) => a - b)
    const ys = group.map((b) => b.rect.y * mapHeight)
    const hs = group.map((b) => b.rect.h * mapHeight)
    const medianX = xs[Math.floor(xs.length / 2)]!
    const minY = Math.min(...ys)
    const avgH = hs.reduce((s, h) => s + h, 0) / hs.length
    const y = Math.max(avgH * 0.55, minY - avgH * 0.45)
    out.push({ hundred, text: String(hundred), x: medianX, y })
  }
  out.sort((a, b) => a.hundred - b.hundred)
  return out
}
