import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { usePendingCount } from '../hooks'
import { useAsk } from './Dialog'

// Accounts kept for the whole device (language, last activity); every other henzo.* cache belongs to a farm
const KEEP = ['henzo.lastActivity']

export async function changerFerme(id) {
  const { error } = await supabase.rpc('changer_ferme', { p_ferme: id })
  if (error) throw error
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('henzo.') && !KEEP.includes(k)).forEach((k) => localStorage.removeItem(k))
  } catch {}
  window.location.assign('/')
}

// Farm selector in the header, shown only to accounts that belong to several farms
export default function FarmSwitch() {
  const { t } = useTranslation()
  const ask = useAsk()
  const pending = usePendingCount()
  const [fermes, setFermes] = useState([])

  useEffect(() => {
    if (!navigator.onLine) return
    supabase.rpc('mes_fermes').then(({ data }) => setFermes(data ?? []))
  }, [])

  if (fermes.length < 2) return null
  const active = fermes.find((f) => f.active)

  const change = async (e) => {
    const id = e.target.value
    // Entries waiting in the outbox would be recorded in the new farm: send them first
    if (pending > 0) return ask.error(t('fermes.pendingFirst', { count: pending }))
    try { await changerFerme(id) } catch (err) { ask.error(err.message) }
  }

  return (
    <select className="farm-switch" value={active?.ferme_id ?? ''} onChange={change} aria-label={t('fermes.switch')}>
      {fermes.map((f) => <option key={f.ferme_id} value={f.ferme_id}>{f.nom}</option>)}
    </select>
  )
}
