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
  /** Optional fixed end of the tour (after the last booth stop). */
  end?: NormPoint | null
  mapWidth: number
  mapHeight: number
  boothRects: Rect[]
  obstacles?: Rect[]
  /**
   * When set, keep this booth order (no nearest-neighbor / 2-opt).
   * Used after the user reorders or removes stops.
   */
  orderedBoothIds?: number[]
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

/**
 * Nearest-neighbor tour starting from `pin`, then a short 2-opt pass.
 * When `end` is set, the last edge into `end` is included in 2-opt scoring.
 */
function orderStops(
  pin: NormPoint,
  stops: Array<TourStopInput & { center: NormPoint }>,
  dist: (a: NormPoint, b: NormPoint) => number,
  end: NormPoint | null,
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

  // 2-opt: reverse segments that shorten pin→…→last(→end).
  const n = ordered.length
  if (n < 2) return ordered

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
        // Edges (i-1 → i) and (k → k+1|end) vs (i-1 → k) and (i → k+1|end)
        const a = pointAt(i - 1)
        const b = ordered[i].center
        const c = ordered[k].center
        const dPoint =
          k + 1 < n ? ordered[k + 1].center : end
        const before =
          dist(a, b) + (dPoint ? dist(c, dPoint) : 0)
        const after =
          dist(a, c) + (dPoint ? dist(b, dPoint) : 0)
        if (after + 1e-9 < before) {
          ordered.splice(i, k - i + 1, ...ordered.slice(i, k + 1).reverse())
          improved = true
        }
      }
    }
  }

  return ordered
}

function buildPathForOrder(
  pin: NormPoint,
  ordered: Array<TourStopInput & { center: NormPoint }>,
  end: NormPoint | null,
  boothRects: Rect[],
  obstacles: Rect[] | undefined,
  mapWidth: number,
  mapHeight: number,
): { path: NormPoint[]; usedStraightFallback: boolean } {
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

  if (end) {
    const { path, straight } = segmentPath(
      prev,
      end,
      boothRects,
      obstacles,
      mapWidth,
      mapHeight,
    )
    if (straight) usedStraightFallback = true
    segments.push(path)
  }

  return { path: concatPaths(segments), usedStraightFallback }
}

/**
 * Plan a single-map aisle tour: nearest-neighbor from My pin, then 2-opt,
 * concatenating `findAislePath` segments (straight-line fallback if A* fails).
 * Pass `orderedBoothIds` to keep a manual order (after remove/reorder).
 */
export function planTour(input: TourPlanInput): TourPlanResult {
  const {
    pin,
    stops,
    end = null,
    mapWidth,
    mapHeight,
    boothRects,
    obstacles,
    orderedBoothIds,
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

  if (!usable.length && !end) {
    return {
      orderedStops: [],
      path: [],
      skippedBoothIds,
      usedStraightFallback: false,
    }
  }

  let ordered: Array<TourStopInput & { center: NormPoint }>
  if (orderedBoothIds) {
    const byId = new Map(usable.map((s) => [s.boothId, s]))
    ordered = []
    for (const id of orderedBoothIds) {
      const stop = byId.get(id)
      if (stop) ordered.push(stop)
      else skippedBoothIds.push(id)
    }
  } else {
    const dist = makeDistanceFn(boothRects, obstacles, mapWidth, mapHeight)
    ordered = orderStops(pin, usable, dist, end)
  }

  if (!ordered.length && !end) {
    return {
      orderedStops: [],
      path: [],
      skippedBoothIds,
      usedStraightFallback: false,
    }
  }

  const { path, usedStraightFallback } = buildPathForOrder(
    pin,
    ordered,
    end,
    boothRects,
    obstacles,
    mapWidth,
    mapHeight,
  )

  const orderedStops: PlannedTourStop[] = ordered.map((s, i) => ({
    ...s,
    index: i + 1,
  }))

  return {
    orderedStops,
    path,
    skippedBoothIds,
    usedStraightFallback,
  }
}
