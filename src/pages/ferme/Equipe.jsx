import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import Icon from '../../components/Icon'
import { day, Empty, Field, FormCard, Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Team (exploitation): add an employee, change his job, mark a departure. Salaries are never shown here:
// finance (Dahirou) is notified to set or check the salary.
export default function Equipe() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => must(await supabase.from('equipe').select('*').order('actif', { ascending: false }).order('nom')))
  const vide = { nom: '', telephone: '', poste: '', date_embauche: '' }
  const [form, setForm] = useState(vide)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const creer = async () => {
    must(await supabase.rpc('ajouter_employe', { p_nom: form.nom, p_telephone: form.telephone || null, p_poste: form.poste || null, p_date_embauche: form.date_embauche || null }))
    setForm(vide); q.reload()
    return t('equipe.created')
  }
  const modifier = async (e) => {
    const v = await ask.form({ title: t('salaires.editTitle', { nom: e.nom }), icon: 'users', submit: t('dialog.save'), message: t('equipe.editHint'), fields: [
      { name: 'nom', label: t('reglages.name'), value: e.nom, required: true },
      { name: 'poste', label: t('salaires.job'), value: e.poste ?? '' },
      { name: 'telephone', label: t('reglages.phone'), type: 'tel', value: e.telephone ?? '' },
      { name: 'actif', label: t('stock.status'), type: 'select', value: e.actif ? 'oui' : 'non', options: [{ value: 'oui', label: t('salaires.active') }, { value: 'non', label: t('salaires.left') }] }
    ] })
    if (v) await run(supabase.rpc('modifier_employe', { p_id: e.id, p_nom: v.nom, p_telephone: v.telephone || null, p_poste: v.poste || null, p_actif: v.actif === 'oui' }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const actifs = q.data.filter((e) => e.actif).length
  return (
    <>
      <Panel icon="users" tone="green" title={t('equipe.title')} subtitle={t('equipe.subtitle', { count: actifs })}>
        {q.data.length === 0 ? <Empty icon="users" text={t('salaires.none')} /> : (
          <ul className="list">
            {q.data.map((e) => (
              <li key={e.id} className={e.actif ? '' : 'read'}>
                <div className="grow">
                  <strong>{e.nom}</strong>{e.poste ? <span className="muted"> · {e.poste}</span> : null}
                  <div className="muted small">{[e.telephone, e.date_embauche && t('equipe.since', { d: day(e.date_embauche, lang) }), !e.actif && t('salaires.left')].filter(Boolean).join(' · ') || '—'}</div>
                  <div className="row-actions"><button className="btn ghost sm" onClick={() => modifier(e)}>{t('common.edit')}</button></div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="note"><Icon name="wallet" size={16} />{t('equipe.salaryHint')}</p>
      </Panel>

      <FormCard title={t('salaires.new')} icon="users" onSubmit={creer}>
        <div className="grid-2">
          <Field label={t('reglages.name')}><input required value={form.nom} onChange={set('nom')} /></Field>
          <Field label={t('salaires.job')}><input value={form.poste} onChange={set('poste')} placeholder={t('salaires.jobPh')} /></Field>
          <Field label={t('reglages.phone')}><input type="tel" value={form.telephone} onChange={set('telephone')} /></Field>
          <Field label={t('salaires.hired')}><input type="date" value={form.date_embauche} onChange={set('date_embauche')} /></Field>
        </div>
      </FormCard>
    </>
  )
}
