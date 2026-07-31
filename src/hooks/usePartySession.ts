import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPartyClient,
  isPartyLiveEnabled,
  type PartyPeer,
  type PartyStatus,
} from '../lib/partySocket'

export type PartyClient = ReturnType<typeof createPartyClient>

/**
 * Owns the live-party WebSocket for the lifetime of the app shell so tab
 * switches (Go → Map) do not dispose the connection.
 */
export function usePartySession() {
  const liveEnabled = isPartyLiveEnabled()
  const [status, setStatus] = useState<PartyStatus>('idle')
  const [detail, setDetail] = useState<string | null>(null)
  const [partyCode, setPartyCode] = useState<string | null>(null)
  const [selfId, setSelfId] = useState<string | null>(null)
  const [peers, setPeers] = useState<PartyPeer[]>([])
  const selfIdRef = useRef<string | null>(null)
  const clientRef = useRef<PartyClient | null>(null)

  useEffect(() => {
    if (!liveEnabled) {
      clientRef.current = null
      return
    }

    const client = createPartyClient({
      onStatus: (s, d) => {
        setStatus(s)
        setDetail(d ?? null)
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
    clientRef.current = client

    return () => {
      client.dispose()
      if (clientRef.current === client) clientRef.current = null
    }
  }, [liveEnabled])

  const create = useCallback(async (name: string, pin?: { x: number; y: number }) => {
    try {
      await clientRef.current?.create(name, pin)
    } catch (e) {
      setDetail(e instanceof Error ? e.message : 'Create failed')
      setStatus('error')
    }
  }, [])

  const join = useCallback(
    async (code: string, name: string, pin?: { x: number; y: number }) => {
      try {
        await clientRef.current?.join(code, name, pin)
      } catch (e) {
        setDetail(e instanceof Error ? e.message : 'Join failed')
        setStatus('error')
      }
    },
    [],
  )

  const leave = useCallback(() => {
    clientRef.current?.leave()
    selfIdRef.current = null
    setPartyCode(null)
    setSelfId(null)
    setPeers([])
    setStatus('idle')
    setDetail(null)
  }, [])

  const publishPin = useCallback((x: number, y: number) => {
    clientRef.current?.publishPin(x, y)
  }, [])

  return {
    liveEnabled,
    status,
    detail,
    partyCode,
    selfId,
    peers,
    inParty: partyCode != null,
    create,
    join,
    leave,
    publishPin,
    clientRef,
  }
}
