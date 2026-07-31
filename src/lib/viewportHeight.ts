/** Keep the app shell matched to the visible mobile viewport (URL bar / chrome). */
export function bindAppViewportHeight(): () => void {
  const root = document.documentElement

  const apply = () => {
    const vv = window.visualViewport
    const height = Math.round(vv?.height ?? window.innerHeight)
    const top = Math.round(vv?.offsetTop ?? 0)
    const width = Math.round(vv?.width ?? window.innerWidth)
    root.style.setProperty('--app-height', `${Math.max(height, 1)}px`)
    root.style.setProperty('--app-top', `${top}px`)
    root.style.setProperty('--app-width', `${Math.max(width, 1)}px`)
  }

  apply()
  requestAnimationFrame(apply)
  // iOS often reports the wrong height on the first portrait paint; remeasure shortly after.
  const t0 = window.setTimeout(apply, 0)
  const t1 = window.setTimeout(apply, 100)
  const t2 = window.setTimeout(apply, 350)

  const onOrientation = () => {
    apply()
    requestAnimationFrame(apply)
    window.setTimeout(apply, 50)
    window.setTimeout(apply, 250)
  }

  window.visualViewport?.addEventListener('resize', apply)
  window.visualViewport?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', onOrientation)
  window.addEventListener('pageshow', apply)

  return () => {
    window.clearTimeout(t0)
    window.clearTimeout(t1)
    window.clearTimeout(t2)
    window.visualViewport?.removeEventListener('resize', apply)
    window.visualViewport?.removeEventListener('scroll', apply)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', onOrientation)
    window.removeEventListener('pageshow', apply)
  }
}
