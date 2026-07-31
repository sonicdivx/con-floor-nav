import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import {
  PiArrowsInSimple,
  PiArrowsOutSimple,
  PiCamera,
  PiPushPinFill,
  PiPushPinLight,
} from 'react-icons/pi'
import { db } from '../db/schema'
import type { VendorRecord, VisitStatus } from '../db/types'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { STATUS_COLORS, STATUS_LABELS, VISIT_STATUSES } from '../lib/statusColors'
import { normalizeTag, registerCustomTags } from '../lib/tags'
import { TagSelect } from './TagSelect'

interface Props {
  vendor: VendorRecord
  boothLabel: string
  pinned?: boolean
  expanded?: boolean
  onTogglePinned?: () => void
  onToggleExpanded?: () => void
  onClose: () => void
  onNavigate: () => void
}

export function VendorPanel({
  vendor,
  boothLabel,
  pinned = false,
  expanded = false,
  onTogglePinned,
  onToggleExpanded,
  onClose,
  onNavigate,
}: Props) {
  const [note, setNote] = useState('')
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const photos = useLiveQuery(
    () =>
      vendor.id != null
        ? db.itemPhotos.where('vendorId').equals(vendor.id).reverse().sortBy('createdAt')
        : [],
    [vendor.id],
  )
  const allVendors = useLiveQuery(
    () => db.vendors.where('eventId').equals(vendor.eventId).toArray(),
    [vendor.eventId],
  )

  const catalogExtra = useMemo(() => {
    const tags: string[] = []
    for (const v of allVendors ?? []) {
      for (const t of v.tags) tags.push(t)
    }
    return tags
  }, [allVendors])

  const setStatus = async (visitStatus: VisitStatus) => {
    if (vendor.id == null) return
    await db.vendors.update(vendor.id, { visitStatus })
  }

  const setTags = async (tags: string[]) => {
    if (vendor.id == null) return
    const normalized = tags.map(normalizeTag).filter(Boolean)
    registerCustomTags(normalized)
    await db.vendors.update(vendor.id, { tags: normalized })
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
    <aside
      className={`side-panel vendor-panel${pinned ? ' is-pinned' : ''}${expanded ? ' is-expanded' : ''}`}
    >
      <header className="panel-header">
        <div className="panel-header-leading">
          <button
            type="button"
            className="btn ghost sm panel-header-icon"
            aria-label="Take photo"
            title="Take photo"
            disabled={vendor.id == null}
            onClick={() => cameraInputRef.current?.click()}
          >
            <PiCamera size={20} aria-hidden />
          </button>
          <input
            ref={cameraInputRef}
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
          <div>
            <p className="eyebrow">Booth {boothLabel}</p>
            <h2>{vendor.name}</h2>
          </div>
        </div>
        <div className="panel-header-actions">
          {onToggleExpanded && (
            <button
              type="button"
              className={`btn ghost sm panel-header-icon${expanded ? ' active' : ''}`}
              onClick={onToggleExpanded}
              aria-pressed={expanded}
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <PiArrowsInSimple size={18} aria-hidden />
              ) : (
                <PiArrowsOutSimple size={18} aria-hidden />
              )}
            </button>
          )}
          {onTogglePinned && (
            <button
              type="button"
              className={`btn ghost sm pin-keep-open${pinned ? ' active' : ''}`}
              onClick={onTogglePinned}
              aria-pressed={pinned}
              aria-label={pinned ? 'Unpin details panel' : 'Keep details panel open'}
              title={
                pinned
                  ? 'Pinned open — tap other booths to switch'
                  : 'Keep open while tapping the map'
              }
            >
              {pinned ? (
                <PiPushPinFill size={18} aria-hidden />
              ) : (
                <PiPushPinLight size={18} aria-hidden />
              )}
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
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
        <TagSelect
          selected={vendor.tags}
          catalogExtra={catalogExtra}
          onChange={(tags) => void setTags(tags)}
        />
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
  const url = useObjectUrl(blob)
  if (!url) return null
  return <img src={url} alt="" />
}
