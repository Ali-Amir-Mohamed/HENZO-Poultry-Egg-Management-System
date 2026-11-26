import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import { can } from '../config'
import { useAuth } from '../auth/AuthProvider'
import { localDate } from '../lib/stats'
import { exportExcel } from '../lib/export'
import Icon from '../components/Icon'
import { day, Loading, money, Panel, Tabs } from '../components/ui'
import Equipe from './ferme/Equipe'
import EmployesBureau from './argent/EmployesBureau'
import { HeuresSup, Presences } from './ferme/Presences'
import { Conges, Evaluations } from './ferme/PersonnelRH'
import Salaires from './argent/Salaires'
import { ChargesAReverser } from './argent/Paie'

// « Personnel »: the whole HR module in one place (0067–0070). Ali sees and decides everything, Dahirou manages
// the files and the pay, Kenfack notes attendance, overtime and evaluations, and sees the rest read only (a partner).
const ONGLETS = ['tableau', 'equipe', 'presences', 'heures', 'conges', 'paie', 'evaluations', 'rapports']
const ICONES = { tableau: 'home', equipe: 'users', presences: 'check', heures: 'clock', conges: 'calendar', paie: 'wallet', evaluations: 'chart', rapports: 'note' }

export default function Personnel() {
  const [params, setParams] = useSearchParams()
  const tab = ONGLETS.includes(params.get('tab')) ? params.get('tab') : 'tableau'
  const choisir = (k) => setParams(k === 'tableau' ? {} : { tab: k }, { replace: true })
  const q = useQuery(async () => must(await supabase.from('employes').select('id, nom, poste, actif, categorie').eq('actif', true).order('nom')))
  const actifs = q.data ?? []

  return (
    <div className="stack">
      <Tabs value={tab} onChange={choisir} tabs={ONGLETS.map((k) => ({ id: k, label: `personnel.tabs.${k}`, icon: ICONES[k] }))} />
      {tab === 'tableau' && <TableauRH onOpen={choisir} />}
      {tab === 'equipe' && <><Equipe /><EmployesBureau /></>}
      {tab === 'presences' && <Presences />}
      {tab === 'heures' && <HeuresSup />}
      {tab === 'conges' && (q.data ? <Conges employes={actifs} /> : <Loading error={q.error} />)}
      {tab === 'paie' && <Salaires />}
      {tab === 'evaluations' && (q.data ? <Evaluations employes={actifs.filter((e) => e.categorie === 'ferme')} /> : <Loading error={q.error} />)}
      {tab === 'rapports' && <RapportsRH />}
    </div>
  )
}

// ---------- HR dashboard: who is here, what waits for a decision, what ends soon ----------
function TableauRH({ onOpen }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const auj = localDate()
  const mois = `${auj.slice(0, 7)}-01`
  const q = useQuery(async () => {
    const dans60 = new Date(); dans60.setDate(dans60.getDate() + 60)
    const [emp, pres, hs, conges, preps, paies] = await Promise.all([
      supabase.from('employes').select('id, nom, poste, categorie, salaire_mensuel, type_contrat, date_fin_contrat, fin_periode_essai').eq('actif', true),
      supabase.from('presences').select('statut').eq('date_jour', auj),
      supabase.from('heures_sup').select('id').eq('statut', 'demandee'),
      supabase.from('conges').select('id, employe_id, date_debut, date_fin, statut, type_conge').or(`statut.eq.demandee,and(statut.eq.accordee,date_debut.lte.${auj},date_fin.gte.${auj})`),
      supabase.from('preparations_paie').select('statut, net').eq('mois', mois),
      supabase.from('paies').select('net').eq('mois', mois).eq('annulee', false)
    ])
    const employes = must(emp)
    const fin = (e) => [e.fin_periode_essai, e.date_fin_contrat].filter((d) => d && d >= auj && d <= dans60.toLocaleDateString('en-CA')).sort()[0]
    return {
      employes, presences: must(pres), hs: must(hs).length, conges: must(conges), preps: must(preps), paies: must(paies),
      finissants: employes.filter(fin).map((e) => ({ ...e, fin: fin(e), essai: fin(e) === e.fin_periode_essai })).sort((a, b) => a.fin.localeCompare(b.fin))
    }
  })
  if (!q.data) return <Loading error={q.error} />
  const d = q.data
  const masse = d.employes.reduce((s, e) => s + Number(e.salaire_mensuel), 0)
  const presents = d.presences.filter((p) => ['present', 'retard'].includes(p.statut)).length
  const enConge = d.conges.filter((c) => c.statut === 'accordee').length
  const congesAttente = d.conges.filter((c) => c.statut === 'demandee').length
  const aValider = d.preps.filter((p) => p.statut === 'preparee').length
  const aPayer = d.preps.filter((p) => p.statut === 'validee').length
  const paye = d.paies.reduce((s, p) => s + Number(p.net), 0)
  const nom = (id) => d.employes.find((e) => e.id === id)?.nom ?? '—'
  const attentes = [
    d.hs > 0 && { k: 'heures', txt: t('personnel.waitOt', { count: d.hs }), qui: can(role, 'rh.autoriser') },
    congesAttente > 0 && { k: 'conges', txt: t('personnel.waitLeave', { count: congesAttente }), qui: can(role, 'rh.conges.decider') },
    aValider > 0 && { k: 'paie', txt: t('personnel.waitValidate', { count: aValider }), qui: can(role, 'salaires.valider') },
    aPayer > 0 && { k: 'paie', txt: t('personnel.waitPay', { count: aPayer }), qui: can(role, 'salaires.payer') }
  ].filter(Boolean)

  return (
    <>
      <section className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-icon"><Icon name="users" size={16} /></span><strong>{d.employes.length}</strong>
          <span className="dash-kpi-label">{t('personnel.staff')}</span>
          <span className="dash-tag">{t('personnel.staffSplit', { f: d.employes.filter((e) => e.categorie === 'ferme').length, b: d.employes.filter((e) => e.categorie === 'bureau').length })}</span></div>
        <div className="dash-kpi gold"><span className="dash-kpi-icon"><Icon name="wallet" size={16} /></span><strong>{money(masse, lang)}</strong>
          <span className="dash-kpi-label">{t('personnel.payroll')}</span>
          <span className="dash-tag">{t('personnel.paidThisMonth', { n: money(paye, lang) })}</span></div>
        <div className="dash-kpi"><span className="dash-kpi-icon"><Icon name="check" size={16} /></span><strong>{presents} / {d.employes.filter((e) => e.categorie === 'ferme').length}</strong>
          <span className="dash-kpi-label">{t('personnel.presentToday')}</span>
          <span className="dash-tag">{d.presences.length ? t('personnel.onLeave', { count: enConge }) : t('personnel.notNoted')}</span></div>
        <div className="dash-kpi"><span className="dash-kpi-icon"><Icon name="clock" size={16} /></span><strong>{attentes.length}</strong>
          <span className="dash-kpi-label">{t('personnel.waiting')}</span>
          <span className={`dash-tag ${attentes.length ? 'down' : 'up'}`}>{attentes.length ? t('personnel.toDecide') : t('personnel.nothingWaiting')}</span></div>
      </section>

      <section className="dash-grid half">
        <Panel icon="bell" tone="yolk" title={t('personnel.waitTitle')}>
          {attentes.length === 0 ? <p className="dash-ok"><Icon name="check" size={16} />{t('personnel.nothingWaiting')}</p> : (
            <ul className="list">
              {attentes.map((a, i) => (
                <li key={i}>
                  <div className="grow"><strong>{a.txt}</strong>{a.qui && <div className="small warn-text">{t('personnel.yourTurn')}</div>}</div>
                  <button className="btn ghost sm" onClick={() => onOpen(a.k)}>{t('personnel.open')}</button>
                </li>
              ))}
            </ul>
          )}
          {enConge > 0 && <p className="muted small">{t('personnel.awayNow')} : {d.conges.filter((c) => c.statut === 'accordee').map((c) => `${nom(c.employe_id)} (${t('rh3.until', { d: day(c.date_fin, lang) })})`).join(', ')}</p>}
        </Panel>
        <Panel icon="calendar" tone="sky" title={t('personnel.endingTitle')} subtitle={t('personnel.endingHint')}>
          {d.finissants.length === 0 ? <p className="muted">{t('personnel.noEnding')}</p> : (
            <ul className="list">
              {d.finissants.map((e) => (
                <li key={e.id}><div className="grow"><strong>{e.nom}</strong>
                  <div className="muted small">{e.essai ? t('personnel.trialEnds', { d: day(e.fin, lang) }) : t('personnel.contractEnds', { d: day(e.fin, lang), c: t(`rh3.contract.${e.type_contrat ?? 'cdd'}`) })}</div></div></li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </>
  )
}

// ---------- Reports: payroll month by month, attendance and overtime per employee, export ----------
function RapportsRH() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [mois, setMois] = useState(() => localDate().slice(0, 7))
  const debut = `${mois}-01`
  const q = useQuery(async () => {
    const d12 = new Date(`${debut}T00:00`); d12.setMonth(d12.getMonth() - 11)
    const fin = new Date(`${debut}T00:00`); fin.setMonth(fin.getMonth() + 1)
    const [emp, paies, pres, hs] = await Promise.all([
      supabase.from('employes').select('id, nom, poste, categorie, actif').order('nom'),
      supabase.from('paies').select('employe_id, mois, net, primes, retenues_legales, salaire_base').eq('annulee', false).gte('mois', d12.toLocaleDateString('en-CA')).lte('mois', debut),
      supabase.from('presences').select('employe_id, statut, justifiee, minutes_retard').gte('date_jour', debut).lt('date_jour', fin.toLocaleDateString('en-CA')),
      supabase.from('heures_sup').select('employe_id, heures, statut').eq('statut', 'autorisee').gte('date_jour', debut).lt('date_jour', fin.toLocaleDateString('en-CA'))
    ])
    const mois12 = Array.from({ length: 12 }, (_, i) => { const x = new Date(d12); x.setMonth(x.getMonth() + i); return x.toLocaleDateString('en-CA').slice(0, 7) })
    const parMois = mois12.map((m) => ({ m, net: must(paies).filter((p) => String(p.mois).slice(0, 7) === m).reduce((s, p) => s + Number(p.net), 0) }))
    const lignes = must(emp).filter((e) => e.actif || must(paies).some((p) => p.employe_id === e.id && String(p.mois).slice(0, 7) === mois)).map((e) => {
      const p = must(pres).filter((x) => x.employe_id === e.id)
      const paie = must(paies).find((x) => x.employe_id === e.id && String(x.mois).slice(0, 7) === mois)
      return {
        ...e,
        presents: p.filter((x) => x.statut === 'present').length,
        absences: p.filter((x) => x.statut === 'absent').length,
        nonJustifiees: p.filter((x) => x.statut === 'absent' && !x.justifiee).length,
        permissions: p.filter((x) => x.statut === 'permission').length,
        retards: p.filter((x) => x.statut === 'retard').length,
        minutes: p.reduce((s, x) => s + Number(x.minutes_retard || 0), 0),
        heures: must(hs).filter((x) => x.employe_id === e.id).reduce((s, x) => s + Number(x.heures), 0),
        net: paie ? Number(paie.net) : null
      }
    })
    return { parMois, lignes }
  }, [debut])

  if (!q.data) return <Loading error={q.error} />
  const max = Math.max(1, ...q.data.parMois.map((x) => x.net))
  const cols = [
    { label: t('rh.employee'), value: (r) => r.nom }, { label: t('salaires.job'), value: (r) => r.poste ?? '' },
    { label: t('rh.status.present'), value: (r) => r.presents }, { label: t('personnel.absences'), value: (r) => r.absences },
    { label: t('personnel.unjustified'), value: (r) => r.nonJustifiees }, { label: t('rh.status.permission'), value: (r) => r.permissions },
    { label: t('rh.status.retard'), value: (r) => r.retards }, { label: t('rh.minutes'), value: (r) => r.minutes },
    { label: t('personnel.otHours'), value: (r) => r.heures }, { label: t('personnel.netPaid'), value: (r) => r.net ?? '' }
  ]

  return (
    <>
      <Panel icon="chart" tone="green" title={t('personnel.payroll12')} subtitle={t('personnel.payroll12Hint')}>
        <div className="dash-bars">
          {q.data.parMois.map((x, i) => (
            <div key={x.m} className={`dash-bar ${i === q.data.parMois.length - 1 ? 'on' : ''}`}>
              <span className="dash-bar-val">{x.net ? `${Math.round(x.net / 1000).toLocaleString(lang)} k` : ''}</span>
              <div className="dash-bar-track"><i style={{ height: `${Math.max(2, (x.net / max) * 100)}%` }} /></div>
              <span className="dash-bar-lbl">{new Date(`${x.m}-01T00:00`).toLocaleDateString(lang, { month: 'short' })}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel icon="note" tone="sky" title={t('personnel.monthReport', { mois: new Date(`${debut}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' }) })}
        actions={<div className="row">
          <input type="month" value={mois} onChange={(e) => e.target.value && setMois(e.target.value)} aria-label={t('salaires.month')} />
          <button className="btn ghost sm" onClick={() => exportExcel(`personnel-${mois}`, cols, q.data.lignes)}><Icon name="download" size={14} />Excel</button>
        </div>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{cols.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
            <tbody>
              {q.data.lignes.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.nom}</strong></td><td className="muted">{r.poste ?? '—'}</td>
                  <td>{r.presents}</td><td>{r.absences}</td><td className={r.nonJustifiees ? 'error' : ''}>{r.nonJustifiees}</td><td>{r.permissions}</td>
                  <td>{r.retards}</td><td>{r.minutes}</td><td>{r.heures.toLocaleString(lang)}</td><td>{r.net == null ? '—' : money(r.net, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <ChargesAReverser />
    </>
  )
}
