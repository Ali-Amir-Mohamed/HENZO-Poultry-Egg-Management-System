import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery, usePendingCount } from '../../hooks'
import Icon from '../../components/Icon'
import { Loading, Panel } from '../../components/ui'
import { useAsk } from '../../components/Dialog'
import { changerFerme } from '../../components/FarmSwitch'

// Several farms (director): list, switch, create. Each farm has its own caisses, flocks, stock and accounts.
export default function Fermes() {
  const { t } = useTranslation()
  const ask = useAsk()
  const pending = usePendingCount()
  const q = useQuery(async () => must(await supabase.rpc('mes_fermes')))

  const ouvrir = async (f) => {
    if (pending > 0) return ask.error(t('fermes.pendingFirst', { count: pending }))
    try { await changerFerme(f.ferme_id) } catch (err) { ask.error(err.message) }
  }
  const creer = async () => {
    const v = await ask.form({ title: t('fermes.new'), icon: 'barn', submit: t('fermes.create'), fields: [
      { name: 'nom', label: t('fermes.name'), required: true, placeholder: 'ex. Ferme de Garoua' }
    ], message: t('fermes.newHint') })
    if (!v) return
    const { data, error } = await supabase.rpc('creer_ferme', { p_nom: v.nom })
    if (error) return ask.error(error.message)
    q.reload()
    if (await ask.confirm(t('fermes.created', { nom: v.nom }), { title: t('fermes.new'), icon: 'barn', submit: t('fermes.open') })) {
      await ouvrir({ ferme_id: data })
    }
  }

  return (
    <Panel icon="barn" tone="green" title={t('fermes.title')} subtitle={t('fermes.subtitle')}
      actions={<button className="btn primary sm" onClick={creer}><Icon name="plus" size={14} />{t('fermes.new')}</button>}>
      {!q.data ? <Loading error={q.error} /> : (
        <ul className="list">
          {q.data.map((f) => (
            <li key={f.ferme_id}>
              <div className="grow">
                <strong>{f.nom}</strong>
                <div className="muted small">{t(`roles.${f.role}`)}</div>
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
