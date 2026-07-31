import { useState } from 'react'
import {
  clearStoredDeviceCode,
  isDeviceSyncConfigured,
  loadPersonalFromCloud,
  loadStoredDeviceCode,
  savePersonalToCloud,
} from '../lib/personalSync'

type Props = {
  onLoaded?: () => void
}

export function DeviceLoginPanel({ onLoaded }: Props) {
  const [code, setCode] = useState(() => loadStoredDeviceCode() ?? '')
  const [loginInput, setLoginInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const available = isDeviceSyncConfigured()

  const save = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await savePersonalToCloud(code || null)
      setCode(result.code)
      setMessage(
        `Saved. Your login code is ${result.code}. Use it on another browser to pull favorites, notes, photos, and pin.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const login = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await loadPersonalFromCloud(loginInput || code)
      setCode((loginInput || code).trim().toUpperCase())
      setLoginInput('')
      setMessage(
        `Loaded ${result.vendors} dealer update${result.vendors === 1 ? '' : 's'} and ${result.photos} photo${result.photos === 1 ? '' : 's'} across ${result.events} event${result.events === 1 ? '' : 's'}.`,
      )
      onLoaded?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setMessage('Code copied.')
      setError(null)
    } catch {
      setError('Could not copy — select the code and copy manually.')
    }
  }

  return (
    <div className="stack-panel">
      <h3>Device login</h3>
      <p className="muted">
        No password — just a unique code. Save from this browser, then open the app somewhere else
        (bigger screen, or if this tab hung) and log in with the code to pull your favorites, notes,
        photos, and pin. Floor maps still sync from the shared catalog.
      </p>

      {!available && (
        <p className="err">
          Cloud login needs the app hosted with the party-server (production, or{' '}
          <code>npm start</code> / <code>VITE_PARTY_WS_URL</code> in dev).
        </p>
      )}

      <div className="settings-card device-login-card">
        <h4>This device</h4>
        {code ? (
          <p className="device-code" aria-label="Your device code">
            {code}
          </p>
        ) : (
          <p className="muted sm">No code yet — save to create one.</p>
        )}
        <div className="chip-row wrap">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !available}
            onClick={() => void save()}
          >
            {busy ? 'Working…' : code ? 'Save / update cloud' : 'Create code & save'}
          </button>
          {code && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => void copyCode()}
            >
              Copy code
            </button>
          )}
          {code && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() => {
                clearStoredDeviceCode()
                setCode('')
                setMessage('Forgot code on this browser (cloud copy kept).')
              }}
            >
              Forget locally
            </button>
          )}
        </div>
      </div>

      <div className="settings-card device-login-card">
        <h4>Log in on this browser</h4>
        <p className="muted sm">Enter a code from another device to pull your content here.</p>
        <div className="device-login-row">
          <input
            type="text"
            className="device-code-input"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. AB3K7Q2M"
            value={loginInput}
            disabled={busy || !available}
            onChange={(e) => setLoginInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void login()
            }}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={busy || !available || !(loginInput || code).trim()}
            onClick={() => void login()}
          >
            Log in &amp; pull
          </button>
        </div>
      </div>

      {message && <p className="ok">{message}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  )
}
