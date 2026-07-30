import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createEvent,
  db,
  deleteEventCascade,
  setActiveEventId,
} from '../db/schema'

interface Props {
  activeEventId: number
  onSwitchEvent: (eventId: number) => void
}

export function EventsPanel({ activeEventId, onSwitchEvent }: Props) {
  const events = useLiveQuery(() => db.events.orderBy('createdAt').toArray(), [])
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const id = await createEvent({ name, venueNotes: venue })
      setName('')
      setVenue('')
      setMessage('Event created.')
      onSwitchEvent(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rename = async (id: number, nextName: string, nextVenue: string) => {
    await db.events.update(id, {
      name: nextName.trim() || 'Untitled event',
      venueNotes: nextVenue.trim(),
      updatedAt: Date.now(),
    })
  }

  const remove = async (id: number) => {
    if ((events?.length ?? 0) <= 1) {
      setError('Keep at least one event.')
      return
    }
    const ev = events?.find((e) => e.id === id)
    const ok = window.confirm(
      `Delete “${ev?.name ?? 'event'}” and all its maps, booths, and photos? This cannot be undone.`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await deleteEventCascade(id)
      if (id === activeEventId) {
        const remaining = (events ?? []).filter((e) => e.id !== id)
        const next = remaining[0]?.id
        if (next != null) {
          setActiveEventId(next)
          onSwitchEvent(next)
        }
      }
      setMessage('Event deleted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-panel">
      <h3>Events</h3>
      <p className="muted">
        Each event is its own con weekend — maps, booths, favorites, and photos stay separate.
      </p>

      <ul className="event-list">
        {(events ?? []).map((ev) =>
          ev.id != null ? (
            <li
              key={ev.id}
              className={`event-list-item${ev.id === activeEventId ? ' active' : ''}`}
            >
              <div className="event-list-main">
                <input
                  className="input"
                  defaultValue={ev.name}
                  aria-label="Event name"
                  onBlur={(e) => void rename(ev.id!, e.target.value, ev.venueNotes)}
                />
                <input
                  className="input"
                  defaultValue={ev.venueNotes}
                  aria-label="Venue notes"
                  placeholder="Venue notes"
                  onBlur={(e) => void rename(ev.id!, ev.name, e.target.value)}
                />
              </div>
              <div className="chip-row wrap">
                {ev.id === activeEventId ? (
                  <span className="chip active">Active</span>
                ) : (
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={busy}
                    onClick={() => {
                      setActiveEventId(ev.id!)
                      onSwitchEvent(ev.id!)
                    }}
                  >
                    Switch
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost sm danger"
                  disabled={busy || (events?.length ?? 0) <= 1}
                  onClick={() => void remove(ev.id!)}
                >
                  Delete
                </button>
              </div>
            </li>
          ) : null,
        )}
      </ul>

      <h4 className="settings-subhead">New event</h4>
      <div className="form-row">
        <input
          className="input"
          placeholder="Name (e.g. Otakon 2027)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          placeholder="Venue notes (optional)"
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
        />
        <button
          type="button"
          className="btn primary"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
        >
          Create event
        </button>
      </div>
      {message && <p className="ok">{message}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  )
}
