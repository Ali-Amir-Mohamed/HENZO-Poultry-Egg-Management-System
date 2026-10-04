import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can, PRODUITS, TABLES } from '../config'
import { localDate } from '../lib/stats'
import { day, Empty, Field, FormCard, Loading, money, Panel, Tabs } from '../components/ui'
import Icon from '../components/Icon'
import Demarrage from './reglages/Demarrage'
import Comptes from './reglages/Comptes'
import Journal from './reglages/Journal'
import Sauvegarde from './reglages/Sauvegarde'
import { Link } from 'react-router-dom'

// Settings: customers & suppliers (with credit authorisation), current sale prices, initial setup
export default function Reglages() {
  const { role } = useAuth()
  const [tab, setTab] = useState('tiers')
  const tabs = [
    { id: 'tiers', label: 'reglages.tabs.tiers', icon: 'users' },
    { id: 'prix', label: 'reglages.tabs.prix', icon: 'tag' },
    ...(can(role, 'comptes') ? [{ id: 'comptes', label: 'reglages.tabs.comptes', icon: 'users' }] : []),
    ...(can(role, 'journal') ? [{ id: 'journal', label: 'reglages.tabs.journal', icon: 'note' }] : []),
    ...(can(role, 'sauvegarde') ? [{ id: 'sauvegarde', label: 'reglages.tabs.sauvegarde', icon: 'download' }] : []),
    ...(can(role, 'demarrage') ? [{ id: 'demarrage', label: 'reglages.tabs.demarrage', icon: 'flag' }] : [])
  ]
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'tiers' && <Tiers />}
      {tab === 'prix' && <Prix />}
      {tab === 'comptes' && <Comptes />}
      {tab === 'journal' && <Journal />}
      {tab === 'sauvegarde' && <Sauvegarde />}
      {tab === 'demarrage' && <Demarrage />}
    </div>
  )
}

function Tiers() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const list = useQuery(async () => must(await supabase.from(TABLES.tiers).select('*').order('nom')))
  const [form, setForm] = useState({ type_tiers: 'client', nom: '', telephone: '', adresse: '', credit_autorise: false, plafond_credit: '0' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const grant = can(role, 'credit.grant')

  const create = async () => {
    must(await supabase.from(TABLES.tiers).insert({
      ...form,
      telephone: form.telephone || null,
      adresse: form.adresse || null,
      credit_autorise: grant && form.credit_autorise,
      plafond_credit: grant && form.credit_autorise ? Number(form.plafond_credit) : 0
    }))
    setForm({ ...form, nom: '', telephone: '', adresse: '' })
    list.reload()
  }

  const editCredit = async (c) => {
    const answer = window.prompt(t('reglages.creditPrompt', { nom: c.nom }), c.credit_autorise ? c.plafond_credit : '0')
    if (answer === null) return
    const plafond = Number(answer)
    if (Number.isNaN(plafond) || plafond < 0) return
    const { error } = await supabase.from(TABLES.tiers).update({ credit_autorise: plafond > 0, plafond_credit: plafond }).eq('id', c.id)
    if (error) window.alert(error.message)
    list.reload()
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
                  <div className="muted small">{t(`tiersTypes.${c.type_tiers}`)}{c.telephone ? ` · ${c.telephone}` : ''}{c.adresse ? ` · ${c.adresse}` : ''}</div>
                  <div className="row-actions">
                    <Link to={`/reglages/tiers/${c.id}`} className="btn ghost sm">{t('tiers.history')}</Link>
                    {grant && c.type_tiers !== 'fournisseur' && <button className="btn ghost sm" onClick={() => editCredit(c)}>{t('reglages.editCredit')}</button>}
                  </div>
                </div>
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
