import { useEffect, useState } from 'react'
import { APP_VERSION, CHANGELOG } from '../lib/changelog'
import {
  checkAndApplyAppUpdate,
  subscribeAppUpdate,
} from '../lib/appUpdate'

type Props = {
  onBack?: () => void
}

export function ChangelogPanel({ onBack }: Props) {
  const [busy, setBusy] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => subscribeAppUpdate(setUpdateReady), [])

  return (
    <div className="stack-panel page changelog-page">
      <header className="changelog-header">
        <div>
          <h2>Changelog</h2>
          <p className="muted sm">You are on v{APP_VERSION}</p>
        </div>
        {onBack && (
          <button type="button" className="btn ghost sm" onClick={onBack}>
            Back
          </button>
        )}
      </header>

      <div className="settings-card changelog-update-card">
        <p className="muted sm">
          {updateReady
            ? 'A newer build is ready on this device.'
            : 'Pull the latest app shell from the server (uses a refresh).'}
        </p>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void checkAndApplyAppUpdate().finally(() => setBusy(false))
          }}
        >
          {busy ? 'Updating…' : 'Update to latest'}
        </button>
      </div>

      <ol className="changelog-list">
        {CHANGELOG.map((entry) => (
          <li key={entry.version} className="changelog-entry">
            <div className="changelog-entry-head">
              <strong>v{entry.version}</strong>
              <span className="muted sm">{entry.date}</span>
              {entry.version === APP_VERSION && (
                <span className="chip active changelog-current">Current</span>
              )}
            </div>
            <ul>
              {entry.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}
