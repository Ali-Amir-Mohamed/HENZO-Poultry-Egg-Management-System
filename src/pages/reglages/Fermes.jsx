import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery, usePendingCount } from '../../hooks'
import Icon from '../../components/Icon'
import { Loading, Panel } from '../../components/ui'
import { useAsk } from '../../components/Dialog'
import { changerFerme } from '../../components/FarmSwitch'

// Group companies (director): list, switch, create – a poultry farm (HENZO) or a buying and reselling company (HENZO AGRO).
// Each has its own cash boxes, stock, sales and accounts (stored in the database's "fermes" table).
export default function Fermes() {
  const { t } = useTranslation()
  const ask = useAsk()
  const pending = usePendingCount()
  const q = useQuery(async () => must(await supabase.rpc('mes_societes')))

  const ouvrir = async (f) => {
    if (pending > 0) return ask.error(t('fermes.pendingFirst', { count: pending }))
    try { await changerFerme(f.ferme_id) } catch (err) { ask.error(err.message) }
  }
  const creer = async () => {
    const v = await ask.form({ title: t('fermes.new'), icon: 'plus', submit: t('fermes.create'), fields: [
      { name: 'type', label: t('fermes.type'), type: 'select', value: 'negoce', options: [{ value: 'negoce', label: t('fermes.typeNegoce') }, { value: 'elevage', label: t('fermes.typeElevage') }] },
      { name: 'nom', label: t('fermes.name'), required: true, placeholder: 'ex. HENZO AGRO' }
    ], message: t('fermes.newHint') })
    if (!v) return
    const { data, error } = await supabase.rpc('creer_ferme', { p_nom: v.nom, p_type: v.type })
    if (error) return ask.error(error.message)
    q.reload()
    if (await ask.confirm(t('fermes.created', { nom: v.nom }), { title: t('fermes.new'), icon: 'plus', submit: t('fermes.open') })) {
      await ouvrir({ ferme_id: data })
    }
  }

  return (
    <Panel icon="users" tone="green" title={t('fermes.title')} subtitle={t('fermes.subtitle')}
      actions={<button className="btn primary sm" onClick={creer}><Icon name="plus" size={14} />{t('fermes.new')}</button>}>
      {!q.data ? <Loading error={q.error} /> : (
        <ul className="list">
          {q.data.map((f) => (
            <li key={f.ferme_id}>
              <span className={`kpi-icon ${f.type_activite === 'negoce' ? 'yolk' : 'green'} sm`}><Icon name={f.type_activite === 'negoce' ? 'box' : 'hen'} size={16} /></span>
              <div className="grow">
                <strong>{f.nom}</strong>
                <div className="muted small">{t(f.type_activite === 'negoce' ? 'systeme.negoce' : 'systeme.elevage')} · {t(`roles.${f.role}`)}</div>
              </div>
              {f.active
                ? <span className="tag ok">{t('fermes.current')}</span>
                : <button className="btn ghost sm" onClick={() => ouvrir(f)}>{t('fermes.open')}</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="note"><Icon name="users" size={16} />{t('fermes.membersHint')}</p>
    </Panel>
  )
}
