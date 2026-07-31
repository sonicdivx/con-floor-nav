import { useCallback, useEffect, useRef, useState } from 'react'
import { useObjectUrl } from '../hooks/useObjectUrl'

type Props = {
  blob: Blob
  /** Vendor / booth name shown in the chrome. */
  title: string
  note?: string
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 5

/**
 * Fullscreen photo viewer with pinch / wheel zoom, pan when zoomed,
 * vendor name in the header, and an explicit Close control.
 */
export function PhotoLightbox({ blob, title, note, onClose }: Props) {
  const url = useObjectUrl(blob)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{
    dist: number
    scale: number
    midX: number
    midY: number
    tx: number
    ty: number
  } | null>(null)
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  )
  const scaleRef = useRef(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)

  scaleRef.current = scale
  txRef.current = tx
  tyRef.current = ty

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // Non-passive wheel so we can prevent page scroll while zooming.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, scaleRef.current * factor),
      )
      if (nextScale <= 1.01) {
        setScale(1)
        setTx(0)
        setTy(0)
        return
      }
      const rect = el.getBoundingClientRect()
      const ox = e.clientX - (rect.left + rect.width / 2)
      const oy = e.clientY - (rect.top + rect.height / 2)
      const ratio = nextScale / scaleRef.current
      const nextTx = txRef.current - ox * (ratio - 1)
      const nextTy = tyRef.current - oy * (ratio - 1)
      const maxX = ((nextScale - 1) * el.clientWidth) / 2
      const maxY = ((nextScale - 1) * el.clientHeight) / 2
      setScale(nextScale)
      setTx(Math.min(maxX, Math.max(-maxX, nextTx)))
      setTy(Math.min(maxY, Math.max(-maxY, nextTy)))
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [])

  const resetView = useCallback(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [])

  const clampPan = (nextScale: number, nextTx: number, nextTy: number) => {
    if (nextScale <= 1.01) return { tx: 0, ty: 0 }
    const el = stageRef.current
    if (!el) return { tx: nextTx, ty: nextTy }
    const { clientWidth: w, clientHeight: h } = el
    const maxX = ((nextScale - 1) * w) / 2
    const maxY = ((nextScale - 1) * h) / 2
    return {
      tx: Math.min(maxX, Math.max(-maxX, nextTx)),
      ty: Math.min(maxY, Math.max(-maxY, nextTy)),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()]
      const a = pts[0]!
      const b = pts[1]!
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      pinch.current = {
        dist,
        scale: scaleRef.current,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        tx: txRef.current,
        ty: tyRef.current,
      }
      pan.current = null
      return
    }

    if (scaleRef.current > 1.01) {
      pan.current = {
        x: e.clientX,
        y: e.clientY,
        tx: txRef.current,
        ty: tyRef.current,
      }
    } else {
      pan.current = null
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && pinch.current) {
      const pts = [...pointers.current.values()]
      const a = pts[0]!
      const b = pts[1]!
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinch.current.scale * (dist / pinch.current.dist)),
      )
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const ratio = nextScale / pinch.current.scale
      const el = stageRef.current
      let nextTx = pinch.current.tx + (midX - pinch.current.midX)
      let nextTy = pinch.current.ty + (midY - pinch.current.midY)
      if (el) {
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const ox = pinch.current.midX - cx
        const oy = pinch.current.midY - cy
        nextTx =
          pinch.current.tx + (midX - pinch.current.midX) - ox * (ratio - 1)
        nextTy =
          pinch.current.ty + (midY - pinch.current.midY) - oy * (ratio - 1)
      }
      const clamped = clampPan(nextScale, nextTx, nextTy)
      setScale(nextScale)
      setTx(clamped.tx)
      setTy(clamped.ty)
      return
    }

    if (pan.current && scaleRef.current > 1.01) {
      const nextTx = pan.current.tx + (e.clientX - pan.current.x)
      const nextTy = pan.current.ty + (e.clientY - pan.current.y)
      const clamped = clampPan(scaleRef.current, nextTx, nextTy)
      setTx(clamped.tx)
      setTy(clamped.ty)
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      pan.current = null
      if (scaleRef.current < 1.05) resetView()
    }
  }

  const onDoubleClick = () => {
    if (scaleRef.current > 1.2) resetView()
    else {
      setScale(2.5)
      setTx(0)
      setTy(0)
    }
  }

  return (
    <div
      className="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo — ${title}`}
    >
      <header className="photo-lightbox-bar">
        <div className="photo-lightbox-meta">
          <strong>{title}</strong>
          {note ? <span className="muted sm">{note}</span> : null}
        </div>
        <div className="photo-lightbox-actions">
          {scale > 1.05 && (
            <button type="button" className="btn ghost sm" onClick={resetView}>
              Reset zoom
            </button>
          )}
          <button
            type="button"
            className="btn primary sm photo-lightbox-close"
            onClick={onClose}
            aria-label="Close photo"
          >
            Close
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className="photo-lightbox-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={onDoubleClick}
      >
        {url ? (
          <img
            src={url}
            alt={title}
            className="photo-lightbox-img"
            draggable={false}
            style={{
              transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
            }}
          />
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>

      <p className="photo-lightbox-hint muted sm">
        Pinch or scroll to zoom · double-tap to toggle · Close to exit
      </p>
    </div>
  )
}
