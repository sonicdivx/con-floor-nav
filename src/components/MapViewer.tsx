import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react'
import { PiPushPinFill, PiPushPinLight } from 'react-icons/pi'
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
  onModeChange?: (mode: MapMode) => void
  onNavigateBooth?: (boothId: number) => void
  onViewBoothDetails?: (boothId: number) => void
  onSelectPeer?: (peer: PartyPeer) => void
  /** Empty-map tap (e.g. close unpinned details). */
  onMapBackgroundTap?: () => void
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
  onSelectBooth,
  onUpdateBoothRect,
  onPinChange,
  onModeChange,
  onNavigateBooth,
  onViewBoothDetails,
  onSelectPeer,
  onMapBackgroundTap,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  /** Hover preview (pointer fine); tap sets pinned until dismissed. */
  const [hoverBoothId, setHoverBoothId] = useState<number | null>(null)
  const [pinnedBoothId, setPinnedBoothId] = useState<number | null>(null)
  /** Live pin position while dragging — commit to parent only on drop. */
  const [dragPin, setDragPin] = useState<{ x: number; y: number } | null>(null)
  const dragPinRef = useRef<{ x: number; y: number } | null>(null)
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
  /** Press-and-hold on the pin icon (My pin mode) to start dragging. */
  const pinHoldRef = useRef<{
    pointerId: number
    x: number
    y: number
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  /** Skip tap-to-place when the gesture started on the pin icon. */
  const suppressPinPlaceRef = useRef(false)
  const suppressClickRef = useRef(false)
  /** After pin drag, skip booth hit-test on that release. */
  const suppressBoothTapRef = useRef(false)
  /**
   * Popover/UI actions: ignore the following map pointerup so it doesn't
   * treat the release as a background tap (which was closing View details).
   */
  const suppressNextMapTapRef = useRef(false)
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  transformRef.current = { scale, tx, ty }

  const TAP_SLOP = 14
  const PIN_HOLD_MS = 380
  const PIN_HOLD_MOVE_SLOP = 10

  const clearHoverClearTimer = () => {
    if (hoverClearTimerRef.current != null) {
      clearTimeout(hoverClearTimerRef.current)
      hoverClearTimerRef.current = null
    }
  }

  const clearPinHold = () => {
    const pending = pinHoldRef.current
    if (!pending) return
    clearTimeout(pending.timer)
    pinHoldRef.current = null
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
    // Re-fit after rotate; avoid visualViewport.resize (fires for keyboard and shifts map).
    const onOrientation = () => {
      fit()
      window.setTimeout(fit, 50)
      window.setTimeout(fit, 250)
    }
    window.addEventListener('orientationchange', onOrientation)
    const t = window.setTimeout(fit, 350)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
      window.removeEventListener('orientationchange', onOrientation)
    }
  }, [fit, mapUrl])

  useEffect(() => {
    if (mode !== 'navigate') {
      setHoverBoothId(null)
      setPinnedBoothId(null)
    }
    if (mode !== 'pin') {
      clearPinHold()
      suppressPinPlaceRef.current = false
    }
  }, [mode])

  useEffect(
    () => () => {
      clearPinHold()
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
    }
    if (!goal && navTargetPoint) {
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
    clearPinHold()
    suppressClickRef.current = true
    suppressBoothTapRef.current = false
  }

  // Non-passive wheel so preventDefault actually works (React 17+ passive wheel).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const { scale: s, tx: txx, ty: tyy } = transformRef.current
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const next = Math.min(8, Math.max(0.2, s * factor))
      const wx = (mx - txx) / s
      const wy = (my - tyy) / s
      setScale(next)
      setTx(mx - wx * next)
      setTy(my - wy * next)
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [])

  const displayPin = dragPin ?? pin

  const updateDragPin = (x: number, y: number) => {
    const next = { x, y }
    dragPinRef.current = next
    setDragPin(next)
  }

  const commitDragPin = () => {
    const final = dragPinRef.current
    dragPinRef.current = null
    setDragPin(null)
    if (final) onPinChange(final.x, final.y)
  }

  /** Capture-phase: track all fingers (including those that land on booths/labels). */
  const onPointerDownCapture = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as Element | null
    // Don't capture UI chrome — popover/panel buttons must own their gesture.
    if (
      target?.closest?.(
        '.map-fab-row, .booth-popover, .vendor-panel, button, select, input, textarea, a',
      )
    ) {
      return
    }
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

  const placePinAtClient = (clientX: number, clientY: number) => {
    const n = clientToNorm(clientX, clientY)
    dragPinRef.current = null
    setDragPin(null)
    onPinChange(n.x, n.y)
  }

  const isMapChrome = (target: EventTarget | null) => {
    const el = target as Element | null
    return Boolean(
      el?.closest?.(
        '.map-fab-row, .booth-popover, .vendor-panel, .booth-edit-bar, .map-fullscreen-bar',
      ),
    )
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    // Multitouch pinch owns the gesture.
    if (pointersRef.current.size >= 2 || pinchRef.current) return
    // FAB / panels: don't start pan or treat as tap-to-place (My pin toggle lives here).
    if (isMapChrome(e.target)) {
      suppressPinPlaceRef.current = true
      dragRef.current = null
      return
    }

    // My pin mode: pan/zoom normally; a tap places the pin (see pointerup).
    // Dragging the pin requires press-and-hold on the pin icon.
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

    // Cancel press-and-hold on the pin if the finger moves before it engages.
    const pendingHold = pinHoldRef.current
    if (pendingHold && pendingHold.pointerId === e.pointerId) {
      const moved = Math.hypot(e.clientX - pendingHold.x, e.clientY - pendingHold.y)
      if (moved > PIN_HOLD_MOVE_SLOP) {
        clearPinHold()
        if (!dragRef.current) {
          const { tx: txx, ty: tyy } = transformRef.current
          dragRef.current = {
            kind: 'pan',
            startX: pendingHold.x,
            startY: pendingHold.y,
            origTx: txx,
            origTy: tyy,
            moved: true,
          }
        }
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
      updateDragPin(n.x, n.y)
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

    // Popover Navigate / View details: ignore this release on the map.
    if (suppressNextMapTapRef.current) {
      suppressNextMapTapRef.current = false
      dragRef.current = null
      pendingBoothTapRef.current = null
      pendingRowZoomRef.current = null
      clearPinHold()
      pinchRef.current = null
      return
    }

    const pinHoldAbandoned =
      pinHoldRef.current?.pointerId === e.pointerId
    if (pinHoldAbandoned) {
      clearPinHold()
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
      clearPinHold()
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

    if (d?.kind === 'pin') {
      commitDragPin()
      suppressBoothTapRef.current = true
      suppressPinPlaceRef.current = false
      return
    }

    if (suppressClickRef.current) {
      suppressClickRef.current = false
      suppressPinPlaceRef.current = false
      return
    }

    // Pin drag / edit booth drag — don't treat as booth tap.
    if (d && d.kind !== 'pan') {
      suppressPinPlaceRef.current = false
      return
    }

    const tapDist = d
      ? Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      : 0
    const wasTap = !d || tapDist <= TAP_SLOP

    if (suppressBoothTapRef.current || pinHoldAbandoned) {
      suppressBoothTapRef.current = false
      suppressPinPlaceRef.current = false
      if (!wasTap) dismissPopover()
      return
    }

    if (!wasTap) {
      suppressPinPlaceRef.current = false
      dismissPopover()
      return
    }

    // My pin: tap anywhere (when zoomed away from the pin) to drop it there.
    if (mode === 'pin') {
      if (!suppressPinPlaceRef.current && !isMapChrome(e.target)) {
        const x = d?.startX ?? e.clientX
        const y = d?.startY ?? e.clientY
        placePinAtClient(x, y)
      }
      suppressPinPlaceRef.current = false
      return
    }
    suppressPinPlaceRef.current = false

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
        // Details already open (esp. when keep-open is filled): switch panel to this booth.
        if (selectedBoothId != null) onSelectBooth(boothId)
        return
      }
    }

    dismissPopover()
    onMapBackgroundTap?.()
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
    pendingBoothTapRef.current = null
    onSelectBooth(booth.id)
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
    pendingBoothTapRef.current = {
      boothId,
      x: e.clientX,
      y: e.clientY,
    }
    // Do not stopPropagation — let pan start so drag-from-booth still scrolls;
    // pointerup uses wasTap + hit-test / pendingBooth for the popover.
  }

  const startPinDrag = (clientX: number, clientY: number) => {
    pendingBoothTapRef.current = null
    pendingRowZoomRef.current = null
    const base = dragPinRef.current ?? pin
    if (base) updateDragPin(base.x, base.y)
    dragRef.current = {
      kind: 'pin',
      startX: clientX,
      startY: clientY,
      origTx: transformRef.current.tx,
      origTy: transformRef.current.ty,
      moved: false,
    }
  }

  const onPinPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    if (mode !== 'pin') return
    // Never steal multitouch / pinch.
    if (pointersRef.current.size >= 2 || pinchRef.current) return
    e.stopPropagation()
    e.preventDefault()
    pendingBoothTapRef.current = null
    // Don't treat release on the icon as "tap map to place".
    suppressPinPlaceRef.current = true
    clearPinHold()
    const pointerId = e.pointerId
    const x = e.clientX
    const y = e.clientY
    pinHoldRef.current = {
      pointerId,
      x,
      y,
      timer: setTimeout(() => {
        if (pinHoldRef.current?.pointerId !== pointerId) return
        if (pointersRef.current.size !== 1 || pinchRef.current) {
          clearPinHold()
          return
        }
        pinHoldRef.current = null
        startPinDrag(x, y)
      }, PIN_HOLD_MS),
    }
  }

  const onRowLabelPointerDown = (hundred: number, e: ReactPointerEvent) => {
    // Prevent map pan; keep capture-phase pinch tracking.
    e.stopPropagation()
    if (pointersRef.current.size >= 2 || pinchRef.current) {
      pendingRowZoomRef.current = null
      return
    }
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

  // Screen-stable section chrome: CSS scale on .map-stage multiplies SVG units,
  // so draw in a local inverse-scale group with fixed font/band sizes.
  const invScale = 1 / Math.max(scale, 0.08)
  const sectionFontPx = 15
  const sectionBandH = 26
  const abbreviateRowLabels = shouldAbbreviateRowHundreds(
    rowLabels,
    scale,
    sectionFontPx,
  )
  const sectionBandCenterY = rowBand
    ? rowBand.y + rowBand.height / 2
    : null

  return (
    <div
      ref={containerRef}
      className="map-viewer"
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {!mapUrl ? (
        <div className="map-empty">
          <p>No floor map yet</p>
          <p className="muted">Import a map image in Settings to get started.</p>
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
            {rowBand && sectionBandCenterY != null && (
              <rect
                className="row-hundred-band"
                x={rowBand.x}
                y={sectionBandCenterY - (sectionBandH * invScale) / 2}
                width={rowBand.width}
                height={sectionBandH * invScale}
                rx={4 * invScale}
                strokeWidth={1.25 * invScale}
                pointerEvents="none"
              />
            )}
            {rowLabels.map((row) => {
              const labelText = abbreviateRowLabels
                ? formatRowHundredAbbrev(row.hundred)
                : row.text
              const hitW = Math.max(
                sectionFontPx * (abbreviateRowLabels ? 1.6 : 2.8),
                abbreviateRowLabels ? 22 : 36,
              )
              const hitH = Math.max(sectionFontPx * 1.5, 22)
              return (
                <g
                  key={`row-${row.hundred}`}
                  className="row-hundred-label"
                  role="button"
                  tabIndex={0}
                  data-hundred={row.hundred}
                  aria-label={`Zoom to section ${row.hundred}`}
                  transform={`translate(${row.x}, ${row.y}) scale(${invScale})`}
                  onPointerDown={(e) => onRowLabelPointerDown(row.hundred, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onRowLabelKeyActivate(row.hundred, e)
                    }
                  }}
                >
                  <rect
                    className="row-hundred-hit"
                    x={-hitW / 2}
                    y={-hitH / 2}
                    width={hitW}
                    height={hitH}
                    rx={3}
                  />
                  <text
                    className="row-hundred-text"
                    x={0}
                    y={0}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={sectionFontPx}
                    fontWeight={800}
                    letterSpacing={abbreviateRowLabels ? 0 : 0.35}
                    strokeWidth={1.35}
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
            {displayPin && (
              <g
                transform={`translate(${displayPin.x * mapWidth}, ${displayPin.y * mapHeight})`}
                style={{
                  cursor: mode === 'pin' ? 'grab' : 'default',
                  pointerEvents: mode === 'pin' ? 'auto' : 'none',
                }}
                onPointerDown={mode === 'pin' ? onPinPointerDown : undefined}
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
          onPointerDown={(e) => {
            e.stopPropagation()
            suppressNextMapTapRef.current = true
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            suppressNextMapTapRef.current = true
          }}
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
              onPointerDown={(e) => {
                e.stopPropagation()
                suppressNextMapTapRef.current = true
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                suppressNextMapTapRef.current = true
                const id = popoverBooth.id
                if (id == null) return
                onNavigateBooth?.(id)
                dismissPopover()
              }}
            >
              Navigate
            </button>
            <button
              type="button"
              className="btn secondary sm"
              onPointerDown={(e) => {
                e.stopPropagation()
                suppressNextMapTapRef.current = true
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                suppressNextMapTapRef.current = true
                const id = popoverBooth.id
                if (id == null) return
                onViewBoothDetails?.(id)
                dismissPopover()
              }}
            >
              View details
            </button>
          </div>
        </div>
      )}

      <div
        className="map-fab-row"
        onPointerDown={(e) => {
          e.stopPropagation()
          suppressPinPlaceRef.current = true
        }}
        onPointerUp={(e) => {
          e.stopPropagation()
          suppressPinPlaceRef.current = true
        }}
      >
        {mode !== 'edit' && onModeChange && (
          <button
            type="button"
            className={`btn secondary sm map-pin-mode-btn${mode === 'pin' ? ' active' : ''}`}
            aria-pressed={mode === 'pin'}
            aria-label={mode === 'pin' ? 'Exit my pin mode' : 'Place or move my pin'}
            title={mode === 'pin' ? 'Done moving pin' : 'My pin'}
            onClick={() => onModeChange(mode === 'pin' ? 'navigate' : 'pin')}
          >
            {mode === 'pin' ? (
              <PiPushPinFill size={18} aria-hidden />
            ) : (
              <PiPushPinLight size={18} aria-hidden />
            )}
            <span>My pin</span>
          </button>
        )}
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
