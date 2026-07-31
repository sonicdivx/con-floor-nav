import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BoothRecord, VendorRecord } from '../db/types'
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors'

export type DealerHit = {
  vendor: VendorRecord
  booth: BoothRecord
  mapName?: string
}

type Props = {
  vendors: VendorRecord[]
  booths: BoothRecord[]
  mapNameById?: Map<number, string>
  onSelect: (hit: DealerHit) => void
  placeholder?: string
  /** Compact styling for map toolbar */
  compact?: boolean
}

function scoreDealer(query: string, vendor: VendorRecord, booth: BoothRecord): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const name = vendor.name.toLowerCase()
  const label = (booth.label || booth.boothKey).toLowerCase()
  const key = booth.boothKey.toLowerCase()
  const tags = vendor.tags.map((t) => t.toLowerCase())

  if (name === q || label === q || key === q) return 100
  if (name.startsWith(q) || label.startsWith(q) || key.startsWith(q)) return 80
  if (name.includes(q)) return 60
  if (label.includes(q) || key.includes(q)) return 50
  if (tags.some((t) => t.includes(q))) return 30
  return 0
}

/** Typeahead dealer search — filters as you type, select navigates to the booth. */
export function DealerSearch({
  vendors,
  booths,
  mapNameById,
  onSelect,
  placeholder = 'Search dealers…',
  compact = false,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  const boothById = useMemo(() => {
    const m = new Map<number, BoothRecord>()
    for (const b of booths) {
      if (b.id != null) m.set(b.id, b)
    }
    return m
  }, [booths])

  const hits = useMemo(() => {
    const q = query.trim()
    if (q.length < 1) return [] as DealerHit[]
    const scored: Array<DealerHit & { score: number }> = []
    for (const vendor of vendors) {
      const booth = boothById.get(vendor.boothId)
      if (!booth) continue
      const score = scoreDealer(q, vendor, booth)
      if (score <= 0) continue
      scored.push({
        vendor,
        booth,
        mapName:
          booth.floorMapId != null
            ? mapNameById?.get(booth.floorMapId)
            : undefined,
        score,
      })
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.vendor.name.localeCompare(b.vendor.name)
    })
    return scored.slice(0, 40)
  }, [query, vendors, boothById, mapNameById])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (hit: DealerHit) => {
    onSelect(hit)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && hits[activeIdx]) {
      e.preventDefault()
      pick(hits[activeIdx])
    }
  }

  return (
    <div
      ref={rootRef}
      className={`dealer-search${compact ? ' compact' : ''}${open && query.trim() ? ' is-open' : ''}`}
    >
      <label className="dealer-search-label">
        <span className="sr-only">Search dealers</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open && hits.length > 0}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && query.trim().length > 0 && (
        <ul id={listId} className="dealer-search-results" role="listbox">
          {hits.length === 0 ? (
            <li className="dealer-search-empty muted sm">No dealers match “{query.trim()}”</li>
          ) : (
            hits.map((hit, idx) => (
              <li key={hit.vendor.id ?? `${hit.booth.boothKey}-${hit.vendor.name}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === activeIdx}
                  className={`dealer-search-item${idx === activeIdx ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(hit)}
                >
                  <span
                    className="status-dot"
                    style={{ background: STATUS_COLORS[hit.vendor.visitStatus] }}
                  />
                  <span>
                    <strong>{hit.vendor.name}</strong>
                    <span className="muted sm">
                      Booth {hit.booth.label || hit.booth.boothKey}
                      {hit.mapName ? ` · ${hit.mapName}` : ''}
                      {hit.vendor.visitStatus !== 'none'
                        ? ` · ${STATUS_LABELS[hit.vendor.visitStatus]}`
                        : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
