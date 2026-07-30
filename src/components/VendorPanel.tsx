import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/schema'
import type { VendorRecord, VisitStatus } from '../db/types'
import { DEFAULT_TAGS } from '../db/types'
import { STATUS_COLORS, STATUS_LABELS, VISIT_STATUSES } from '../lib/statusColors'

interface Props {
  vendor: VendorRecord
  boothLabel: string
  onClose: () => void
  onNavigate: () => void
}

export function VendorPanel({ vendor, boothLabel, onClose, onNavigate }: Props) {
  const [note, setNote] = useState('')
  const photos = useLiveQuery(
    () =>
      vendor.id != null
        ? db.itemPhotos.where('vendorId').equals(vendor.id).reverse().sortBy('createdAt')
        : [],
    [vendor.id],
  )

  const setStatus = async (visitStatus: VisitStatus) => {
    if (vendor.id == null) return
    await db.vendors.update(vendor.id, { visitStatus })
  }

  const toggleTag = async (tag: string) => {
    if (vendor.id == null) return
    const tags = vendor.tags.includes(tag)
      ? vendor.tags.filter((t) => t !== tag)
      : [...vendor.tags, tag]
    await db.vendors.update(vendor.id, { tags })
  }

  const addPhoto = async (file: File) => {
    if (vendor.id == null) return
    await db.itemPhotos.add({
      eventId: vendor.eventId,
      vendorId: vendor.id,
      imageBlob: file,
      note: note.trim() || undefined,
      createdAt: Date.now(),
    })
    setNote('')
  }

  const removePhoto = async (id: number) => {
    await db.itemPhotos.delete(id)
  }

  return (
    <aside className="side-panel vendor-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Booth {boothLabel}</p>
          <h2>{vendor.name}</h2>
        </div>
        <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <section className="panel-section">
        <h3>Visit status</h3>
        <div className="chip-row">
          {VISIT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip ${vendor.visitStatus === s ? 'active' : ''}`}
              style={
                vendor.visitStatus === s
                  ? { background: STATUS_COLORS[s], borderColor: STATUS_COLORS[s] }
                  : { borderColor: STATUS_COLORS[s] }
              }
              onClick={() => setStatus(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          <button type="button" className="chip navigate-chip" onClick={onNavigate}>
            <svg
              className="navigate-chip-icon"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
              focusable="false"
            >
              <path
                fill="currentColor"
                d="M12 2.5 4.2 19.3c-.25.55.32 1.12.88.88L12 17.2l6.92 2.98c.56.24 1.13-.33.88-.88L12 2.5Z"
              />
            </svg>
            Navigate
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h3>Tags</h3>
        <div className="chip-row">
          {DEFAULT_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`chip ${vendor.tags.includes(tag) ? 'active' : ''}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h3>Item photos</h3>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          className="input"
        />
        <div className="btn-row">
          <label className="btn secondary" style={{ display: 'inline-flex' }}>
            Camera
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void addPhoto(f)
                e.target.value = ''
              }}
            />
          </label>
          <label className="btn secondary" style={{ display: 'inline-flex' }}>
            Library
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void addPhoto(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <div className="photo-grid">
          {(photos ?? []).map((p) =>
            p.id != null ? (
              <figure key={p.id} className="photo-thumb">
                <PhotoThumb blob={p.imageBlob} />
                {p.note && <figcaption>{p.note}</figcaption>}
                <button
                  type="button"
                  className="btn ghost sm danger"
                  onClick={() => removePhoto(p.id!)}
                >
                  Remove
                </button>
              </figure>
            ) : null,
          )}
        </div>
      </section>
    </aside>
  )
}

function PhotoThumb({ blob }: { blob: Blob }) {
  const url = URL.createObjectURL(blob)
  return (
    <img
      src={url}
      alt=""
      onLoad={() => URL.revokeObjectURL(url)}
    />
  )
}
