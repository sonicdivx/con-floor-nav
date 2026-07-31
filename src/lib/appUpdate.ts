import { registerSW } from 'virtual:pwa-register'
import { APP_VERSION } from './changelog'

type UpdateListener = (available: boolean) => void

const listeners = new Set<UpdateListener>()
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined
let swRegistration: ServiceWorkerRegistration | undefined
let updateAvailable = false
let refreshInFlight = false

const DISMISS_KEY = 'cfn-update-dismissed-version'
/** Query token that forces a cache-busting navigation after SW swap / hard refresh. */
export const REFRESH_PARAM = '__cfn_r'

function notify() {
  for (const listener of listeners) listener(updateAvailable)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Drop the refresh token from the URL after a forced navigation. */
export function stripRefreshToken(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(REFRESH_PARAM)) return
    url.searchParams.delete(REFRESH_PARAM)
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState(null, '', next)
  } catch {
    /* ignore */
  }
}

/**
 * Navigate with a unique `__cfn_r` token so HTTP + SW navigation caches cannot
 * reuse a stale index.html shell.
 */
function navigateWithRefreshToken(reason: string = APP_VERSION): void {
  const url = new URL(window.location.href)
  url.searchParams.set(REFRESH_PARAM, `${reason}-${Date.now()}`)
  window.location.replace(`${url.pathname}${url.search}${url.hash}`)
}

async function clearAppCaches(): Promise<void> {
  if (!('caches' in window)) return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  } catch {
    /* ignore */
  }
}

async function unregisterServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((reg) => reg.unregister()))
  } catch {
    /* ignore */
  }
}

/** Hard path: wipe SW caches, unregister workers, reload with bust token. */
async function hardRefreshFromNetwork(): Promise<void> {
  await clearAppCaches()
  await unregisterServiceWorkers()
  navigateWithRefreshToken(`hard-${APP_VERSION}`)
}

/** Call once at startup (main.tsx). Uses prompt mode so the UI can Refresh / Dismiss. */
export function initAppUpdateRegistration(): void {
  stripRefreshToken()

  updateSW = registerSW({
    immediate: true,
    // Take over reload so we can append the cache-bust token.
    onNeedReload() {
      navigateWithRefreshToken(`sw-${APP_VERSION}`)
    },
    onNeedRefresh() {
      const dismissed = (() => {
        try {
          return sessionStorage.getItem(DISMISS_KEY)
        } catch {
          return null
        }
      })()
      if (dismissed === APP_VERSION) {
        updateAvailable = false
        notify()
        return
      }
      updateAvailable = true
      notify()
    },
    onOfflineReady() {
      /* shell cached — no toast needed */
    },
    onRegisteredSW(_swUrl, registration) {
      swRegistration = registration
    },
  })

  // Dev/QA: `window.dispatchEvent(new Event('cfn:force-update-toast'))`
  window.addEventListener('cfn:force-update-toast', () => {
    updateAvailable = true
    notify()
  })
}

export function subscribeAppUpdate(listener: UpdateListener): () => void {
  listeners.add(listener)
  listener(updateAvailable)
  return () => listeners.delete(listener)
}

export function isAppUpdateAvailable(): boolean {
  return updateAvailable
}

/**
 * Activate the waiting service worker, then navigate with a `__cfn_r` token
 * (via onNeedReload). Falls back to a hard cache-clear refresh.
 */
export async function applyAppUpdate(): Promise<void> {
  if (refreshInFlight) return
  refreshInFlight = true
  try {
    sessionStorage.removeItem(DISMISS_KEY)
  } catch {
    /* ignore */
  }

  try {
    if (updateSW && (updateAvailable || swRegistration?.waiting)) {
      // vite-plugin-pwa ignores the reloadPage arg; reload comes from onNeedReload
      // after SKIP_WAITING. If that never fires, hard-refresh with the bust token.
      window.setTimeout(() => {
        void hardRefreshFromNetwork()
      }, 2500)
      await updateSW(true)
      return
    }
    await hardRefreshFromNetwork()
  } catch {
    await hardRefreshFromNetwork()
  }
}

/** Hide the toast for this browser session (reappears next visit if still waiting). */
export function dismissAppUpdate(): void {
  updateAvailable = false
  try {
    sessionStorage.setItem(DISMISS_KEY, APP_VERSION)
  } catch {
    /* ignore */
  }
  notify()
}

/**
 * “Update to latest”:
 * 1. Ask the registration to check for a new SW (`registration.update()`).
 * 2. If a waiting worker is ready → skipWaiting + token navigation.
 * 3. Otherwise → clear Cache Storage, unregister SW, navigate with `__cfn_r` token.
 */
export async function checkAndApplyAppUpdate(): Promise<void> {
  if (refreshInFlight) return

  if (updateAvailable && updateSW) {
    await applyAppUpdate()
    return
  }

  try {
    const reg =
      swRegistration ??
      (await (navigator.serviceWorker?.getRegistration() ?? Promise.resolve(undefined)))
    swRegistration = reg

    if (reg) {
      try {
        await reg.update()
      } catch {
        /* offline or SW missing — fall through to hard refresh */
      }
      // Give install/waiting a brief window after update().
      await sleep(600)
      if (reg.waiting || updateAvailable) {
        await applyAppUpdate()
        return
      }
    }

    refreshInFlight = true
    await hardRefreshFromNetwork()
  } catch {
    refreshInFlight = true
    await hardRefreshFromNetwork()
  }
}
