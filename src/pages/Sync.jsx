import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { discardOutboxItem, listOutbox, onQueueChange, syncOutbox } from '../lib/offlineQueue'
import { useOnline } from '../hooks'
import Icon from '../components/Icon'

export default function Sync() {
  const { t, i18n } = useTranslation()
  const online = useOnline()
  const [items, setItems] = useState([])

  useEffect(() => {
    const refresh = () => listOutbox().then(setItems)
    refresh()
    return onQueueChange(refresh)
  }, [])

  const discard = (it) => {
    if (window.confirm(t('sync.confirmDiscard'))) discardOutboxItem(it.seq)
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="kpi-icon sky"><Icon name="sync" size={22} /></span>
        <h2>{t('sync.title')}</h2>
        <span className="spacer" />
        <button className="btn primary" disabled={!online || items.length === 0} onClick={syncOutbox}>
          <Icon name="sync" size={16} />{t('sync.retry')}
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><Icon name="check" size={28} /></span>
          <p>{t('sync.empty')}</p>
        </div>
      ) : (
        <ul className="list">
          {items.map((it) => (
            <li key={it.seq}>
              <div className="grow">
                <strong>{t(`tables.${it.table}`, it.table)}</strong>
                <span className="muted"> · {new Date(it.createdAt).toLocaleString(i18n.resolvedLanguage)}</span>
                {it.error && (
                  <>
                    <div className="error small">{t('sync.error')} : {it.error}</div>
                    <div className="row-actions">
                      <button className="btn ghost sm" onClick={() => discard(it)}><Icon name="trash" size={14} />{t('sync.discard')}</button>
                    </div>
                  </>
                )}
              </div>
              <span className={`tag ${it.error ? 'danger' : 'warn'}`}>
                {it.error ? t('sync.error') : t('sync.waiting')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
