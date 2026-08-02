import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
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

const EDGE_PX = 72
const MAX_SCROLL_STEP = 28

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    const oy = style.overflowY
    if (
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Planned tour stops with touch-friendly drag reorder and a full-height delete control.
 * Page scroll works on rows; only the grip starts a drag. Dragging near edges auto-scrolls
 * the Go tab panel (`.page`), not the window.
 */
export function TourStopList({ items, onReorder, onRemove, onFocus }: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const itemsRef = useRef(items)
  const onReorderRef = useRef(onReorder)
  const dragIdRef = useRef<number | null>(null)
  const overIdRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const lastClientYRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  itemsRef.current = items
  onReorderRef.current = onReorder

  const setOver = (id: number | null) => {
    overIdRef.current = id
    setOverId(id)
  }

  /** Pick the row whose vertical band contains the pointer (works while the panel scrolls). */
  const rowFromPoint = (clientY: number): number | null => {
    const list = listRef.current
    if (!list) return null
    const rows = list.querySelectorAll<HTMLElement>('[data-tour-booth-id]')
    let bestId: number | null = null
    let bestDist = Infinity
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      const id = Number(row.dataset.tourBoothId)
      if (!Number.isFinite(id)) continue
      if (clientY >= rect.top && clientY <= rect.bottom) return id
      const mid = (rect.top + rect.bottom) / 2
      const dist = Math.abs(clientY - mid)
      if (dist < bestDist) {
        bestDist = dist
        bestId = id
      }
    }
    return bestId
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      document.body.classList.remove('tour-stop-dragging')
    }
  }, [])

  useEffect(() => {
    if (dragId == null) return

    const stopAutoScroll = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    const scrollNearEdges = () => {
      const y = lastClientYRef.current
      const scroller = getScrollParent(listRef.current)
      const viewportTop = scroller
        ? scroller.getBoundingClientRect().top
        : 0
      const viewportBottom = scroller
        ? scroller.getBoundingClientRect().bottom
        : window.innerHeight

      let step = 0
      if (y < viewportTop + EDGE_PX) {
        const t = Math.min(1, (viewportTop + EDGE_PX - y) / EDGE_PX)
        step = -Math.ceil(t * MAX_SCROLL_STEP)
      } else if (y > viewportBottom - EDGE_PX) {
        const t = Math.min(1, (y - (viewportBottom - EDGE_PX)) / EDGE_PX)
        step = Math.ceil(t * MAX_SCROLL_STEP)
      }
      if (step === 0) return false

      if (scroller) scroller.scrollTop += step
      else window.scrollBy(0, step)
      return true
    }

    const tickAutoScroll = () => {
      rafRef.current = null
      if (dragIdRef.current == null) return
      const moved = scrollNearEdges()
      const over = rowFromPoint(lastClientYRef.current)
      if (over != null) setOver(over)
      if (moved) rafRef.current = requestAnimationFrame(tickAutoScroll)
    }

    const ensureAutoScroll = () => {
      if (rafRef.current != null) return
      if (scrollNearEdges()) {
        const over = rowFromPoint(lastClientYRef.current)
        if (over != null) setOver(over)
        rafRef.current = requestAnimationFrame(tickAutoScroll)
      }
    }

    const endDrag = (clientY?: number) => {
      const fromId = dragIdRef.current
      const y = clientY ?? lastClientYRef.current
      const order = itemsRef.current.map((i) => i.boothId)
      const from = fromId != null ? order.indexOf(fromId) : -1
      // Drop onto the row under the pointer (take that slot). Mid-line insert
      // math was cancelling one-step moves and leaving the map path stale.
      const toId =
        overIdRef.current ?? (fromId != null ? rowFromPoint(y) : null)
      const to = toId != null ? order.indexOf(toId) : -1

      dragIdRef.current = null
      pointerIdRef.current = null
      stopAutoScroll()
      setDragId(null)
      setOver(null)
      document.body.classList.remove('tour-stop-dragging')

      if (fromId == null || from < 0 || to < 0 || to === from) return
      const next = [...order]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      onReorderRef.current(next)
    }

    const onMove = (e: PointerEvent) => {
      if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) {
        return
      }
      // Keep the drag gesture from scrolling the panel; edge zones auto-scroll instead.
      e.preventDefault()
      lastClientYRef.current = e.clientY
      const over = rowFromPoint(e.clientY)
      if (over != null) setOver(over)
      ensureAutoScroll()
    }

    const onUp = (e: PointerEvent) => {
      if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) {
        return
      }
      endDrag(e.clientY)
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      // Safety: never leave the page stuck non-scrollable after an interrupted drag.
      stopAutoScroll()
      document.body.classList.remove('tour-stop-dragging')
    }
  }, [dragId])

  const onHandlePointerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    boothId: number,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    pointerIdRef.current = e.pointerId
    dragIdRef.current = boothId
    lastClientYRef.current = e.clientY
    setDragId(boothId)
    setOver(boothId)
    document.body.classList.add('tour-stop-dragging')
  }

  if (!items.length) return null

  return (
    <ul className="nav-list tour-stop-list" ref={listRef}>
      {items.map((stop) => {
        const dragging = dragId === stop.boothId
        const dropTarget =
          overId === stop.boothId && dragId != null && dragId !== stop.boothId
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
