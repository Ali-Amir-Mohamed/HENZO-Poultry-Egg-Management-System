import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import Icon, { Logo } from '../components/Icon'
import { day, Empty, Loading, money, Panel, Tabs } from '../components/ui'

// Analyses: flock comparison, forecast for running flocks, monthly report (printable to PDF)
export default function Analyses() {
  const [tab, setTab] = useState('comparaison')
  return (
    <div className="stack">
      <div className="no-print">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'comparaison', label: 'analyses.tabs.comparaison', icon: 'chart' },
          { id: 'previsionnel', label: 'analyses.tabs.previsionnel', icon: 'clock' },
          { id: 'rapport', label: 'analyses.tabs.rapport', icon: 'note' }
        ]} />
      </div>
      {tab === 'comparaison' && <Comparaison />}
      {tab === 'previsionnel' && <Previsionnel />}
      {tab === 'rapport' && <Rapport />}
    </div>
  )
}

// ---------- Comparison of flocks (closed: frozen report ; running: live) ----------
const METRICS = [
  { key: 'taux_mortalite', unit: '%', digits: 1, better: 'low' },
  { key: 'fcr', digits: 2, better: 'low' },
  { key: 'gmq_g_jour', unit: 'g/j', digits: 1, better: 'high' },
  { key: 'poids_moyen_g', unit: 'g', better: 'high' },
  { key: 'cout_par_poulet_vendu', money: true, better: 'low' },
  { key: 'cout_par_kg', money: true, better: 'low' },
  { key: 'prix_moyen_poulet', money: true, better: 'high' },
  { key: 'marge_brute', money: true, better: 'high' },
  { key: 'duree_jours', unit: 'j' }
]

function Comparaison() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [metric, setMetric] = useState('marge_brute')
  const q = useQuery(async () => {
    const [closed, open] = await Promise.all([
      supabase.from('bilans_bandes').select('*').order('date_arrivee'),
      supabase.from('indicateurs_bandes').select('*').neq('statut', 'cloturee').order('date_arrivee')
    ])
    return [...must(closed).map((b) => ({ ...b, closed: true })), ...must(open).map((b) => ({ ...b, closed: false }))]
  })
  if (!q.data) return <Loading error={q.error} />
  if (!q.data.length) return <Empty icon="chart" text={t('analyses.noFlock')} />

  const fmt = (m, v) => v == null ? '—'
    : m.money ? money(v, lang)
      : `${Number(v).toLocaleString(lang, { maximumFractionDigits: m.digits ?? 0 })}${m.unit ? ` ${m.unit}` : ''}`
  const best = (m) => {
    if (!m.better) return null
    const vals = q.data.filter((b) => b.closed && b[m.key] != null).map((b) => Number(b[m.key]))
    if (!vals.length) return null
    return m.better === 'low' ? Math.min(...vals) : Math.max(...vals)
  }
  const sel = METRICS.find((m) => m.key === metric)
  const values = q.data.map((b) => Number(b[metric] ?? 0))
  const maxAbs = Math.max(1, ...values.map(Math.abs))

  return (
    <>
      <Panel icon="chart" tone="green" title={t('analyses.chartTitle')}
        actions={(
          <select className="inline-select" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map((m) => <option key={m.key} value={m.key}>{t(`analyses.metrics.${m.key}`)}</option>)}
          </select>
        )}>
        <div className="hbars">
          {q.data.map((b) => {
            const v = Number(b[metric] ?? 0)
            return (
              <div key={b.bande_id} className="hbar">
                <Link to={`/ferme/bande/${b.bande_id}`} className="hbar-label">{b.code}{!b.closed && <small> · {t('analyses.running')}</small>}</Link>
                <div className="hbar-track"><div className={`hbar-fill ${v < 0 ? 'neg' : ''} ${b.closed ? '' : 'open'}`} style={{ width: `${(Math.abs(v) / maxAbs) * 100}%` }} /></div>
                <span className="hbar-val">{fmt(sel, b[metric])}</span>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title={t('analyses.tableTitle')} subtitle={t('analyses.bestHint')}>
        <div className="table-wrap">
          <table className="table compare">
            <thead>
              <tr>
                <th>{t('saisie.bande')}</th>
                {METRICS.map((m) => <th key={m.key}>{t(`analyses.metrics.${m.key}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {q.data.map((b) => (
                <tr key={b.bande_id} className={b.closed ? '' : 'open-row'}>
                  <td><Link to={`/ferme/bande/${b.bande_id}`}><strong>{b.code}</strong></Link>{!b.closed && <span className="tag warn">{t('analyses.running')}</span>}</td>
                  {METRICS.map((m) => {
                    const isBest = b.closed && b[m.key] != null && Number(b[m.key]) === best(m)
                    return <td key={m.key} className={isBest ? 'best' : ''}>{fmt(m, b[m.key])}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

// ---------- Forecast for running flocks (never mixed with real results) ----------
function Previsionnel() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const q = useQuery(async () => {
    const [ind, prix] = await Promise.all([
      supabase.from('indicateurs_bandes').select('*').neq('statut', 'cloturee').order('date_arrivee'),
      supabase.from('prix_actuels').select('*').eq('produit', 'poulets').eq('unite', 'piece').maybeSingle()
    ])
    return { bandes: must(ind), prix: must(prix)?.prix ?? '' }
  })
  const [inputs, setInputs] = useState({})
  if (!q.data) return <Loading error={q.error} />
  if (!q.data.bandes.length) return <Empty icon="drumstick" text={t('analyses.noRunning')} />

  const get = (id, k, def) => inputs[id]?.[k] ?? def
  const set = (id, k) => (e) => setInputs({ ...inputs, [id]: { ...inputs[id], [k]: e.target.value } })

  return (
    <>
      <div className="alert warn"><Icon name="alert" size={18} />{t('analyses.forecastWarning')}</div>
      {q.data.bandes.map((b) => {
        const prix = Number(get(b.bande_id, 'prix', q.data.prix)) || 0
        const autres = Number(get(b.bande_id, 'autres', 0)) || 0
        const potentiel = Number(b.chiffre_affaires) + b.restants * prix
        const coutPrevu = Number(b.cout_total) + autres
        const benef = potentiel - coutPrevu
        return (
          <Panel key={b.bande_id} icon="drumstick" tone="sky" title={b.code}
            subtitle={t('analyses.forecastSub', { age: b.age_jours, n: b.restants })}
            actions={<Link to={`/ferme/bande/${b.bande_id}`} className="btn ghost sm">{t('fiche.open')}</Link>}>
            <div className="grid-2">
              <label className="field"><span>{t('analyses.estPrice')}</span>
                <input type="number" min="0" value={get(b.bande_id, 'prix', q.data.prix)} onChange={set(b.bande_id, 'prix')} />
              </label>
              <label className="field"><span>{t('analyses.extraCosts')}</span>
                <input type="number" min="0" value={get(b.bande_id, 'autres', '')} onChange={set(b.bande_id, 'autres')} placeholder="0" />
              </label>
            </div>
            <table className="table money-table">
              <tbody>
                <tr><td>{t('analyses.realSales')}</td><td>{money(b.chiffre_affaires, lang)}</td></tr>
                <tr><td>{t('analyses.toSell', { n: b.restants, p: money(prix, lang) })}</td><td>{money(b.restants * prix, lang)}</td></tr>
                <tr className="sum"><td>{t('analyses.potentialRevenue')}</td><td>{money(potentiel, lang)}</td></tr>
                <tr><td>{t('analyses.currentCosts')}</td><td>{money(b.cout_total, lang)}</td></tr>
                {autres > 0 && <tr><td>{t('analyses.extraCosts')}</td><td>{money(autres, lang)}</td></tr>}
                <tr className={`sum ${benef < 0 ? 'bad' : 'good'}`}><td>{t('analyses.potentialProfit')}</td><td>{money(benef, lang)}</td></tr>
              </tbody>
            </table>
          </Panel>
        )
      })}
    </>
  )
}

// ---------- Monthly report ----------
function Rapport() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [mois, setMois] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7))
  const q = useQuery(async () => {
    const { data, error } = await supabase.rpc('rapport_mensuel', { p_mois: `${mois}-01` })
    if (error) throw error
    return data
  }, [mois])
  const n = (v, d = 0) => Number(v ?? 0).toLocaleString(lang, { maximumFractionDigits: d })
  const r = q.data
  const titreMois = new Date(`${mois}-01T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })

  return (
    <>
      <div className="row no-print">
        <label className="field"><span>{t('analyses.month')}</span>
          <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} />
        </label>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()} disabled={!r}><Icon name="download" size={16} />{t('capital.print')}</button>
      </div>

      {!r ? <Loading error={q.error} /> : (
        <div className="stack report">
          <section className="panel">
            <div className="releve-head">
              <Logo size={48} />
              <div>
                <h1>{t('analyses.reportTitle', { mois: titreMois })}</h1>
                <p className="muted">{r.ferme} · {day(r.periode.debut, lang)} – {day(r.periode.fin, lang)}</p>
              </div>
            </div>
          </section>

          <ReportSection title={t('analyses.r.production')}>
            <div className="facts">
              <F l={t('analyses.r.eggs')} v={n(r.production.oeufs_collectes)} />
              <F l={t('analyses.r.broken')} v={n(r.production.oeufs_casses)} />
              <F l={t('analyses.r.trays')} v={n(r.production.plateaux_vendus, 2)} />
              <F l={t('analyses.r.birdsSold')} v={n(r.production.poulets_vendus)} />
              <F l={t('analyses.r.kgSold')} v={n(r.production.kg_vendus, 2)} />
              <F l={t('analyses.r.feed')} v={`${n(r.production.aliment_consomme_kg)} kg`} />
              <F l={t('analyses.r.deadChair')} v={n(r.mortalite.chair)} />
              <F l={t('analyses.r.deadLayers')} v={n(r.mortalite.pondeuse)} />
            </div>
          </ReportSection>

          <ReportSection title={t('analyses.r.result')}>
            <table className="table money-table">
              <thead><tr><th /><th>{t('types.chair_pl')}</th><th>{t('types.pondeuse_pl')}</th><th>{t('analyses.r.total')}</th></tr></thead>
              <tbody>
                {['ventes', 'depenses'].map((k) => (
                  <tr key={k}><td>{t(`analyses.r.${k}`)}</td>{r.resultat.map((x) => <td key={x.activite}>{money(x[k], lang)}</td>)}<td>{money(r.resultat.reduce((s, x) => s + Number(x[k]), 0), lang)}</td></tr>
                ))}
                <tr className="sum">
                  <td>{t('analyses.r.balance')}</td>
                  {r.resultat.map((x) => <td key={x.activite}>{money(x.ventes - x.depenses, lang)}</td>)}
                  <td>{money(r.resultat.reduce((s, x) => s + x.ventes - x.depenses, 0), lang)}</td>
                </tr>
                <tr><td>{t('fiche.withdrawals')}</td>{r.resultat.map((x) => <td key={x.activite}>{money(x.retraits, lang)}</td>)}<td>{money(r.resultat.reduce((s, x) => s + Number(x.retraits), 0), lang)}</td></tr>
              </tbody>
            </table>
            <p className="muted small">{t('analyses.r.resultNote')}</p>
          </ReportSection>

          <ReportSection title={t('analyses.r.sales')}>
            {r.ventes.length === 0 ? <p className="muted">{t('argent.noSales')}</p> : (
              <table className="table">
                <thead><tr><th>{t('analyses.r.activity')}</th><th>{t('saisie.produit')}</th><th>{t('argent.quantity')}</th><th>{t('argent.amount')}</th></tr></thead>
                <tbody>{r.ventes.map((v, i) => (
                  <tr key={i}><td>{t(`types.${v.activite}_pl`)}</td><td>{t(`produits.${v.produit}`)}</td><td>{n(v.quantite, 2)} {t(`unites.${v.unite}`)}</td><td>{money(v.montant, lang)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </ReportSection>

          <ReportSection title={t('analyses.r.expenses')}>
            {r.depenses.length === 0 ? <p className="muted">{t('argent.noExpenses')}</p> : (
              <table className="table">
                <thead><tr><th>{t('analyses.r.activity')}</th><th>{t('argent.category')}</th><th>{t('analyses.r.count')}</th><th>{t('argent.amount')}</th></tr></thead>
                <tbody>{r.depenses.map((d, i) => (
                  <tr key={i}><td>{t(`types.${d.activite}_pl`)}</td><td>{t(`categories.${d.categorie}`)}</td><td>{d.nombre}</td><td>{money(d.montant, lang)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </ReportSection>

          <ReportSection title={t('analyses.r.cash')}>
            <table className="table money-table">
              <thead><tr><th>{t('argent.caisseLabel')}</th><th>{t('analyses.r.in')}</th><th>{t('analyses.r.out')}</th><th>{t('analyses.r.endBalance')}</th></tr></thead>
              <tbody>{r.tresorerie.map((c, i) => (
                <tr key={i}><td>{t(`types.${c.activite}_pl`)} · {t(`modes.${c.mode}`)}</td><td>{money(c.entrees, lang)}</td><td>{money(c.sorties, lang)}</td><td>{money(c.solde_fin, lang)}</td></tr>
              ))}</tbody>
            </table>
          </ReportSection>

          <ReportSection title={t('analyses.r.stocks')}>
            {r.stocks.length === 0 ? <p className="muted">{t('stock.empty')}</p> : (
              <table className="table">
                <thead><tr><th>{t('stock.name')}</th><th>{t('analyses.r.used')}</th><th>{t('analyses.r.endStock')}</th></tr></thead>
                <tbody>{r.stocks.map((s, i) => (
                  <tr key={i}><td>{s.nom}</td><td>{n(s.consomme, 2)} {t(`unites.${s.unite}`)}</td><td className={(Number(s.seuil_minimum) > 0 && Number(s.stock_fin) <= Number(s.seuil_minimum)) || Number(s.stock_fin) < 0 ? 'error' : ''}>{n(s.stock_fin, 2)} {t(`unites.${s.unite}`)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </ReportSection>

          <ReportSection title={t('analyses.r.debts')}>
            <div className="facts">
              <F l={t('analyses.r.receivables')} v={money(r.creances.total, lang)} />
              <F l={t('analyses.r.receivablesLate')} v={money(r.creances.en_retard, lang)} />
              <F l={t('analyses.r.payables')} v={money(r.dettes.total, lang)} />
              <F l={t('analyses.r.payablesLate')} v={money(r.dettes.en_retard, lang)} />
            </div>
          </ReportSection>

          {(r.investisseurs.length > 0 || r.prets.length > 0) && (
            <ReportSection title={t('analyses.r.capital')}>
              {r.investisseurs.length > 0 && (
                <table className="table money-table">
                  <thead><tr><th>{t('capital.investor')}</th><th>{t('capital.remaining')}</th><th>{t('analyses.r.tenMonth')}</th></tr></thead>
                  <tbody>{r.investisseurs.map((x, i) => <tr key={i}><td>{x.nom}</td><td>{money(x.capital_restant, lang)}</td><td>{money(x.dix_pourcent_mois, lang)}</td></tr>)}</tbody>
                </table>
              )}
              {r.prets.length > 0 && (
                <table className="table money-table">
                  <thead><tr><th>{t('prets.lender')}</th><th>{t('analyses.r.repaidMonth')}</th><th>{t('prets.balance')}</th></tr></thead>
                  <tbody>{r.prets.map((x, i) => <tr key={i}><td>{x.preteur}{x.en_retard ? ` (${t('argent.late')})` : ''}</td><td>{money(x.rembourse_mois, lang)}</td><td>{money(x.solde, lang)}</td></tr>)}</tbody>
                </table>
              )}
            </ReportSection>
          )}

          <ReportSection title={t('analyses.r.flocks')}>
            {r.bandes_cloturees.length > 0 && (
              <>
                <h3>{t('analyses.r.closed')}</h3>
                <table className="table">
                  <thead><tr><th>{t('saisie.bande')}</th><th>{t('analyses.metrics.taux_mortalite')}</th><th>FCR</th><th>{t('dashboard.weight')}</th><th>{t('fiche.costTotal')}</th><th>{t('fiche.turnover')}</th><th>{t('fiche.margin')}</th></tr></thead>
                  <tbody>{r.bandes_cloturees.map((b, i) => (
                    <tr key={i}><td>{b.code}</td><td>{n(b.taux_mortalite, 1)} %</td><td>{b.fcr ?? '—'}</td><td>{b.poids_moyen_g ? `${n(b.poids_moyen_g)} g` : '—'}</td><td>{money(b.cout_total, lang)}</td><td>{money(b.chiffre_affaires, lang)}</td><td>{money(b.marge_brute, lang)}</td></tr>
                  ))}</tbody>
                </table>
              </>
            )}
            {r.bandes_en_cours.length > 0 && (
              <>
                <h3>{t('analyses.r.running')}</h3>
                <table className="table">
                  <thead><tr><th>{t('saisie.bande')}</th><th>{t('dashboard.age')}</th><th>{t('ferme.remaining')}</th><th>{t('analyses.metrics.taux_mortalite')}</th><th>{t('dashboard.weight')}</th><th>FCR</th><th>{t('fiche.costTotal')}</th></tr></thead>
                  <tbody>{r.bandes_en_cours.map((b, i) => (
                    <tr key={i}><td>{b.code}</td><td>{t('dashboard.days', { n: b.age_jours })}</td><td>{n(b.restants)}</td><td>{n(b.taux_mortalite, 1)} %</td><td>{b.poids_moyen_g ? `${n(b.poids_moyen_g)} g` : '—'}</td><td>{b.fcr ?? '—'}</td><td>{money(b.cout_total, lang)}</td></tr>
                  ))}</tbody>
                </table>
              </>
            )}
            {r.lots.length > 0 && (
              <>
                <h3>{t('types.pondeuse_pl')}</h3>
                <table className="table">
                  <thead><tr><th>{t('saisie.lot')}</th><th>{t('dashboard.birds')}</th><th>{t('fiche.layingRate7')}</th><th>{t('fiche.breakRate')}</th><th>{t('fiche.turnover')}</th><th>{t('fiche.margin')}</th></tr></thead>
                  <tbody>{r.lots.map((l, i) => (
                    <tr key={i}><td>{l.code}</td><td>{n(l.effectif)}</td><td>{l.taux_ponte_7j ? `${n(l.taux_ponte_7j, 1)} %` : '—'}</td><td>{l.taux_casse ? `${n(l.taux_casse, 1)} %` : '—'}</td><td>{money(l.chiffre_affaires, lang)}</td><td>{money(l.marge_brute, lang)}</td></tr>
                  ))}</tbody>
                </table>
              </>
            )}
            {!r.bandes_cloturees.length && !r.bandes_en_cours.length && !r.lots.length && <p className="muted">{t('analyses.noFlock')}</p>}
          </ReportSection>
          <p className="muted small">{t('analyses.r.generated', { d: new Date().toLocaleString(lang) })}</p>
        </div>
      )}
    </>
  )
}

function ReportSection({ title, children }) {
  return <section className="panel report-section"><h2>{title}</h2>{children}</section>
}
function F({ l, v }) {
  return <div className="fact"><span>{l}</span><strong>{v}</strong></div>
}
