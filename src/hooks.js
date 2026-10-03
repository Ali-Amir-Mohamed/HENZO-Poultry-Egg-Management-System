import { useEffect, useState } from 'react'
import { onQueueChange, pendingCount } from './lib/offlineQueue'

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
