import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  ensureVendorForBooth,
  getActiveEventId,
  getOrCreateUserLocation,
  resolveActiveFloorMapId,
  setActiveFloorMapId,
} from './db/schema'
import type { Rect, VendorRecord } from './db/types'
import { MapViewer, type MapMode } from './components/MapViewer'
import { VendorPanel } from './components/VendorPanel'
import { ImportPanel } from './components/ImportPanel'
import { AiExtractPanel } from './components/AiExtractPanel'
import { BackupPanel } from './components/BackupPanel'
import { EventsPanel } from './components/EventsPanel'
import { MapsPanel } from './components/MapsPanel'
import { GalleryPanel } from './components/GalleryPanel'
import { NativeAppPanel } from './components/NativeAppPanel'
import { SharePartyPanel } from './components/SharePartyPanel'
import { NavCollapsible } from './components/NavCollapsible'
import { DealerSearch, type DealerHit } from './components/DealerSearch'
import { STATUS_COLORS, STATUS_LABELS } from './lib/statusColors'
import { maybeAutoSeedOtakonSample } from './lib/sampleData'
import { mergeTagCatalog, registerCustomTags } from './lib/tags'
import type { PartyPeer } from './lib/partySocket'
import { peerColor } from './lib/partySocket'
import { usePartySession } from './hooks/usePartySession'
import { syncCatalogFromCloud } from './lib/cloudSync'
import './App.css'

type Tab = 'map' | 'settings' | 'ai' | 'gallery' | 'nav'

function App() {
  const [eventId, setEventId] = useState<number | null>(null)
  const [floorMapId, setFloorMapId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('map')
  const [mapMode, setMapMode] = useState<MapMode>('navigate')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selectedBoothId, setSelectedBoothId] = useState<number | null>(null)
  /** Unsaved booth rect edits while in Settings → Customize → Map edit mode. */
  const [boothDrafts, setBoothDrafts] = useState<Record<number, Rect>>({})
  const [boothEditSaving, setBoothEditSaving] = useState(false)
  /** Keep details panel open while tapping the map. */
  const [detailsPinned, setDetailsPinned] = useState(false)
  /** Expand vendor details sheet to near-full height. */
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  /** Immediate pin for nav (avoids live-query lag after getOrCreate). */
  const [localPin, setLocalPin] = useState<{ x: number; y: number } | null>(null)
  const [navTargetBoothId, setNavTargetBoothId] = useState<number | null>(null)
  const [navTargetPoint, setNavTargetPoint] = useState<{
    x: number
    y: number
  } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{
    x: number
    y: number
    nonce: number
  } | null>(null)
  /** Bump to reset the map to default fit scale (dealer search). */
  const [mapFitNonce, setMapFitNonce] = useState(0)
  const [mapUrl, setMapUrl] = useState<string | null>(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsMsg, setGpsMsg] = useState<string | null>(null)
  const [mapMenuOpen, setMapMenuOpen] = useState(false)
  const [mapFullscreen, setMapFullscreen] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const party = usePartySession()
  const peerPins = party.peers
  const lastPinPublish = useRef(0)
  const focusNonce = useRef(0)

  const resetMapSession = () => {
    setBoothDrafts({})
    setSelectedBoothId(null)
    setDetailsPinned(false)
    setDetailsExpanded(false)
    setNavTargetBoothId(null)
    setNavTargetPoint(null)
    setLocalPin(null)
    setMapMode('navigate')
  }

  const switchEvent = (id: number) => {
    setEventId(id)
    setFloorMapId(null)
    resetMapSession()
    setTab('map')
  }

  const switchFloorMap = (id: number) => {
    if (eventId != null) setActiveFloorMapId(eventId, id)
    setFloorMapId(id)
    resetMapSession()
  }

  useEffect(() => {
    void getActiveEventId().then(setEventId)
  }, [])

  useEffect(() => {
    if (eventId == null) return
    // First-run only: don't dump Otakon sample into every newly created blank event.
    void (async () => {
      const count = await db.events.count()
      if (count !== 1) return
      try {
        await maybeAutoSeedOtakonSample(eventId)
      } catch (err) {
        console.warn('Auto-seed Otakon sample skipped:', err)
      }
    })()
  }, [eventId])

  /** Pull shared catalog when online (cloud = source of truth for maps/dealers). */
  useEffect(() => {
    let cancelled = false
    const run = async (force = false) => {
      const result = await syncCatalogFromCloud({ force })
      if (cancelled) return
      if (result.ok) {
        if (!result.skipped) {
          setSyncMsg(
            `Synced ${result.events} event${result.events === 1 ? '' : 's'} from cloud.`,
          )
          if (eventId != null) {
            void resolveActiveFloorMapId(eventId).then(setFloorMapId)
          }
        }
      } else if (
        result.error !== 'Offline' &&
        !result.error.includes('not configured')
      ) {
        setSyncMsg(`Sync: ${result.error}`)
      }
    }
    void run(false)
    const onOnline = () => void run(false)
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
    }
  }, [eventId])

  useEffect(() => {
    if (eventId == null) return
    void resolveActiveFloorMapId(eventId).then(setFloorMapId)
  }, [eventId])

  const event = useLiveQuery(
    () => (eventId != null ? db.events.get(eventId) : undefined),
    [eventId],
  )
  const floorMaps = useLiveQuery(
    () =>
      eventId != null
        ? db.floorMaps.where('eventId').equals(eventId).sortBy('createdAt')
        : [],
    [eventId],
  )
  const floorMap = useLiveQuery(
    () => (floorMapId != null ? db.floorMaps.get(floorMapId) : undefined),
    [floorMapId],
  )
  const booths = useLiveQuery(
    () => {
      if (eventId == null) return []
      if (floorMapId != null) {
        return db.booths.where('floorMapId').equals(floorMapId).toArray()
      }
      return db.booths.where('eventId').equals(eventId).toArray()
    },
    [eventId, floorMapId],
  )
  /** All booths for the event — dealer search spans maps. */
  const allBooths = useLiveQuery(
    () => (eventId != null ? db.booths.where('eventId').equals(eventId).toArray() : []),
    [eventId],
  )
  const vendors = useLiveQuery(
    () => (eventId != null ? db.vendors.where('eventId').equals(eventId).toArray() : []),
    [eventId],
  )
  const userLoc = useLiveQuery(
    () => (eventId != null ? db.userLocations.where('eventId').equals(eventId).first() : undefined),
    [eventId],
  )

  useEffect(() => {
    if (!floorMap?.imageBlob) {
      setMapUrl(null)
      return
    }
    const url = URL.createObjectURL(floorMap.imageBlob)
    setMapUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [floorMap?.id, floorMap?.imageBlob])

  useEffect(() => {
    if (eventId == null) return
    void getOrCreateUserLocation(eventId)
  }, [eventId])

  useEffect(() => {
    if (userLoc) setLocalPin({ x: userLoc.x, y: userLoc.y })
  }, [userLoc?.id, userLoc?.x, userLoc?.y])

  const mapPin = localPin ?? (userLoc ? { x: userLoc.x, y: userLoc.y } : null)

  const vendorsByBoothId = useMemo(() => {
    const m = new Map<number, VendorRecord>()
    for (const v of vendors ?? []) m.set(v.boothId, v)
    return m
  }, [vendors])

  const selectedVendor = useMemo(() => {
    if (selectedBoothId == null) return null
    return vendorsByBoothId.get(selectedBoothId) ?? null
  }, [selectedBoothId, vendorsByBoothId])

  const selectedBooth = useMemo(() => {
    if (selectedBoothId == null) return null
    return (booths ?? []).find((b) => b.id === selectedBoothId) ?? null
  }, [booths, selectedBoothId])

  const mapBooths = useMemo(() => {
    const list = booths ?? []
    if (mapMode !== 'edit' || Object.keys(boothDrafts).length === 0) return list
    return list.map((b) => {
      if (b.id == null) return b
      const draft = boothDrafts[b.id]
      return draft ? { ...b, rect: draft } : b
    })
  }, [booths, boothDrafts, mapMode])

  const boothEditsDirty = Object.keys(boothDrafts).length > 0

  const quickPick = useMemo(() => {
    const boothIds = new Set(
      (booths ?? [])
        .map((b) => b.id)
        .filter((id): id is number => id != null),
    )
    const list = (vendors ?? []).filter(
      (v) =>
        boothIds.has(v.boothId) &&
        (v.visitStatus === 'favorite' || v.visitStatus === 'look_again'),
    )
    list.sort((a, b) => {
      if (a.visitStatus !== b.visitStatus) {
        return a.visitStatus === 'favorite' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    return list
  }, [vendors, booths])

  const filterTags = useMemo(() => {
    const inUse: string[] = []
    for (const v of vendors ?? []) {
      for (const t of v.tags) inUse.push(t)
    }
    return mergeTagCatalog(inUse)
  }, [vendors])

  useEffect(() => {
    if (!vendors?.length) return
    const inUse: string[] = []
    for (const v of vendors) {
      for (const t of v.tags) inUse.push(t)
    }
    registerCustomTags(inUse)
  }, [vendors])

  const updateBoothRectDraft = (boothId: number, rect: Rect) => {
    setBoothDrafts((prev) => ({ ...prev, [boothId]: rect }))
  }

  const startEditBooths = () => {
    setBoothDrafts({})
    setDetailsPinned(false)
    setSelectedBoothId(null)
    setMapMode('edit')
    setTab('map')
    setMapMenuOpen(false)
    setMapFullscreen(false)
  }

  const saveBoothEdits = async () => {
    const entries = Object.entries(boothDrafts)
    if (entries.length === 0) return
    setBoothEditSaving(true)
    try {
      await db.transaction('rw', db.booths, async () => {
        for (const [id, rect] of entries) {
          await db.booths.update(Number(id), { rect })
        }
      })
      setBoothDrafts({})
    } finally {
      setBoothEditSaving(false)
    }
  }

  const resetBoothEdits = () => {
    setBoothDrafts({})
  }

  const exitEditBooths = () => {
    if (boothEditsDirty && !window.confirm('Discard unsaved booth changes?')) {
      return
    }
    setBoothDrafts({})
    setMapMode('navigate')
  }

  const setPin = async (x: number, y: number) => {
    setLocalPin({ x, y })
    if (eventId == null) return
    const loc = await getOrCreateUserLocation(eventId)
    if (loc.id != null) {
      await db.userLocations.update(loc.id, {
        x,
        y,
        source: 'manual',
        updatedAt: Date.now(),
      })
    }
    const now = Date.now()
    if (now - lastPinPublish.current >= 1500) {
      lastPinPublish.current = now
      party.publishPin(x, y)
    } else {
      window.setTimeout(() => {
        const t = Date.now()
        if (t - lastPinPublish.current >= 1400) {
          lastPinPublish.current = t
          party.publishPin(x, y)
        }
      }, 1600)
    }
  }

  const ensurePin = async () => {
    if (eventId == null) return mapPin
    if (mapPin) return mapPin
    const loc = await getOrCreateUserLocation(eventId)
    const p = { x: loc.x, y: loc.y }
    setLocalPin(p)
    return p
  }

  const applySharedPin = useCallback(async (p: { x: number; y: number }) => {
    setNavTargetBoothId(null)
    setNavTargetPoint(p)
    focusNonce.current += 1
    setFocusRequest({ x: p.x, y: p.y, nonce: focusNonce.current })
    setTab('map')
    setMapMode('navigate')
  }, [])

  const navigateToPeer = (peer: PartyPeer) => {
    setNavTargetBoothId(null)
    setNavTargetPoint({ x: peer.x, y: peer.y })
    focusNonce.current += 1
    setFocusRequest({ x: peer.x, y: peer.y, nonce: focusNonce.current })
    setTab('map')
    setMapMode('navigate')
  }

  const navigateToBooth = (boothId: number) => {
    // Set target + pin immediately so the dashed line can render (no live-query lag).
    if (!mapPin) setLocalPin({ x: 0.5, y: 0.5 })
    const booth = (booths ?? []).find((b) => b.id === boothId)
    setNavTargetBoothId(boothId)
    // Point fallback if booth id lookup races / misses in the map layer.
    if (booth) {
      setNavTargetPoint({
        x: booth.rect.x + booth.rect.w / 2,
        y: booth.rect.y + booth.rect.h / 2,
      })
    } else {
      setNavTargetPoint(null)
    }
    setTab('map')
    setMapMode('navigate')
    void ensurePin()
  }

  const navigateToVendor = (vendor: VendorRecord) => {
    const booth =
      (booths ?? []).find((b) => b.id === vendor.boothId) ??
      (booths ?? []).find((b) => b.id != null && vendorsByBoothId.get(b.id)?.id === vendor.id)
    if (booth?.id != null) {
      setSelectedBoothId(booth.id)
      navigateToBooth(booth.id)
    } else {
      navigateToBooth(vendor.boothId)
      setSelectedBoothId(vendor.boothId)
    }
  }

  const mapNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const fm of floorMaps ?? []) {
      if (fm.id != null) m.set(fm.id, fm.name?.trim() || 'Floor map')
    }
    return m
  }, [floorMaps])

  /** Search result → switch map if needed, aisle-nav to booth at default fit scale. */
  const navigateToDealer = (hit: DealerHit) => {
    const { booth } = hit
    if (booth.id == null) return
    // Dismiss keyboard / clear any iOS focus scroll before switching tabs.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    window.scrollTo(0, 0)
    if (booth.floorMapId != null && booth.floorMapId !== floorMapId) {
      if (eventId != null) setActiveFloorMapId(eventId, booth.floorMapId)
      setFloorMapId(booth.floorMapId)
      setBoothDrafts({})
      setDetailsPinned(false)
      setMapMode('navigate')
    }
    setSelectedBoothId(booth.id)
    if (!mapPin) setLocalPin({ x: 0.5, y: 0.5 })
    setNavTargetBoothId(booth.id)
    setNavTargetPoint({
      x: booth.rect.x + booth.rect.w / 2,
      y: booth.rect.y + booth.rect.h / 2,
    })
    // Do not zoom/focus the booth — keep (or reset to) default fit scale.
    // Focusing was also interacting badly with iOS input page-zoom after search.
    setMapFitNonce((n) => n + 1)
    setTab('map')
    setMapMode('navigate')
    void ensurePin()
  }

  const openBoothDetails = (boothId: number) => {
    // Open / switch panel immediately — don't wait on IndexedDB.
    // Keep pin state: fill means “keep open while browsing,” not “this booth.”
    setSelectedBoothId(boothId)
    setTab('map')
    if (eventId != null) {
      void ensureVendorForBooth(eventId, boothId).catch((err) => {
        console.warn('ensureVendorForBooth failed', err)
      })
    }
  }

  const selectBoothForDetails = (boothId: number | null) => {
    setSelectedBoothId(boothId)
    if (boothId != null && eventId != null) {
      void ensureVendorForBooth(eventId, boothId).catch((err) => {
        console.warn('ensureVendorForBooth failed', err)
      })
    }
  }

  const closeBoothDetails = () => {
    setSelectedBoothId(null)
    setDetailsPinned(false)
    setDetailsExpanded(false)
  }

  const useGps = () => {
    setGpsMsg(null)
    if (!navigator.geolocation) {
      setGpsMsg('Geolocation not available in this browser.')
      return
    }
    if (!window.isSecureContext) {
      setGpsMsg(
        'GPS needs a secure context (HTTPS or localhost). Use npm run dev:https on LAN.',
      )
      return
    }
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGpsBusy(false)
        if (eventId == null || !floorMap) {
          setGpsMsg('Need a map first. GPS→image mapping is approximate — use the pin.')
          return
        }
        // Without calibration, drop pin near center as a soft hint and store accuracy.
        const loc = await getOrCreateUserLocation(eventId)
        if (loc.id != null) {
          await db.userLocations.update(loc.id, {
            source: 'gps',
            accuracy: pos.coords.accuracy,
            updatedAt: Date.now(),
            // Keep existing pin; halls need manual placement. Mark source for UI.
          })
        }
        setGpsMsg(
          `GPS fix ±${Math.round(pos.coords.accuracy)}m. Convention halls need the manual pin — drag it in Pin mode.`,
        )
        setMapMode('pin')
      },
      (err) => {
        setGpsBusy(false)
        setGpsMsg(err.message || 'GPS failed')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  const openVendorById = (vendorId: number) => {
    const v = (vendors ?? []).find((x) => x.id === vendorId)
    if (!v) return
    setSelectedBoothId(v.boothId)
    setTab('map')
  }

  const setAppTab = (next: Tab) => {
    if (
      mapMode === 'edit' &&
      next !== 'map' &&
      boothEditsDirty &&
      !window.confirm('Leave map editing? Unsaved booth changes will be discarded.')
    ) {
      return
    }
    if (mapMode === 'edit' && next !== 'map') {
      setBoothDrafts({})
      setMapMode('navigate')
    }
    setTab(next)
    setMapMenuOpen(false)
    if (next !== 'map') setMapFullscreen(false)
  }

  const enterMapFullscreen = () => {
    setMapFullscreen(true)
    setMapMenuOpen(false)
  }

  const exitMapFullscreen = () => {
    setMapFullscreen(false)
    setMapMenuOpen(false)
  }

  if (eventId == null) {
    return (
      <div className="app-loading">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div className={`app${mapFullscreen ? ' map-fullscreen' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CFN</span>
          <div>
            <strong>{event?.name ?? 'Con Floor Nav'}</strong>
            <span className="muted sm">{event?.venueNotes}</span>
          </div>
        </div>
        {tab === 'map' && (
          <div className="topbar-map-actions">
            <button
              type="button"
              className="icon-btn map-menu-toggle"
              aria-label="Map filters and modes"
              aria-expanded={mapMenuOpen}
              aria-controls="map-toolbar"
              onClick={() => setMapMenuOpen((open) => !open)}
            >
              <span className="hamburger-icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn secondary sm map-expand-btn"
              onClick={enterMapFullscreen}
            >
              Full map
            </button>
          </div>
        )}
        <nav className="tabs" aria-label="Main">
          {(
            [
              ['map', 'Map'],
              ['nav', 'Go'],
              ['gallery', 'Photos'],
              ['settings', 'Settings'],
              ['ai', 'AI'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab ${tab === id ? 'active' : ''}`}
              onClick={() => setAppTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'map' && (
        <div className="map-layout">
          {mapMenuOpen && (
            <button
              type="button"
              className="map-menu-backdrop"
              aria-label="Close map menu"
              onClick={() => setMapMenuOpen(false)}
            />
          )}
          <div
            id="map-toolbar"
            className={`map-toolbar${mapMenuOpen ? ' is-open' : ''}`}
            role={mapMenuOpen ? 'dialog' : undefined}
            aria-label={mapMenuOpen ? 'Map filters and modes' : undefined}
          >
            <div className="map-toolbar-header">
              <strong>Map options</strong>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setMapMenuOpen(false)}
              >
                Close
              </button>
            </div>
            <DealerSearch
              compact
              vendors={vendors ?? []}
              booths={allBooths ?? []}
              mapNameById={mapNameById}
              placeholder="Search dealers…"
              onSelect={(hit) => {
                setMapMenuOpen(false)
                navigateToDealer(hit)
              }}
            />
            <div className="chip-row wrap">
              {mapMode === 'edit' ? (
                <span className="muted sm">
                  Editing booth layout — use Save / Reset below. Started from Settings →
                  Customize → Map.
                </span>
              ) : (
                <button
                  type="button"
                  className="chip"
                  disabled={gpsBusy}
                  onClick={useGps}
                >
                  {gpsBusy ? 'GPS…' : 'Optional GPS'}
                </button>
              )}
            </div>
            {gpsMsg && <p className="muted sm gps-msg">{gpsMsg}</p>}
            {mapMode === 'pin' && (
              <p className="muted sm gps-msg">
                Tap the map to drop your pin. Press and hold the pin to drag it.
              </p>
            )}
            <div className="chip-row wrap">
              {(floorMaps?.length ?? 0) > 1 && (
                <>
                  {(floorMaps ?? []).map((m) =>
                    m.id != null ? (
                      <button
                        key={m.id}
                        type="button"
                        className={`chip ${floorMapId === m.id ? 'active' : ''}`}
                        onClick={() => switchFloorMap(m.id!)}
                      >
                        {m.name?.trim() || 'Floor map'}
                      </button>
                    ) : null,
                  )}
                </>
              )}
              <button
                type="button"
                className={`chip ${tagFilter == null ? 'active' : ''}`}
                onClick={() => setTagFilter(null)}
              >
                All tags
              </button>
              {filterTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip ${tagFilter === t ? 'active' : ''}`}
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {gpsMsg && <p className="muted sm gps-msg">{gpsMsg}</p>}
            <div className="legend">
              {(Object.keys(STATUS_COLORS) as Array<keyof typeof STATUS_COLORS>).map(
                (s) => (
                  <span key={s} className="legend-item">
                    <i style={{ background: STATUS_COLORS[s] }} />
                    {STATUS_LABELS[s]}
                  </span>
                ),
              )}
            </div>
            <div className="map-toolbar-footer">
              <button
                type="button"
                className="btn secondary sm"
                onClick={enterMapFullscreen}
              >
                Full map
              </button>
            </div>
          </div>

          <div className="map-body">
            <MapViewer
              mapUrl={mapUrl}
              mapWidth={floorMap?.width ?? 1000}
              mapHeight={floorMap?.height ?? 700}
              booths={mapBooths}
              obstacles={floorMap?.obstacles ?? []}
              vendorsByBoothId={vendorsByBoothId}
              tagFilter={tagFilter}
              selectedBoothId={selectedBoothId}
              navTargetBoothId={navTargetBoothId}
              navTargetPoint={navTargetPoint}
              focusRequest={focusRequest}
              fitRequest={mapFitNonce}
              peerPins={peerPins}
              pin={mapPin}
              mode={mapMode}
              onSelectBooth={selectBoothForDetails}
              onUpdateBoothRect={updateBoothRectDraft}
              onPinChange={(x, y) => void setPin(x, y)}
              onModeChange={setMapMode}
              onNavigateBooth={navigateToBooth}
              onViewBoothDetails={openBoothDetails}
              onSelectPeer={navigateToPeer}
              onMapBackgroundTap={() => {
                if (!detailsPinned) closeBoothDetails()
              }}
            />
            {mapMode === 'edit' && (
              <div className="booth-edit-bar" role="toolbar" aria-label="Booth layout editing">
                <div className="booth-edit-bar-copy">
                  <strong>Edit booths</strong>
                  <span className="muted sm">
                    {boothEditsDirty
                      ? `${Object.keys(boothDrafts).length} unsaved`
                      : 'Drag boxes · corner to resize'}
                  </span>
                </div>
                <div className="booth-edit-bar-actions">
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={!boothEditsDirty || boothEditSaving}
                    onClick={resetBoothEdits}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={!boothEditsDirty || boothEditSaving}
                    onClick={() => void saveBoothEdits()}
                  >
                    {boothEditSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={boothEditSaving}
                    onClick={exitEditBooths}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
            {mapFullscreen && (
              <div className="map-fullscreen-bar">
                <button
                  type="button"
                  className="btn secondary sm"
                  aria-expanded={mapMenuOpen}
                  aria-controls="map-toolbar"
                  onClick={() => setMapMenuOpen((open) => !open)}
                >
                  Menu
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={exitMapFullscreen}
                >
                  Exit full map
                </button>
              </div>
            )}
            {selectedBooth && eventId != null && mapMode !== 'edit' && (
              <VendorPanel
                key={selectedBooth.id}
                vendor={
                  selectedVendor ?? {
                    eventId,
                    boothId: selectedBooth.id!,
                    name:
                      selectedBooth.nameOverride?.trim() ||
                      `Booth ${selectedBooth.label}`,
                    tags: [],
                    visitStatus: 'none' as const,
                  }
                }
                boothLabel={selectedBooth.label}
                pinned={detailsPinned}
                expanded={detailsExpanded}
                onTogglePinned={() => setDetailsPinned((p) => !p)}
                onToggleExpanded={() => setDetailsExpanded((e) => !e)}
                onClose={closeBoothDetails}
                onNavigate={() => {
                  if (selectedVendor) navigateToVendor(selectedVendor)
                  else if (selectedBooth.id != null) navigateToBooth(selectedBooth.id)
                }}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'nav' && (
        <div className="stack-panel page">
          <h2>Navigate</h2>
          <p className="muted">
            Search dealers, quick-pick favorites, or share a live party pin. Routes an aisle path from your pin around booths and pillars.
          </p>

          <section className="nav-section">
            <h3>Find a dealer</h3>
            <DealerSearch
              vendors={vendors ?? []}
              booths={allBooths ?? []}
              mapNameById={mapNameById}
              onSelect={navigateToDealer}
              placeholder="Type a dealer or booth…"
            />
          </section>

          <NavCollapsible
            key={party.inParty ? 'party-in' : 'party-out'}
            title="Share & party"
            summary={
              party.inParty
                ? `${party.partyCode} · ${party.status}`
                : party.liveEnabled
                  ? 'Create or join'
                  : 'Share pin'
            }
            defaultOpen={!party.inParty}
          >
            <SharePartyPanel
              pin={mapPin}
              onApplySharedPin={(p) => void applySharedPin(p)}
              party={{
                liveEnabled: party.liveEnabled,
                status: party.status,
                detail: party.detail,
                partyCode: party.partyCode,
                create: party.create,
                join: party.join,
                leave: party.leave,
              }}
            />
          </NavCollapsible>

          {party.inParty && (
            <section className="nav-section">
              <h3>
                Party members
                <span className="muted sm">
                  {party.peers.length
                    ? ` · ${party.peers.length} online · ${party.partyCode}`
                    : ` · Waiting · ${party.partyCode}`}
                </span>
              </h3>
              {!party.peers.length ? (
                <p className="muted sm">No other members yet — share your party code.</p>
              ) : (
                <ul className="nav-list">
                  {party.peers.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="nav-item"
                        onClick={() => navigateToPeer(p)}
                      >
                        <span
                          className="status-dot"
                          style={{ background: peerColor(p.id || p.name) }}
                        />
                        <span>
                          <strong>{p.name}</strong>
                          <span className="muted sm">Tap to navigate to their pin</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="nav-section">
            <h3>Favorites & look again</h3>
            {!quickPick.length && (
              <p className="muted">Mark vendors as Favorite or Look again first.</p>
            )}
            <ul className="nav-list">
              {quickPick.map((v) => {
                const booth = (booths ?? []).find((b) => b.id === v.boothId)
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className="nav-item"
                      onClick={() => navigateToVendor(v)}
                    >
                      <span
                        className="status-dot"
                        style={{ background: STATUS_COLORS[v.visitStatus] }}
                      />
                      <span>
                        <strong>{v.name}</strong>
                        <span className="muted sm">
                          Booth {booth?.label ?? '?'} · {STATUS_LABELS[v.visitStatus]}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {(navTargetBoothId != null || navTargetPoint != null) && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setNavTargetBoothId(null)
                setNavTargetPoint(null)
              }}
            >
              Clear navigation line
            </button>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="page settings-page">
          <h2>Settings</h2>
          <p className="muted">
            Manage events and floor maps, import data, and customize this device.
          </p>

          <section className="panel-section settings-section">
            <EventsPanel activeEventId={eventId} onSwitchEvent={switchEvent} />
          </section>

          <section className="panel-section settings-section">
            <MapsPanel
              eventId={eventId}
              activeFloorMapId={floorMapId}
              onSwitchMap={switchFloorMap}
            />
          </section>

          <section className="panel-section settings-section">
            <h3>Customize</h3>
            <div className="settings-card">
              <h4>Map</h4>
              <p className="muted sm">
                Nudge booth boxes so they match the printed floor plan. Edits stay on this device
                until you save. Kept out of the map menu so it isn’t tapped by accident on phones.
              </p>
              <button type="button" className="btn primary" onClick={startEditBooths}>
                Edit booth layout
              </button>
            </div>
          </section>

          <section className="panel-section settings-section">
            <h3>Cloud sync</h3>
            <div className="settings-card">
              <p className="muted sm">
                Shared floor maps and dealer directories sync from the server when you are online.
                Favorites, notes, and photos stay on this device.
              </p>
              {syncMsg && <p className="muted sm">{syncMsg}</p>}
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  void syncCatalogFromCloud({ force: true }).then((result) => {
                    if (result.ok) {
                      setSyncMsg(
                        result.skipped
                          ? 'Already up to date.'
                          : `Synced ${result.events} event${result.events === 1 ? '' : 's'} from cloud.`,
                      )
                      if (eventId != null) {
                        void resolveActiveFloorMapId(eventId).then(setFloorMapId)
                      }
                    } else {
                      setSyncMsg(`Sync: ${result.error}`)
                    }
                  })
                }}
              >
                Sync now
              </button>
            </div>
          </section>

          <section className="panel-section settings-section">
            <BackupPanel
              eventId={eventId}
              onRestored={() => {
                setLocalPin(null)
                setSelectedBoothId(null)
                setNavTargetBoothId(null)
                setNavTargetPoint(null)
                void resolveActiveFloorMapId(eventId).then(setFloorMapId)
              }}
            />
          </section>

          <section className="panel-section settings-section">
            <NativeAppPanel />
          </section>

          <section className="panel-section settings-section">
            <ImportPanel
              eventId={eventId}
              floorMapId={floorMapId}
              onDone={() => setAppTab('map')}
            />
          </section>
        </div>
      )}

      {tab === 'ai' && (
        <div className="page">
          <AiExtractPanel
            eventId={eventId}
            floorMapId={floorMapId}
            onImported={() => setTab('map')}
          />
        </div>
      )}

      {tab === 'gallery' && (
        <div className="page">
          <GalleryPanel eventId={eventId} onOpenVendor={openVendorById} />
        </div>
      )}
    </div>
  )
}

export default App
