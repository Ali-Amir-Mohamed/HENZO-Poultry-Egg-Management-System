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
import { useAsk } from '../../components/Dialog'

// Money start-up (Argent > Démarrage): the situation existing before HENZO
// (opening balances, investor capital, running loans) and reminders for stock and flocks — without double counting cash.
// The farm settings are in Réglages > Ferme (ReglagesFerme below).
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
    { key: 'argent', ok: done.soldes > 0 },
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
              {s.key === 'ferme' && can(role, 'ferme.settings')
                ? <Link to="/reglages?tab=ferme">{t('demarrage.steps.ferme')}</Link>
                : t(`demarrage.steps.${s.key}`)}
            </li>
          ))}
        </ol>
      </Panel>

      <ArgentDeDepart investisseurs={q.data.investisseurs} already={done.soldes} onSaved={q.reload} lang={lang} />

      <Panel icon="box" tone="sky" title={t('demarrage.steps.stock')} subtitle={t('demarrage.stockHint')}
        actions={<Link to="/stock" className="btn ghost sm">{t('nav.stock')}</Link>} />
      <Panel icon="hen" tone="yolk" title={t('demarrage.steps.bandes')} subtitle={t('demarrage.flocksHint')}
        actions={<Link to="/ferme" className="btn ghost sm">{t('nav.ferme')}</Link>} />
    </>
  )
}

export function ReglagesFerme() {
  const q = useQuery(async () => must(await supabase.from('fermes').select('*').limit(1).single()))
  if (!q.data) return <Loading error={q.error} />
  return <ParametresFerme ferme={q.data} onSaved={q.reload} />
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
      session_minutes: Number(form.session_minutes),
      oeufs_par_plateau: Number(form.oeufs_par_plateau)
    }).eq('id', ferme.id))
    onSaved()
  }
  return (
    <FormCard title={t('demarrage.settings')} icon="settings" onSubmit={save} startOpen>
      <div className="grid-2">
        <Field label={t('demarrage.farmName')} className="span-2"><input required value={form.nom} onChange={set('nom')} /></Field>
        <Field label={t('demarrage.threshold')}><input type="number" min="0" required value={form.seuil_validation_depense} onChange={set('seuil_validation_depense')} /></Field>
        <Field label={t('demarrage.investorRate')}><input type="number" min="0" max="100" step="0.01" required value={form.taux_investisseurs} onChange={set('taux_investisseurs')} /></Field>
        <Field label={t('demarrage.mortalityAlert')}><input type="number" min="0.01" step="0.01" required value={form.seuil_mortalite_pct} onChange={set('seuil_mortalite_pct')} /></Field>
        <Field label={t('demarrage.autonomyAlert')}><input type="number" min="1" required value={form.alerte_autonomie_jours} onChange={set('alerte_autonomie_jours')} /></Field>
        <Field label={t('demarrage.partyThreshold')}><input type="number" min="0" required value={form.seuil_tiers_obligatoire} onChange={set('seuil_tiers_obligatoire')} /></Field>
        <Field label={t('demarrage.sessionMinutes')}><input type="number" min="5" max="1440" required value={form.session_minutes} onChange={set('session_minutes')} /></Field>
        <Field label={t('demarrage.eggsPerTray')}><input type="number" min="1" required value={form.oeufs_par_plateau ?? 30} onChange={set('oeufs_par_plateau')} /></Field>
      </div>
    </FormCard>
  )
}

// Money present at start-up, by origin: partners' money, investors, loans.
// HENZO adds everything up; investors and loans also keep their capital / debt (10 %, repayments).
const CAISSES = ['chair', 'pondeuse'].flatMap((a) => MODES_PAIEMENT.map((m) => `${a}|${m}`))
const ligneAssocie = () => ({ caisse: 'chair|especes', montant: '' })
const ligneInvestisseur = () => ({ investisseur_id: '', nom: '', montant: '', caisse: 'chair|especes', disponible: '' })
const lignePret = () => ({ preteur: '', type_preteur: 'banque', montant: '', interets: '0', deja_rembourse: '0', caisse: 'chair|banque', disponible: '' })

function ArgentDeDepart({ investisseurs, already, onSaved, lang }) {
  const { t } = useTranslation()
  const ask = useAsk()
  const [date, setDate] = useState(localDate())
  const [associes, setAssocies] = useState([ligneAssocie()])
  const [invs, setInvs] = useState([])
  const [prets, setPrets] = useState([])
  const [busy, setBusy] = useState(false)
  const n = (v) => Number(v) || 0
  // "Encore en caisse" left empty = the whole amount
  const dispo = (l) => (l.disponible === '' ? n(l.montant) : Math.min(n(l.disponible), n(l.montant)))

  const parCaisse = {}
  const ajoute = (caisse, v) => { if (v > 0) parCaisse[caisse] = (parCaisse[caisse] ?? 0) + v }
  associes.forEach((l) => ajoute(l.caisse, n(l.montant)))
  invs.forEach((l) => ajoute(l.caisse, dispo(l)))
  prets.forEach((l) => ajoute(l.caisse, dispo(l)))
  const total = Object.values(parCaisse).reduce((a, b) => a + b, 0)
  const nomCaisse = (c) => { const [a, m] = c.split('|'); return `${t(`argent.caisse.${a}`)} · ${t(`modes.${m}`)}` }
  const dette = prets.reduce((s, l) => s + n(l.montant) + n(l.interets) - n(l.deja_rembourse), 0)
  const capital = invs.reduce((s, l) => s + n(l.montant), 0)

  const maj = (setter) => (i, k) => (e) => setter((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))
  const retire = (setter) => (i) => setter((rows) => rows.filter((_, j) => j !== i))
  const caisseSelect = (value, onChange) => (
    <select value={value} onChange={onChange}>{CAISSES.map((c) => <option key={c} value={c}>{nomCaisse(c)}</option>)}</select>
  )
  const split = (c) => { const [activite, mode] = c.split('|'); return { activite, mode } }

  const enregistrer = async () => {
    if (total <= 0 && !invs.length && !prets.length) return ask.error(t('demarrage.nothing'))
    const lignes = Object.entries(parCaisse).map(([c, v]) => `${nomCaisse(c)} : ${money(v, lang)}`).join('\n')
    if (!(await ask.confirm(t('demarrage.confirm', { total: money(total, lang), lignes }), { title: t('demarrage.saveTitle'), icon: 'wallet', submit: t('demarrage.save') }))) return
    setBusy(true)
    const payload = {
      date,
      associes: associes.filter((l) => n(l.montant) > 0).map((l) => ({ ...split(l.caisse), montant: n(l.montant) })),
      investisseurs: invs.filter((l) => n(l.montant) > 0).map((l) => ({ investisseur_id: l.investisseur_id || null, nom: l.nom, montant: n(l.montant), disponible: dispo(l), ...split(l.caisse) })),
      prets: prets.filter((l) => n(l.montant) > 0).map((l) => ({ preteur: l.preteur, type_preteur: l.type_preteur, montant: n(l.montant), interets: n(l.interets), deja_rembourse: n(l.deja_rembourse), disponible: dispo(l), ...split(l.caisse) }))
    }
    const { error } = await supabase.rpc('enregistrer_demarrage', { p: payload })
    setBusy(false)
    if (error) return ask.error(error.message)
    setAssocies([ligneAssocie()]); setInvs([]); setPrets([])
    onSaved()
    await ask.info(t('demarrage.savedTitle'), t('demarrage.savedText', { total: money(total, lang) }))
  }

  return (
    <Panel icon="wallet" tone="green" title={t('demarrage.moneyTitle')} subtitle={t('demarrage.moneyHint')}>
      {already > 0 && <div className="alert warn"><Icon name="alert" size={18} />{t('demarrage.alreadyBalances', { count: already })}</div>}
      <Field label={t('demarrage.balanceDate')}><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>

      <h3 className="start-title">1. {t('demarrage.partners')}</h3>
      <p className="muted small">{t('demarrage.partnersHint')}</p>
      {associes.map((l, i) => (
        <div key={i} className="start-line">
          <Field label={t('demarrage.cashBox')}>{caisseSelect(l.caisse, maj(setAssocies)(i, 'caisse'))}</Field>
          <Field label={t('demarrage.amount')}><input type="number" min="0" value={l.montant} onChange={maj(setAssocies)(i, 'montant')} placeholder="0" /></Field>
          {associes.length > 1 && <button type="button" className="icon-btn dark" onClick={() => retire(setAssocies)(i)} aria-label={t('stock.remove')}><Icon name="trash" size={16} /></button>}
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => setAssocies([...associes, ligneAssocie()])}><Icon name="plus" size={14} />{t('demarrage.addCashBox')}</button>

      <h3 className="start-title">2. {t('demarrage.investors')}</h3>
      <p className="muted small">{t('demarrage.investorsHint')}</p>
      {invs.map((l, i) => (
        <div key={i} className="start-line">
          <Field label={t('capital.investor')}>
            <select value={l.investisseur_id} onChange={maj(setInvs)(i, 'investisseur_id')}>
              <option value="">{t('demarrage.newInvestor')}</option>
              {investisseurs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </Field>
          {!l.investisseur_id && <Field label={t('reglages.name')}><input value={l.nom} onChange={maj(setInvs)(i, 'nom')} /></Field>}
          <Field label={t('demarrage.invested')}><input type="number" min="0" value={l.montant} onChange={maj(setInvs)(i, 'montant')} placeholder="0" /></Field>
          <Field label={t('demarrage.cashBox')}>{caisseSelect(l.caisse, maj(setInvs)(i, 'caisse'))}</Field>
          <Field label={t('demarrage.stillInCash')}><input type="number" min="0" value={l.disponible} onChange={maj(setInvs)(i, 'disponible')} placeholder={String(n(l.montant))} /></Field>
          <button type="button" className="icon-btn dark" onClick={() => retire(setInvs)(i)} aria-label={t('stock.remove')}><Icon name="trash" size={16} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => setInvs([...invs, ligneInvestisseur()])}><Icon name="plus" size={14} />{t('demarrage.addInvestor')}</button>

      <h3 className="start-title">3. {t('demarrage.loans')}</h3>
      <p className="muted small">{t('demarrage.loansHint')}</p>
      {prets.map((l, i) => (
        <div key={i} className="start-line">
          <Field label={t('prets.lender')}><input value={l.preteur} onChange={maj(setPrets)(i, 'preteur')} /></Field>
          <Field label={t('reglages.type')}>
            <select value={l.type_preteur} onChange={maj(setPrets)(i, 'type_preteur')}>
              {['banque', 'particulier'].map((k) => <option key={k} value={k}>{t(`prets.types.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('demarrage.lent')}><input type="number" min="0" value={l.montant} onChange={maj(setPrets)(i, 'montant')} placeholder="0" /></Field>
          <Field label={t('prets.interestTotal')}><input type="number" min="0" value={l.interets} onChange={maj(setPrets)(i, 'interets')} /></Field>
          <Field label={t('demarrage.alreadyRepaid')}><input type="number" min="0" value={l.deja_rembourse} onChange={maj(setPrets)(i, 'deja_rembourse')} /></Field>
          <Field label={t('demarrage.cashBox')}>{caisseSelect(l.caisse, maj(setPrets)(i, 'caisse'))}</Field>
          <Field label={t('demarrage.stillInCash')}><input type="number" min="0" value={l.disponible} onChange={maj(setPrets)(i, 'disponible')} placeholder={String(n(l.montant))} /></Field>
          <button type="button" className="icon-btn dark" onClick={() => retire(setPrets)(i)} aria-label={t('stock.remove')}><Icon name="trash" size={16} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => setPrets([...prets, lignePret()])}><Icon name="plus" size={14} />{t('demarrage.addLoan')}</button>

      <div className="start-summary">
        <h3 className="start-title">{t('demarrage.summary')}</h3>
        {Object.keys(parCaisse).length === 0 ? <p className="muted small">{t('demarrage.summaryEmpty')}</p> : (
          <table className="table money-table">
            <tbody>
              {Object.entries(parCaisse).map(([c, v]) => <tr key={c}><td>{nomCaisse(c)}</td><td>{money(v, lang)}</td></tr>)}
              <tr className="sum"><td>{t('demarrage.totalCash')}</td><td>{money(total, lang)}</td></tr>
            </tbody>
          </table>
        )}
        {(capital > 0 || dette > 0) && (
          <p className="muted small">
            {capital > 0 && t('demarrage.ofWhichCapital', { n: money(capital, lang) })}
            {capital > 0 && dette > 0 && ' · '}
            {dette > 0 && t('demarrage.ofWhichDebt', { n: money(dette, lang) })}
          </p>
        )}
      </div>
      <button className="btn primary block" onClick={enregistrer} disabled={busy}><Icon name="check" size={18} />{busy ? t('common.loading') : t('demarrage.save')}</button>
    </Panel>
  )
}
