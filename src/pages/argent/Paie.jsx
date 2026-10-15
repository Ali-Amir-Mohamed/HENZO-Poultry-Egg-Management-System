import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import Icon from '../../components/Icon'
import { day, Field, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Payroll side panels: what is to be paid over each month (CNPS, payroll taxes), and the payroll settings
// (rates and scales, default values to be confirmed by the accountant).

export function ChargesAReverser() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => {
    const depuis = new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1).toLocaleDateString('en-CA')
    const [charges, paiements] = await Promise.all([
      supabase.from('charges_salaires_mensuelles').select('*').gte('mois', depuis).order('mois', { ascending: false }),
      supabase.from('paiements_impots').select('type_impot, periode, montant, depense:depenses(annulee)').in('type_impot', ['cnps', 'impots_salaires']).gte('periode', depuis)
    ])
    return { charges: must(charges), paiements: must(paiements).filter((p) => !p.depense?.annulee) }
  })
  if (!q.data) return <Loading error={q.error} />
  if (q.data.charges.length === 0) return null
  const payeur = can(role, 'impots.payer')
  const paye = (type, mois) => q.data.paiements.filter((p) => p.type_impot === type && String(p.periode).slice(0, 7) === String(mois).slice(0, 7)).reduce((s, p) => s + Number(p.montant), 0)
  const payer = async (type, mois, du) => {
    const libelle = `${t(`paie.over.${type}`)} – ${new Date(`${String(mois).slice(0, 10)}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })}`
    const v = await ask.form({ title: libelle, icon: 'wallet', submit: t('compta.imp.pay'), fields: [
      { name: 'montant', label: t('argent.amount'), type: 'number', min: 1, value: du, required: true },
      { name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'banque', options: MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) })) },
      { name: 'activite', label: t('compta.imp.box'), type: 'select', value: 'chair', options: ['chair', 'pondeuse'].map((a) => ({ value: a, label: t(`argent.caisse.${a}`) })) },
      { name: 'date', label: t('saisie.date'), type: 'date', value: new Date().toLocaleDateString('en-CA'), required: true },
      { name: 'reference', label: t('compta.imp.receipt') }
    ] })
    if (v) await run(supabase.rpc('payer_impot', { p_type: type, p_periode: String(mois).slice(0, 10), p_montant: v.montant, p_mode: v.mode, p_activite: v.activite, p_date: v.date, p_reference: v.reference || null }), q.reload)
  }
  const cellule = (type, mois, du) => {
    const deja = paye(type, mois)
    const echeance = new Date(new Date(`${String(mois).slice(0, 10)}T00:00`).getFullYear(), new Date(`${String(mois).slice(0, 10)}T00:00`).getMonth() + 1, 15)
    return (
      <td>
        <div className="num">{money(du, lang)}</div>
        {deja >= du ? <span className="tag ok">{t('compta.imp.paid')}</span>
          : <>
            <span className={`tag ${new Date() > echeance ? 'danger' : 'warn'}`}>{new Date() > echeance ? t('compta.imp.late') : t('compta.imp.toPay', { d: day(echeance.toLocaleDateString('en-CA'), lang) })}</span>
            {payeur && <button className="btn ghost sm" onClick={() => payer(type, mois, du - deja)}>{t('compta.imp.pay')}</button>}
          </>}
      </td>
    )
  }
  return (
    <Panel icon="wallet" tone="yolk" title={t('paie.overTitle')} subtitle={t('paie.overHint')}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('compta.imp.month')}</th><th className="num">{t('paie.grossTotal')}</th><th>{t('paie.over.cnps')}</th><th>{t('paie.over.impots_salaires')}</th></tr></thead>
          <tbody>
            {q.data.charges.map((c) => (
              <tr key={c.mois}>
                <td>{new Date(`${String(c.mois).slice(0, 10)}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })}<div className="muted small">{t('paie.payslips', { count: Number(c.bulletins) })}</div></td>
                <td className="num">{money(c.masse_brute, lang)}</td>
                {cellule('cnps', c.mois, Number(c.a_reverser_cnps))}
                {cellule('impots_salaires', c.mois, Number(c.a_reverser_impots))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

const NUMS = [
  ['plafond_cnps', 1], ['taux_cnps_salarie', 0.01], ['taux_cnps_vieillesse_pat', 0.01], ['taux_allocations_fam', 0.01], ['taux_accidents_travail', 0.01],
  ['taux_cfc_salarie', 0.01], ['taux_cfc_patronal', 0.01], ['taux_fne', 0.01], ['taux_cac', 0.01], ['abattement_frais', 0.01], ['abattement_annuel', 1], ['seuil_irpp', 1]
]
const BAREMES = [['bareme_irpp', 'taux'], ['bareme_rav', 'montant'], ['bareme_tdl', 'montant']]
const versTexte = (b, cle) => (b ?? []).map((x) => `${x.jusqu_a ?? '-'} ; ${x[cle]}`).join('\n')
const depuisTexte = (txt, cle) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [borne, val] = l.split(/[;=]/).map((x) => x.trim().replace(/\s/g, ''))
  if (val === undefined || Number.isNaN(Number(val))) throw new Error(l)
  return { jusqu_a: !borne || borne === '-' ? null : Number(borne), [cle]: Number(val) }
})

export function ParametresPaie() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const edit = can(role, 'salaires')
  const [ouvert, setOuvert] = useState(false)
  const q = useQuery(async () => (ouvert ? must(await supabase.from('parametres_paie').select('*').maybeSingle()) : null), [ouvert])
  const [form, setForm] = useState(null)
  const [etat, setEtat] = useState(null)
  useEffect(() => {
    if (q.data) setForm({ ...Object.fromEntries(NUMS.map(([k]) => [k, q.data[k]])), ...Object.fromEntries(BAREMES.map(([k, c]) => [k, versTexte(q.data[k], c)])) })
  }, [q.data])

  if (!edit) return null
  if (!ouvert) return <button type="button" className="btn ghost block" onClick={() => setOuvert(true)}><Icon name="settings" size={18} />{t('paie.settings')}</button>
  if (!q.data || !form) return <Loading error={q.error} />
  const set = (k) => (e) => { setEtat(null); setForm({ ...form, [k]: e.target.value }) }
  const enregistrer = async (e) => {
    e.preventDefault()
    let p
    try {
      p = { ...Object.fromEntries(NUMS.map(([k]) => [k, String(form[k])])), ...Object.fromEntries(BAREMES.map(([k, c]) => [k, depuisTexte(form[k], c)])) }
    } catch (err) {
      return setEtat({ error: t('paie.badLine', { l: err.message }) })
    }
    const { error } = await supabase.rpc('maj_parametres_paie', { p })
    if (error) return setEtat({ error: error.message })
    setEtat({ ok: true })
    q.reload()
  }
  return (
    <form className="panel form-card" onSubmit={enregistrer}>
      <div className="panel-head">
        <span className="kpi-icon green"><Icon name="settings" size={20} /></span>
        <div><h2>{t('paie.settings')}</h2><p className="muted">{t('paie.settingsHint')}</p></div>
        <span className="spacer" />
        <button type="button" className="icon-btn dark" onClick={() => setOuvert(false)} aria-label={t('common.close')}>✕</button>
      </div>
      <div className="grid-2">
        {NUMS.map(([k, step]) => (
          <Field key={k} label={t(`paie.params.${k}`)}><input type="number" min="0" step={step} required value={form[k]} onChange={set(k)} /></Field>
        ))}
      </div>
      {BAREMES.map(([k]) => (
        <Field key={k} label={t(`paie.params.${k}`)}><textarea rows={5} value={form[k]} onChange={set(k)} className="mono" /></Field>
      ))}
      <p className="muted small">{t('paie.scaleHelp')}</p>
      {etat?.error && <div className="alert danger"><Icon name="alert" size={18} />{etat.error}</div>}
      {etat?.ok && <div className="alert success"><Icon name="check" size={18} />{t('common.saved')}</div>}
      <button type="submit" className="btn primary block"><Icon name="check" size={18} />{t('common.save')}</button>
    </form>
  )
}
