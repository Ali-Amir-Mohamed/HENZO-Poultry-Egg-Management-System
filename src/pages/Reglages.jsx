import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can, PRODUITS, TABLES } from '../config'
import { localDate } from '../lib/stats'
import { day, Empty, Field, FormCard, Loading, money, Panel, Tabs } from '../components/ui'
import Icon from '../components/Icon'
import { ReglagesFerme } from './reglages/Demarrage'
import { useAsk, useRun } from '../components/Dialog'
import Comptes from './reglages/Comptes'
import Journal from './reglages/Journal'
import Connexions from './reglages/Connexions'
import Fermes from './reglages/Fermes'
import NoteConfiance from '../components/NoteConfiance'
import Sauvegarde from './reglages/Sauvegarde'
import { Link, useSearchParams } from 'react-router-dom'

// Settings: customers & suppliers (with credit authorisation), current sale prices, initial setup
export default function Reglages() {
  const { role } = useAuth()
  const [params] = useSearchParams()
  const [tab, setTab] = useState(() => params.get('tab') || 'tiers')
  const tabs = [
    { id: 'tiers', label: 'reglages.tabs.tiers', icon: 'users' },
    { id: 'prix', label: 'reglages.tabs.prix', icon: 'tag' },
    ...(can(role, 'comptes') ? [{ id: 'comptes', label: 'reglages.tabs.comptes', icon: 'users' }] : []),
    ...(can(role, 'journal') ? [{ id: 'journal', label: 'reglages.tabs.journal', icon: 'note' }, { id: 'connexions', label: 'reglages.tabs.connexions', icon: 'clock' }] : []),
    ...(can(role, 'comptes') ? [{ id: 'fermes', label: 'reglages.tabs.fermes', icon: 'barn' }] : []),
    ...(can(role, 'sauvegarde') ? [{ id: 'sauvegarde', label: 'reglages.tabs.sauvegarde', icon: 'download' }] : []),
    ...(can(role, 'ferme.settings') ? [{ id: 'ferme', label: 'reglages.tabs.ferme', icon: 'settings' }] : [])
  ]
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'tiers' && <Tiers />}
      {tab === 'prix' && <Prix />}
      {tab === 'comptes' && <Comptes />}
      {tab === 'journal' && <Journal />}
      {tab === 'connexions' && <Connexions />}
      {tab === 'fermes' && <Fermes />}
      {tab === 'sauvegarde' && <Sauvegarde />}
      {tab === 'ferme' && <ReglagesFerme />}
    </div>
  )
}

function Tiers() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const list = useQuery(async () => must(await supabase.from(TABLES.tiers).select('*').order('nom')))
  const societes = useQuery(async () => (await supabase.rpc('mes_societes')).data ?? [])
  const confiance = useQuery(async () => { const { data } = await supabase.from('confiance_clients').select('*'); return Object.fromEntries((data ?? []).map((c) => [c.client_id, c])) })
  const [form, setForm] = useState({ type_tiers: 'client', nom: '', telephone: '', adresse: '', niu: '', rccm: '', credit_autorise: false, plafond_credit: '0' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const grant = can(role, 'credit.grant')
  const ask = useAsk()
  const run = useRun()

  const create = async () => {
    must(await supabase.from(TABLES.tiers).insert({
      ...form,
      telephone: form.telephone || null,
      adresse: form.adresse || null,
      niu: form.niu.trim() || null,
      rccm: form.rccm.trim() || null,
      credit_autorise: grant && form.credit_autorise,
      plafond_credit: grant && form.credit_autorise ? Number(form.plafond_credit) : 0
    }))
    setForm({ ...form, nom: '', telephone: '', adresse: '', niu: '', rccm: '' })
    list.reload()
  }

  // Edit a customer / supplier (credit fields only for director and exploitation)
  const editTiers = async (c) => {
    const withCredit = grant && c.type_tiers !== 'fournisseur'
    const v = await ask.form({ title: t('reglages.editTitle', { nom: c.nom }), icon: 'users', submit: t('dialog.save'), fields: [
      { name: 'nom', label: t('reglages.name'), value: c.nom, required: true },
      { name: 'type_tiers', label: t('reglages.type'), type: 'select', value: c.type_tiers,
        options: ['client', 'fournisseur', 'client_fournisseur'].map((x) => ({ value: x, label: t(`tiersTypes.${x}`) })) },
      { name: 'telephone', label: t('reglages.phone'), type: 'tel', value: c.telephone ?? '' },
      { name: 'adresse', label: t('reglages.address'), value: c.adresse ?? '' },
      { name: 'niu', label: 'NIU', value: c.niu ?? '', hint: t('reglages.niuHint') },
      { name: 'rccm', label: 'RCCM', value: c.rccm ?? '' },
      ...(withCredit ? [{ name: 'plafond_credit', label: t('reglages.ceilingEdit'), type: 'number', min: 0, value: c.credit_autorise ? c.plafond_credit : 0, hint: t('reglages.ceilingHint') }] : [])
    ] })
    if (!v) return
    const patch = { nom: v.nom, type_tiers: v.type_tiers, telephone: v.telephone || null, adresse: v.adresse || null, niu: v.niu.trim() || null, rccm: v.rccm.trim() || null }
    if (withCredit) Object.assign(patch, { credit_autorise: Number(v.plafond_credit) > 0, plafond_credit: Number(v.plafond_credit) || 0 })
    await run(supabase.from(TABLES.tiers).update(patch).eq('id', c.id), list.reload)
  }

  // Link to another company of the group (its sales become deliveries to receive, paid from the buyer)
  const lier = async (c) => {
    const autres = (societes.data ?? []).filter((s) => !s.active)
    if (autres.length === 0) return ask.error(t('groupe.noOther'))
    const v = await ask.form({ title: t('groupe.linkTitle', { nom: c.nom }), icon: 'users', submit: t('dialog.save'), message: t('groupe.linkHint'), fields: [
      { name: 'ferme', label: t('groupe.company'), type: 'select', value: c.ferme_liee_id ?? '', options: [{ value: '', label: t('groupe.none') }, ...autres.map((s) => ({ value: s.ferme_id, label: s.nom }))] }
    ] })
    if (v) await run(supabase.rpc('lier_tiers', { p_tiers: c.id, p_ferme: v.ferme || null }), list.reload)
  }
  const nomSociete = (id) => (societes.data ?? []).find((s) => s.ferme_id === id)?.nom ?? t('groupe.company')
  // Kenfack applies the advised credit ceiling (0 = cash only)
  const appliquer = async (c, n) => {
    const plafond = Number(n.plafond_conseille)
    if (!(await ask.confirm(plafond > 0 ? t('confiance.applyConfirm', { nom: c.nom, n: money(plafond, lang) }) : t('confiance.applyNone', { nom: c.nom }), { title: t('confiance.apply'), icon: 'users' }))) return
    await run(supabase.from(TABLES.tiers).update({ credit_autorise: plafond > 0, plafond_credit: plafond }).eq('id', c.id), () => { list.reload(); confiance.reload() })
  }

  return (
    <>
      {can(role, 'tiers.edit') && (
        <FormCard title={t('reglages.newTiers')} icon="users" onSubmit={create}>
          <div className="grid-2">
            <Field label={t('reglages.type')}>
              <select value={form.type_tiers} onChange={set('type_tiers')}>
                {['client', 'fournisseur', 'client_fournisseur'].map((x) => <option key={x} value={x}>{t(`tiersTypes.${x}`)}</option>)}
              </select>
            </Field>
            <Field label={t('reglages.name')}><input required value={form.nom} onChange={set('nom')} /></Field>
            <Field label={t('reglages.phone')}><input type="tel" value={form.telephone} onChange={set('telephone')} /></Field>
            <Field label={t('reglages.address')}><input value={form.adresse} onChange={set('adresse')} /></Field>
            <Field label="NIU"><input value={form.niu} onChange={set('niu')} placeholder={t('reglages.niuHint')} /></Field>
            <Field label="RCCM"><input value={form.rccm} onChange={set('rccm')} /></Field>
          </div>
          {grant && form.type_tiers !== 'fournisseur' && (
            <div className="grid-2">
              <label className="check"><input type="checkbox" checked={form.credit_autorise} onChange={set('credit_autorise')} />{t('reglages.allowCredit')}</label>
              {form.credit_autorise && (
                <Field label={t('reglages.ceiling')}><input type="number" min="0" value={form.plafond_credit} onChange={set('plafond_credit')} /></Field>
              )}
            </div>
          )}
        </FormCard>
      )}

      <Panel title={t('reglages.tiersList')}>
        {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <Empty icon="users" text={t('reglages.noTiers')} /> : (
          <ul className="list">
            {list.data.map((c) => (
              <li key={c.id}>
                <div className="grow">
                  <Link to={`/reglages/tiers/${c.id}`} className="card-title">{c.nom}<Icon name="chevron" size={14} /></Link>
                  <div className="muted small">{t(`tiersTypes.${c.type_tiers}`)}{c.telephone ? ` · ${c.telephone}` : ''}{c.adresse ? ` · ${c.adresse}` : ''}{c.niu ? ` · NIU ${c.niu}` : ''}</div>
                  {confiance.data?.[c.id] && confiance.data[c.id].note !== 'nouveau' && (
                    <div className="muted small">{[confiance.data[c.id].delai_moyen != null && t('confiance.delay', { count: Number(confiance.data[c.id].delai_moyen) }),
                      Number(confiance.data[c.id].plus_vieille_dette) > 0 && t('confiance.oldest', { count: Number(confiance.data[c.id].plus_vieille_dette) }),
                      confiance.data[c.id].plafond_conseille != null && (Number(confiance.data[c.id].plafond_conseille) > 0 ? t('confiance.advised', { n: money(confiance.data[c.id].plafond_conseille, lang) }) : t('confiance.noCredit'))].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="row-actions">
                    <Link to={`/reglages/tiers/${c.id}`} className="btn ghost sm">{t('tiers.history')}</Link>
                    {can(role, 'tiers.edit') && <button className="btn ghost sm" onClick={() => editTiers(c)}>{t('common.edit')}</button>}
                    {can(role, 'groupe.lier') && <button className="btn ghost sm" onClick={() => lier(c)}>{t('groupe.link')}</button>}
                    {grant && confiance.data?.[c.id]?.plafond_conseille != null && Number(confiance.data[c.id].plafond_conseille) !== (c.credit_autorise ? Number(c.plafond_credit) : 0) && (
                      <button className="btn ghost sm" onClick={() => appliquer(c, confiance.data[c.id])}>{t('confiance.apply')}</button>
                    )}
                  </div>
                </div>
                {c.ferme_liee_id && <span className="tag ok">{t('groupe.tag', { nom: nomSociete(c.ferme_liee_id) })}</span>}
                <NoteConfiance note={confiance.data?.[c.id]?.note} />
                {c.credit_autorise && <span className="tag warn">{t('reglages.creditUpTo', { n: money(c.plafond_credit, lang) })}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

function Prix() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const list = useQuery(async () => must(await supabase.from('prix_actuels').select('*')))
  const options = [...new Map([...PRODUITS.chair, ...PRODUITS.pondeuse].map((p) => [p.produit, p])).values()]
  const [form, setForm] = useState({ produit: 'poulets', unite: 'piece', prix: '', date_debut: localDate() })
  const unites = options.find((p) => p.produit === form.produit)?.unites ?? []

  const create = async () => {
    must(await supabase.from(TABLES.prix).insert({ ...form, prix: Number(form.prix) }))
    setForm({ ...form, prix: '' })
    list.reload()
  }

  return (
    <>
      <Panel icon="tag" tone="yolk" title={t('reglages.currentPrices')} subtitle={t('reglages.pricesHint')}>
        {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <p className="muted">{t('reglages.noPrices')}</p> : (
          <ul className="list">
            {list.data.map((p) => (
              <li key={`${p.produit}-${p.unite}`}>
                <div>
                  <strong>{t(`produits.${p.produit}`)}</strong>
                  <div className="muted small">{t('reglages.per', { unite: t(`unites.${p.unite}`) })} · {t('reglages.since', { d: day(p.date_debut, lang) })}</div>
                </div>
                <strong>{money(p.prix, lang)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {can(role, 'prix.set') && (
        <FormCard title={t('reglages.newPrice')} icon="tag" onSubmit={create}>
          <div className="grid-2">
            <Field label={t('saisie.produit')}>
              <select value={form.produit} onChange={(e) => {
                const p = options.find((o) => o.produit === e.target.value)
                setForm({ ...form, produit: e.target.value, unite: p.unites[0] })
              }}>
                {options.map((p) => <option key={p.produit} value={p.produit}>{t(`produits.${p.produit}`)}</option>)}
              </select>
            </Field>
            <Field label={t('saisie.unite')}>
              <select value={form.unite} onChange={(e) => setForm({ ...form, unite: e.target.value })}>
                {unites.map((u) => <option key={u} value={u}>{t(`unites.${u}`)}</option>)}
              </select>
            </Field>
            <Field label={t('reglages.price')} className="big"><input type="number" min="1" required value={form.prix} onChange={(e) => setForm({ ...form, prix: e.target.value })} /></Field>
            <Field label={t('reglages.from')}><input type="date" required value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} /></Field>
          </div>
          <p className="note"><Icon name="alert" size={16} />{t('reglages.priceGapNote')}</p>
        </FormCard>
      )}
    </>
  )
}
