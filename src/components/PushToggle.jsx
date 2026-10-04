import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import Icon from './Icon'

// Notifications on this phone (web push). The subscription is stored in abonnements_push;
// the Supabase function « envoyer-notifications » sends each new notification to the devices of the role.
const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
const supported = () => Boolean(KEY) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const toBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
// The service worker only exists in the installed / built app: give up after a few seconds
const registration = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_, reject) => setTimeout(() => reject(new Error('sw')), 4000))
])

export default function PushToggle() {
  const { t } = useTranslation()
  const [state, setState] = useState('loading') // loading | off | on | denied | unsupported
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!supported()) { setState('unsupported'); return }
    if (Notification.permission === 'denied') { setState('denied'); return }
    registration()
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('unsupported'))
  }, [])

  const enable = async () => {
    setBusy(true); setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return }
      const reg = await registration()
      const sub = (await reg.pushManager.getSubscription()) ??
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(KEY) })
      const j = sub.toJSON()
      const { error: e } = await supabase.from('abonnements_push')
        .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, appareil: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' })
      if (e) throw e
      setState('on')
    } catch (e) {
      setError(e.message === 'sw' ? t('push.needInstall') : e.message)
    } finally { setBusy(false) }
  }

  const disable = async () => {
    setBusy(true); setError(null)
    try {
      const reg = await registration()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('abonnements_push').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setState('off')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (state === 'loading') return null
  return (
    <div className="push-toggle">
      {state === 'on' && (
        <><span className="tag ok"><Icon name="bell" size={12} /> {t('push.on')}</span>
          <button className="btn ghost sm" disabled={busy} onClick={disable}>{t('push.disable')}</button></>
      )}
      {state === 'off' && <button className="btn primary sm" disabled={busy} onClick={enable}><Icon name="bell" size={14} />{t('push.enable')}</button>}
      {state === 'denied' && <p className="muted small">{t('push.denied')}</p>}
      {state === 'unsupported' && <p className="muted small">{t('push.unsupported')}</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
