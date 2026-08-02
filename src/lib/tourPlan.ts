import type { Rect, VisitStatus } from '../db/types'
import { findAislePath, type NormPoint } from './pathfinding'

export type TourStopInput = {
  boothId: number
  rect: Rect
  label: string
  name: string
  visitStatus: VisitStatus
}

export type TourPlanInput = {
  pin: NormPoint
  stops: TourStopInput[]
  mapWidth: number
  mapHeight: number
  boothRects: Rect[]
  obstacles?: Rect[]
}

export type PlannedTourStop = TourStopInput & {
  /** 1-based visit order */
  index: number
  center: NormPoint
}

export type TourPlanResult = {
  orderedStops: PlannedTourStop[]
  path: NormPoint[]
  /** Booths omitted because no aisle path and no usable center */
  skippedBoothIds: number[]
  /** True when at least one segment fell back to a straight line */
  usedStraightFallback: boolean
}

function boothCenter(rect: Rect): NormPoint {
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  }
}

function euclidean(a: NormPoint, b: NormPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pathLength(points: NormPoint[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += euclidean(points[i - 1], points[i])
  }
  return len
}

function segmentPath(
  start: NormPoint,
  goal: NormPoint,
  boothRects: Rect[],
  obstacles: Rect[] | undefined,
  mapWidth: number,
  mapHeight: number,
): { path: NormPoint[]; straight: boolean } {
  const computed = findAislePath({
    start,
    goal,
    booths: boothRects,
    obstacles,
    mapWidth,
    mapHeight,
  })
  if (computed && computed.length >= 2) {
    return { path: computed, straight: false }
  }
  return { path: [start, goal], straight: true }
}

function concatPaths(segments: NormPoint[][]): NormPoint[] {
  const out: NormPoint[] = []
  for (const seg of segments) {
    if (seg.length === 0) continue
    if (out.length === 0) {
      out.push(...seg)
      continue
    }
    // Drop duplicate join point when segments meet.
    const [first, ...rest] = seg
    const last = out[out.length - 1]
    if (first.x === last.x && first.y === last.y) {
      out.push(...rest)
    } else {
      out.push(first, ...rest)
    }
  }
  return out
}

/** Pairwise aisle distance with Euclidean fallback; caches by point keys. */
function makeDistanceFn(
  boothRects: Rect[],
  obstacles: Rect[] | undefined,
  mapWidth: number,
  mapHeight: number,
) {
  const cache = new Map<string, number>()
  return (a: NormPoint, b: NormPoint): number => {
    const key = `${a.x.toFixed(5)},${a.y.toFixed(5)}>${b.x.toFixed(5)},${b.y.toFixed(5)}`
    const hit = cache.get(key)
    if (hit != null) return hit
    const { path } = segmentPath(a, b, boothRects, obstacles, mapWidth, mapHeight)
    const d = pathLength(path)
    cache.set(key, d)
    return d
  }
}

/** Nearest-neighbor tour starting from `pin`, then a short 2-opt pass. */
function orderStops(
  pin: NormPoint,
  stops: Array<TourStopInput & { center: NormPoint }>,
  dist: (a: NormPoint, b: NormPoint) => number,
): Array<TourStopInput & { center: NormPoint }> {
  if (stops.length <= 1) return [...stops]

  const remaining = [...stops]
  const ordered: Array<TourStopInput & { center: NormPoint }> = []
  let current = pin

  while (remaining.length) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = dist(current, remaining[i].center)
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    const [next] = remaining.splice(bestIdx, 1)
    ordered.push(next)
    current = next.center
  }

  // 2-opt: reverse segments that shorten the pin→…→last tour.
  const n = ordered.length
  if (n < 3) return ordered

  const pointAt = (i: number): NormPoint =>
    i < 0 ? pin : ordered[i].center

  let improved = true
  let passes = 0
  const maxPasses = 40
  while (improved && passes < maxPasses) {
    improved = false
    passes += 1
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        // Edges (i-1 → i) and (k → k+1) vs (i-1 → k) and (i → k+1)
        const a = pointAt(i - 1)
        const b = ordered[i].center
        const c = ordered[k].center
        const d = k + 1 < n ? ordered[k + 1].center : null
        const before =
          dist(a, b) + (d ? dist(c, d) : 0)
        const after =
          dist(a, c) + (d ? dist(b, d) : 0)
        if (after + 1e-9 < before) {
          ordered.splice(i, k - i + 1, ...ordered.slice(i, k + 1).reverse())
          improved = true
        }
      }
    }
  }

  return ordered
}

/**
 * Plan a single-map aisle tour: nearest-neighbor from My pin, then 2-opt,
 * concatenating `findAislePath` segments (straight-line fallback if A* fails).
 */
export function planTour(input: TourPlanInput): TourPlanResult {
  const {
    pin,
    stops,
    mapWidth,
    mapHeight,
    boothRects,
    obstacles,
  } = input

  const skippedBoothIds: number[] = []
  const usable: Array<TourStopInput & { center: NormPoint }> = []

  for (const stop of stops) {
    const { rect } = stop
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.w) ||
      !Number.isFinite(rect.h) ||
      rect.w <= 0 ||
      rect.h <= 0
    ) {
      skippedBoothIds.push(stop.boothId)
      continue
    }
    usable.push({ ...stop, center: boothCenter(rect) })
  }

  if (!usable.length) {
    return {
      orderedStops: [],
      path: [],
      skippedBoothIds,
      usedStraightFallback: false,
    }
  }

  const dist = makeDistanceFn(boothRects, obstacles, mapWidth, mapHeight)
  const ordered = orderStops(pin, usable, dist)

  const segments: NormPoint[][] = []
  let usedStraightFallback = false
  let prev = pin

  for (const stop of ordered) {
    const { path, straight } = segmentPath(
      prev,
      stop.center,
      boothRects,
      obstacles,
      mapWidth,
      mapHeight,
    )
    if (straight) usedStraightFallback = true
    segments.push(path)
    prev = stop.center
  }

  const orderedStops: PlannedTourStop[] = ordered.map((s, i) => ({
    ...s,
    index: i + 1,
  }))

  return {
    orderedStops,
    path: concatPaths(segments),
    skippedBoothIds,
    usedStraightFallback,
  }
}
