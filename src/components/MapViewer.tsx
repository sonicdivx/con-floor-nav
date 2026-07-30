import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { BoothRecord, Rect, VendorRecord, VisitStatus } from '../db/types'
import {
  computeRowHundredLabels,
  fitBoothLabelFontSize,
} from '../lib/boothLabels'
import { findAislePath } from '../lib/pathfinding'
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
  pin: { x: number; y: number } | null
  mode: MapMode
  onSelectBooth: (boothId: number | null) => void
  onUpdateBoothRect: (boothId: number, rect: BoothRecord['rect']) => void
  onPinChange: (x: number, y: number) => void
  onNavigateBooth?: (boothId: number) => void
  onViewBoothDetails?: (boothId: number) => void
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
  pin,
  mode,
  onSelectBooth,
  onUpdateBoothRect,
  onPinChange,
  onNavigateBooth,
  onViewBoothDetails,
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
  const suppressClickRef = useRef(false)
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHoverClearTimer = () => {
    if (hoverClearTimerRef.current != null) {
      clearTimeout(hoverClearTimerRef.current)
      hoverClearTimerRef.current = null
    }
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
    }
  }, [mode])

  const visibleBooths = useMemo(() => {
    if (!tagFilter) return booths
    return booths.filter((b) => {
      if (b.id == null) return false
      const v = vendorsByBoothId.get(b.id)
      return v?.tags.includes(tagFilter)
    })
  }, [booths, vendorsByBoothId, tagFilter])

  const rowLabels = useMemo(
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
    if (!pin || navTargetBoothId == null || mapWidth <= 0 || mapHeight <= 0) {
      return null
    }
    const booth = booths.find((b) => b.id === navTargetBoothId)
    if (!booth) return null
    const goal = {
      x: booth.rect.x + booth.rect.w / 2,
      y: booth.rect.y + booth.rect.h / 2,
    }
    const path =
      findAislePath({
        start: pin,
        goal,
        booths: booths.map((b) => b.rect),
        obstacles,
        mapWidth,
        mapHeight,
      }) ?? [pin, goal]
    return path
      .map((p, i) => {
        const x = p.x * mapWidth
        const y = p.y * mapHeight
        return `${i === 0 ? 'M' : 'L'}${x} ${y}`
      })
      .join(' ')
  }, [pin, navTargetBoothId, booths, obstacles, mapWidth, mapHeight])

  const clientToNorm = (clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const lx = clientX - rect.left
    const ly = clientY - rect.top
    const ix = (lx - tx) / scale
    const iy = (ly - ty) / scale
    return {
      x: Math.min(1, Math.max(0, ix / mapWidth)),
      y: Math.min(1, Math.max(0, iy / mapHeight)),
    }
  }

  const dismissPopover = () => {
    clearHoverClearTimer()
    setHoverBoothId(null)
    setPinnedBoothId(null)
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

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)

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

  const onPointerUp = () => {
    const d = dragRef.current
    if (d?.kind === 'pan') {
      if (d.moved) {
        suppressClickRef.current = true
        dismissPopover()
      } else {
        // Tap empty map (not a booth — booths stopPropagation).
        dismissPopover()
      }
    }
    dragRef.current = null
  }

  const startBoothDrag = (
    e: ReactPointerEvent,
    booth: BoothRecord,
    kind: 'booth' | 'resize',
  ) => {
    if (mode !== 'edit' || booth.id == null) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
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

  const onBoothActivate = (boothId: number, e: ReactPointerEvent) => {
    e.stopPropagation()
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (mode === 'edit') {
      onSelectBooth(boothId)
      return
    }
    if (mode !== 'navigate') return
    // Tap toggles pinned popover (works for touch; mouse can also pin).
    setPinnedBoothId((prev) => (prev === boothId ? null : boothId))
    setHoverBoothId(boothId)
  }

  const rowLabelFont = Math.max(11, 14 / Math.min(scale, 1.25))

  return (
    <div
      ref={containerRef}
      className="map-viewer"
      onWheel={onWheel}
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
            {rowLabels.map((row) => (
              <g key={`row-${row.hundred}`} pointerEvents="none">
                <text
                  x={row.x}
                  y={row.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="rgba(255,255,255,0.92)"
                  fontSize={rowLabelFont}
                  fontWeight={700}
                  letterSpacing={0.5}
                  style={{
                    paintOrder: 'stroke',
                    stroke: 'rgba(10,14,22,0.75)',
                    strokeWidth: 3 / Math.max(scale, 0.5),
                  }}
                >
                  {row.text}
                </text>
              </g>
            ))}
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
                    onPointerDown={(e) => {
                      if (mode === 'edit') startBoothDrag(e, booth, 'booth')
                      else onBoothActivate(booth.id!, e)
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
                d={navPathD}
                fill="none"
                stroke="#ff6b4a"
                strokeWidth={3 / scale}
                strokeDasharray={`${8 / scale} ${6 / scale}`}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {pin && (
              <g
                transform={`translate(${pin.x * mapWidth}, ${pin.y * mapHeight})`}
                style={{ cursor: mode === 'pin' ? 'grab' : 'default' }}
                onPointerDown={(e) => {
                  if (mode !== 'pin') return
                  e.stopPropagation()
                  dragRef.current = {
                    kind: 'pin',
                    startX: e.clientX,
                    startY: e.clientY,
                    origTx: tx,
                    origTy: ty,
                    moved: false,
                  }
                }}
              >
                <circle r={14 / scale} fill="#ff6b4a" fillOpacity={0.25} />
                <circle r={7 / scale} fill="#ff6b4a" stroke="#fff" strokeWidth={2 / scale} />
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
              onClick={() => {
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
              onClick={() => {
                const id = popoverBooth.id!
                onViewBoothDetails?.(id)
                onSelectBooth(id)
                dismissPopover()
              }}
            >
              View details
            </button>
          </div>
        </div>
      )}

      <div className="map-fab-row">
        <button type="button" className="btn ghost sm" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  )
}
