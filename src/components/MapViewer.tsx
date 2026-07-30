import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { BoothRecord, VendorRecord, VisitStatus } from '../db/types'
import { STATUS_COLORS } from '../lib/statusColors'

export type MapMode = 'navigate' | 'edit' | 'pin'

interface Props {
  mapUrl: string | null
  mapWidth: number
  mapHeight: number
  booths: BoothRecord[]
  vendorsByBoothId: Map<number, VendorRecord>
  tagFilter: string | null
  selectedBoothId: number | null
  navTargetBoothId: number | null
  pin: { x: number; y: number } | null
  mode: MapMode
  onSelectBooth: (boothId: number | null) => void
  onUpdateBoothRect: (boothId: number, rect: BoothRecord['rect']) => void
  onPinChange: (x: number, y: number) => void
}

export function MapViewer({
  mapUrl,
  mapWidth,
  mapHeight,
  booths,
  vendorsByBoothId,
  tagFilter,
  selectedBoothId,
  navTargetBoothId,
  pin,
  mode,
  onSelectBooth,
  onUpdateBoothRect,
  onPinChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const dragRef = useRef<{
    kind: 'pan' | 'booth' | 'pin' | 'resize'
    startX: number
    startY: number
    origTx: number
    origTy: number
    boothId?: number
    origRect?: BoothRecord['rect']
    handle?: 'se'
  } | null>(null)

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

  const visibleBooths = useMemo(() => {
    if (!tagFilter) return booths
    return booths.filter((b) => {
      if (b.id == null) return false
      const v = vendorsByBoothId.get(b.id)
      return v?.tags.includes(tagFilter)
    })
  }, [booths, vendorsByBoothId, tagFilter])

  const navLine = useMemo(() => {
    if (!pin || navTargetBoothId == null) return null
    const booth = booths.find((b) => b.id === navTargetBoothId)
    if (!booth) return null
    const cx = (booth.rect.x + booth.rect.w / 2) * mapWidth
    const cy = (booth.rect.y + booth.rect.h / 2) * mapHeight
    return {
      x1: pin.x * mapWidth,
      y1: pin.y * mapHeight,
      x2: cx,
      y2: cy,
    }
  }, [pin, navTargetBoothId, booths, mapWidth, mapHeight])

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
      }
      return
    }

    dragRef.current = {
      kind: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      origTx: tx,
      origTy: ty,
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
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
    }
  }

  const statusFor = (boothId: number | undefined): VisitStatus => {
    if (boothId == null) return 'none'
    return vendorsByBoothId.get(boothId)?.visitStatus ?? 'none'
  }

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
            {visibleBooths.map((booth) => {
              if (booth.id == null) return null
              const status = statusFor(booth.id)
              const color = STATUS_COLORS[status]
              const selected = selectedBoothId === booth.id
              const isNav = navTargetBoothId === booth.id
              const x = booth.rect.x * mapWidth
              const y = booth.rect.y * mapHeight
              const w = booth.rect.w * mapWidth
              const h = booth.rect.h * mapHeight
              return (
                <g key={booth.id}>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={color}
                    fillOpacity={selected || isNav ? 0.55 : 0.35}
                    stroke={isNav ? '#fff' : selected ? '#fff' : color}
                    strokeWidth={(selected || isNav ? 3 : 1.5) / scale}
                    rx={2 / scale}
                    style={{ cursor: mode === 'edit' ? 'move' : 'pointer' }}
                    onPointerDown={(e) => {
                      if (mode === 'edit') startBoothDrag(e, booth, 'booth')
                      else {
                        e.stopPropagation()
                        onSelectBooth(booth.id!)
                      }
                    }}
                  />
                  <text
                    x={x + w / 2}
                    y={y + h / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    fontSize={Math.max(10, Math.min(w, h) * 0.45) / Math.min(scale, 1.5)}
                    fontWeight={600}
                    pointerEvents="none"
                    style={{ textShadow: '0 1px 2px rgba(0,0,0,.6)' }}
                  >
                    {booth.label}
                  </text>
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
            {navLine && (
              <line
                x1={navLine.x1}
                y1={navLine.y1}
                x2={navLine.x2}
                y2={navLine.y2}
                stroke="#ff6b4a"
                strokeWidth={3 / scale}
                strokeDasharray={`${8 / scale} ${6 / scale}`}
                strokeLinecap="round"
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
      <div className="map-fab-row">
        <button type="button" className="btn ghost sm" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  )
}
