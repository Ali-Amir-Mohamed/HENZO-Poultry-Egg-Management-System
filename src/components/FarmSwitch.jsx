import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { usePendingCount } from '../hooks'
import { oublierChoix } from '../lib/systeme'
import { useAsk } from './Dialog'

// Accounts kept for the whole device (language, last activity); every other henzo.* cache belongs to a farm
const KEEP = ['henzo.lastActivity', 'henzo.faceid', 'henzo.faceid.plustard', 'henzo.theme', 'henzo.palette']

export async function changerFerme(id) {
  const { error } = await supabase.rpc('changer_ferme', { p_ferme: id })
  if (error) throw error
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('henzo.') && !KEEP.includes(k)).forEach((k) => localStorage.removeItem(k))
  } catch {}
  window.location.assign('/')
}

// Header: the site selector lists only the companies of the same system (the farms in HENZO);
// the other system (HENZO AGRO) is reached through the « Applications » portal.
export default function FarmSwitch() {
  const { t } = useTranslation()
  const ask = useAsk()
  const pending = usePendingCount()
  const [societes, setSocietes] = useState([])

  useEffect(() => {
    if (!navigator.onLine) return
    supabase.rpc('mes_societes').then(({ data }) => setSocietes(data ?? []))
  }, [])

  const active = societes.find((s) => s.active)
  if (!active) return null
  const memeSysteme = societes.filter((s) => s.type_activite === active.type_activite)
  const autreSysteme = societes.some((s) => s.type_activite !== active.type_activite)

  const change = async (e) => {
    // Entries waiting in the outbox would be recorded in the new site: send them first
    if (pending > 0) return ask.error(t('fermes.pendingFirst', { count: pending }))
    try { await changerFerme(e.target.value) } catch (err) { ask.error(err.message) }
  }
  const applications = () => {
    if (pending > 0) return ask.error(t('fermes.pendingFirst', { count: pending }))
    oublierChoix()
    window.location.assign('/')
  }

  return (
    <span className="farm-switch-wrap">
      {memeSysteme.length > 1 && (
        <select className="farm-switch" value={active.ferme_id} onChange={change} aria-label={t('fermes.switchSite')}>
          {memeSysteme.map((s) => <option key={s.ferme_id} value={s.ferme_id}>{s.nom}</option>)}
        </select>
      )}
      {autreSysteme && <button type="button" className="farm-switch apps-btn" onClick={applications}>⇄ {t('systeme.apps')}</button>}
    </span>
  )
}
