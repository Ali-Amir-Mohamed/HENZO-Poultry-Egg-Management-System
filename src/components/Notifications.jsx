import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { TABLES } from '../config'
import Icon from './Icon'
import PushToggle from './PushToggle'
import { Link } from 'react-router-dom'

// Links written by the database → app pages
const lienAppli = (lien) => {
  if (!lien) return '/'
  if (lien.startsWith('/bandes/')) return lien.replace('/bandes/', '/ferme/bande/')
  if (lien.startsWith('/lots/')) return lien.replace('/lots/', '/ferme/lot/')
  if (lien.startsWith('/depenses')) return '/argent'
  return lien
}

// Bell in the header: notifications addressed to the user's role (created by database triggers)
export default function Notifications() {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (!navigator.onLine) return
    const { data } = await supabase.from(TABLES.notifications).select('*')
      .order('created_at', { ascending: false }).limit(30)
    if (data) setItems(data)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  const unread = items.filter((n) => !n.lu)

  const markAllRead = async () => {
    if (!unread.length) return
    await supabase.from(TABLES.notifications).update({ lu: true }).in('id', unread.map((n) => n.id))
    load()
  }

  return (
    <div className="notif">
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={t('notifications.title')}>
        <Icon name="bell" size={18} />
        {unread.length > 0 && <span className="bubble">{unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="panel-head">
            <h2>{t('notifications.title')}</h2>
            <span className="spacer" />
            {unread.length > 0 && <button className="btn ghost sm" onClick={markAllRead}>{t('notifications.markRead')}</button>}
          </div>
          <PushToggle />
          {items.length === 0 ? <p className="muted">{t('notifications.empty')}</p> : (
            <ul className="list">
              {items.map((n) => (
                <li key={n.id} className={n.lu ? 'read' : ''}>
                  <Link to={lienAppli(n.lien)} onClick={() => setOpen(false)}>
                    <strong>{n.message}</strong>
                    <div className="muted small">{new Date(n.created_at).toLocaleString(i18n.resolvedLanguage)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
