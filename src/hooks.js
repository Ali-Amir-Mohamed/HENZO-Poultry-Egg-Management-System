import { useCallback, useEffect, useState } from 'react'
import { onQueueChange, pendingCount } from './lib/offlineQueue'

// Runs an async loader (online data for office screens) and exposes reload().
export function useQuery(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }))
    return loader()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => setState((s) => ({ data: s.data, error: e.message, loading: false })))
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [run])
  return { ...state, reload: run }
}

// Throws Supabase errors so callers can show them
export const must = (r) => { if (r.error) throw r.error; return r.data }

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return online
}

export function usePendingCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const refresh = () => pendingCount().then(setCount)
    refresh()
    return onQueueChange(refresh)
  }, [])
  return count
}

export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState(null)
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setPromptEvent(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  const install = async () => {
    if (!promptEvent) return
    promptEvent.prompt()
    await promptEvent.userChoice
    setPromptEvent(null)
  }
  return promptEvent ? install : null
}
