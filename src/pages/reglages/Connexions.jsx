import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import Icon from '../../components/Icon'
import { Loading, Panel } from '../../components/ui'
import { nomsComptes } from './Journal'

const ICONS = { connexion: 'check', deconnexion: 'logout', expiration: 'clock' }

// Login history (director): who signed in, from which device, when
export default function Connexions() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [user, setUser] = useState('')
  const [limit, setLimit] = useState(100)

  const q = useQuery(async () => {
    let req = supabase.from('connexions').select('*').order('created_at', { ascending: false }).limit(limit)
    if (user) req = req.eq('user_id', user)
    const [rows, names] = await Promise.all([req, nomsComptes()])
    return { rows: must(rows), names }
  }, [user, limit])

  return (
    <Panel icon="users" tone="sky" title={t('connexions.title')} subtitle={t('connexions.subtitle')}
      actions={q.data && (
        <select className="inline-select" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">{t('connexions.everyone')}</option>
          {Object.entries(q.data.names).map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
        </select>
      )}>
      {!q.data ? <Loading error={q.error} /> : q.data.rows.length === 0 ? <p className="muted">{t('connexions.none')}</p> : (
        <>
          <ul className="list">
            {q.data.rows.map((r) => (
              <li key={r.id}>
                <span className={`kpi-icon ${r.evenement === 'connexion' ? 'green' : 'sky'} sm`}><Icon name={ICONS[r.evenement]} size={16} /></span>
                <div className="grow">
                  <strong>{q.data.names[r.user_id] ?? '?'} · {t(`connexions.events.${r.evenement}`)}</strong>
                  <div className="muted small">{new Date(r.created_at).toLocaleString(lang)}{r.appareil ? ` · ${r.appareil}` : ''}</div>
                </div>
              </li>
            ))}
          </ul>
          {q.data.rows.length === limit && <button className="btn ghost block" onClick={() => setLimit(limit + 100)}>{t('journal.more')}</button>}
        </>
      )}
    </Panel>
  )
}
