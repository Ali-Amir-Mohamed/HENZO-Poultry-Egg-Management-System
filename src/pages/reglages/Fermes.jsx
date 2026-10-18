import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery, usePendingCount } from '../../hooks'
import Icon from '../../components/Icon'
import { Loading, Panel } from '../../components/ui'
import { useAsk } from '../../components/Dialog'
import { changerFerme } from '../../components/FarmSwitch'
import { useAuth } from '../../auth/AuthProvider'
import { estNegoce } from '../../lib/systeme'

// Group companies (director): list, switch, create – a poultry farm (HENZO) or a buying and reselling company (HENZO AGRO).
// Each has its own cash boxes, stock, sales and accounts (stored in the database's "fermes" table).
export default function Fermes() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const ask = useAsk()
  const pending = usePendingCount()
  const q = useQuery(async () => must(await supabase.rpc('mes_societes')))

  const ouvrir = async (f) => {
    if (pending > 0) return ask.error(t('fermes.pendingFirst', { count: pending }))
    try { await changerFerme(f.ferme_id) } catch (err) { ask.error(err.message) }
  }
  // A farm created on its own becomes a site of the open company (one sheet, one numbering, common accounts and taxes)
  const rattacher = async (f) => {
    const ouverte = q.data.find((x) => x.active)
    if (!(await ask.confirm(t('sites.attachConfirm', { ferme: f.nom, societe: ouverte?.nom }), { title: t('sites.attach'), icon: 'users', submit: t('sites.attach') }))) return
    const { error } = await supabase.rpc('rattacher_site', { p_ferme: f.ferme_id, p_societe: ouverte.ferme_id })
    if (error) return ask.error(error.message)
    q.reload()
    ask.info(t('sites.attached', { ferme: f.nom }), t('sites.attachedHint'))
  }
  const creer = async () => {
    const v = await ask.form({ title: t('fermes.new'), icon: 'plus', submit: t('fermes.create'), fields: [
      { name: 'type', label: t('fermes.type'), type: 'select', value: estNegoce(profile) ? 'negoce' : 'site', options: [...(estNegoce(profile) ? [] : [{ value: 'site', label: t('fermes.typeSite') }]), { value: 'negoce', label: t('fermes.typeNegoce') }] },
      { name: 'nom', label: t('fermes.name'), required: true, placeholder: 'ex. HENZO AGRO' }
    ], message: t('fermes.newHint') })
    if (!v) return
    const { data, error } = await supabase.rpc('creer_ferme', v.type === 'site' ? { p_nom: v.nom, p_type: 'elevage', p_site_de: profile.ferme_id } : { p_nom: v.nom, p_type: v.type })
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
                : <>
                  {f.type_activite === 'elevage' && !estNegoce(profile) && f.role === 'directeur' && <button className="btn ghost sm" onClick={() => rattacher(f)}>{t('sites.attach')}</button>}
                  <button className="btn ghost sm" onClick={() => ouvrir(f)}>{t('fermes.open')}</button>
                </>}
            </li>
          ))}
        </ul>
      )}
      <p className="note"><Icon name="users" size={16} />{t('fermes.membersHint')}</p>
    </Panel>
  )
}
