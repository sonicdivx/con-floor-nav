import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import {
  clearPinHash,
  copyText,
  decodePinShare,
  encodePinShare,
  pinShareUrl,
  readPinFromLocationHash,
} from '../lib/pinShare'
import {
  createPartyClient,
  isPartyLiveEnabled,
  type PartyPeer,
  type PartyStatus,
} from '../lib/partySocket'

type Pin = { x: number; y: number }

type Props = {
  pin: Pin | null
  onApplySharedPin: (pin: Pin) => void
  onPeersChange: (peers: PartyPeer[], selfId: string | null) => void
  partyClientRef: MutableRefObject<ReturnType<typeof createPartyClient> | null>
}

export function SharePartyPanel({
  pin,
  onApplySharedPin,
  onPeersChange,
  partyClientRef,
}: Props) {
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
  const [partyCode, setPartyCode] = useState<string | null>(null)
  const [partyStatus, setPartyStatus] = useState<PartyStatus>('idle')
  const [partyDetail, setPartyDetail] = useState<string | null>(null)
  const [peers, setPeers] = useState<PartyPeer[]>([])
  const [selfId, setSelfId] = useState<string | null>(null)
  const selfIdRef = useRef<string | null>(null)
  const liveEnabled = isPartyLiveEnabled()

  const client = useMemo(() => {
    if (!liveEnabled) return null
    return createPartyClient({
      onStatus: (s, detail) => {
        setPartyStatus(s)
        setPartyDetail(detail ?? null)
      },
      onJoined: ({ code, selfId: id, members }) => {
        selfIdRef.current = id
        setPartyCode(code)
        setSelfId(id)
        setPeers(members.filter((m) => m.id !== id))
      },
      onMembers: (members) => {
        const id = selfIdRef.current
        setPeers(members.filter((m) => m.id !== id))
      },
      onPeerPin: (peer) => {
        if (peer.id === selfIdRef.current) return
        setPeers((prev) => {
          const next = prev.filter((p) => p.id !== peer.id)
          next.push(peer)
          return next
        })
      },
      onLeft: () => {
        selfIdRef.current = null
        setPartyCode(null)
        setSelfId(null)
        setPeers([])
      },
    })
  }, [liveEnabled])

  useEffect(() => {
    partyClientRef.current = client
    return () => {
      client?.dispose()
      partyClientRef.current = null
    }
  }, [client, partyClientRef])

  useEffect(() => {
    onPeersChange(peers, selfId)
  }, [peers, selfId, onPeersChange])

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
    if (!client) return
    const name = nickname.trim() || 'Friend'
    persistName(name)
    try {
      await client.create(name, pin ?? undefined)
    } catch (e) {
      setPartyDetail(e instanceof Error ? e.message : 'Create failed')
    }
  }

  const joinParty = async () => {
    if (!client) return
    const name = nickname.trim() || 'Friend'
    persistName(name)
    try {
      await client.join(joinCode, name, pin ?? undefined)
    } catch (e) {
      setPartyDetail(e instanceof Error ? e.message : 'Join failed')
    }
  }

  const leaveParty = () => {
    client?.leave()
    selfIdRef.current = null
    setPartyCode(null)
    setSelfId(null)
    setPeers([])
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

      {liveEnabled ? (
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
          {partyCode ? (
            <div className="party-active">
              <p>
                Party code: <strong className="party-code">{partyCode}</strong>
                <span className="muted sm"> · {partyStatus}</span>
              </p>
              <button type="button" className="btn ghost sm" onClick={leaveParty}>
                Leave party
              </button>
              {peers.length > 0 && (
                <ul className="peer-list">
                  {peers.map((p) => (
                    <li key={p.id}>
                      {p.name}{' '}
                      <span className="muted sm">
                        ({p.x.toFixed(2)}, {p.y.toFixed(2)})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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
          {partyDetail && <p className="muted sm">{partyDetail}</p>}
        </>
      ) : (
        <p className="muted sm">
          Live party sharing is off until <code>VITE_PARTY_WS_URL</code> is set (see
          README).
        </p>
      )}
    </div>
  )
}

export type PartyClientHandle = ReturnType<typeof createPartyClient>
