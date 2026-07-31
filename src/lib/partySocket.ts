export type PartyPeer = {
  id: string
  name: string
  x: number
  y: number
  updatedAt: number
}

export type PartyStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'error'

type Handlers = {
  onStatus: (s: PartyStatus, detail?: string) => void
  onJoined: (info: { code: string; selfId: string; members: PartyPeer[] }) => void
  onMembers: (members: PartyPeer[]) => void
  onPeerPin: (peer: PartyPeer) => void
  onLeft?: () => void
}

function toPartyWsUrl(base: string): string {
  let u = base.trim().replace(/\/$/, '')
  if (u.startsWith('https://')) u = `wss://${u.slice('https://'.length)}`
  else if (u.startsWith('http://')) u = `ws://${u.slice('http://'.length)}`
  else if (!u.startsWith('ws://') && !u.startsWith('wss://')) {
    const proto =
      typeof location !== 'undefined' && location.protocol === 'https:'
        ? 'wss://'
        : 'ws://'
    u = `${proto}${u}`
  }
  if (!u.endsWith('/party')) u = `${u}/party`
  return u
}

function wsUrlFromEnv(): string | null {
  const raw = import.meta.env.VITE_PARTY_WS_URL as string | undefined
  if (!raw?.trim()) return null
  return toPartyWsUrl(raw)
}

function isPartyEnvSet(): boolean {
  const raw = import.meta.env.VITE_PARTY_WS_URL as string | undefined
  return Boolean(raw?.trim())
}

/** True when live party UI should be shown. */
export function isPartyLiveEnabled(): boolean {
  return isPartyEnvSet()
}

export function createPartyClient(handlers: Handlers) {
  let ws: WebSocket | null = null
  let selfId: string | null = null
  let code: string | null = null
  let intentionalClose = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let lastJoin:
    | { kind: 'create'; name: string; pin?: { x: number; y: number } }
    | { kind: 'join'; code: string; name: string; pin?: { x: number; y: number } }
    | null = null

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const connect = (): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const base = wsUrlFromEnv()
      if (!base) {
        reject(new Error('VITE_PARTY_WS_URL not set'))
        return
      }

      handlers.onStatus('connecting')
      const socket = new WebSocket(base)
      socket.onopen = () => {
        ws = socket
        resolve(socket)
      }
      socket.onerror = () => {
        handlers.onStatus('error', 'WebSocket connection failed')
        reject(new Error('WebSocket connection failed'))
      }
      socket.onclose = () => {
        ws = null
        if (intentionalClose) {
          handlers.onStatus('idle')
          return
        }
        handlers.onStatus('reconnecting')
        clearReconnect()
        reconnectTimer = setTimeout(() => {
          void reconnect()
        }, 2000)
      }
      socket.onmessage = (ev) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>
        } catch {
          return
        }
        if (msg.type === 'joined') {
          selfId = String(msg.selfId)
          code = String(msg.code)
          handlers.onStatus('joined')
          handlers.onJoined({
            code: String(msg.code),
            selfId: String(msg.selfId),
            members: (msg.members as PartyPeer[]) ?? [],
          })
        } else if (msg.type === 'members') {
          handlers.onMembers((msg.members as PartyPeer[]) ?? [])
        } else if (msg.type === 'peer_pin') {
          handlers.onPeerPin({
            id: String(msg.id),
            name: String(msg.name ?? 'Friend'),
            x: Number(msg.x),
            y: Number(msg.y),
            updatedAt: Number(msg.updatedAt ?? Date.now()),
          })
        } else if (msg.type === 'left') {
          selfId = null
          code = null
          handlers.onLeft?.()
          handlers.onStatus('idle')
        } else if (msg.type === 'error') {
          handlers.onStatus('error', String(msg.message ?? 'Party error'))
        }
      }
    })

  const reconnect = async () => {
    if (!lastJoin) return
    try {
      await connect()
      if (lastJoin.kind === 'create') {
        send({ type: 'create', name: lastJoin.name, pin: lastJoin.pin })
      } else {
        send({
          type: 'join',
          code: lastJoin.code,
          name: lastJoin.name,
          pin: lastJoin.pin,
        })
      }
    } catch {
      clearReconnect()
      reconnectTimer = setTimeout(() => void reconnect(), 4000)
    }
  }

  const send = (payload: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }

  return {
    get selfId() {
      return selfId
    },
    get code() {
      return code
    },
    async create(name: string, pin?: { x: number; y: number }) {
      intentionalClose = false
      lastJoin = { kind: 'create', name, pin }
      await connect()
      send({ type: 'create', name, pin })
    },
    async join(partyCode: string, name: string, pin?: { x: number; y: number }) {
      intentionalClose = false
      lastJoin = { kind: 'join', code: partyCode, name, pin }
      await connect()
      send({ type: 'join', code: partyCode, name, pin })
    },
    publishPin(x: number, y: number) {
      send({ type: 'pin', x, y })
      if (lastJoin) lastJoin = { ...lastJoin, pin: { x, y } }
    },
    leave() {
      intentionalClose = true
      clearReconnect()
      send({ type: 'leave' })
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
      ws = null
      selfId = null
      code = null
      lastJoin = null
      handlers.onStatus('idle')
    },
    dispose() {
      intentionalClose = true
      clearReconnect()
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
      ws = null
    },
  }
}

/** Stable cheerful color from a string (peer name/id). */
export function peerColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `hsl(${hue} 85% 58%)`
}
