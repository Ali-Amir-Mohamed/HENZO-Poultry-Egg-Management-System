import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { Field, FormCard, Loading, money, Panel } from '../../components/ui'

// Initial setup: farm settings and the situation existing before HENZO
// (opening balances, investor capital, running loans, stock, flocks) — without double counting cash.
export default function Demarrage() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage

  const q = useQuery(async () => {
    const count = (table, filter) => {
      let r = supabase.from(table).select('id', { count: 'exact', head: true })
      if (filter) r = filter(r)
      return r
    }
    const [ferme, soldes, inv, prets, articles, bandes, lots, caisses, investisseurs] = await Promise.all([
      supabase.from('fermes').select('*').limit(1).single(),
      count('ecritures', (r) => r.eq('nature', 'solde_initial')),
      count('investisseurs'), count('prets'), count('articles'), count('bandes'), count('lots_pondeuses'),
      supabase.from('caisses').select('id, activite, mode').order('activite').order('mode'),
      supabase.from('investisseurs').select('id, nom').order('nom')
    ])
    for (const r of [soldes, inv, prets, articles, bandes, lots]) if (r.error) throw r.error
    return {
      ferme: must(ferme), caisses: must(caisses), investisseurs: must(investisseurs),
      done: { soldes: soldes.count, investisseurs: inv.count, prets: prets.count, stock: articles.count, bandes: bandes.count + lots.count }
    }
  })

  if (!q.data) return <Loading error={q.error} />
  const { done } = q.data
  const steps = [
    { key: 'ferme', ok: true },
    { key: 'soldes', ok: done.soldes > 0 },
    { key: 'investisseurs', ok: done.investisseurs > 0 },
    { key: 'prets', ok: done.prets > 0 },
    { key: 'stock', ok: done.stock > 0 },
    { key: 'bandes', ok: done.bandes > 0 }
  ]

  return (
    <>
      <Panel icon="flag" tone="green" title={t('demarrage.title')} subtitle={t('demarrage.subtitle')}>
        <ol className="checklist">
          {steps.map((s) => (
            <li key={s.key} className={s.ok ? 'ok' : ''}>
              <span className="task-check">{s.ok ? <Icon name="check" size={14} /> : null}</span>
              {t(`demarrage.steps.${s.key}`)}
            </li>
          ))}
        </ol>
      </Panel>

      {can(role, 'ferme.settings') && <ParametresFerme ferme={q.data.ferme} onSaved={q.reload} />}
      <SoldesInitiaux caisses={q.data.caisses} already={done.soldes} onSaved={q.reload} lang={lang} />
      <CapitalInitial investisseurs={q.data.investisseurs} onSaved={q.reload} />
      <PretExistant onSaved={q.reload} />

      <Panel icon="box" tone="sky" title={t('demarrage.steps.stock')} subtitle={t('demarrage.stockHint')}
        actions={<Link to="/stock" className="btn ghost sm">{t('nav.stock')}</Link>} />
      <Panel icon="hen" tone="yolk" title={t('demarrage.steps.bandes')} subtitle={t('demarrage.flocksHint')}
        actions={<Link to="/ferme" className="btn ghost sm">{t('nav.ferme')}</Link>} />
    </>
  )
}

function ParametresFerme({ ferme, onSaved }) {
  const { t } = useTranslation()
  const [form, setForm] = useState(ferme)
  useEffect(() => setForm(ferme), [ferme])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = async () => {
    must(await supabase.from('fermes').update({
      nom: form.nom,
      seuil_validation_depense: Number(form.seuil_validation_depense),
      taux_investisseurs: Number(form.taux_investisseurs),
      seuil_mortalite_pct: Number(form.seuil_mortalite_pct),
      alerte_autonomie_jours: Number(form.alerte_autonomie_jours),
      seuil_tiers_obligatoire: Number(form.seuil_tiers_obligatoire),
      session_minutes: Number(form.session_minutes)
    }).eq('id', ferme.id))
    onSaved()
  }
  return (
    <FormCard title={t('demarrage.settings')} icon="settings" onSubmit={save}>
      <div className="grid-2">
        <Field label={t('demarrage.farmName')} className="span-2"><input required value={form.nom} onChange={set('nom')} /></Field>
        <Field label={t('demarrage.threshold')}><input type="number" min="0" required value={form.seuil_validation_depense} onChange={set('seuil_validation_depense')} /></Field>
        <Field label={t('demarrage.investorRate')}><input type="number" min="0" max="100" step="0.01" required value={form.taux_investisseurs} onChange={set('taux_investisseurs')} /></Field>
        <Field label={t('demarrage.mortalityAlert')}><input type="number" min="0.01" step="0.01" required value={form.seuil_mortalite_pct} onChange={set('seuil_mortalite_pct')} /></Field>
        <Field label={t('demarrage.autonomyAlert')}><input type="number" min="1" required value={form.alerte_autonomie_jours} onChange={set('alerte_autonomie_jours')} /></Field>
        <Field label={t('demarrage.partyThreshold')}><input type="number" min="0" required value={form.seuil_tiers_obligatoire} onChange={set('seuil_tiers_obligatoire')} /></Field>
        <Field label={t('demarrage.sessionMinutes')}><input type="number" min="5" max="1440" required value={form.session_minutes} onChange={set('session_minutes')} /></Field>
      </div>
    </FormCard>
  )
}

function SoldesInitiaux({ caisses, already, onSaved, lang }) {
  const { t } = useTranslation()
  const [values, setValues] = useState({})
  const [date, setDate] = useState(localDate())
  const total = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0)
  const save = async () => {
    const rows = caisses.filter((c) => Number(values[c.id]) > 0).map((c) => ({
      caisse_id: c.id, sens: 'entree', montant: Number(values[c.id]), nature: 'solde_initial',
      libelle: t('argent.openingBalance'), date_operation: date
    }))
    if (!rows.length) throw new Error(t('demarrage.nothing'))
    must(await supabase.from('ecritures').insert(rows))
    setValues({})
    onSaved()
  }
  return (
    <FormCard title={t('demarrage.steps.soldes')} icon="wallet" onSubmit={save}>
      {already > 0 && <div className="alert warn"><Icon name="alert" size={18} />{t('demarrage.alreadyBalances', { count: already })}</div>}
      <p className="note"><Icon name="clock" size={16} />{t('demarrage.balancesHint')}</p>
      <div className="grid-2">
        {caisses.map((c) => (
          <Field key={c.id} label={`${t(`argent.caisse.${c.activite}`)} · ${t(`modes.${c.mode}`)}`}>
            <input type="number" min="0" value={values[c.id] ?? ''} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} placeholder="0" />
          </Field>
        ))}
        <Field label={t('demarrage.balanceDate')}><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="total-box"><span>{t('analyses.r.total')}</span><strong>{money(total, lang)}</strong></div>
    </FormCard>
  )
}

function CapitalInitial({ investisseurs, onSaved }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ investisseur_id: '', nom: '', montant: '' })
  const save = async () => {
    let id = form.investisseur_id
    if (!id) {
      const created = must(await supabase.from('investisseurs').insert({ nom: form.nom }).select('id').single())
      id = created.id
    }
    must(await supabase.from('operations_investisseurs').insert({
      investisseur_id: id, type_operation: 'capital_initial', montant: Number(form.montant), notes: t('demarrage.beforeHenzo')
    }))
    setForm({ investisseur_id: '', nom: '', montant: '' })
    onSaved()
  }
  return (
    <FormCard title={t('demarrage.steps.investisseurs')} icon="users" onSubmit={save}>
      <p className="note"><Icon name="clock" size={16} />{t('demarrage.capitalHint')}</p>
      <div className="grid-2">
        <Field label={t('capital.investor')}>
          <select value={form.investisseur_id} onChange={(e) => setForm({ ...form, investisseur_id: e.target.value })}>
            <option value="">{t('demarrage.newInvestor')}</option>
            {investisseurs.map((i) => <option key={i.id} value={i.id}>{i.nom}</option>)}
          </select>
        </Field>
        {!form.investisseur_id && <Field label={t('reglages.name')}><input required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></Field>}
        <Field label={t('demarrage.capitalAmount')} className="big"><input type="number" min="1" required value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></Field>
      </div>
    </FormCard>
  )
}

function PretExistant({ onSaved }) {
  const { t } = useTranslation()
  const empty = { type_preteur: 'banque', preteur: '', montant_initial: '', interets: '0', deja_rembourse: '0', activite: 'chair', date_pret: localDate() }
  const [form, setForm] = useState(empty)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = async () => {
    must(await supabase.from('prets').insert({
      ...form, montant_initial: Number(form.montant_initial), interets: Number(form.interets) || 0,
      deja_rembourse: Number(form.deja_rembourse) || 0, mode_paiement: MODES_PAIEMENT[2], existant: true
    }))
    setForm(empty)
    onSaved()
  }
  return (
    <FormCard title={t('demarrage.steps.prets')} icon="receipt" onSubmit={save}>
      <p className="note"><Icon name="clock" size={16} />{t('demarrage.loanHint')}</p>
      <div className="grid-2">
        <Field label={t('prets.lender')}><input required value={form.preteur} onChange={set('preteur')} /></Field>
        <Field label={t('reglages.type')}>
          <select value={form.type_preteur} onChange={set('type_preteur')}>
            {['banque', 'particulier'].map((k) => <option key={k} value={k}>{t(`prets.types.${k}`)}</option>)}
          </select>
        </Field>
        <Field label={t('prets.amount')}><input type="number" min="1" required value={form.montant_initial} onChange={set('montant_initial')} /></Field>
        <Field label={t('prets.interestTotal')}><input type="number" min="0" value={form.interets} onChange={set('interets')} /></Field>
        <Field label={t('demarrage.alreadyRepaid')}><input type="number" min="0" value={form.deja_rembourse} onChange={set('deja_rembourse')} /></Field>
        <Field label={t('prets.activity')}>
          <select value={form.activite} onChange={set('activite')}>
            <option value="chair">{t('argent.caisse.chair')}</option>
            <option value="pondeuse">{t('argent.caisse.pondeuse')}</option>
          </select>
        </Field>
        <Field label={t('demarrage.loanDate')}><input type="date" required value={form.date_pret} onChange={set('date_pret')} /></Field>
      </div>
    </FormCard>
  )
}
