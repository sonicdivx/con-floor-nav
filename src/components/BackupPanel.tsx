import { useState } from 'react'
import {
  buildEventBackup,
  downloadBackupJson,
  parseEventBackup,
  restoreEventBackup,
} from '../lib/backup'

interface Props {
  eventId: number
  onRestored?: () => void
}

export function BackupPanel({ eventId, onRestored }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const exportBackup = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const backup = await buildEventBackup(eventId)
      await downloadBackupJson(backup)
      setMessage(
        `Exported ${backup.booths.length} booths, ${backup.vendors.length} vendors, ${backup.photos.length} photos.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const importBackup = async (file: File) => {
    setError(null)
    setMessage(null)
    try {
      const text = await file.text()
      const backup = parseEventBackup(JSON.parse(text) as unknown)
      const ok = window.confirm(
        `Replace all booths, vendors, photos, map, and pin for this event with “${backup.event.name}” from the backup? This cannot be undone.`,
      )
      if (!ok) return
      setBusy(true)
      const result = await restoreEventBackup(eventId, backup)
      setMessage(
        `Restored ${result.booths} booths, ${result.vendors} vendors, ${result.photos} photos.`,
      )
      onRestored?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-panel">
      <h3>Backup</h3>
      <p className="muted">
        Download a full copy of this event (map image, booths, visit status, tags, and item photos)
        for laptop backup, or restore one onto this device.
      </p>
      <div className="chip-row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void exportBackup()}
        >
          {busy ? 'Working…' : 'Export event backup'}
        </button>
        <label className={`btn secondary${busy ? ' disabled' : ''}`}>
          Import backup…
          <input
            type="file"
            accept="application/json,.json"
            hidden
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importBackup(file)
            }}
          />
        </label>
      </div>
      {message && <p className="ok">{message}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  )
}
