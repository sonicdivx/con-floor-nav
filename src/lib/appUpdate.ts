import { registerSW } from 'virtual:pwa-register'
import { APP_VERSION } from './changelog'

type UpdateListener = (available: boolean) => void

const listeners = new Set<UpdateListener>()
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined
let updateAvailable = false

const DISMISS_KEY = 'cfn-update-dismissed-version'

function notify() {
  for (const listener of listeners) listener(updateAvailable)
}

/** Call once at startup (main.tsx). Uses prompt mode so the UI can Refresh / Later. */
export function initAppUpdateRegistration(): void {
  updateSW = registerSW({
    immediate: true,
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

/** Activate the waiting service worker and reload. */
export async function applyAppUpdate(): Promise<void> {
  try {
    sessionStorage.removeItem(DISMISS_KEY)
  } catch {
    /* ignore */
  }
  if (updateSW) {
    await updateSW(true)
    return
  }
  window.location.reload()
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
 * Soft “check for update” — reloads if the SW already has a waiting worker,
 * otherwise reloads the page so a fresh HTML/SW check can run.
 */
export async function checkAndApplyAppUpdate(): Promise<void> {
  if (updateAvailable && updateSW) {
    await applyAppUpdate()
    return
  }
  // Force a navigation so browsers revalidate index.html / SW in production.
  window.location.reload()
}
