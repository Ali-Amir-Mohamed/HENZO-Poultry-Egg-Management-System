import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import { exportExcel } from '../../lib/export'
import Icon from '../../components/Icon'
import { day, Empty, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Accounting books (SYSCOHADA), built from what HENZO already records: journal, general ledger,
// trial balance, income statement, simplified balance sheet, chart of accounts (editable by direction and finance).
// Stocks, depreciation and the year-end tax remain the accountant's entries.
const VUES = ['journal', 'grandlivre', 'balance', 'resultat', 'bilan', 'plan']
const LIMITE = 3000
const classe = (c) => Number(String(c)[0])
const nombre = (n) => Number(n ?? 0).toLocaleString('fr-FR')

function usePeriode() {
  const an = new Date().getFullYear()
  const [annee, setAnnee] = useState(an)
  const [mois, setMois] = useState('')
  const debut = mois ? `${annee}-${mois}-01` : `${annee}-01-01`
  const fin = mois ? new Date(annee, Number(mois), 0).toLocaleDateString('en-CA') : `${annee}-12-31`
  return { annee, setAnnee, mois, setMois, debut, fin, annees: [an, an - 1, an - 2] }
}

export default function Livres() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const p = usePeriode()
  const [vue, setVue] = useState('balance')
  const soldes = useQuery(async () => must(await supabase.rpc('soldes_comptables', { p_debut: p.debut, p_fin: p.fin })), [p.debut, p.fin])

  return (
    <div className="stack">
      <Panel icon="chart" tone="sky" title={t('livres.title')} subtitle={t('livres.hint')}>
        <div className="row wrap">
          <label className="field compact-field"><span>{t('livres.year')}</span>
            <select value={p.annee} onChange={(e) => p.setAnnee(Number(e.target.value))}>{p.annees.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </label>
          <label className="field compact-field"><span>{t('livres.month')}</span>
            <select value={p.mois} onChange={(e) => p.setMois(e.target.value)}>
              <option value="">{t('livres.wholeYear')}</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>{new Date(2026, Number(m) - 1, 1).toLocaleDateString(lang, { month: 'long' })}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="segmented small wrap">
          {VUES.map((v) => <button key={v} type="button" className={vue === v ? 'active' : ''} onClick={() => setVue(v)}>{t(`livres.views.${v}`)}</button>)}
        </div>
      </Panel>
      {vue === 'journal' && <Journal p={p} />}
      {vue === 'grandlivre' && <GrandLivre p={p} soldes={soldes} />}
      {vue === 'balance' && <Balance p={p} soldes={soldes} />}
      {vue === 'resultat' && <Resultat p={p} soldes={soldes} />}
      {vue === 'bilan' && <Bilan p={p} soldes={soldes} />}
      {vue === 'plan' && <Plan onChange={soldes.reload} />}
    </div>
  )
}

function Journal({ p }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [code, setCode] = useState('')
  const q = useQuery(async () => {
    let r = supabase.from('journal_comptable').select('date_ecriture, journal, piece, libelle, compte, intitule, debit, credit')
      .gte('date_ecriture', p.debut).lte('date_ecriture', p.fin).order('date_ecriture').order('piece').order('debit', { ascending: false }).limit(LIMITE)
    if (code) r = r.eq('journal', code)
    return must(await r)
  }, [p.debut, p.fin, code])
  const exporter = () => exportExcel(`journal-${p.debut}`, [
    { label: t('saisie.date'), value: (l) => l.date_ecriture }, { label: t('livres.journal'), value: (l) => l.journal },
    { label: t('livres.piece'), value: (l) => l.piece }, { label: t('livres.account'), value: (l) => l.compte },
    { label: t('livres.label'), value: (l) => l.intitule }, { label: t('export.label'), value: (l) => l.libelle },
    { label: t('livres.debit'), value: (l) => Number(l.debit) }, { label: t('livres.credit'), value: (l) => Number(l.credit) }
  ], q.data ?? [])
  if (!q.data) return <Loading error={q.error} />
  const td = q.data.reduce((s, l) => s + Number(l.debit), 0)
  const tc = q.data.reduce((s, l) => s + Number(l.credit), 0)
  return (
    <Panel icon="note" tone="green" title={t('livres.views.journal')}
      actions={<div className="row">
        <select className="inline-select" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('livres.journal')}>
          <option value="">{t('livres.allJournals')}</option>
          {['VT', 'BO', 'AC', 'PA', 'CA', 'BQ', 'MM', 'OD'].map((c) => <option key={c} value={c}>{c} – {t(`livres.journals.${c}`)}</option>)}
        </select>
        {q.data.length > 0 && <button className="btn ghost sm" onClick={exporter}><Icon name="download" size={14} />{t('export.button')}</button>}
      </div>}>
      {q.data.length === 0 ? <Empty icon="note" text={t('livres.empty')} /> : (
        <div className="table-wrap">
          <table className="table small">
            <thead><tr><th>{t('saisie.date')}</th><th>{t('livres.journal')}</th><th>{t('livres.account')}</th><th>{t('export.label')}</th><th className="num">{t('livres.debit')}</th><th className="num">{t('livres.credit')}</th></tr></thead>
            <tbody>
              {q.data.map((l, i) => (
                <tr key={i}>
                  <td>{day(l.date_ecriture, lang)}</td><td>{l.journal}</td>
                  <td><strong>{l.compte}</strong> <span className="muted">{l.intitule}</span></td>
                  <td>{l.libelle}</td>
                  <td className="num">{Number(l.debit) ? nombre(l.debit) : ''}</td><td className="num">{Number(l.credit) ? nombre(l.credit) : ''}</td>
                </tr>
              ))}
              <tr><td colSpan={4}><strong>{t('livres.total')}</strong></td><td className="num"><strong>{nombre(td)}</strong></td><td className="num"><strong>{nombre(tc)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
      {q.data.length >= LIMITE && <p className="muted small">{t('livres.truncated', { n: LIMITE })}</p>}
    </Panel>
  )
}

function GrandLivre({ p, soldes }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [compte, setCompte] = useState('')
  const lignes = useQuery(async () => {
    if (!compte) return null
    return must(await supabase.from('journal_comptable').select('date_ecriture, journal, piece, libelle, debit, credit')
      .eq('compte', compte).gte('date_ecriture', p.debut).lte('date_ecriture', p.fin).order('date_ecriture').order('piece').limit(LIMITE))
  }, [compte, p.debut, p.fin])
  if (!soldes.data) return <Loading error={soldes.error} />
  const s = soldes.data.find((x) => x.compte === compte)
  const ouverture = s ? (Number(s.debit_cumule) - Number(s.credit_cumule)) - (Number(s.debit_periode) - Number(s.credit_periode)) : 0
  let cumul = ouverture
  return (
    <Panel icon="note" tone="green" title={t('livres.views.grandlivre')}
      actions={<select className="inline-select" value={compte} onChange={(e) => setCompte(e.target.value)} aria-label={t('livres.account')}>
        <option value="">{t('livres.pickAccount')}</option>
        {soldes.data.map((x) => <option key={x.compte} value={x.compte}>{x.compte} – {x.intitule}</option>)}
      </select>}>
      {!compte ? <p className="muted">{t('livres.pickAccountHint')}</p> : !lignes.data ? <Loading error={lignes.error} /> : (
        <div className="table-wrap">
          <table className="table small">
            <thead><tr><th>{t('saisie.date')}</th><th>{t('livres.journal')}</th><th>{t('export.label')}</th><th className="num">{t('livres.debit')}</th><th className="num">{t('livres.credit')}</th><th className="num">{t('livres.balanceCol')}</th></tr></thead>
            <tbody>
              <tr><td colSpan={5} className="muted">{t('livres.opening')}</td><td className="num">{nombre(ouverture)}</td></tr>
              {lignes.data.map((l, i) => {
                cumul += Number(l.debit) - Number(l.credit)
                return (
                  <tr key={i}>
                    <td>{day(l.date_ecriture, lang)}</td><td>{l.journal}</td><td>{l.libelle}</td>
                    <td className="num">{Number(l.debit) ? nombre(l.debit) : ''}</td><td className="num">{Number(l.credit) ? nombre(l.credit) : ''}</td>
                    <td className="num">{nombre(cumul)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Balance({ p, soldes }) {
  const { t } = useTranslation()
  if (!soldes.data) return <Loading error={soldes.error} />
  const rows = soldes.data.map((s) => {
    const d = Number(s.debit_cumule)
    const c = Number(s.credit_cumule)
    return { ...s, d, c, sd: d > c ? d - c : 0, sc: c > d ? c - d : 0 }
  })
  const tot = rows.reduce((a, r) => ({ d: a.d + r.d, c: a.c + r.c, sd: a.sd + r.sd, sc: a.sc + r.sc }), { d: 0, c: 0, sd: 0, sc: 0 })
  const exporter = () => exportExcel(`balance-${p.fin}`, [
    { label: t('livres.account'), value: (r) => r.compte }, { label: t('livres.label'), value: (r) => r.intitule },
    { label: t('livres.debit'), value: (r) => r.d }, { label: t('livres.credit'), value: (r) => r.c },
    { label: t('livres.debitBalance'), value: (r) => r.sd }, { label: t('livres.creditBalance'), value: (r) => r.sc }
  ], rows)
  return (
    <Panel icon="chart" tone="green" title={t('livres.views.balance')} subtitle={t('livres.balanceHint', { d: p.fin })}
      actions={rows.length > 0 && <button className="btn ghost sm" onClick={exporter}><Icon name="download" size={14} />{t('export.button')}</button>}>
      {rows.length === 0 ? <Empty icon="chart" text={t('livres.empty')} /> : (
        <div className="table-wrap">
          <table className="table small">
            <thead><tr><th>{t('livres.account')}</th><th>{t('livres.label')}</th><th className="num">{t('livres.debit')}</th><th className="num">{t('livres.credit')}</th><th className="num">{t('livres.debitBalance')}</th><th className="num">{t('livres.creditBalance')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.compte}><td><strong>{r.compte}</strong></td><td>{r.intitule}</td><td className="num">{nombre(r.d)}</td><td className="num">{nombre(r.c)}</td>
                  <td className="num">{r.sd ? nombre(r.sd) : ''}</td><td className="num">{r.sc ? nombre(r.sc) : ''}</td></tr>
              ))}
              <tr><td colSpan={2}><strong>{t('livres.total')}</strong></td><td className="num"><strong>{nombre(tot.d)}</strong></td><td className="num"><strong>{nombre(tot.c)}</strong></td>
                <td className="num"><strong>{nombre(tot.sd)}</strong></td><td className="num"><strong>{nombre(tot.sc)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && tot.d !== tot.c && <div className="alert danger"><Icon name="alert" size={16} />{t('livres.unbalanced')}</div>}
    </Panel>
  )
}

function Resultat({ p, soldes }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  if (!soldes.data) return <Loading error={soldes.error} />
  const produits = soldes.data.filter((s) => classe(s.compte) === 7).map((s) => ({ ...s, m: Number(s.credit_periode) - Number(s.debit_periode) }))
  const charges = soldes.data.filter((s) => classe(s.compte) === 6).map((s) => ({ ...s, m: Number(s.debit_periode) - Number(s.credit_periode) }))
  const tp = produits.reduce((a, s) => a + s.m, 0)
  const tch = charges.reduce((a, s) => a + s.m, 0)
  const bloc = (titre, lignes, total) => (
    <>
      <tr><th colSpan={2}>{titre}</th></tr>
      {lignes.map((s) => <tr key={s.compte}><td>{s.compte} – {s.intitule}</td><td className="num">{money(s.m, lang)}</td></tr>)}
      <tr><td><strong>{t('livres.total')}</strong></td><td className="num"><strong>{money(total, lang)}</strong></td></tr>
    </>
  )
  return (
    <Panel icon="chart" tone="yolk" title={t('livres.views.resultat')} subtitle={t('livres.period', { a: day(p.debut, lang), b: day(p.fin, lang) })}>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {bloc(t('livres.income'), produits, tp)}
            {bloc(t('livres.expenses'), charges, tch)}
            <tr className="strong"><td><strong>{tp - tch >= 0 ? t('livres.profit') : t('livres.loss')}</strong></td><td className="num"><strong>{money(tp - tch, lang)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('livres.resultHint')}</p>
    </Panel>
  )
}

function Bilan({ p, soldes }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const data = useMemo(() => {
    if (!soldes.data) return null
    const s = soldes.data.map((x) => ({ ...x, solde: Number(x.debit_cumule) - Number(x.credit_cumule) }))
    const actif = s.filter((x) => [2, 3, 4, 5].includes(classe(x.compte)) && x.solde > 0)
    const passif = s.filter((x) => [1, 4, 5].includes(classe(x.compte)) && x.solde < 0).map((x) => ({ ...x, solde: -x.solde }))
    const resultat = s.filter((x) => [6, 7].includes(classe(x.compte))).reduce((a, x) => a - x.solde, 0)
    return { actif, passif, resultat }
  }, [soldes.data])
  if (!data) return <Loading error={soldes.error} />
  const ta = data.actif.reduce((a, x) => a + x.solde, 0)
  const tpas = data.passif.reduce((a, x) => a + x.solde, 0) + data.resultat
  const colonne = (titre, lignes, extra, total) => (
    <table className="table small">
      <thead><tr><th colSpan={2}>{titre}</th></tr></thead>
      <tbody>
        {lignes.map((x) => <tr key={x.compte}><td>{x.compte} – {x.intitule}</td><td className="num">{nombre(x.solde)}</td></tr>)}
        {extra}
        <tr><td><strong>{t('livres.total')}</strong></td><td className="num"><strong>{nombre(total)}</strong></td></tr>
      </tbody>
    </table>
  )
  return (
    <Panel icon="chart" tone="green" title={t('livres.views.bilan')} subtitle={t('livres.balanceSheetAt', { d: day(p.fin, lang) })}>
      <div className="grid-2">
        {colonne(t('livres.assets'), data.actif, null, ta)}
        {colonne(t('livres.liabilities'), data.passif, <tr><td>{t('livres.cumulativeResult')}</td><td className="num">{nombre(data.resultat)}</td></tr>, tpas)}
      </div>
      <p className="muted small">{t('livres.balanceSheetHint')}</p>
    </Panel>
  )
}

function Plan({ onChange }) {
  const { t } = useTranslation()
  const { role } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => must(await supabase.from('plan_comptable').select('cle, numero, intitule').order('numero')))
  const modifier = async (c) => {
    const v = await ask.form({ title: `${c.numero} – ${c.intitule}`, icon: 'note', submit: t('dialog.save'), message: t('livres.planEditHint'), fields: [
      { name: 'numero', label: t('livres.account'), value: c.numero, required: true },
      { name: 'intitule', label: t('livres.label'), value: c.intitule, required: true }
    ] })
    if (v) await run(supabase.rpc('maj_compte', { p_cle: c.cle, p_numero: v.numero, p_intitule: v.intitule }), () => { q.reload(); onChange?.() })
  }
  if (!q.data) return <Loading error={q.error} />
  return (
    <Panel icon="note" tone="sky" title={t('livres.views.plan')} subtitle={t('livres.planHint')}>
      <ul className="list">
        {q.data.map((c) => (
          <li key={c.cle}>
            <div className="grow"><strong>{c.numero}</strong> · {c.intitule}<div className="muted small">{t(`livres.usages.${c.cle}`, { defaultValue: c.cle })}</div></div>
            {can(role, 'compta.livres') && <button className="btn ghost sm" onClick={() => modifier(c)}>{t('common.edit')}</button>}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
