/**
 * Keep the app shell sized to the usable viewport so bottom chrome
 * (tabs, FABs, Clear tour) is not covered by mobile browser UI.
 *
 * Prefer the smaller of layout `innerHeight` and `visualViewport.height`
 * when the shrink looks like browser chrome (not a soft keyboard).
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
      // Browser chrome hide/show is typically under ~180px; keyboards are larger.
      if (delta > 0 && delta < 180) {
        height = Math.max(visual, 1)
      }
    }

    root.style.setProperty('--app-height', `${height}px`)
    // Clear any legacy shift vars from older builds / cached SW.
    root.style.removeProperty('--app-top')
    root.style.removeProperty('--app-width')
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
  // Intentionally no visualViewport scroll listener / scrollTo — those fought
  // mobile chrome animations and left controls obscured.

  return () => {
    for (const t of timers) window.clearTimeout(t)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', onOrientation)
    window.removeEventListener('pageshow', apply)
    window.removeEventListener('visibilitychange', apply)
    window.visualViewport?.removeEventListener('resize', apply)
  }
}
