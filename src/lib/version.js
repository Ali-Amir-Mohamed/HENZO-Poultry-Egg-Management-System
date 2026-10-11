// Version of the app and "force update" for installed apps stuck on an old version
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev' // eslint-disable-line no-undef

export async function forcerMiseAJour() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    const keys = await caches?.keys?.() ?? []
    await Promise.all(keys.map((k) => caches.delete(k)))
  } catch { /* nothing to clean */ }
  // Fresh copy of the page, bypassing any cache
  window.location.replace(`/?maj=${Date.now()}`)
}
