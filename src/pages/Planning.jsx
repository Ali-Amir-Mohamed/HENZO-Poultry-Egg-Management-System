import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can, TABLES, TYPES_TACHE } from '../config'
import { localDate } from '../lib/stats'
import Icon from '../components/Icon'
import { day, Empty, Field, FormCard, Loading, Panel, Tabs } from '../components/ui'

const TYPE_ICONS = {
  vaccination: 'syringe', traitement: 'syringe', pesee: 'scale', achat_aliment: 'box', remboursement: 'receipt',
  arrivee_poussins: 'drumstick', vente_prevue: 'cart', nettoyage: 'sync', autre: 'note'
}
const ROLES_TACHE = ['', 'employe', 'exploitation', 'finance', 'directeur']

// Planning: dated tasks (with recurrence) and the programmes that generate them for each new flock
export default function Planning() {
  const [tab, setTab] = useState('taches')
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'taches', label: 'planning.tabs.taches', icon: 'calendar' },
        { id: 'programmes', label: 'planning.tabs.programmes', icon: 'syringe' }
      ]} />
      {tab === 'taches' ? <Taches /> : <Programmes />}
    </div>
  )
}

function useFlocks() {
  return useQuery(async () => {
    const [b, l] = await Promise.all([
      supabase.from('bandes').select('id, code').neq('statut', 'cloturee').order('date_arrivee'),
      supabase.from('lots_pondeuses').select('id, code').eq('statut', 'en_production').order('date_arrivee')
    ])
    return { bandes: must(b), lots: must(l) }
  })
}

function Taches() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const today = localDate()
  const inAWeek = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return localDate(d) })()

  const list = useQuery(async () => must(await supabase.from(TABLES.taches)
    .select('*, bande:bandes(code), lot:lots_pondeuses(code)').eq('statut', 'a_faire').order('date_prevue').limit(300)))
  const doneList = useQuery(async () => must(await supabase.from(TABLES.taches)
    .select('id, titre, fait_le, statut, bande:bandes(code), lot:lots_pondeuses(code)').eq('statut', 'fait')
    .order('fait_le', { ascending: false }).limit(15)))
  const flocks = useFlocks()
  const reload = () => { list.reload(); doneList.reload() }

  const [form, setForm] = useState({ titre: '', type_tache: 'vaccination', date_prevue: today, cible: '', produit: '', description: '', assigne_role: 'employe', repeter_jours: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const create = async () => {
    must(await supabase.from(TABLES.taches).insert({
      titre: form.titre,
      type_tache: form.type_tache,
      date_prevue: form.date_prevue,
      bande_id: form.cible.startsWith('b:') ? form.cible.slice(2) : null,
      lot_id: form.cible.startsWith('l:') ? form.cible.slice(2) : null,
      produit: form.produit || null,
      description: form.description || null,
      assigne_role: form.assigne_role || null,
      repeter_jours: form.repeter_jours ? Number(form.repeter_jours) : null
    }))
    setForm({ ...form, titre: '', produit: '', description: '' })
    reload()
  }

  const done = async (tc) => {
    const { error } = await supabase.from(TABLES.realisations).insert({ tache_id: tc.id })
    if (error) window.alert(error.message)
    reload()
  }
  const postpone = async (tc) => {
    const d = window.prompt(t('planning.newDate'), tc.date_prevue)
    if (!d) return
    const { error } = await supabase.from(TABLES.taches).update({ date_prevue: d }).eq('id', tc.id)
    if (error) window.alert(error.message)
    reload()
  }
  const cancel = async (tc) => {
    if (!window.confirm(t('planning.confirmCancel', { titre: tc.titre }))) return
    const { error } = await supabase.from(TABLES.taches).update({ statut: 'annule' }).eq('id', tc.id)
    if (error) window.alert(error.message)
    reload()
  }

  const groups = [
    { key: 'late', tone: 'rose', rows: (list.data ?? []).filter((x) => x.date_prevue < today) },
    { key: 'today', tone: 'yolk', rows: (list.data ?? []).filter((x) => x.date_prevue === today) },
    { key: 'week', tone: 'green', rows: (list.data ?? []).filter((x) => x.date_prevue > today && x.date_prevue <= inAWeek) },
    { key: 'later', tone: 'sky', rows: (list.data ?? []).filter((x) => x.date_prevue > inAWeek) }
  ]

  return (
    <>
      {can(role, 'tache.plan') && (
        <FormCard title={t('planning.newTask')} icon="calendar" onSubmit={create}>
          <div className="grid-2">
            <Field label={t('planning.title')} className="span-2"><input required value={form.titre} onChange={set('titre')} placeholder={t('planning.titlePh')} /></Field>
            <Field label={t('planning.type')}>
              <select value={form.type_tache} onChange={set('type_tache')}>
                {TYPES_TACHE.map((x) => <option key={x} value={x}>{t(`planning.types.${x}`)}</option>)}
              </select>
            </Field>
            <Field label={t('planning.date')}><input type="date" required value={form.date_prevue} onChange={set('date_prevue')} /></Field>
            <Field label={t('saisie.cible')}>
              <select value={form.cible} onChange={set('cible')}>
                <option value="">{t('saisie.toute')}</option>
                <optgroup label={t('types.chair_pl')}>{(flocks.data?.bandes ?? []).map((b) => <option key={b.id} value={`b:${b.id}`}>{b.code}</option>)}</optgroup>
                <optgroup label={t('types.pondeuse_pl')}>{(flocks.data?.lots ?? []).map((l) => <option key={l.id} value={`l:${l.id}`}>{l.code}</option>)}</optgroup>
              </select>
            </Field>
            <Field label={t('planning.assignee')}>
              <select value={form.assigne_role} onChange={set('assigne_role')}>
                {ROLES_TACHE.map((r) => <option key={r} value={r}>{r ? t(`roles.${r}`) : t('planning.everyone')}</option>)}
              </select>
            </Field>
            <Field label={t('planning.product')}><input value={form.produit} onChange={set('produit')} /></Field>
            <Field label={t('planning.repeat')}><input type="number" min="1" value={form.repeter_jours} onChange={set('repeter_jours')} placeholder={t('planning.repeatPh')} /></Field>
          </div>
          <Field label={t('planning.description')}><textarea rows="2" value={form.description} onChange={set('description')} /></Field>
        </FormCard>
      )}

      {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <Empty icon="calendar" text={t('planning.empty')} /> : (
        groups.filter((g) => g.rows.length).map((g) => (
          <Panel key={g.key} icon="calendar" tone={g.tone} title={`${t(`planning.groups.${g.key}`)} (${g.rows.length})`}>
            <ul className="list">
              {g.rows.map((tc) => (
                <li key={tc.id}>
                  <span className={`kpi-icon ${g.tone} sm`}><Icon name={TYPE_ICONS[tc.type_tache]} size={16} /></span>
                  <div className="grow">
                    <strong>{tc.titre}</strong>
                    <div className="muted small">
                      {day(tc.date_prevue, lang)}
                      {tc.bande ? <> · <Link to={`/ferme/bande/${tc.bande_id}`}>{tc.bande.code}</Link></> : tc.lot ? <> · <Link to={`/ferme/lot/${tc.lot_id}`}>{tc.lot.code}</Link></> : ''}
                      {tc.produit ? ` · ${tc.produit}` : ''}
                      {` · ${tc.assigne_role ? t(`roles.${tc.assigne_role}`) : t('planning.everyone')}`}
                      {tc.repeter_jours ? ` · ${t('planning.every', { n: tc.repeter_jours })}` : ''}
                    </div>
                    {tc.description && <div className="small">{tc.description}</div>}
                    {can(role, 'tache.plan') && (
                      <div className="row-actions">
                        <button className="btn primary sm" onClick={() => done(tc)}><Icon name="check" size={14} />{t('planning.markDone')}</button>
                        <button className="btn ghost sm" onClick={() => postpone(tc)}>{t('planning.postpone')}</button>
                        <button className="btn ghost sm" onClick={() => cancel(tc)}>{t('argent.cancel')}</button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}

      {doneList.data?.length > 0 && (
        <Panel icon="check" tone="green" title={t('planning.recentlyDone')}>
          <ul className="list">
            {doneList.data.map((tc) => (
              <li key={tc.id} className="read">
                <div className="grow">
                  <strong>{tc.titre}</strong>
                  <div className="muted small">{tc.bande?.code ?? tc.lot?.code ?? t('saisie.toute')} · {new Date(tc.fait_le).toLocaleString(lang)}</div>
                </div>
                <span className="tag ok">{t('planning.done')}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  )
}

function Programmes() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const edit = can(role, 'programme.edit')
  const list = useQuery(async () => must(await supabase.from(TABLES.modeles).select('*').order('type_production').order('jour')))
  const [form, setForm] = useState({ type_production: 'chair', jour: '7', type_tache: 'vaccination', titre: '', produit: '', assigne_role: 'employe', repeter_jours: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const create = async () => {
    must(await supabase.from(TABLES.modeles).insert({
      ...form, jour: Number(form.jour), produit: form.produit || null, assigne_role: form.assigne_role || null,
      repeter_jours: form.repeter_jours ? Number(form.repeter_jours) : null
    }))
    setForm({ ...form, titre: '', produit: '' })
    list.reload()
  }
  const toggle = async (m) => {
    const { error } = await supabase.from(TABLES.modeles).update({ actif: !m.actif }).eq('id', m.id)
    if (error) window.alert(error.message)
    list.reload()
  }

  return (
    <>
      <p className="note"><Icon name="syringe" size={16} />{t('planning.programmesHint')}</p>
      {!list.data ? <Loading error={list.error} /> : ['chair', 'pondeuse'].map((tp) => (
        <Panel key={tp} icon={tp === 'chair' ? 'drumstick' : 'egg'} tone={tp === 'chair' ? 'sky' : 'yolk'} title={t(`types.${tp}_pl`)}>
          <ul className="list">
            {list.data.filter((m) => m.type_production === tp).map((m) => (
              <li key={m.id} className={m.actif ? '' : 'read'}>
                <div className="grow">
                  <strong>{t('planning.dayN', { n: m.jour })} · {m.titre}</strong>
                  <div className="muted small">
                    {t(`planning.types.${m.type_tache}`)}{m.produit ? ` · ${m.produit}` : ''}
                    {` · ${m.assigne_role ? t(`roles.${m.assigne_role}`) : t('planning.everyone')}`}
                    {m.repeter_jours ? ` · ${t('planning.every', { n: m.repeter_jours })}` : ''}
                  </div>
                </div>
                {edit
                  ? <button className="btn ghost sm" onClick={() => toggle(m)}>{m.actif ? t('planning.disable') : t('planning.enable')}</button>
                  : !m.actif && <span className="tag muted">{t('planning.disabled')}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      {edit && (
        <FormCard title={t('planning.newStep')} icon="syringe" onSubmit={create}>
          <div className="grid-2">
            <Field label={t('planning.production')}>
              <select value={form.type_production} onChange={set('type_production')}>
                <option value="chair">{t('types.chair_pl')}</option>
                <option value="pondeuse">{t('types.pondeuse_pl')}</option>
              </select>
            </Field>
            <Field label={t('planning.ageDay')}><input type="number" min="0" required value={form.jour} onChange={set('jour')} /></Field>
            <Field label={t('planning.title')}><input required value={form.titre} onChange={set('titre')} /></Field>
            <Field label={t('planning.type')}>
              <select value={form.type_tache} onChange={set('type_tache')}>
                {TYPES_TACHE.map((x) => <option key={x} value={x}>{t(`planning.types.${x}`)}</option>)}
              </select>
            </Field>
            <Field label={t('planning.product')}><input value={form.produit} onChange={set('produit')} /></Field>
            <Field label={t('planning.assignee')}>
              <select value={form.assigne_role} onChange={set('assigne_role')}>
                {ROLES_TACHE.map((r) => <option key={r} value={r}>{r ? t(`roles.${r}`) : t('planning.everyone')}</option>)}
              </select>
            </Field>
            <Field label={t('planning.repeat')}><input type="number" min="1" value={form.repeter_jours} onChange={set('repeter_jours')} placeholder={t('planning.repeatPh')} /></Field>
          </div>
        </FormCard>
      )}
    </>
  )
}
