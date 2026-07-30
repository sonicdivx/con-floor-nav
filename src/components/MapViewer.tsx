import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { BoothRecord, Rect, VendorRecord, VisitStatus } from '../db/types'
import {
  boothHundred,
  computeRowHundredLabels,
  fitBoothLabelFontSize,
  formatRowHundredAbbrev,
  shouldAbbreviateRowHundreds,
} from '../lib/boothLabels'
import { findAislePath } from '../lib/pathfinding'
import { peerColor, type PartyPeer } from '../lib/partySocket'
import { STATUS_COLORS } from '../lib/statusColors'

export type MapMode = 'navigate' | 'edit' | 'pin'

interface Props {
  mapUrl: string | null
  mapWidth: number
  mapHeight: number
  booths: BoothRecord[]
  /** Extra blocked regions (pillars etc.). Empty / omitted = booths only. */
  obstacles?: Rect[]
  vendorsByBoothId: Map<number, VendorRecord>
  tagFilter: string | null
  selectedBoothId: number | null
  navTargetBoothId: number | null
  /** Navigate to an arbitrary map point (shared pin / peer). */
  navTargetPoint?: { x: number; y: number } | null
  pin: { x: number; y: number } | null
  mode: MapMode
  /** Other party members (exclude self client-side). */
  peerPins?: PartyPeer[]
  /** Bump nonce to fly the camera to a point. */
  focusRequest?: { x: number; y: number; nonce: number } | null
  onSelectBooth: (_boothId: number | null) => void
  onUpdateBoothRect: (boothId: number, rect: BoothRecord['rect']) => void
  onPinChange: (x: number, y: number) => void
  onNavigateBooth?: (boothId: number) => void
  onViewBoothDetails?: (boothId: number) => void
  onSelectPeer?: (peer: PartyPeer) => void
}

export function MapViewer({
  mapUrl,
  mapWidth,
  mapHeight,
  booths,
  obstacles = [],
  vendorsByBoothId,
  tagFilter,
  selectedBoothId,
  navTargetBoothId,
  navTargetPoint = null,
  pin,
  mode,
  peerPins = [],
  focusRequest = null,
  onSelectBooth: _onSelectBooth,
  onUpdateBoothRect,
  onPinChange,
  onNavigateBooth,
  onViewBoothDetails,
  onSelectPeer,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  /** Hover preview (pointer fine); tap sets pinned until dismissed. */
  const [hoverBoothId, setHoverBoothId] = useState<number | null>(null)
  const [pinnedBoothId, setPinnedBoothId] = useState<number | null>(null)
  const dragRef = useRef<{
    kind: 'pan' | 'booth' | 'pin' | 'resize'
    startX: number
    startY: number
    origTx: number
    origTy: number
    boothId?: number
    origRect?: BoothRecord['rect']
    handle?: 'se'
    moved?: boolean
  } | null>(null)
  /** Active pointers for one-finger pan / two-finger pinch. */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{
    dist0: number
    scale0: number
    worldX: number
    worldY: number
  } | null>(null)
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  /** Row-label tap pending; resolved on pointerup (capture steals click on touch). */
  const pendingRowZoomRef = useRef<{
    hundred: number
    x: number
    y: number
  } | null>(null)
  /** Booth tap pending when SVG hit-testing works; pointerup confirms. */
  const pendingBoothTapRef = useRef<{
    boothId: number
    x: number
    y: number
  } | null>(null)
  /** Long-press on pin in Browse to drag without entering Pin mode. */
  const pinLongPressRef = useRef<{
    pointerId: number
    x: number
    y: number
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const suppressClickRef = useRef(false)
  /** After a pin press that became a pan, skip booth hit-test on that release. */
  const suppressBoothTapRef = useRef(false)
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  transformRef.current = { scale, tx, ty }

  const TAP_SLOP = 14
  const LONG_PRESS_MS = 420
  const LONG_PRESS_MOVE_SLOP = 10

  const clearHoverClearTimer = () => {
    if (hoverClearTimerRef.current != null) {
      clearTimeout(hoverClearTimerRef.current)
      hoverClearTimerRef.current = null
    }
  }

  const clearPinLongPress = () => {
    const pending = pinLongPressRef.current
    if (!pending) return
    clearTimeout(pending.timer)
    pinLongPressRef.current = null
  }

  const scheduleHoverClear = (boothId: number) => {
    clearHoverClearTimer()
    hoverClearTimerRef.current = setTimeout(() => {
      setHoverBoothId((prev) =>
        prev === boothId && pinnedBoothId !== boothId ? null : prev,
      )
      hoverClearTimerRef.current = null
    }, 180)
  }

  const aspect = mapWidth > 0 && mapHeight > 0 ? mapWidth / mapHeight : 16 / 9

  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el || !mapWidth) return
    const pad = 16
    const availW = el.clientWidth - pad * 2
    const availH = el.clientHeight - pad * 2
    const s = Math.min(availW / mapWidth, availH / mapHeight)
    setScale(s)
    setTx((el.clientWidth - mapWidth * s) / 2)
    setTy((el.clientHeight - mapHeight * s) / 2)
  }, [mapWidth, mapHeight])

  useEffect(() => {
    fit()
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, mapUrl])

  useEffect(() => {
    if (mode !== 'navigate') {
      setHoverBoothId(null)
      setPinnedBoothId(null)
      clearPinLongPress()
    }
  }, [mode])

  useEffect(
    () => () => {
      const pending = pinLongPressRef.current
      if (pending) clearTimeout(pending.timer)
      pinLongPressRef.current = null
    },
    [],
  )

  const visibleBooths = useMemo(() => {
    if (!tagFilter) return booths
    return booths.filter((b) => {
      if (b.id == null) return false
      const v = vendorsByBoothId.get(b.id)
      return v?.tags.includes(tagFilter)
    })
  }, [booths, vendorsByBoothId, tagFilter])

  const { labels: rowLabels, band: rowBand } = useMemo(
    () => computeRowHundredLabels(visibleBooths, mapWidth, mapHeight),
    [visibleBooths, mapWidth, mapHeight],
  )

  const popoverBoothId = pinnedBoothId ?? hoverBoothId

  const popoverBooth = useMemo(() => {
    if (popoverBoothId == null) return null
    return booths.find((b) => b.id === popoverBoothId) ?? null
  }, [booths, popoverBoothId])

  const popoverVendor =
    popoverBoothId != null ? vendorsByBoothId.get(popoverBoothId) : undefined

  const popoverStyle = useMemo(() => {
    if (!popoverBooth) return null
    const cx =
      tx + (popoverBooth.rect.x + popoverBooth.rect.w / 2) * mapWidth * scale
    const top = ty + popoverBooth.rect.y * mapHeight * scale
    return {
      left: cx,
      top: Math.max(8, top - 8),
    }
  }, [popoverBooth, tx, ty, scale, mapWidth, mapHeight])

  const navPathD = useMemo(() => {
    if (!pin || mapWidth <= 0 || mapHeight <= 0) {
      return null
    }
    let goal: { x: number; y: number } | null = null
    if (navTargetBoothId != null) {
      const booth = booths.find((b) => b.id === navTargetBoothId)
      if (booth) {
        goal = {
          x: booth.rect.x + booth.rect.w / 2,
          y: booth.rect.y + booth.rect.h / 2,
        }
      }
    } else if (navTargetPoint) {
      goal = navTargetPoint
    }
    if (!goal) return null
    const computed = findAislePath({
      start: pin,
      goal,
      booths: booths.map((b) => b.rect),
      obstacles,
      mapWidth,
      mapHeight,
    })
    // Always draw something: A* can fail if pin/goal are boxed in; fall back to straight line.
    const path =
      computed && computed.length >= 2 ? computed : [pin, goal]
    return path
      .map((p, i) => {
        const x = p.x * mapWidth
        const y = p.y * mapHeight
        return `${i === 0 ? 'M' : 'L'}${x} ${y}`
      })
      .join(' ')
  }, [
    pin,
    navTargetBoothId,
    navTargetPoint,
    booths,
    obstacles,
    mapWidth,
    mapHeight,
  ])

  const clientToNorm = (clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const lx = clientX - rect.left
    const ly = clientY - rect.top
    const { scale: s, tx: txx, ty: tyy } = transformRef.current
    const ix = (lx - txx) / s
    const iy = (ly - tyy) / s
    return {
      x: Math.min(1, Math.max(0, ix / mapWidth)),
      y: Math.min(1, Math.max(0, iy / mapHeight)),
    }
  }

  /**
   * Hit-test booth rects in map space. Needed because CSS scale on .map-stage
   * can break SVG element hit-testing on touch (esp. when zoomed out).
   */
  const hitTestBooth = (clientX: number, clientY: number): number | null => {
    if (mapWidth <= 0 || mapHeight <= 0) return null
    const n = clientToNorm(clientX, clientY)
    // Top-most booth wins (later in list = drawn later).
    for (let i = visibleBooths.length - 1; i >= 0; i--) {
      const booth = visibleBooths[i]!
      if (booth.id == null) continue
      const { x, y, w, h } = booth.rect
      if (n.x >= x && n.x <= x + w && n.y >= y && n.y <= y + h) {
        return booth.id
      }
    }
    return null
  }

  /** Screen-stable pin hit radius in map pixels (matches transparent halo). */
  const pinHitRadiusMap = () => 22 / Math.max(transformRef.current.scale, 0.05)

  const hitTestPin = (clientX: number, clientY: number): boolean => {
    if (!pin || mapWidth <= 0 || mapHeight <= 0) return false
    const n = clientToNorm(clientX, clientY)
    const dx = (n.x - pin.x) * mapWidth
    const dy = (n.y - pin.y) * mapHeight
    const r = pinHitRadiusMap()
    return dx * dx + dy * dy <= r * r
  }

  const dismissPopover = () => {
    clearHoverClearTimer()
    setHoverBoothId(null)
    setPinnedBoothId(null)
  }

  const pinBoothPopover = (boothId: number) => {
    setPinnedBoothId((prev) => (prev === boothId ? null : boothId))
    setHoverBoothId(boothId)
  }

  /** Fit + center the booths in a hundred-row group (100, 200, …). */
  const zoomToRow = useCallback(
    (hundred: number) => {
      const el = containerRef.current
      if (!el || mapWidth <= 0 || mapHeight <= 0) return
      const group = booths.filter((b) => {
        const h = boothHundred(b.label || b.boothKey)
        return h === hundred
      })
      if (group.length === 0) return

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const b of group) {
        const x0 = b.rect.x * mapWidth
        const y0 = b.rect.y * mapHeight
        const x1 = (b.rect.x + b.rect.w) * mapWidth
        const y1 = (b.rect.y + b.rect.h) * mapHeight
        minX = Math.min(minX, x0)
        minY = Math.min(minY, y0)
        maxX = Math.max(maxX, x1)
        maxY = Math.max(maxY, y1)
      }

      const pad = 48
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      const availW = el.clientWidth - pad * 2
      const availH = el.clientHeight - pad * 2
      const next = Math.min(8, Math.max(0.2, Math.min(availW / bw, availH / bh)))
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      setScale(next)
      setTx(el.clientWidth / 2 - cx * next)
      setTy(el.clientHeight / 2 - cy * next)
      clearHoverClearTimer()
      setHoverBoothId(null)
      setPinnedBoothId(null)
    },
    [booths, mapWidth, mapHeight],
  )

  const focusPoint = useCallback(
    (nx: number, ny: number) => {
      const el = containerRef.current
      if (!el || mapWidth <= 0 || mapHeight <= 0) return
      const next = Math.min(4, Math.max(scale, 1.2))
      const cx = nx * mapWidth
      const cy = ny * mapHeight
      setScale(next)
      setTx(el.clientWidth / 2 - cx * next)
      setTy(el.clientHeight / 2 - cy * next)
    },
    [mapWidth, mapHeight, scale],
  )

  const lastFocusNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focusRequest) return
    if (lastFocusNonce.current === focusRequest.nonce) return
    lastFocusNonce.current = focusRequest.nonce
    focusPoint(focusRequest.x, focusRequest.y)
  }, [focusRequest, focusPoint])

  const beginPinch = () => {
    const pts = [...pointersRef.current.values()]
    if (pts.length < 2) return
    const a = pts[0]!
    const b = pts[1]!
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const midX = (a.x + b.x) / 2 - rect.left
    const midY = (a.y + b.y) / 2 - rect.top
    const { scale: s, tx: txx, ty: tyy } = transformRef.current
    pinchRef.current = {
      dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      scale0: s,
      worldX: (midX - txx) / s,
      worldY: (midY - tyy) / s,
    }
    dragRef.current = null
    pendingRowZoomRef.current = null
    pendingBoothTapRef.current = null
    clearPinLongPress()
    suppressClickRef.current = true
    suppressBoothTapRef.current = false
  }

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault()
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const next = Math.min(8, Math.max(0.2, scale * factor))
    const wx = (mx - tx) / scale
    const wy = (my - ty) / scale
    setScale(next)
    setTx(mx - wx * next)
    setTy(my - wy * next)
  }

  /** Capture-phase: track all fingers (including those that land on booths/labels). */
  const onPointerDownCapture = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as Element | null
    if (target?.closest?.('.map-fab-row, .booth-popover')) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (pointersRef.current.size >= 2) {
      beginPinch()
    }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    // Multitouch pinch owns the gesture.
    if (pointersRef.current.size >= 2 || pinchRef.current) return

    if (mode === 'pin') {
      const n = clientToNorm(e.clientX, e.clientY)
      onPinChange(n.x, n.y)
      dragRef.current = {
        kind: 'pin',
        startX: e.clientX,
        startY: e.clientY,
        origTx: tx,
        origTy: ty,
        moved: false,
      }
      return
    }

    // Zoom-safe pin hit when SVG pointer events miss under CSS scale.
    if (
      mode === 'navigate' &&
      hitTestPin(e.clientX, e.clientY) &&
      !pinLongPressRef.current
    ) {
      onPinPointerDown(e)
      return
    }

    dragRef.current = {
      kind: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      origTx: tx,
      origTy: ty,
      moved: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()]
      const a = pts[0]!
      const b = pts[1]!
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const midX = (a.x + b.x) / 2 - rect.left
      const midY = (a.y + b.y) / 2 - rect.top
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const p = pinchRef.current
      const next = Math.min(8, Math.max(0.2, p.scale0 * (dist / p.dist0)))
      setScale(next)
      setTx(midX - p.worldX * next)
      setTy(midY - p.worldY * next)
      return
    }

    // Cancel pin long-press if the finger moves before it fires.
    const pendingPin = pinLongPressRef.current
    if (pendingPin && pendingPin.pointerId === e.pointerId) {
      const moved = Math.hypot(e.clientX - pendingPin.x, e.clientY - pendingPin.y)
      if (moved > LONG_PRESS_MOVE_SLOP) {
        clearPinLongPress()
        // Convert to pan so Browse still scrolls if the press wasn't a hold.
        if (!dragRef.current) {
          const { tx: txx, ty: tyy } = transformRef.current
          dragRef.current = {
            kind: 'pan',
            startX: pendingPin.x,
            startY: pendingPin.y,
            origTx: txx,
            origTy: tyy,
            moved: true,
          }
        }
        // Avoid treating an aborted pin-hold as a booth tap on release.
        pendingBoothTapRef.current = null
        suppressBoothTapRef.current = true
      }
    }

    const d = dragRef.current
    if (!d) return
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
    if (dist > 4) d.moved = true
    if (d.kind === 'pan') {
      setTx(d.origTx + (e.clientX - d.startX))
      setTy(d.origTy + (e.clientY - d.startY))
    } else if (d.kind === 'pin') {
      const n = clientToNorm(e.clientX, e.clientY)
      onPinChange(n.x, n.y)
    } else if (d.kind === 'booth' && d.boothId != null && d.origRect) {
      const dx = (e.clientX - d.startX) / scale / mapWidth
      const dy = (e.clientY - d.startY) / scale / mapHeight
      onUpdateBoothRect(d.boothId, {
        ...d.origRect,
        x: Math.min(1 - d.origRect.w, Math.max(0, d.origRect.x + dx)),
        y: Math.min(1 - d.origRect.h, Math.max(0, d.origRect.y + dy)),
      })
    } else if (d.kind === 'resize' && d.boothId != null && d.origRect) {
      const dx = (e.clientX - d.startX) / scale / mapWidth
      const dy = (e.clientY - d.startY) / scale / mapHeight
      onUpdateBoothRect(d.boothId, {
        ...d.origRect,
        w: Math.min(1 - d.origRect.x, Math.max(0.008, d.origRect.w + dx)),
        h: Math.min(1 - d.origRect.y, Math.max(0.008, d.origRect.h + dy)),
      })
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    // Capture before clearing — short pin press should not hit-test a booth underneath.
    const pinPressAbandoned =
      pinLongPressRef.current?.pointerId === e.pointerId
    if (pinPressAbandoned) {
      clearPinLongPress()
    }

    if (pointersRef.current.size >= 2) {
      beginPinch()
      return
    }

    if (pointersRef.current.size === 1) {
      // Hand off to one-finger pan from current transform (no jump).
      pinchRef.current = null
      pendingRowZoomRef.current = null
      pendingBoothTapRef.current = null
      clearPinLongPress()
      const remaining = [...pointersRef.current.values()][0]!
      const { tx: txx, ty: tyy } = transformRef.current
      dragRef.current = {
        kind: 'pan',
        startX: remaining.x,
        startY: remaining.y,
        origTx: txx,
        origTy: tyy,
        moved: true,
      }
      return
    }

    pinchRef.current = null
    const pendingRow = pendingRowZoomRef.current
    pendingRowZoomRef.current = null
    const pendingBooth = pendingBoothTapRef.current
    pendingBoothTapRef.current = null

    // Label taps use pointerup — container capture redirects click away on touch.
    if (pendingRow) {
      const slop = Math.hypot(e.clientX - pendingRow.x, e.clientY - pendingRow.y)
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        dragRef.current = null
        return
      }
      if (slop <= TAP_SLOP) {
        zoomToRow(pendingRow.hundred)
      }
      dragRef.current = null
      return
    }

    const d = dragRef.current
    dragRef.current = null

    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    // Pin drag / edit booth drag — don't treat as booth tap.
    if (d && d.kind !== 'pan') {
      return
    }

    const tapDist = d
      ? Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      : 0
    const wasTap = !d || tapDist <= TAP_SLOP

    // Short press on pin, or pin-hold that became a pan: don't open a booth.
    if (pinPressAbandoned || suppressBoothTapRef.current) {
      suppressBoothTapRef.current = false
      if (!wasTap) dismissPopover()
      return
    }

    if (!wasTap) {
      dismissPopover()
      return
    }

    // Browse: resolve booth by pending target or map-space hit-test (zoom-safe).
    if (mode === 'navigate') {
      let boothId: number | null = null
      if (pendingBooth) {
        const slop = Math.hypot(e.clientX - pendingBooth.x, e.clientY - pendingBooth.y)
        if (slop <= TAP_SLOP) boothId = pendingBooth.boothId
      }
      if (boothId == null) {
        boothId = hitTestBooth(e.clientX, e.clientY)
      }
      if (boothId != null) {
        pinBoothPopover(boothId)
        return
      }
    }

    dismissPopover()
  }

  const startBoothDrag = (
    e: ReactPointerEvent,
    booth: BoothRecord,
    kind: 'booth' | 'resize',
  ) => {
    if (mode !== 'edit' || booth.id == null) return
    if (pointersRef.current.size >= 2 || pinchRef.current) return
    e.stopPropagation()
    e.preventDefault()
    clearPinLongPress()
    pendingBoothTapRef.current = null
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      origTx: tx,
      origTy: ty,
      boothId: booth.id,
      origRect: { ...booth.rect },
      handle: 'se',
      moved: false,
    }
  }

  const statusFor = (boothId: number | undefined): VisitStatus => {
    if (boothId == null) return 'none'
    return vendorsByBoothId.get(boothId)?.visitStatus ?? 'none'
  }

  /** Browse: queue booth tap; confirm on pointerup (zoom-safe + touch capture). */
  const onBoothPointerDown = (boothId: number, e: ReactPointerEvent) => {
    if (pointersRef.current.size >= 2 || pinchRef.current) return
    if (mode === 'edit') return
    if (mode !== 'navigate') return
    clearPinLongPress()
    pendingBoothTapRef.current = {
      boothId,
      x: e.clientX,
      y: e.clientY,
    }
    // Do not stopPropagation — let pan start so drag-from-booth still scrolls;
    // pointerup uses wasTap + hit-test / pendingBooth for the popover.
  }

  const startPinDrag = (e: ReactPointerEvent) => {
    clearPinLongPress()
    pendingBoothTapRef.current = null
    pendingRowZoomRef.current = null
    dragRef.current = {
      kind: 'pin',
      startX: e.clientX,
      startY: e.clientY,
      origTx: transformRef.current.tx,
      origTy: transformRef.current.ty,
      moved: false,
    }
  }

  const onPinPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    // Never steal multitouch / pinch.
    if (pointersRef.current.size >= 2 || pinchRef.current) return
    e.stopPropagation()
    e.preventDefault()
    pendingBoothTapRef.current = null

    if (mode === 'pin') {
      startPinDrag(e)
      return
    }

    if (mode !== 'navigate') return

    // Browse: press-and-hold to move the pin (short tap does nothing).
    clearPinLongPress()
    const pointerId = e.pointerId
    const x = e.clientX
    const y = e.clientY
    pinLongPressRef.current = {
      pointerId,
      x,
      y,
      timer: setTimeout(() => {
        if (pinLongPressRef.current?.pointerId !== pointerId) return
        if (pointersRef.current.size !== 1 || pinchRef.current) {
          clearPinLongPress()
          return
        }
        pinLongPressRef.current = null
        dragRef.current = {
          kind: 'pin',
          startX: x,
          startY: y,
          origTx: transformRef.current.tx,
          origTy: transformRef.current.ty,
          moved: false,
        }
      }, LONG_PRESS_MS),
    }
  }

  const onRowLabelPointerDown = (hundred: number, e: ReactPointerEvent) => {
    // Prevent map pan; keep capture-phase pinch tracking.
    e.stopPropagation()
    if (pointersRef.current.size >= 2 || pinchRef.current) {
      pendingRowZoomRef.current = null
      return
    }
    clearPinLongPress()
    pendingBoothTapRef.current = null
    pendingRowZoomRef.current = {
      hundred,
      x: e.clientX,
      y: e.clientY,
    }
  }

  const onRowLabelKeyActivate = (hundred: number, e: SyntheticEvent) => {
    e.stopPropagation()
    e.preventDefault()
    zoomToRow(hundred)
  }

  // Screen-stable size: SVG sits inside a CSS-scaled stage, so map-units = screenPx / scale.
  // (Using min(scale, …) inverted the zoom — labels grew when zooming in.)
  const rowLabelFont = 16 / Math.max(scale, 0.08)
  const abbreviateRowLabels = shouldAbbreviateRowHundreds(
    rowLabels,
    scale,
    16, // screen-px for gap heuristic, not map-units
  )

  return (
    <div
      ref={containerRef}
      className="map-viewer"
      onWheel={onWheel}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {!mapUrl ? (
        <div className="map-empty">
          <p>No floor map yet</p>
          <p className="muted">Import a map image in Setup to get started.</p>
        </div>
      ) : (
        <div
          className="map-stage"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            width: mapWidth,
            height: mapHeight,
            aspectRatio: aspect,
          }}
        >
          <img
            src={mapUrl}
            alt="Floor map"
            draggable={false}
            className="map-image"
            width={mapWidth}
            height={mapHeight}
          />
          <svg
            className="map-overlay"
            viewBox={`0 0 ${mapWidth} ${mapHeight}`}
            width={mapWidth}
            height={mapHeight}
          >
            {obstacles.map((obs, i) => (
              <rect
                key={`obstacle-${i}`}
                x={obs.x * mapWidth}
                y={obs.y * mapHeight}
                width={obs.w * mapWidth}
                height={obs.h * mapHeight}
                fill="rgba(20, 24, 32, 0.35)"
                stroke="rgba(180, 40, 40, 0.45)"
                strokeWidth={1 / scale}
                rx={1 / scale}
                pointerEvents="none"
              />
            ))}
            {rowBand && (
              <rect
                className="row-hundred-band"
                x={rowBand.x}
                y={rowBand.y}
                width={rowBand.width}
                height={rowBand.height}
                rx={Math.min(4, rowBand.height * 0.2) / Math.max(scale, 0.35)}
                strokeWidth={1.25 / Math.max(scale, 0.35)}
                pointerEvents="none"
              />
            )}
            {rowLabels.map((row) => {
              const labelText = abbreviateRowLabels
                ? formatRowHundredAbbrev(row.hundred)
                : row.text
              const hitW =
                Math.max(
                  16 * (abbreviateRowLabels ? 1.5 : 2.6),
                  abbreviateRowLabels ? 20 : 32,
                ) / Math.max(scale, 0.08)
              const hitH = Math.max(16 * 1.4, 20) / Math.max(scale, 0.08)
              return (
                <g
                  key={`row-${row.hundred}`}
                  className="row-hundred-label"
                  role="button"
                  tabIndex={0}
                  data-hundred={row.hundred}
                  aria-label={`Zoom to section ${row.hundred}`}
                  onPointerDown={(e) => onRowLabelPointerDown(row.hundred, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onRowLabelKeyActivate(row.hundred, e)
                    }
                  }}
                >
                  <rect
                    className="row-hundred-hit"
                    x={row.x - hitW / 2}
                    y={row.y - hitH / 2}
                    width={hitW}
                    height={hitH}
                    rx={2 / scale}
                  />
                  <text
                    className="row-hundred-text"
                    x={row.x}
                    y={row.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={rowLabelFont}
                    fontWeight={800}
                    letterSpacing={abbreviateRowLabels ? 0 : 0.4}
                    strokeWidth={Math.max(1.5, 2.5 / Math.max(scale, 0.35))}
                  >
                    {labelText}
                  </text>
                </g>
              )
            })}
            {visibleBooths.map((booth) => {
              if (booth.id == null) return null
              const status = statusFor(booth.id)
              const color = STATUS_COLORS[status]
              const selected = selectedBoothId === booth.id
              const isNav = navTargetBoothId === booth.id
              const isPopover = popoverBoothId === booth.id
              const x = booth.rect.x * mapWidth
              const y = booth.rect.y * mapHeight
              const w = booth.rect.w * mapWidth
              const h = booth.rect.h * mapHeight
              const label = booth.label
              const fontSize = fitBoothLabelFontSize(label, w, h)
              const clipId = `booth-clip-${booth.id}`
              return (
                <g key={booth.id}>
                  <defs>
                    <clipPath id={clipId}>
                      <rect x={x} y={y} width={w} height={h} rx={2 / scale} />
                    </clipPath>
                  </defs>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={color}
                    fillOpacity={selected || isNav || isPopover ? 0.55 : 0.35}
                    stroke={
                      isNav || isPopover ? '#fff' : selected ? '#fff' : color
                    }
                    strokeWidth={(selected || isNav || isPopover ? 3 : 1.5) / scale}
                    rx={2 / scale}
                    style={{ cursor: mode === 'edit' ? 'move' : 'pointer' }}
                    pointerEvents="all"
                    onPointerDown={(e) => {
                      if (mode === 'edit') startBoothDrag(e, booth, 'booth')
                      else onBoothPointerDown(booth.id!, e)
                    }}
                    onPointerEnter={() => {
                      if (mode !== 'navigate') return
                      if (window.matchMedia('(hover: hover)').matches) {
                        clearHoverClearTimer()
                        setHoverBoothId(booth.id!)
                      }
                    }}
                    onPointerLeave={() => {
                      if (mode !== 'navigate') return
                      scheduleHoverClear(booth.id!)
                    }}
                  />
                  <g clipPath={`url(#${clipId})`} pointerEvents="none">
                    <text
                      x={x + w / 2}
                      y={y + h / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      fontSize={fontSize}
                      fontWeight={600}
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,.6)' }}
                    >
                      {label}
                    </text>
                  </g>
                  {mode === 'edit' && selected && (
                    <rect
                      x={x + w - 10 / scale}
                      y={y + h - 10 / scale}
                      width={12 / scale}
                      height={12 / scale}
                      fill="#fff"
                      stroke="#1a1f2e"
                      strokeWidth={1 / scale}
                      style={{ cursor: 'nwse-resize' }}
                      onPointerDown={(e) => startBoothDrag(e, booth, 'resize')}
                    />
                  )}
                </g>
              )
            })}
            {navPathD && (
              <path
                className="nav-line"
                d={navPathD}
                fill="none"
                stroke="#ff6b4a"
                strokeWidth={Math.max(3, 4 / scale)}
                strokeDasharray={`${10 / scale} ${7 / scale}`}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.95}
                pointerEvents="none"
              />
            )}
            {peerPins.map((peer) => {
              const color = peerColor(peer.id || peer.name)
              return (
                <g
                  key={peer.id}
                  className="peer-pin"
                  transform={`translate(${peer.x * mapWidth}, ${peer.y * mapHeight})`}
                  style={{ cursor: onSelectPeer ? 'pointer' : 'default' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectPeer?.(peer)
                  }}
                >
                  <circle r={16 / scale} fill={color} fillOpacity={0.25} />
                  <circle
                    r={8 / scale}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={2 / scale}
                  />
                  <text
                    y={-12 / scale}
                    textAnchor="middle"
                    fontSize={11 / scale}
                    fontWeight={700}
                    fill={color}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth={2 / scale}
                    paintOrder="stroke"
                    style={{ pointerEvents: 'none' }}
                  >
                    {peer.name.slice(0, 12)}
                  </text>
                </g>
              )
            })}
            {pin && (
              <g
                transform={`translate(${pin.x * mapWidth}, ${pin.y * mapHeight})`}
                style={{
                  cursor:
                    mode === 'pin' || mode === 'navigate' ? 'grab' : 'default',
                }}
                onPointerDown={onPinPointerDown}
              >
                {/* Larger touch target; visuals stay screen-stable via /scale. */}
                <circle r={pinHitRadiusMap()} fill="transparent" pointerEvents="all" />
                <circle
                  r={14 / scale}
                  fill="#ff6b4a"
                  fillOpacity={0.25}
                  pointerEvents="none"
                />
                <circle
                  r={7 / scale}
                  fill="#ff6b4a"
                  stroke="#fff"
                  strokeWidth={2 / scale}
                  pointerEvents="none"
                />
              </g>
            )}
          </svg>
        </div>
      )}

      {mode === 'navigate' && popoverBooth && popoverStyle && (
        <div
          className="booth-popover"
          style={{
            left: popoverStyle.left,
            top: popoverStyle.top,
          }}
          role="dialog"
          aria-label={`Booth ${popoverBooth.label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => {
            clearHoverClearTimer()
            if (popoverBooth.id != null) setHoverBoothId(popoverBooth.id)
          }}
          onPointerLeave={() => {
            if (popoverBooth.id != null && pinnedBoothId !== popoverBooth.id) {
              scheduleHoverClear(popoverBooth.id)
            }
          }}
        >
          <p className="booth-popover-booth">Booth {popoverBooth.label}</p>
          <p className="booth-popover-name">
            {popoverVendor?.name ??
              popoverBooth.nameOverride ??
              'No vendor listed'}
          </p>
          <div className="booth-popover-actions">
            <button
              type="button"
              className="btn primary sm"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                const id = popoverBooth.id!
                onNavigateBooth?.(id)
                dismissPopover()
              }}
            >
              Navigate
            </button>
            <button
              type="button"
              className="btn secondary sm"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                const id = popoverBooth.id!
                onViewBoothDetails?.(id)
                dismissPopover()
              }}
            >
              View details
            </button>
          </div>
        </div>
      )}

      <div className="map-fab-row">
        {rowLabels.length > 0 && (
          <select
            className="map-section-select"
            aria-label="Zoom to section"
            defaultValue=""
            onChange={(e) => {
              const value = Number(e.target.value)
              if (Number.isFinite(value) && value > 0) zoomToRow(value)
              e.target.value = ''
            }}
          >
            <option value="" disabled>
              Section…
            </option>
            {rowLabels.map((row) => (
              <option key={row.hundred} value={row.hundred}>
                {row.hundred}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn secondary sm map-fit-btn" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  )
}
