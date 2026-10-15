import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import Icon, { Logo } from '../components/Icon'
import { day, Loading } from '../components/ui'

// Payslip (bulletin de paie): employer, employee, gross, withholdings, net paid, employer contributions.
// Printable or saved as PDF from the print window. Opened with the pay's id.
const n = (x) => Number(x ?? 0).toLocaleString('fr-FR')

export default function Bulletin() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const q = useQuery(async () => {
    const b = must(await supabase.from('bulletins_paie').select('*, employe:employes(nom, poste, numero_cnps, date_embauche), paie:paies(mode_paiement, annulee, created_at, motif_retenues)').eq('paie_id', id).maybeSingle())
    if (!b) throw new Error(t('paie.notFound'))
    const s = must(await supabase.from('fermes').select('nom, raison_sociale, forme_juridique, capital_social, niu, rccm, adresse_siege, numero_cnps_employeur').eq('id', b.ferme_id).maybeSingle()) ?? {}
    return { b, s }
  }, [id])

  if (!q.data) return <Loading error={q.error} />
  const { b, s } = q.data
  const p = b.parametres ?? {}
  const nom = s.raison_sociale || s.nom || t('app.name')
  const periode = new Date(`${String(b.mois).slice(0, 10)}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })
  const retenues = [
    ['cnps_salarie', b.cnps_salarie, `${n(b.base_cnps)} × ${n(p.taux_cnps_salarie)} %`],
    ['irpp', b.irpp, t('paie.irppBase', { n: n(b.revenu_imposable_annuel) })],
    ['cac', b.cac, `${n(p.taux_cac)} % IRPP`],
    ['cfc_salarie', b.cfc_salarie, `${n(b.brut)} × ${n(p.taux_cfc_salarie)} %`],
    ['rav', b.rav, ''],
    ['tdl', b.tdl, '']
  ]
  const patronales = [
    ['cnps_vieillesse_pat', b.cnps_vieillesse_pat, `${n(p.taux_cnps_vieillesse_pat)} %`],
    ['cnps_allocations', b.cnps_allocations, `${n(p.taux_allocations_fam)} %`],
    ['cnps_accidents', b.cnps_accidents, `${n(p.taux_accidents_travail)} %`],
    ['cfc_patronal', b.cfc_patronal, `${n(p.taux_cfc_patronal)} %`],
    ['fne', b.fne, `${n(p.taux_fne)} %`]
  ]

  return (
    <div className="stack">
      <button className="back no-print" onClick={() => navigate(-1)}><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</button>
      <article className={`invoice ${b.paie?.annulee ? 'cancelled' : ''}`}>
        <header className="invoice-head">
          <div className="invoice-company">
            <Logo size={44} />
            <div>
              <strong>{nom}</strong>
              {[s.forme_juridique && s.capital_social ? `${s.forme_juridique} au capital de ${n(s.capital_social)} FCFA` : s.forme_juridique,
                s.niu && `NIU : ${s.niu}`, s.numero_cnps_employeur && `N° employeur CNPS : ${s.numero_cnps_employeur}`, s.adresse_siege].filter(Boolean).map((x) => <small key={x}>{x}</small>)}
            </div>
          </div>
          <div className="invoice-title">
            <h2>{t('paie.payslipTitle')}</h2>
            <div>{t('paie.period')} : <strong>{periode}</strong></div>
          </div>
        </header>
        {b.paie?.annulee && <div className="alert danger"><Icon name="alert" size={16} />{t('paie.cancelled')}</div>}

        <section className="invoice-client">
          <span className="muted small">{t('paie.employee')}</span>
          <strong>{b.employe?.nom}</strong>
          {[b.employe?.poste, b.employe?.numero_cnps && `N° CNPS : ${b.employe.numero_cnps}`, b.employe?.date_embauche && t('paie.hired', { d: day(b.employe.date_embauche, lang) })].filter(Boolean).map((x) => <small key={x}>{x}</small>)}
        </section>

        <table className="table invoice-lines">
          <thead><tr><th>{t('paie.item')}</th><th>{t('paie.base')}</th><th className="num">{t('paie.gain')}</th><th className="num">{t('paie.deduction')}</th></tr></thead>
          <tbody>
            <tr><td>{t('paie.lines.base')}</td><td /><td className="num">{n(b.salaire_base)}</td><td /></tr>
            {Number(b.primes) > 0 && <tr><td>{t('paie.lines.primes')}</td><td /><td className="num">{n(b.primes)}</td><td /></tr>}
            <tr className="strong"><td><strong>{t('paie.lines.brut')}</strong></td><td /><td className="num"><strong>{n(b.brut)}</strong></td><td /></tr>
            {retenues.map(([k, v, base]) => <tr key={k}><td>{t(`paie.lines.${k}`)}</td><td className="small muted">{base}</td><td /><td className="num">{n(v)}</td></tr>)}
            {Number(b.retenues_diverses) > 0 && <tr><td>{t('paie.lines.retenues')}{b.paie?.motif_retenues ? ` (${b.paie.motif_retenues})` : ''}</td><td /><td /><td className="num">{n(b.retenues_diverses)}</td></tr>}
            {Number(b.avances) > 0 && <tr><td>{t('paie.lines.avances')}</td><td /><td /><td className="num">{n(b.avances)}</td></tr>}
          </tbody>
        </table>

        <dl className="receipt-totals invoice-totals">
          <div><dt>{t('paie.lines.brut')}</dt><dd>{n(b.brut)} FCFA</dd></div>
          <div><dt>{t('paie.totalWithheld')}</dt><dd>{n(Number(b.total_retenues) + Number(b.retenues_diverses) + Number(b.avances))} FCFA</dd></div>
          <div className="main"><dt>{t('paie.netPaid')}</dt><dd>{n(b.net_a_payer)} FCFA</dd></div>
          {b.paie?.mode_paiement && <div><dt className="muted">{t('saisie.modeAcompte')}</dt><dd>{t(`modes.${b.paie.mode_paiement}`)}</dd></div>}
        </dl>

        <table className="table small">
          <thead><tr><th>{t('paie.employerContrib')}</th><th>{t('paie.rate')}</th><th className="num">{t('recu.amount')}</th></tr></thead>
          <tbody>
            {patronales.map(([k, v, taux]) => <tr key={k}><td>{t(`paie.lines.${k}`)}</td><td>{taux}</td><td className="num">{n(v)}</td></tr>)}
            <tr><td><strong>{t('paie.employerTotal')}</strong></td><td /><td className="num"><strong>{n(b.total_patronal)}</strong></td></tr>
          </tbody>
        </table>

        <div className="signatures">
          <div><small className="muted">{t('paie.employerSign')}</small></div>
          <div><small className="muted">{t('paie.employeeSign')}</small></div>
        </div>
        <footer className="invoice-foot"><small>{t('paie.keepIt')}</small></footer>
      </article>
      <div className="row no-print">
        <button className="btn primary" onClick={() => window.print()}><Icon name="download" size={16} />{t('recu.print')}</button>
      </div>
    </div>
  )
}
