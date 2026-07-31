import { DEFAULT_TAGS } from '../db/types'

const STORAGE_KEY = 'cfn-custom-tags'

/** Normalize for storage / comparison (lowercase, trimmed). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function loadCustomTags(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const tag = normalizeTag(item)
      if (!tag || seen.has(tag)) continue
      seen.add(tag)
      out.push(tag)
    }
    return out.sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function saveCustomTags(tags: string[]) {
  const unique = [...new Set(tags.map(normalizeTag).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(unique))
  return unique
}

/** Persist a custom tag globally (no-op if it is a built-in default). */
export function registerCustomTag(raw: string): string {
  const tag = normalizeTag(raw)
  if (!tag) return tag
  if ((DEFAULT_TAGS as readonly string[]).includes(tag)) return tag
  const existing = loadCustomTags()
  if (!existing.includes(tag)) saveCustomTags([...existing, tag])
  return tag
}

/** Register any non-default tags (e.g. from import / vendor rows). */
export function registerCustomTags(tags: string[]): void {
  const existing = new Set(loadCustomTags())
  let changed = false
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (!tag) continue
    if ((DEFAULT_TAGS as readonly string[]).includes(tag)) continue
    if (!existing.has(tag)) {
      existing.add(tag)
      changed = true
    }
  }
  if (changed) saveCustomTags([...existing])
}

/**
 * Full catalog for pickers / filters: defaults + saved customs + any in-use tags.
 */
export function mergeTagCatalog(inUse: Iterable<string> = []): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string) => {
    const tag = normalizeTag(raw)
    if (!tag || seen.has(tag)) return
    seen.add(tag)
    out.push(tag)
  }
  for (const t of DEFAULT_TAGS) add(t)
  for (const t of loadCustomTags()) add(t)
  for (const t of inUse) add(t)
  return out.sort((a, b) => a.localeCompare(b))
}
