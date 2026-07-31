/** Versioned pin share strings for SMS / Signal / deep links. */

export type SharedPin = { x: number; y: number }

const PREFIX = 'cfn1:'

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Encode normalized pin as `cfn1:x,y` (6 decimal places). */
export function encodePinShare(pin: SharedPin): string {
  const x = clamp01(pin.x)
  const y = clamp01(pin.y)
  return `${PREFIX}${x.toFixed(6)},${y.toFixed(6)}`
}

/**
 * Parse `cfn1:x,y`, a full URL with `#pin=…`, or bare `x,y`.
 * Returns null if invalid.
 */
export function decodePinShare(raw: string): SharedPin | null {
  let s = raw.trim()
  if (!s) return null

  try {
    if (/^https?:\/\//i.test(s) || s.includes('#pin=')) {
      const hashIdx = s.indexOf('#pin=')
      if (hashIdx >= 0) {
        s = decodeURIComponent(s.slice(hashIdx + 5).split(/[&\s]/)[0] ?? '')
      } else {
        const u = new URL(s)
        const fromHash = u.hash.startsWith('#pin=')
          ? u.hash.slice(5)
          : u.searchParams.get('pin')
        if (fromHash) s = decodeURIComponent(fromHash)
      }
    }
  } catch {
    // fall through with original string
  }

  s = s.trim()
  if (s.toLowerCase().startsWith(PREFIX)) {
    s = s.slice(PREFIX.length)
  }

  const m = s.match(
    /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/,
  )
  if (!m) return null
  const x = Number(m[1])
  const y = Number(m[2])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

/** Full deep link when running on a real origin (not opaque). */
export function pinShareUrl(pin: SharedPin, origin = location.origin): string {
  const encoded = encodeURIComponent(encodePinShare(pin))
  return `${origin}/#pin=${encoded}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Read `#pin=` from the current location hash. */
export function readPinFromLocationHash(
  hash = location.hash,
): SharedPin | null {
  if (!hash.startsWith('#pin=')) return null
  return decodePinShare(decodeURIComponent(hash.slice(5)))
}

export function clearPinHash(): void {
  if (!location.hash.startsWith('#pin=')) return
  const url = `${location.pathname}${location.search}`
  history.replaceState(null, '', url)
}
