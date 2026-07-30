import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { VisitStatus } from '../db/types'
import { useObjectUrl } from '../hooks/useObjectUrl'

interface Props {
  eventId: number
  onOpenVendor: (vendorId: number) => void
}

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

  const vendorMap = useMemo(() => {
    const m = new Map<number, { name: string; id: number }>()
    for (const v of vendors ?? []) {
      if (v.id != null) m.set(v.id, { name: v.name, id: v.id })
    }
    return m
  }, [vendors])

  const grouped = useMemo(() => {
    const groups = new Map<number, typeof photos>()
    for (const p of photos ?? []) {
      const list = groups.get(p.vendorId) ?? []
      list.push(p)
      groups.set(p.vendorId, list)
    }
    const entries = [...groups.entries()].map(([vendorId, list]) => ({
      vendorId,
      name: vendorMap.get(vendorId)?.name ?? `Vendor #${vendorId}`,
      photos: [...(list ?? [])].sort((a, b) => b.createdAt - a.createdAt),
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
      <p className="muted">Sorted by vendor. Multi-select to mark a revisit pass.</p>

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
                <button
                  key={p.id}
                  type="button"
                  className={`photo-select ${selected.has(p.id) ? 'selected' : ''}`}
                  onClick={() => toggle(p.id!)}
                >
                  <GalleryThumb blob={p.imageBlob} />
                  {p.note && <span className="photo-note">{p.note}</span>}
                </button>
              ) : null,
            )}
          </div>
        </section>
      ))}
    </div>
  )
}

function GalleryThumb({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  if (!url) return null
  return <img src={url} alt="" />
}
