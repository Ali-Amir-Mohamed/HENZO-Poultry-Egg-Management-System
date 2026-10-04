import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { discardOutboxItem, listOutbox, onQueueChange, syncOutbox } from '../lib/offlineQueue'
import { useOnline } from '../hooks'
import Icon from '../components/Icon'
import { useAsk } from '../components/Dialog'

// What the entry contained, so the person can enter it again correctly
function resumeSaisie(r, t) {
  const date = r.date_vente ?? r.date_ponte ?? r.date_constat ?? r.date_pesee ?? r.date_mouvement ?? r.date_observation
  const parts = [
    date,
    r.produit && t(`produits.${r.produit}`),
    r.quantite != null && `${r.quantite}${r.unite ? ` ${t(`unites.${r.unite}`)}` : ''}`,
    r.prix_unitaire != null && `× ${Number(r.prix_unitaire).toLocaleString()} F`,
    r.nombre_sujets != null && t('argent.birds', { n: r.nombre_sujets }),
    r.oeufs_collectes != null && `${r.oeufs_collectes} ${t('oeufs.eggs')}`,
    r.nombre != null && `${r.nombre}`,
    r.nom
  ]
  return parts.filter(Boolean).join(' · ')
}

export default function Sync() {
  const { t, i18n } = useTranslation()
  const online = useOnline()
  const [items, setItems] = useState([])

  useEffect(() => {
    const refresh = () => listOutbox().then(setItems)
    refresh()
    return onQueueChange(refresh)
  }, [])

  const ask = useAsk()
  const discard = async (it) => {
    if (await ask.confirm(t('sync.confirmDiscard'), { title: t('sync.discard'), icon: 'trash', danger: true, submit: t('sync.discard') })) discardOutboxItem(it.seq)
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
      <details className="note">
        <summary><Icon name="cloud" size={16} /> {t('sync.rulesTitle')}</summary>
        <ul className="small">
          <li>{t('sync.rule1')}</li>
          <li>{t('sync.rule2')}</li>
          <li>{t('sync.rule3')}</li>
          <li>{t('sync.rule4')}</li>
        </ul>
      </details>
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
                    <div className="muted small">{resumeSaisie(it.row, t)}</div>
                    <div className="small">{t('sync.refusedHelp')}</div>
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
