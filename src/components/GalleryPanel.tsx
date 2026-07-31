import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { ItemPhotoRecord, VisitStatus } from '../db/types'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { PhotoLightbox } from './PhotoLightbox'

interface Props {
  eventId: number
  onOpenVendor: (vendorId: number) => void
}

type ViewerState = {
  blob: Blob
  title: string
  note?: string
}

const LONG_PRESS_MS = 420

export function GalleryPanel({ eventId, onOpenVendor }: Props) {
  const photos = useLiveQuery(
    () => db.itemPhotos.where('eventId').equals(eventId).toArray(),
    [eventId],
  )
  const vendors = useLiveQuery(
    () => db.vendors.where('eventId').equals(eventId).toArray(),
    [eventId],
  )
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)

  const vendorMap = useMemo(() => {
    const m = new Map<number, { name: string; id: number }>()
    for (const v of vendors ?? []) {
      if (v.id != null) m.set(v.id, { name: v.name, id: v.id })
    }
    return m
  }, [vendors])

  const grouped = useMemo(() => {
    const groups = new Map<number, ItemPhotoRecord[]>()
    for (const p of photos ?? []) {
      const list = groups.get(p.vendorId) ?? []
      list.push(p)
      groups.set(p.vendorId, list)
    }
    const entries = [...groups.entries()].map(([vendorId, list]) => ({
      vendorId,
      name: vendorMap.get(vendorId)?.name ?? `Vendor #${vendorId}`,
      photos: [...list].sort((a, b) => b.createdAt - a.createdAt),
    }))
    entries.sort((a, b) => a.name.localeCompare(b.name))
    return entries
  }, [photos, vendorMap])

  const toggle = (photoId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  const selectedVendorIds = useMemo(() => {
    const ids = new Set<number>()
    for (const p of photos ?? []) {
      if (p.id != null && selected.has(p.id)) ids.add(p.vendorId)
    }
    return [...ids]
  }, [photos, selected])

  const setStatusForSelected = async (visitStatus: VisitStatus) => {
    if (!selectedVendorIds.length) return
    await db.transaction('rw', db.vendors, async () => {
      for (const id of selectedVendorIds) {
        await db.vendors.update(id, { visitStatus })
      }
    })
    setMessage(
      `Set ${selectedVendorIds.length} vendor(s) to ${visitStatus.replace('_', ' ')}.`,
    )
    setSelected(new Set())
  }

  return (
    <div className="stack-panel">
      <h2>Photo gallery</h2>
      <p className="muted">
        Tap a photo for fullscreen (pinch to zoom). Hold to multi-select for a revisit pass.
      </p>

      {selectedVendorIds.length > 0 && (
        <div className="gallery-actions">
          <span>{selectedVendorIds.length} vendor(s) selected</span>
          <button
            type="button"
            className="btn secondary sm"
            onClick={() => void setStatusForSelected('look_again')}
          >
            Look again
          </button>
          <button
            type="button"
            className="btn secondary sm"
            onClick={() => void setStatusForSelected('favorite')}
          >
            Favorite
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {message && <p className="ok">{message}</p>}

      {!grouped.length && (
        <p className="muted">No item photos yet — add some from a vendor panel.</p>
      )}

      {grouped.map((g) => (
        <section key={g.vendorId} className="gallery-group">
          <header className="gallery-group-header">
            <h3>{g.name}</h3>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => onOpenVendor(g.vendorId)}
            >
              Open
            </button>
          </header>
          <div className="photo-grid">
            {g.photos.map((p) =>
              p.id != null ? (
                <GalleryPhotoButton
                  key={p.id}
                  photo={p}
                  vendorName={g.name}
                  selected={selected.has(p.id)}
                  onToggleSelect={() => toggle(p.id!)}
                  onOpen={() =>
                    setViewer({
                      blob: p.imageBlob,
                      title: g.name,
                      note: p.note,
                    })
                  }
                />
              ) : null,
            )}
          </div>
        </section>
      ))}

      {viewer && (
        <PhotoLightbox
          blob={viewer.blob}
          title={viewer.title}
          note={viewer.note}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}

function GalleryPhotoButton({
  photo,
  vendorName,
  selected,
  onToggleSelect,
  onOpen,
}: {
  photo: ItemPhotoRecord
  vendorName: string
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
}) {
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  return (
    <button
      type="button"
      className={`photo-select ${selected ? 'selected' : ''}`}
      aria-label={`${vendorName} photo${photo.note ? ` — ${photo.note}` : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return
        longPressed.current = false
        start.current = { x: e.clientX, y: e.clientY }
        clearTimer()
        timer.current = window.setTimeout(() => {
          longPressed.current = true
          onToggleSelect()
          try {
            navigator.vibrate?.(12)
          } catch {
            /* ignore */
          }
        }, LONG_PRESS_MS)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const dx = e.clientX - start.current.x
        const dy = e.clientY - start.current.y
        if (Math.hypot(dx, dy) > 12) clearTimer()
      }}
      onPointerUp={() => {
        const wasLong = longPressed.current
        clearTimer()
        start.current = null
        if (!wasLong) onOpen()
        longPressed.current = false
      }}
      onPointerCancel={() => {
        clearTimer()
        start.current = null
        longPressed.current = false
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        clearTimer()
        onToggleSelect()
      }}
    >
      <GalleryThumb blob={photo.imageBlob} />
      {photo.note && <span className="photo-note">{photo.note}</span>}
    </button>
  )
}

function GalleryThumb({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  if (!url) return null
  return <img src={url} alt="" />
}
