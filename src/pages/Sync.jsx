import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listOutbox, onQueueChange, syncOutbox } from '../lib/offlineQueue'
import { useOnline } from '../hooks'

export default function Sync() {
  const { t } = useTranslation()
  const online = useOnline()
  const [items, setItems] = useState([])

  useEffect(() => {
    const refresh = () => listOutbox().then(setItems)
    refresh()
    return onQueueChange(refresh)
  }, [])

  return (
    <section className="card">
      <div className="row">
        <h2>{t('sync.title')}</h2>
        <span className="spacer" />
        <button disabled={!online || items.length === 0} onClick={syncOutbox}>{t('sync.retry')}</button>
      </div>
      {items.length === 0 ? <p className="muted">{t('sync.empty')}</p> : (
        <ul className="list">
          {items.map((it) => (
            <li key={it.seq}>
              <code>{it.table}</code> · {new Date(it.createdAt).toLocaleString()}
              {it.error && <div className="error">{t('sync.error')} : {it.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
