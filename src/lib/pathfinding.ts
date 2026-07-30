import type { Rect } from '../db/types'

/** Normalized 0–1 map coordinates */
export type NormPoint = { x: number; y: number }

export interface PathfindingInput {
  start: NormPoint
  goal: NormPoint
  /** Booth rectangles (normalized) — impassable */
  booths: Rect[]
  /** Extra obstacles e.g. pillars (normalized). Empty = booths only. */
  obstacles?: Rect[]
  /** Map pixel size — used so grid cells are roughly square in image space */
  mapWidth: number
  mapHeight: number
  /**
   * Cells along the longer map axis. Higher = tighter aisles, slower.
   * Default ~160 is enough for Otakon-scale booths.
   */
  resolution?: number
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  b: Rect,
): boolean {
  return !(ax + aw <= b.x || b.x + b.w <= ax || ay + ah <= b.y || b.y + b.h <= ay)
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Binary min-heap keyed by `f` (A* f-score). */
class MinHeap {
  private data: { i: number; f: number }[] = []

  get size() {
    return this.data.length
  }

  push(i: number, f: number) {
    const d = this.data
    d.push({ i, f })
    let ci = d.length - 1
    while (ci > 0) {
      const pi = (ci - 1) >> 1
      if (d[pi].f <= d[ci].f) break
      ;[d[pi], d[ci]] = [d[ci], d[pi]]
      ci = pi
    }
  }

  pop(): number | undefined {
    const d = this.data
    if (!d.length) return undefined
    const top = d[0].i
    const last = d.pop()!
    if (d.length) {
      d[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let smallest = i
        if (l < d.length && d[l].f < d[smallest].f) smallest = l
        if (r < d.length && d[r].f < d[smallest].f) smallest = r
        if (smallest === i) break
        ;[d[i], d[smallest]] = [d[smallest], d[i]]
        i = smallest
      }
    }
    return top
  }
}

function buildBlockedGrid(
  cols: number,
  rows: number,
  blockers: Rect[],
): Uint8Array {
  const blocked = new Uint8Array(cols * rows)
  const cw = 1 / cols
  const ch = 1 / rows
  for (const rect of blockers) {
    const x0 = Math.max(0, Math.floor(rect.x * cols))
    const x1 = Math.min(cols - 1, Math.floor((rect.x + rect.w) * cols))
    const y0 = Math.max(0, Math.floor(rect.y * rows))
    const y1 = Math.min(rows - 1, Math.floor((rect.y + rect.h) * rows))
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (rectsOverlap(gx * cw, gy * ch, cw, ch, rect)) {
          blocked[gy * cols + gx] = 1
        }
      }
    }
  }
  return blocked
}

function cellCenter(gx: number, gy: number, cols: number, rows: number): NormPoint {
  return {
    x: (gx + 0.5) / cols,
    y: (gy + 0.5) / rows,
  }
}

function toCell(p: NormPoint, cols: number, rows: number): { gx: number; gy: number } {
  return {
    gx: Math.min(cols - 1, Math.max(0, Math.floor(p.x * cols))),
    gy: Math.min(rows - 1, Math.max(0, Math.floor(p.y * rows))),
  }
}

/** Nearest walkable cell (BFS). Returns null if none. */
function nearestWalkable(
  gx: number,
  gy: number,
  cols: number,
  rows: number,
  blocked: Uint8Array,
): { gx: number; gy: number } | null {
  const start = gy * cols + gx
  if (!blocked[start]) return { gx, gy }

  const visited = new Uint8Array(cols * rows)
  const q: number[] = [start]
  visited[start] = 1
  let qi = 0
  const dirs = [1, -1, cols, -cols]

  while (qi < q.length) {
    const cur = q[qi++]
    const cx = cur % cols
    const cy = (cur / cols) | 0
    for (const d of dirs) {
      const n = cur + d
      if (n < 0 || n >= blocked.length) continue
      const nx = n % cols
      const ny = (n / cols) | 0
      // reject wrap on horizontal moves
      if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue
      if (visited[n]) continue
      visited[n] = 1
      if (!blocked[n]) return { gx: nx, gy: ny }
      q.push(n)
    }
  }
  return null
}

const SQRT2 = Math.SQRT2

/**
 * Grid A* aisle path in normalized map space.
 * Booths + optional obstacles block cells; start/goal snap to nearest aisle.
 * Returns polyline including the true start and goal, or null if unreachable.
 */
export function findAislePath(input: PathfindingInput): NormPoint[] | null {
  const {
    start,
    goal,
    booths,
    obstacles = [],
    mapWidth,
    mapHeight,
    resolution = 160,
  } = input

  if (mapWidth <= 0 || mapHeight <= 0) return null

  const longer = Math.max(mapWidth, mapHeight)
  const cols =
    mapWidth >= mapHeight
      ? resolution
      : Math.max(8, Math.round(resolution * (mapWidth / longer)))
  const rows =
    mapHeight >= mapWidth
      ? resolution
      : Math.max(8, Math.round(resolution * (mapHeight / longer)))

  const blockers = [...booths, ...obstacles]
  const blocked = buildBlockedGrid(cols, rows, blockers)

  const startCell = toCell(start, cols, rows)
  const goalCell = toCell(goal, cols, rows)
  const sWalk = nearestWalkable(startCell.gx, startCell.gy, cols, rows, blocked)
  const gWalk = nearestWalkable(goalCell.gx, goalCell.gy, cols, rows, blocked)
  if (!sWalk || !gWalk) return null

  const startIdx = sWalk.gy * cols + sWalk.gx
  const goalIdx = gWalk.gy * cols + gWalk.gx

  if (startIdx === goalIdx) {
    return [
      { x: clamp01(start.x), y: clamp01(start.y) },
      { x: clamp01(goal.x), y: clamp01(goal.y) },
    ]
  }

  const open = new MinHeap()
  const gScore = new Float64Array(cols * rows)
  gScore.fill(Infinity)
  const cameFrom = new Int32Array(cols * rows)
  cameFrom.fill(-1)
  const closed = new Uint8Array(cols * rows)

  const heuristic = (idx: number) => {
    const x = idx % cols
    const y = (idx / cols) | 0
    const dx = Math.abs(x - gWalk.gx)
    const dy = Math.abs(y - gWalk.gy)
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)
  }

  gScore[startIdx] = 0
  open.push(startIdx, heuristic(startIdx))

  // 8-connected
  const neighbors: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2],
  ]

  let found = false
  while (open.size) {
    const current = open.pop()!
    if (closed[current]) continue
    if (current === goalIdx) {
      found = true
      break
    }
    closed[current] = 1

    const cx = current % cols
    const cy = (current / cols) | 0
    const baseG = gScore[current]

    for (const [dx, dy, cost] of neighbors) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      // No corner-cutting through blocked cells
      if (dx !== 0 && dy !== 0) {
        if (blocked[cy * cols + nx] || blocked[ny * cols + cx]) continue
      }
      const ni = ny * cols + nx
      if (blocked[ni] || closed[ni]) continue
      const tentative = baseG + cost
      if (tentative >= gScore[ni]) continue
      cameFrom[ni] = current
      gScore[ni] = tentative
      open.push(ni, tentative + heuristic(ni))
    }
  }

  if (!found) return null

  const cells: { gx: number; gy: number }[] = []
  for (let cur = goalIdx; cur !== -1; cur = cameFrom[cur]) {
    cells.push({ gx: cur % cols, gy: (cur / cols) | 0 })
    if (cur === startIdx) break
  }
  cells.reverse()

  const path: NormPoint[] = [
    { x: clamp01(start.x), y: clamp01(start.y) },
  ]
  for (const c of cells) {
    path.push(cellCenter(c.gx, c.gy, cols, rows))
  }
  path.push({ x: clamp01(goal.x), y: clamp01(goal.y) })

  return simplifyPath(path)
}

/** Drop near-collinear intermediate points for a cleaner dashed stroke. */
function simplifyPath(points: NormPoint[], epsilon = 0.0015): NormPoint[] {
  if (points.length <= 2) return points

  const out: NormPoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1]
    const b = points[i]
    const c = points[i + 1]
    const cross =
      Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    if (ab < epsilon || cross / Math.max(ab, 1e-9) < epsilon) continue
    out.push(b)
  }
  out.push(points[points.length - 1])
  return out
}
