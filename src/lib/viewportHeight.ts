/**
 * Keep the app shell sized to the usable viewport.
 *
 * Prefer layout `innerHeight`, but when mobile browser chrome (URL bar) shrinks
 * the visual viewport by a modest amount, use that height so bottom chrome
 * (tabs, FABs, Clear tour) is not covered. Large shrinks are treated as the
 * soft keyboard — keep layout height so the UI does not jump.
 *
 * Do NOT apply visualViewport offset/top — that shifts the whole app when the
 * keyboard opens.
 */
export function bindAppViewportHeight(): () => void {
  const root = document.documentElement

  const apply = () => {
    const ih = Math.round(window.innerHeight || root.clientHeight || 0)
    const vv = window.visualViewport
    let height = Math.max(ih, 1)

    if (vv && vv.height > 0) {
      const visual = Math.round(vv.height)
      const delta = ih - visual
      // Browser chrome hide/show is typically under ~140px; keyboards are larger.
      if (delta > 0 && delta < 140) {
        height = Math.max(visual, 1)
      }
    }

    root.style.setProperty('--app-height', `${height}px`)
    // Clear any legacy shift vars from older builds / cached SW.
    root.style.removeProperty('--app-top')
    root.style.removeProperty('--app-width')
    // Kill accidental document scroll from focus/keyboard.
    window.scrollTo(0, 0)
    document.documentElement.scrollLeft = 0
    document.body.scrollLeft = 0
  }

  apply()
  requestAnimationFrame(apply)
  const timers = [0, 100, 350, 800].map((ms) => window.setTimeout(apply, ms))

  const onOrientation = () => {
    apply()
    requestAnimationFrame(apply)
    window.setTimeout(apply, 50)
    window.setTimeout(apply, 250)
    window.setTimeout(apply, 600)
  }

  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', onOrientation)
  window.addEventListener('pageshow', apply)
  window.addEventListener('visibilitychange', apply)
  window.visualViewport?.addEventListener('resize', apply)
  window.visualViewport?.addEventListener('scroll', apply)

  return () => {
    for (const t of timers) window.clearTimeout(t)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', onOrientation)
    window.removeEventListener('pageshow', apply)
    window.removeEventListener('visibilitychange', apply)
    window.visualViewport?.removeEventListener('resize', apply)
    window.visualViewport?.removeEventListener('scroll', apply)
  }
}
