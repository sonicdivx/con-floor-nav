import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { mergeTagCatalog, normalizeTag, registerCustomTag } from '../lib/tags'

interface Props {
  selected: string[]
  /** Extra tags known on this device / event (e.g. from other vendors). */
  catalogExtra?: string[]
  onChange: (tags: string[]) => void
}

export function TagSelect({ selected, catalogExtra = [], onChange }: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [catalogTick, setCatalogTick] = useState(0)

  const catalog = useMemo(
    () => mergeTagCatalog([...catalogExtra, ...selected]),
    [catalogExtra, selected, catalogTick],
  )

  const normalizedQuery = normalizeTag(query)
  const selectedSet = useMemo(
    () => new Set(selected.map(normalizeTag)),
    [selected],
  )

  const filtered = useMemo(() => {
    const available = catalog.filter((t) => !selectedSet.has(t))
    if (!normalizedQuery) return available
    return available.filter((t) => t.includes(normalizedQuery))
  }, [catalog, selectedSet, normalizedQuery])

  const exactMatch = normalizedQuery
    ? catalog.some((t) => t === normalizedQuery)
    : false
  const showAddNew = Boolean(normalizedQuery) && !exactMatch

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const toggle = (tag: string) => {
    const t = normalizeTag(tag)
    if (!t) return
    if (selectedSet.has(t)) {
      onChange(selected.filter((s) => normalizeTag(s) !== t))
    } else {
      onChange([...selected.map(normalizeTag), t])
    }
    setQuery('')
    inputRef.current?.focus()
  }

  const addNew = () => {
    if (!normalizedQuery) return
    const tag = registerCustomTag(normalizedQuery)
    setCatalogTick((n) => n + 1)
    if (!selectedSet.has(tag)) {
      onChange([...selected.map(normalizeTag), tag])
    }
    setQuery('')
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showAddNew) addNew()
      else if (filtered[0]) toggle(filtered[0])
      return
    }
    if (e.key === 'Backspace' && !query && selected.length > 0) {
      onChange(selected.slice(0, -1))
    }
  }

  return (
    <div className="tag-select" ref={rootRef}>
      <div className="tag-select-chips">
        {selected.map((tag) => (
          <button
            key={tag}
            type="button"
            className="chip active tag-select-chip"
            onClick={() => toggle(tag)}
            title={`Remove “${tag}”`}
          >
            {tag}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
      </div>

      <div className={`tag-select-field${open ? ' is-open' : ''}`}>
        <input
          ref={inputRef}
          className="input tag-select-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={selected.length ? 'Search or add tag…' : 'Search tags or add new…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul id={listId} className="tag-select-menu" role="listbox">
            {filtered.map((tag) => (
              <li key={tag} role="option">
                <button type="button" className="tag-select-option" onClick={() => toggle(tag)}>
                  {tag}
                </button>
              </li>
            ))}
            {showAddNew && (
              <li role="option">
                <button
                  type="button"
                  className="tag-select-option tag-select-add"
                  onClick={addNew}
                >
                  + Add New “{normalizedQuery}”
                </button>
              </li>
            )}
            {!filtered.length && !showAddNew && (
              <li className="tag-select-empty muted sm">No tags match</li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
