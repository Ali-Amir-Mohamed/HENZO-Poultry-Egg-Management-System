import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { Empty, Loading } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Buildings: capacity, who is inside (flocks / layer lots), free or occupied
export default function Batiments() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const manage = can(role, 'bande.create')
  const q = useQuery(async () => must(await supabase.from('occupation_batiments').select('*').order('nom')))

  const fields = (b = {}) => [
    { name: 'nom', label: t('batiments.name'), value: b.nom ?? '', required: true, placeholder: 'ex. Bâtiment A' },
    { name: 'capacite', label: t('batiments.capacity'), type: 'number', min: 1, value: b.capacite ?? '' },
    ...(b.batiment_id ? [{ name: 'actif', label: t('stock.status'), type: 'select', value: b.actif ? 'oui' : 'non',
      options: [{ value: 'oui', label: t('batiments.inUse') }, { value: 'non', label: t('batiments.outOfUse') }] }] : [])
  ]
  const create = async () => {
    const v = await ask.form({ title: t('batiments.new'), icon: 'barn', submit: t('dialog.save'), fields: fields() })
    if (v) await run(supabase.from('batiments').insert({ nom: v.nom, capacite: v.capacite || null }), q.reload)
  }
  const edit = async (b) => {
    const v = await ask.form({ title: t('batiments.editTitle', { nom: b.nom }), icon: 'barn', submit: t('dialog.save'), fields: fields(b) })
    if (v) await run(supabase.from('batiments').update({ nom: v.nom, capacite: v.capacite || null, actif: v.actif === 'oui' }).eq('id', b.batiment_id), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  return (
    <>
      {manage && <button className="btn ghost block" onClick={create}><Icon name="plus" size={18} />{t('batiments.new')}</button>}
      {q.data.length === 0 ? <Empty icon="barn" text={t('batiments.none')} /> : (
        <div className="cards">
          {q.data.map((b) => {
            const libre = b.occupants.length === 0
            const pct = b.capacite ? Math.min(100, Math.round((Number(b.oiseaux) / b.capacite) * 100)) : null
            return (
              <article key={b.batiment_id} className={`card-item ${b.actif ? '' : 'read'}`}>
                <header>
                  <strong>{b.nom}</strong>
                  <span className={`tag ${!b.actif ? 'muted' : libre ? 'ok' : 'warn'}`}>
                    {!b.actif ? t('batiments.outOfUse') : libre ? t('batiments.free') : t('batiments.occupied')}
                  </span>
                </header>
                <div className="facts">
                  <div className="fact"><span>{t('batiments.capacity')}</span><strong>{b.capacite ? Number(b.capacite).toLocaleString(lang) : '—'}</strong></div>
                  <div className="fact"><span>{t('batiments.birds')}</span><strong>{Number(b.oiseaux).toLocaleString(lang)}{pct != null ? ` (${pct} %)` : ''}</strong></div>
                </div>
                {pct != null && <div className="progress"><div style={{ width: `${pct}%` }} /></div>}
                {b.occupants.length > 0 && (
                  <ul className="list">
                    {b.occupants.map((o) => (
                      <li key={o.id}>
                        <Link to={`/ferme/${o.type === 'chair' ? 'bande' : 'lot'}/${o.id}`} className="card-title">
                          <Icon name={o.type === 'chair' ? 'drumstick' : 'egg'} size={14} /> {o.code}
                        </Link>
                        <span className="muted small">{t('batiments.birdsN', { n: Number(o.effectif).toLocaleString(lang) })}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {manage && <footer><button className="btn ghost sm" onClick={() => edit(b)}><Icon name="note" size={14} />{t('common.edit')}</button></footer>}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
