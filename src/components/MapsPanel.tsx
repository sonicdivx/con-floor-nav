import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setActiveFloorMapId } from '../db/schema'
import { saveFloorMapBlob } from '../lib/sampleData'

interface Props {
  eventId: number
  activeFloorMapId: number | null
  onSwitchMap: (floorMapId: number) => void
}

export function MapsPanel({ eventId, activeFloorMapId, onSwitchMap }: Props) {
  const maps = useLiveQuery(
    () => db.floorMaps.where('eventId').equals(eventId).sortBy('createdAt'),
    [eventId],
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rename = async (id: number, name: string) => {
    await db.floorMaps.update(id, { name: name.trim() || 'Floor map' })
  }

  const addMap = async (file: File) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await saveFloorMapBlob(eventId, file, {
        mode: 'add',
        name: file.name.replace(/\.[^.]+$/, '') || 'Floor map',
      })
      setMessage(`Added map (${result.width}×${result.height}).`)
      onSwitchMap(result.floorMapId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    if ((maps?.length ?? 0) <= 1) {
      setError('Keep at least one map, or delete the event instead.')
      return
    }
    const map = maps?.find((m) => m.id === id)
    const ok = window.confirm(
      `Delete map “${map?.name ?? 'Floor map'}” and its booths on this map?`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await db.transaction('rw', db.floorMaps, db.booths, db.vendors, db.itemPhotos, async () => {
        const booths = await db.booths.where('floorMapId').equals(id).toArray()
        const boothIds = booths.map((b) => b.id!).filter(Boolean)
        if (boothIds.length) {
          const vendors = await db.vendors.where('boothId').anyOf(boothIds).toArray()
          const vendorIds = vendors.map((v) => v.id!).filter(Boolean)
          if (vendorIds.length) {
            await db.itemPhotos.where('vendorId').anyOf(vendorIds).delete()
          }
          await db.vendors.where('boothId').anyOf(boothIds).delete()
          await db.booths.bulkDelete(boothIds)
        }
        await db.floorMaps.delete(id)
      })
      if (id === activeFloorMapId) {
        const next = (maps ?? []).find((m) => m.id !== id)?.id
        if (next != null) {
          setActiveFloorMapId(eventId, next)
          onSwitchMap(next)
        }
      }
      setMessage('Map deleted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-panel">
      <h3>Floor maps</h3>
      <p className="muted">
        One event can have several maps (Dealers hall, Artist Alley, …). Booths stay on the map you
        import them onto.
      </p>

      <ul className="event-list">
        {(maps ?? []).map((m) =>
          m.id != null ? (
            <li
              key={m.id}
              className={`event-list-item${m.id === activeFloorMapId ? ' active' : ''}`}
            >
              <div className="event-list-main">
                <input
                  className="input"
                  defaultValue={m.name ?? 'Floor map'}
                  aria-label="Map name"
                  onBlur={(e) => void rename(m.id!, e.target.value)}
                />
                <p className="muted sm">
                  {m.width}×{m.height}
                </p>
              </div>
              <div className="chip-row wrap">
                {m.id === activeFloorMapId ? (
                  <span className="chip active">Active</span>
                ) : (
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={busy}
                    onClick={() => {
                      setActiveFloorMapId(eventId, m.id!)
                      onSwitchMap(m.id!)
                    }}
                  >
                    Switch
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost sm danger"
                  disabled={busy || (maps?.length ?? 0) <= 1}
                  onClick={() => void remove(m.id!)}
                >
                  Delete
                </button>
              </div>
            </li>
          ) : null,
        )}
      </ul>

      <label className={`btn secondary${busy ? ' disabled' : ''}`}>
        Add another map…
        <input
          type="file"
          accept="image/*"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void addMap(file)
          }}
        />
      </label>
      {message && <p className="ok">{message}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  )
}
