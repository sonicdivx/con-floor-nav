import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PiDotsSixVerticalBold, PiTrash } from 'react-icons/pi'
import type { VisitStatus } from '../db/types'
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors'

export type TourStopListItem = {
  boothId: number
  index: number
  x: number
  y: number
  label: string
  name: string
  visitStatus: VisitStatus
}

type Props = {
  items: TourStopListItem[]
  onReorder: (boothIds: number[]) => void
  onRemove: (boothId: number) => void
  onFocus: (boothId: number, x: number, y: number) => void
}

/**
 * Planned tour stops with touch-friendly drag reorder and a full-height delete control.
 */
export function TourStopList({ items, onReorder, onRemove, onFocus }: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const dragIdRef = useRef<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  const ids = items.map((i) => i.boothId)

  const rowFromPoint = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY)
    const row = el?.closest?.('[data-tour-booth-id]') as HTMLElement | null
    if (!row) return null
    const id = Number(row.dataset.tourBoothId)
    return Number.isFinite(id) ? id : null
  }

  const onHandlePointerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    boothId: number,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragIdRef.current = boothId
    setDragId(boothId)
    setOverId(boothId)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragIdRef.current == null) return
    const over = rowFromPoint(e.clientX, e.clientY)
    if (over != null) setOverId(over)
  }

  const finishDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const fromId = dragIdRef.current
    dragIdRef.current = null
    setDragId(null)
    const toId = overId ?? rowFromPoint(e.clientX, e.clientY)
    setOverId(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (fromId == null || toId == null || fromId === toId) return
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onReorder(next)
  }

  if (!items.length) return null

  return (
    <ul className="nav-list tour-stop-list" ref={listRef}>
      {items.map((stop) => {
        const dragging = dragId === stop.boothId
        const dropTarget = overId === stop.boothId && dragId != null && dragId !== stop.boothId
        return (
          <li
            key={stop.boothId}
            data-tour-booth-id={stop.boothId}
            className={[
              'tour-stop-row',
              dragging ? 'is-dragging' : '',
              dropTarget ? 'is-drop-target' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="tour-drag-handle"
              aria-label={`Drag to reorder stop ${stop.index}`}
              onPointerDown={(e) => onHandlePointerDown(e, stop.boothId)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              <PiDotsSixVerticalBold size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="nav-item tour-stop-main"
              onClick={() => onFocus(stop.boothId, stop.x, stop.y)}
            >
              <span className="tour-stop-num">{stop.index}</span>
              <span
                className="status-dot"
                style={{ background: STATUS_COLORS[stop.visitStatus] }}
              />
              <span>
                <strong>{stop.name}</strong>
                <span className="muted sm">
                  Booth {stop.label}
                  {stop.visitStatus !== 'none'
                    ? ` · ${STATUS_LABELS[stop.visitStatus]}`
                    : ''}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="tour-stop-delete"
              aria-label={`Remove ${stop.name} from tour`}
              onClick={() => onRemove(stop.boothId)}
            >
              <PiTrash size={20} aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
