import { useCallback, useEffect, useState } from 'react'
import {
  clearPinHash,
  copyText,
  decodePinShare,
  encodePinShare,
  pinShareUrl,
  readPinFromLocationHash,
} from '../lib/pinShare'
import type { PartyStatus } from '../lib/partySocket'

type Pin = { x: number; y: number }

export type PartySessionProps = {
  liveEnabled: boolean
  status: PartyStatus
  detail: string | null
  partyCode: string | null
  create: (name: string, pin?: Pin) => Promise<void>
  join: (code: string, name: string, pin?: Pin) => Promise<void>
  leave: () => void
}

type Props = {
  pin: Pin | null
  onApplySharedPin: (pin: Pin) => void
  party: PartySessionProps
}

export function SharePartyPanel({ pin, onApplySharedPin, party }: Props) {
  const [pasteValue, setPasteValue] = useState('')
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem('cfn-party-name') || ''
    } catch {
      return ''
    }
  })
  const [joinCode, setJoinCode] = useState('')

  const applyShared = useCallback(
    (p: Pin) => {
      onApplySharedPin(p)
    },
    [onApplySharedPin],
  )

  useEffect(() => {
    const fromHash = readPinFromLocationHash()
    if (!fromHash) return
    applyShared(fromHash)
    clearPinHash()
    setShareMsg('Opened shared pin from link.')
  }, [applyShared])

  const sharePin = async () => {
    if (!pin) {
      setShareMsg('Drop your pin on the map first.')
      return
    }
    const text = pinShareUrl(pin)
    const ok = await copyText(text)
    setShareMsg(
      ok
        ? `Copied share link (${encodePinShare(pin)}). Send via SMS/Signal.`
        : `Copy failed — paste manually: ${encodePinShare(pin)}`,
    )
  }

  const applyPaste = () => {
    const decoded = decodePinShare(pasteValue)
    if (!decoded) {
      setShareMsg('Could not parse pin. Use cfn1:x,y or a #pin= link.')
      return
    }
    applyShared(decoded)
    setShareMsg('Navigating to shared pin.')
    setPasteValue('')
  }

  const persistName = (name: string) => {
    setNickname(name)
    try {
      localStorage.setItem('cfn-party-name', name)
    } catch {
      /* ignore */
    }
  }

  const createParty = async () => {
    const name = nickname.trim() || 'Friend'
    persistName(name)
    await party.create(name, pin ?? undefined)
  }

  const joinParty = async () => {
    const name = nickname.trim() || 'Friend'
    persistName(name)
    await party.join(joinCode, name, pin ?? undefined)
  }

  return (
    <div className="share-party-panel">
      <h3>Share pin</h3>
      <p className="muted sm">
        Offline-friendly: copies a link with encoded map coordinates. Friends paste it
        below or open the link.
      </p>
      <div className="chip-row wrap">
        <button
          type="button"
          className="btn secondary sm"
          onClick={() => void sharePin()}
        >
          Copy share link
        </button>
      </div>
      <label className="field-label sm">
        Paste shared pin
        <div className="inline-row">
          <input
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="cfn1:0.12,0.34 or https://…/#pin=…"
            aria-label="Paste shared pin"
          />
          <button type="button" className="btn secondary sm" onClick={applyPaste}>
            Go
          </button>
        </div>
      </label>
      {shareMsg && <p className="muted sm">{shareMsg}</p>}

      {party.liveEnabled ? (
        <>
          <h3>Live party</h3>
          <p className="muted sm">
            Wi‑Fi only. Create or join a code to see each other’s pins. Don’t post codes
            publicly.
          </p>
          <label className="field-label sm">
            Display name
            <input
              value={nickname}
              onChange={(e) => persistName(e.target.value)}
              placeholder="Your name"
              maxLength={24}
            />
          </label>
          {party.partyCode ? (
            <div className="party-active">
              <p>
                Party code: <strong className="party-code">{party.partyCode}</strong>
                <span className="muted sm"> · {party.status}</span>
              </p>
              <button type="button" className="btn ghost sm" onClick={party.leave}>
                Leave party
              </button>
            </div>
          ) : (
            <div className="party-join">
              <button
                type="button"
                className="btn secondary sm"
                onClick={() => void createParty()}
              >
                Create party
              </button>
              <div className="inline-row">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  maxLength={8}
                  aria-label="Party code"
                />
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={() => void joinParty()}
                >
                  Join
                </button>
              </div>
            </div>
          )}
          {party.detail && <p className="muted sm">{party.detail}</p>}
        </>
      ) : (
        <p className="muted sm">
          Live party is off in local Vite until <code>VITE_PARTY_WS_URL</code> points at{' '}
          <code>npm run party-server</code>. On the Render deploy it uses this same host
          automatically.
        </p>
      )}
    </div>
  )
}
