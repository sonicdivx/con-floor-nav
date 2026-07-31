/**
 * Keep the app shell sized to the layout viewport.
 *
 * Do NOT pin to visualViewport offset/width — on iOS that shifts the whole UI
 * when the keyboard opens (search), landscape chrome animates, or the hamburger
 * drawer opens. Use innerHeight / 100svh instead; safe-area pads the chrome.
 */
export function bindAppViewportHeight(): () => void {
  const root = document.documentElement

  const apply = () => {
    // Prefer layout viewport height (stable vs keyboard). Fall back for older WebViews.
    const height = Math.round(window.innerHeight || root.clientHeight || 0)
    root.style.setProperty('--app-height', `${Math.max(height, 1)}px`)
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
  const timers = [0, 100, 350].map((ms) => window.setTimeout(apply, ms))

  const onOrientation = () => {
    apply()
    requestAnimationFrame(apply)
    window.setTimeout(apply, 50)
    window.setTimeout(apply, 250)
  }

  // Resize of the layout viewport (rotate, browser chrome settle) — not vv.scroll.
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', onOrientation)
  window.addEventListener('pageshow', apply)

  return () => {
    for (const t of timers) window.clearTimeout(t)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', onOrientation)
    window.removeEventListener('pageshow', apply)
  }
}
