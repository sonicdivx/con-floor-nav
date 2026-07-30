import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  getActiveEventId,
  getOrCreateUserLocation,
} from './db/schema'
import type { BoothRecord, VendorRecord } from './db/types'
import { DEFAULT_TAGS } from './db/types'
import { MapViewer, type MapMode } from './components/MapViewer'
import { VendorPanel } from './components/VendorPanel'
import { ImportPanel } from './components/ImportPanel'
import { AiExtractPanel } from './components/AiExtractPanel'
import { GalleryPanel } from './components/GalleryPanel'
import { STATUS_COLORS, STATUS_LABELS } from './lib/statusColors'
import { maybeAutoSeedOtakonSample } from './lib/sampleData'
import './App.css'

type Tab = 'map' | 'setup' | 'ai' | 'gallery' | 'nav'

function App() {
  const [eventId, setEventId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('map')
  const [mapMode, setMapMode] = useState<MapMode>('navigate')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selectedBoothId, setSelectedBoothId] = useState<number | null>(null)
  const [navTargetBoothId, setNavTargetBoothId] = useState<number | null>(null)
  const [mapUrl, setMapUrl] = useState<string | null>(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsMsg, setGpsMsg] = useState<string | null>(null)

  useEffect(() => {
    void getActiveEventId().then(setEventId)
  }, [])

  useEffect(() => {
    if (eventId == null) return
    void maybeAutoSeedOtakonSample(eventId).catch((err) => {
      console.warn('Auto-seed Otakon sample skipped:', err)
    })
  }, [eventId])

  const event = useLiveQuery(
    () => (eventId != null ? db.events.get(eventId) : undefined),
    [eventId],
  )
  const floorMap = useLiveQuery(
    () => (eventId != null ? db.floorMaps.where('eventId').equals(eventId).first() : undefined),
    [eventId],
  )
  const booths = useLiveQuery(
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

  const quickPick = useMemo(() => {
    const list = (vendors ?? []).filter(
      (v) => v.visitStatus === 'favorite' || v.visitStatus === 'look_again',
    )
    list.sort((a, b) => {
      if (a.visitStatus !== b.visitStatus) {
        return a.visitStatus === 'favorite' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    return list
  }, [vendors])

  const updateBoothRect = async (boothId: number, rect: BoothRecord['rect']) => {
    await db.booths.update(boothId, { rect })
  }

  const setPin = async (x: number, y: number) => {
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

  const navigateToVendor = (vendor: VendorRecord) => {
    setNavTargetBoothId(vendor.boothId)
    setSelectedBoothId(vendor.boothId)
    setTab('map')
    setMapMode('navigate')
  }

  const navigateToBooth = (boothId: number) => {
    setNavTargetBoothId(boothId)
    setTab('map')
    setMapMode('navigate')
  }

  const openVendorById = (vendorId: number) => {
    const v = (vendors ?? []).find((x) => x.id === vendorId)
    if (!v) return
    setSelectedBoothId(v.boothId)
    setTab('map')
  }

  if (eventId == null) {
    return (
      <div className="app-loading">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CFN</span>
          <div>
            <strong>{event?.name ?? 'Con Floor Nav'}</strong>
            <span className="muted sm">{event?.venueNotes}</span>
          </div>
        </div>
        <nav className="tabs" aria-label="Main">
          {(
            [
              ['map', 'Map'],
              ['nav', 'Go'],
              ['gallery', 'Photos'],
              ['setup', 'Setup'],
              ['ai', 'AI'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'map' && (
        <div className="map-layout">
          <div className="map-toolbar">
            <div className="chip-row wrap">
              {(
                [
                  ['navigate', 'Browse'],
                  ['edit', 'Edit booths'],
                  ['pin', 'My pin'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  className={`chip ${mapMode === m ? 'active' : ''}`}
                  onClick={() => setMapMode(m)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                disabled={gpsBusy}
                onClick={useGps}
              >
                {gpsBusy ? 'GPS…' : 'Optional GPS'}
              </button>
            </div>
            <div className="chip-row wrap">
              <button
                type="button"
                className={`chip ${tagFilter == null ? 'active' : ''}`}
                onClick={() => setTagFilter(null)}
              >
                All tags
              </button>
              {DEFAULT_TAGS.map((t) => (
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
          </div>

          <div className="map-body">
            <MapViewer
              mapUrl={mapUrl}
              mapWidth={floorMap?.width ?? 1000}
              mapHeight={floorMap?.height ?? 700}
              booths={booths ?? []}
              obstacles={floorMap?.obstacles ?? []}
              vendorsByBoothId={vendorsByBoothId}
              tagFilter={tagFilter}
              selectedBoothId={selectedBoothId}
              navTargetBoothId={navTargetBoothId}
              pin={userLoc ? { x: userLoc.x, y: userLoc.y } : null}
              mode={mapMode}
              onSelectBooth={setSelectedBoothId}
              onUpdateBoothRect={(id, rect) => void updateBoothRect(id, rect)}
              onPinChange={(x, y) => void setPin(x, y)}
              onNavigateBooth={navigateToBooth}
              onViewBoothDetails={setSelectedBoothId}
            />
            {selectedVendor && selectedBooth && (
              <VendorPanel
                vendor={selectedVendor}
                boothLabel={selectedBooth.label}
                onClose={() => setSelectedBoothId(null)}
                onNavigate={() => navigateToVendor(selectedVendor)}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'nav' && (
        <div className="stack-panel page">
          <h2>Navigate</h2>
          <p className="muted">
            Quick pick from favorites and look-again. Routes an aisle path from your pin around booths and pillars.
          </p>
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
          {navTargetBoothId != null && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setNavTargetBoothId(null)}
            >
              Clear navigation line
            </button>
          )}
        </div>
      )}

      {tab === 'setup' && (
        <div className="page">
          <ImportPanel eventId={eventId} onDone={() => setTab('map')} />
        </div>
      )}

      {tab === 'ai' && (
        <div className="page">
          <AiExtractPanel eventId={eventId} onImported={() => setTab('map')} />
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
