import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { PiTrash } from 'react-icons/pi'
import {
  db,
  ensureVendorForBooth,
  getActiveEventId,
  getOrCreateUserLocation,
  getStoredFloorMapId,
  resolveActiveFloorMapId,
  setActiveFloorMapId,
} from './db/schema'
import type { Rect, VendorRecord, VisitStatus } from './db/types'
import { MapViewer, type MapMode, type TourStopMarker } from './components/MapViewer'
import { TourStopList } from './components/TourStopList'
import { VendorPanel } from './components/VendorPanel'
import { ImportPanel } from './components/ImportPanel'
import { AiExtractPanel } from './components/AiExtractPanel'
import { BackupPanel } from './components/BackupPanel'
import { DeviceLoginPanel } from './components/DeviceLoginPanel'
import { EventsPanel } from './components/EventsPanel'
import { MapsPanel } from './components/MapsPanel'
import { GalleryPanel } from './components/GalleryPanel'
import { NativeAppPanel } from './components/NativeAppPanel'
import { SharePartyPanel } from './components/SharePartyPanel'
import { NavCollapsible } from './components/NavCollapsible'
import { DealerSearch, type DealerHit } from './components/DealerSearch'
import { UpdateToast } from './components/UpdateToast'
import { ChangelogPanel } from './components/ChangelogPanel'
import { STATUS_COLORS, STATUS_LABELS } from './lib/statusColors'
import { maybeAutoSeedOtakonSample } from './lib/sampleData'
import { mergeTagCatalog, registerCustomTags } from './lib/tags'
import type { PartyPeer } from './lib/partySocket'
import { peerColor } from './lib/partySocket'
import { usePartySession } from './hooks/usePartySession'
import { syncCatalogFromCloud } from './lib/cloudSync'
import { APP_VERSION } from './lib/changelog'
import { planTour } from './lib/tourPlan'
import type { NormPoint } from './lib/pathfinding'
import './App.css'

const TOUR_STATUS_OPTIONS: Array<Exclude<VisitStatus, 'none'>> = [
  'favorite',
  'look_again',
  'end_of_con',
]

const TOUR_STATUS_RANK: Record<VisitStatus, number> = {
  favorite: 0,
  look_again: 1,
  end_of_con: 2,
  none: 3,
}

type Tab = 'map' | 'settings' | 'ai' | 'gallery' | 'nav' | 'changelog'

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
  /** Booth ids in planned tour visit order (active map only). Path is derived from this. */
  const [tourStopIds, setTourStopIds] = useState<number[] | null>(null)
  const [tourStatusFilters, setTourStatusFilters] = useState<
    Record<Exclude<VisitStatus, 'none'>, boolean>
  >({
    favorite: true,
    look_again: true,
    end_of_con: true,
  })
  /** Map-placed destination after the last booth stop (normalized coords). */
  const [tourEndPin, setTourEndPin] = useState<NormPoint | null>(null)
  /** Manually added booth ids for the next / current tour plan. */
  const [tourExtraBoothIds, setTourExtraBoothIds] = useState<number[]>([])
  const [tourMsg, setTourMsg] = useState<string | null>(null)
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

  const clearTour = () => {
    setTourStopIds(null)
    setTourMsg(null)
  }

  const resetMapSession = () => {
    setBoothDrafts({})
    setSelectedBoothId(null)
    setDetailsPinned(false)
    setDetailsExpanded(false)
    setNavTargetBoothId(null)
    setNavTargetPoint(null)
    clearTour()
    setTourExtraBoothIds([])
    setTourEndPin(null)
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
      // One-shot force after Booth-info releases so stale IndexedDB picks up masterlists.
      let shouldForce = force
      try {
        if (!force && localStorage.getItem('cfn-force-catalog-v10') !== '1') {
          shouldForce = true
          localStorage.setItem('cfn-force-catalog-v10', '1')
        }
      } catch {
        /* ignore */
      }
      const result = await syncCatalogFromCloud({ force: shouldForce })
      if (cancelled) return
      if (result.ok) {
        if (!result.skipped) {
          const mapPart =
            result.maps != null
              ? ` · ${result.maps} map${result.maps === 1 ? '' : 's'}`
              : ''
          setSyncMsg(
            `Synced ${result.events} event${result.events === 1 ? '' : 's'} from cloud${mapPart}.`,
          )
          // Keep the user's active map; only resolve when nothing is selected yet.
          if (eventId != null) {
            void (async () => {
              const maps = await db.floorMaps
                .where('eventId')
                .equals(eventId)
                .toArray()
              const ids = new Set(
                maps.map((m) => m.id).filter((id): id is number => id != null),
              )
              setFloorMapId((current) => {
                if (current != null && ids.has(current)) return current
                const stored = getStoredFloorMapId(eventId)
                if (stored != null && ids.has(stored)) return stored
                return current
              })
              const stored = getStoredFloorMapId(eventId)
              if (stored == null || !ids.has(stored)) {
                const next = await resolveActiveFloorMapId(eventId)
                if (next != null) setFloorMapId(next)
              }
            })()
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

  const mapPin = useMemo(() => {
    if (localPin) return localPin
    if (userLoc) return { x: userLoc.x, y: userLoc.y }
    return null
  }, [localPin, userLoc?.x, userLoc?.y])

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
        (v.visitStatus === 'favorite' ||
          v.visitStatus === 'look_again' ||
          v.visitStatus === 'end_of_con'),
    )
    list.sort((a, b) => {
      const rank =
        TOUR_STATUS_RANK[a.visitStatus] - TOUR_STATUS_RANK[b.visitStatus]
      if (rank !== 0) return rank
      return a.name.localeCompare(b.name)
    })
    return list
  }, [vendors, booths])

  const tourCandidateCount = useMemo(() => {
    const boothIds = new Set(
      (booths ?? [])
        .map((b) => b.id)
        .filter((id): id is number => id != null),
    )
    const selected = new Set(
      TOUR_STATUS_OPTIONS.filter((s) => tourStatusFilters[s]),
    )
    let count = 0
    for (const v of vendors ?? []) {
      if (!boothIds.has(v.boothId)) continue
      if (selected.has(v.visitStatus as Exclude<VisitStatus, 'none'>)) count += 1
    }
    for (const id of tourExtraBoothIds) {
      if (!boothIds.has(id)) continue
      const v = vendorsByBoothId.get(id)
      if (v && selected.has(v.visitStatus as Exclude<VisitStatus, 'none'>)) {
        continue
      }
      count += 1
    }
    return count
  }, [
    booths,
    vendors,
    vendorsByBoothId,
    tourStatusFilters,
    tourExtraBoothIds,
  ])

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
    clearTour()
    setNavTargetBoothId(null)
    setNavTargetPoint(p)
    focusNonce.current += 1
    setFocusRequest({ x: p.x, y: p.y, nonce: focusNonce.current })
    setTab('map')
    setMapMode('navigate')
  }, [])

  const navigateToPeer = (peer: PartyPeer) => {
    clearTour()
    setNavTargetBoothId(null)
    setNavTargetPoint({ x: peer.x, y: peer.y })
    focusNonce.current += 1
    setFocusRequest({ x: peer.x, y: peer.y, nonce: focusNonce.current })
    setTab('map')
    setMapMode('navigate')
  }

  const navigateToBooth = (boothId: number) => {
    // Set target + pin immediately so the dashed line can render (no live-query lag).
    clearTour()
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

  const activeMapName =
    floorMap?.name?.trim() ||
    (floorMapId != null ? mapNameById.get(floorMapId) : undefined) ||
    'This map'

  /**
   * Aisle path + numbered markers always follow `tourStopIds` order.
   * Reorder / remove / end-pin changes recalculate the path automatically.
   */
  const { tourPath, tourStopMarkers } = useMemo(() => {
    if (tourStopIds == null) {
      return {
        tourPath: null as NormPoint[] | null,
        tourStopMarkers: null as TourStopMarker[] | null,
      }
    }

    const mapBoothList = booths ?? []
    const pin = mapPin ?? { x: 0.5, y: 0.5 }
    const boothById = new Map<number, (typeof mapBoothList)[number]>()
    for (const b of mapBoothList) {
      if (b.id != null) boothById.set(b.id, b)
    }

    const stops = tourStopIds.flatMap((boothId) => {
      const booth = boothById.get(boothId)
      if (!booth) return []
      const vendor = vendorsByBoothId.get(boothId)
      return [
        {
          boothId,
          rect: booth.rect,
          label: booth.label || booth.boothKey || String(boothId),
          name: vendor?.name?.trim() || `Booth ${booth.label || boothId}`,
          visitStatus: vendor?.visitStatus ?? ('none' as const),
        },
      ]
    })

    if (!stops.length && !tourEndPin) {
      return { tourPath: null, tourStopMarkers: null }
    }

    const result = planTour({
      pin,
      stops,
      end: tourEndPin,
      orderedBoothIds: tourStopIds,
      mapWidth: floorMap?.width ?? 1000,
      mapHeight: floorMap?.height ?? 700,
      boothRects: mapBoothList.map((b) => b.rect),
      obstacles: floorMap?.obstacles ?? [],
    })

    return {
      tourPath: result.path.length >= 2 ? result.path : null,
      tourStopMarkers: result.orderedStops.map((s) => ({
        boothId: s.boothId,
        x: s.center.x,
        y: s.center.y,
        label: s.label,
        index: s.index,
        kind: 'stop' as const,
      })),
    }
  }, [
    tourStopIds,
    tourEndPin,
    mapPin,
    booths,
    vendorsByBoothId,
    floorMap?.width,
    floorMap?.height,
    floorMap?.obstacles,
  ])

  /** Search result → switch map if needed, aisle-nav to booth at default fit scale. */
  const navigateToDealer = (hit: DealerHit) => {
    const { booth } = hit
    if (booth.id == null) return
    // Dismiss keyboard / clear any iOS focus scroll before switching tabs.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    window.scrollTo(0, 0)
    clearTour()
    setTourExtraBoothIds([])
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

  const addBoothToTour = (hit: DealerHit) => {
    const { booth, vendor } = hit
    if (booth.id == null) return
    if (booth.floorMapId != null && booth.floorMapId !== floorMapId) {
      const other =
        booth.floorMapId != null
          ? mapNameById.get(booth.floorMapId)
          : undefined
      setTourMsg(
        `${vendor.name} is on ${other ?? 'another map'}. Switch maps to tour that hall.`,
      )
      return
    }
    setTourExtraBoothIds((prev) =>
      prev.includes(booth.id!) ? prev : [...prev, booth.id!],
    )
    setTourMsg(null)
  }

  const focusTourStop = (boothId: number | null, x: number, y: number) => {
    if (boothId != null) setSelectedBoothId(boothId)
    focusNonce.current += 1
    setFocusRequest({ x, y, nonce: focusNonce.current })
    setTab('map')
    setMapMode('navigate')
  }

  const startSetTourEndPin = () => {
    setTab('map')
    setMapMode('tourEnd')
    setMapMenuOpen(false)
    setMapFullscreen(false)
    setTourMsg('Tap the map to place the tour end pin.')
  }

  const setTourEndPinOnMap = (x: number, y: number) => {
    setTourEndPin({ x, y })
    setTourMsg(
      tourStopIds != null
        ? 'End pin set · path recalculated'
        : 'Tour end pin set.',
    )
    // Activate an empty tour shell so the end pin alone can draw a path.
    if (tourStopIds == null) setTourStopIds([])
  }

  const clearTourEndPin = () => {
    setTourEndPin(null)
    if (tourStopIds != null && tourStopIds.length === 0) {
      clearTour()
      setTourMsg('End pin cleared.')
    } else if (tourStopIds != null) {
      setTourMsg('End pin cleared · path recalculated')
    } else {
      setTourMsg('End pin cleared.')
    }
    if (mapMode === 'tourEnd') setMapMode('navigate')
  }

  const removeTourStop = (boothId: number) => {
    if (!tourStopIds) return
    const next = tourStopIds.filter((id) => id !== boothId)
    if (!next.length && !tourEndPin) {
      clearTour()
      setTourMsg('Tour cleared.')
      return
    }
    setTourStopIds(next)
    setTourMsg('Stop removed · path recalculated')
  }

  const reorderTourStops = (orderedIds: number[]) => {
    setNavTargetBoothId(null)
    setNavTargetPoint(null)
    setTourStopIds(orderedIds)
    setTourMsg('Stop order changed · path recalculated')
  }

  const buildTour = () => {
    const mapBoothList = booths ?? []
    if (!mapBoothList.length) {
      setTourMsg('No booths on this map yet.')
      return
    }

    const pin = mapPin ?? { x: 0.5, y: 0.5 }
    if (!mapPin) setLocalPin(pin)

    const selectedStatuses = new Set(
      TOUR_STATUS_OPTIONS.filter((s) => tourStatusFilters[s]),
    )
    const boothById = new Map<number, (typeof mapBoothList)[number]>()
    for (const b of mapBoothList) {
      if (b.id != null) boothById.set(b.id, b)
    }

    const stopIds = new Set<number>()
    for (const v of vendors ?? []) {
      if (!selectedStatuses.has(v.visitStatus as Exclude<VisitStatus, 'none'>)) {
        continue
      }
      if (boothById.has(v.boothId)) stopIds.add(v.boothId)
    }
    for (const id of tourExtraBoothIds) {
      if (boothById.has(id)) stopIds.add(id)
    }

    if (!stopIds.size && !tourEndPin) {
      setTourStopIds(null)
      setTourMsg('No matching booths on this map. Mark favorites or add a booth.')
      return
    }

    const stops = [...stopIds].map((boothId) => {
      const booth = boothById.get(boothId)!
      const vendor = vendorsByBoothId.get(boothId)
      return {
        boothId,
        rect: booth.rect,
        label: booth.label || booth.boothKey || String(boothId),
        name: vendor?.name?.trim() || `Booth ${booth.label || boothId}`,
        visitStatus: vendor?.visitStatus ?? ('none' as const),
      }
    })

    const result = planTour({
      pin,
      stops,
      end: tourEndPin,
      mapWidth: floorMap?.width ?? 1000,
      mapHeight: floorMap?.height ?? 700,
      boothRects: mapBoothList.map((b) => b.rect),
      obstacles: floorMap?.obstacles ?? [],
    })

    if (!result.orderedStops.length && !tourEndPin) {
      setTourStopIds(null)
      setTourMsg('Could not plan a route for those booths.')
      return
    }

    setNavTargetBoothId(null)
    setNavTargetPoint(null)
    setTourStopIds(result.orderedStops.map((s) => s.boothId))

    const parts: string[] = [
      `${result.orderedStops.length} stop${result.orderedStops.length === 1 ? '' : 's'} on ${activeMapName}`,
    ]
    if (tourEndPin) parts.push('ends at end pin')
    if (result.skippedBoothIds.length) {
      parts.push(`${result.skippedBoothIds.length} skipped`)
    }
    if (result.usedStraightFallback) {
      parts.push('some legs use a straight line')
    }
    setTourMsg(parts.join(' · '))
    setTab('map')
    setMapMode('navigate')
    setMapFitNonce((n) => n + 1)
    void ensurePin()
  }

  const openBoothDetails = (boothId: number) => {
    // Open / switch panel immediately — don't wait on IndexedDB.
    // Keep pin state: fill means “keep open while browsing,” not “this booth.”
    setSelectedBoothId(boothId)
    setTab('map')
    // Expand sheet when masterlist info exists so Booth info isn't clipped.
    void db.booths.get(boothId).then((b) => {
      if (b?.catalogInfo) setDetailsExpanded(true)
    })
    if (eventId != null) {
      void ensureVendorForBooth(eventId, boothId).catch((err) => {
        console.warn('ensureVendorForBooth failed', err)
      })
    }
  }

  const selectBoothForDetails = (boothId: number | null) => {
    setSelectedBoothId(boothId)
    if (boothId != null) {
      void db.booths.get(boothId).then((b) => {
        if (b?.catalogInfo) setDetailsExpanded(true)
      })
    }
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

  const openChangelog = () => setAppTab('changelog')

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
        <div className="topbar-map-actions">
          <button
            type="button"
            className="icon-btn map-menu-toggle"
            aria-label="Map filters and modes"
            aria-expanded={mapMenuOpen}
            aria-controls="map-toolbar"
            onClick={() => {
              if (tab !== 'map') setAppTab('map')
              setMapMenuOpen((open) => !open)
            }}
          >
            <span className="hamburger-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn secondary sm map-expand-btn"
            hidden={tab !== 'map'}
            onClick={enterMapFullscreen}
          >
            Full map
          </button>
        </div>
        <nav className="tabs" aria-label="Main">
          {(floorMaps?.length ?? 0) > 1 ? (
            <select
              className={`tab tab-map-select${tab === 'map' ? ' active' : ''}`}
              aria-label="Floor map"
              value={floorMapId ?? ''}
              onFocus={() => {
                if (tab !== 'map') setAppTab('map')
              }}
              onClick={() => {
                if (tab !== 'map') setAppTab('map')
              }}
              onChange={(e) => {
                const id = Number(e.target.value)
                if (!Number.isFinite(id)) return
                if (id !== floorMapId) switchFloorMap(id)
                setAppTab('map')
              }}
            >
              {(floorMaps ?? []).map((m) =>
                m.id != null ? (
                  <option key={m.id} value={m.id}>
                    {m.name?.trim() || 'Floor map'}
                  </option>
                ) : null,
              )}
            </select>
          ) : (
            <button
              type="button"
              className={`tab${tab === 'map' ? ' active' : ''}`}
              onClick={() => setAppTab('map')}
            >
              Map
            </button>
          )}
          {(
            [
              ['nav', 'Go'],
              ['gallery', 'Photos'],
              ['settings', 'Settings'],
              ['ai', 'AI'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab${tab === id ? ' active' : ''}`}
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
                className="btn secondary sm map-toolbar-fullmap"
                onClick={enterMapFullscreen}
              >
                Full map
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={openChangelog}
              >
                Changelog
              </button>
              <p className="app-menu-version">v{APP_VERSION}</p>
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
              tourPath={tourPath}
              tourStops={tourStopMarkers}
              tourEndPin={tourEndPin}
              focusRequest={focusRequest}
              fitRequest={mapFitNonce}
              peerPins={peerPins}
              pin={mapPin}
              mode={mapMode}
              onSelectBooth={selectBoothForDetails}
              onUpdateBoothRect={updateBoothRectDraft}
              onPinChange={(x, y) => void setPin(x, y)}
              onTourEndChange={setTourEndPinOnMap}
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
            Search dealers, plan a multi-stop tour on this map, or share a live party pin. Routes an aisle path from your pin around booths and pillars.
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

          <section className="nav-section">
            <h3>
              Plan route
              <span className="muted sm"> · {activeMapName}</span>
            </h3>
            <p className="muted sm">
              Builds an aisle tour from My pin through booths on this map only
              (Dealers and Artist Alley stay separate).
            </p>
            <div className="tour-status-filters">
              {TOUR_STATUS_OPTIONS.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    checked={tourStatusFilters[status]}
                    onChange={(e) =>
                      setTourStatusFilters((prev) => ({
                        ...prev,
                        [status]: e.target.checked,
                      }))
                    }
                  />
                  <span
                    className="status-dot"
                    style={{ background: STATUS_COLORS[status] }}
                  />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </div>
            <p className="muted sm">
              {tourCandidateCount} matching booth
              {tourCandidateCount === 1 ? '' : 's'} on this map
              {tourExtraBoothIds.length
                ? ` · ${tourExtraBoothIds.length} added`
                : ''}
            </p>
            <DealerSearch
              vendors={vendors ?? []}
              booths={booths ?? []}
              mapNameById={mapNameById}
              onSelect={addBoothToTour}
              placeholder="Add booth to tour…"
            />
            {tourExtraBoothIds.length > 0 && (
              <ul className="tour-extra-list">
                {tourExtraBoothIds.map((id) => {
                  const booth = (booths ?? []).find((b) => b.id === id)
                  const vendor = vendorsByBoothId.get(id)
                  return (
                    <li key={id} className="tour-extra-chip">
                      <span>
                        {vendor?.name ?? `Booth ${booth?.label ?? id}`}
                      </span>
                      <button
                        type="button"
                        aria-label="Remove from tour"
                        onClick={() =>
                          setTourExtraBoothIds((prev) =>
                            prev.filter((x) => x !== id),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="tour-end-block">
              <p className="tour-end-label">
                End pin
                <span className="muted sm"> · after the last stop</span>
              </p>
              <div className="tour-actions" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={`btn sm ${mapMode === 'tourEnd' ? 'primary' : 'secondary'}`}
                  onClick={startSetTourEndPin}
                >
                  {tourEndPin ? 'Move end pin on map' : 'Set end pin on map'}
                </button>
                {tourEndPin && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={clearTourEndPin}
                  >
                    Clear end pin
                  </button>
                )}
              </div>
              {tourEndPin && (
                <p className="muted sm tour-end-selected">
                  End pin set on this map
                </p>
              )}
            </div>

            {tourStopIds && tourStopMarkers && tourStopMarkers.length > 0 && (
              <TourStopList
                items={tourStopMarkers
                  .filter(
                    (s): s is TourStopMarker & { boothId: number } =>
                      s.kind !== 'end' && s.boothId != null,
                  )
                  .map((s) => {
                    const vendor = vendorsByBoothId.get(s.boothId)
                    return {
                      boothId: s.boothId,
                      index: s.index,
                      x: s.x,
                      y: s.y,
                      label: s.label,
                      name: vendor?.name?.trim() || `Booth ${s.label}`,
                      visitStatus: vendor?.visitStatus ?? 'none',
                    }
                  })}
                onReorder={reorderTourStops}
                onRemove={removeTourStop}
                onFocus={(boothId, x, y) => focusTourStop(boothId, x, y)}
              />
            )}
            {tourEndPin && tourStopIds != null && (
              <div className="tour-stop-row is-end tour-end-list-row">
                <span className="tour-stop-num end">E</span>
                <span className="tour-end-list-copy">
                  <strong>End pin</strong>
                  <span className="muted sm">Destination after last stop</span>
                </span>
                <button
                  type="button"
                  className="tour-stop-delete"
                  aria-label="Clear end pin"
                  onClick={clearTourEndPin}
                >
                  <PiTrash size={20} aria-hidden />
                </button>
              </div>
            )}
            {tourMsg && <p className="muted sm">{tourMsg}</p>}
            <div className="tour-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => buildTour()}
              >
                Plan route on this map
              </button>
              {(tourStopIds != null || tourPath != null) && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    clearTour()
                    setTourExtraBoothIds([])
                  }}
                >
                  Clear tour
                </button>
              )}
            </div>
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
            <h3>Favorites, look again & end of con</h3>
            {!quickPick.length && (
              <p className="muted">
                Mark vendors as Favorite, Look again, or End of con first.
              </p>
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
                Favorites, notes, and photos stay on this device unless you use Device login below.
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
            <DeviceLoginPanel
              onLoaded={() => {
                setLocalPin(null)
                setSelectedBoothId(null)
                if (eventId != null) {
                  void resolveActiveFloorMapId(eventId).then(setFloorMapId)
                }
              }}
            />
          </section>

          <section className="panel-section settings-section">
            <h3>About</h3>
            <div className="settings-card">
              <p className="muted sm">App version v{APP_VERSION}</p>
              <button type="button" className="btn secondary" onClick={openChangelog}>
                Changelog
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

      {tab === 'changelog' && (
        <ChangelogPanel onBack={() => setAppTab('map')} />
      )}

      <UpdateToast onOpenChangelog={openChangelog} />
    </div>
  )
}

export default App
