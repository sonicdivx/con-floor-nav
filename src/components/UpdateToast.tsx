import { useEffect, useState } from 'react'
import {
  dismissAppUpdate,
  applyAppUpdate,
  subscribeAppUpdate,
} from '../lib/appUpdate'
import { APP_VERSION, latestChangelog } from '../lib/changelog'

type Props = {
  onOpenChangelog: () => void
}

/** Banner when a new service-worker build is waiting. */
export function UpdateToast({ onOpenChangelog }: Props) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const entry = latestChangelog()

  useEffect(() => subscribeAppUpdate(setAvailable), [])

  if (!available) return null

  const highlights = entry.highlights.slice(0, 4)

  return (
    <div className="update-toast" role="status" aria-live="polite">
      <div className="update-toast-body">
        <strong>Update available</strong>
        <p className="muted sm">
          v{entry.version !== APP_VERSION ? entry.version : APP_VERSION}
          {highlights.length ? ` — ${highlights.join(' · ')}` : ''}
        </p>
        <button
          type="button"
          className="btn ghost sm update-toast-link"
          onClick={onOpenChangelog}
        >
          Full changelog
        </button>
      </div>
      <div className="update-toast-actions">
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy}
          onClick={() => dismissAppUpdate()}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void applyAppUpdate().finally(() => setBusy(false))
          }}
        >
          {busy ? 'Updating…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
