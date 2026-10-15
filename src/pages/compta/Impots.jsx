import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import Icon from '../../components/Icon'
import { day, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Taxes: monthly turnover and the advance due on it (real / simplified regime), or the IGS by quarter,
// VAT collected when the company is registered for it, and a simple estimate of the year's tax.
// Every rate comes from the company sheet; the accountant confirms them. Paying = a "taxes" expense.
const iso = (d) => d.toLocaleDateString('en-CA')
const finMois = (y, m) => new Date(y, m + 1, 15)          // le 15 du mois suivant
const finTrimestre = (y, tr) => new Date(y, tr * 3 + 3, 15)

export default function Impots() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role, profile } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const annee = new Date().getFullYear()
  const q = useQuery(async () => {
    const [soc, ca, paiements, bareme, depenses] = await Promise.all([
      supabase.from('fermes').select('regime_fiscal, adherent_cga, assujetti_tva, taux_tva, taux_acompte, taux_is, niu').eq('id', profile.ferme_id).maybeSingle(),
      supabase.from('chiffre_affaires_mensuel').select('mois, chiffre_affaires').gte('mois', `${annee - 1}-01-01`),
      supabase.from('paiements_impots').select('*, depense:depenses(annulee)').gte('periode', `${annee}-01-01`).order('date_paiement', { ascending: false }),
      supabase.from('bareme_igs').select('*').order('classe'),
      supabase.from('depenses').select('montant, categorie').eq('statut', 'validee').eq('annulee', false).gte('date_depense', `${annee}-01-01`)
    ])
    return {
      soc: must(soc) ?? {},
      ca: Object.fromEntries(must(ca).map((r) => [String(r.mois).slice(0, 7), Number(r.chiffre_affaires)])),
      paiements: must(paiements).filter((p) => !p.depense?.annulee),
      bareme: must(bareme),
      charges: must(depenses).filter((d) => !['retrait_associe', 'impots_taxes'].includes(d.categorie)).reduce((s, d) => s + Number(d.montant), 0)
    }
  }, [profile?.ferme_id])

  const payer = async (type, periode, du, libelle) => {
    const v = await ask.form({ title: libelle, icon: 'wallet', submit: t('compta.imp.pay'), message: t('compta.imp.payHint'), fields: [
      { name: 'montant', label: t('argent.amount'), type: 'number', min: 1, value: du > 0 ? du : '', required: true },
      { name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'banque', options: MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) })) },
      { name: 'activite', label: t('compta.imp.box'), type: 'select', value: 'chair', options: ['chair', 'pondeuse'].map((a) => ({ value: a, label: t(`argent.caisse.${a}`) })) },
      { name: 'date', label: t('saisie.date'), type: 'date', value: iso(new Date()), required: true },
      { name: 'reference', label: t('compta.imp.receipt') }
    ] })
    if (v) {
      await run(supabase.rpc('payer_impot', { p_type: type, p_periode: periode, p_montant: v.montant, p_mode: v.mode, p_activite: v.activite,
        p_date: v.date, p_reference: v.reference || null }), q.reload)
    }
  }

  if (!q.data) return <Loading error={q.error} />
  const { soc, ca, paiements, bareme, charges } = q.data
  const payeur = can(role, 'impots.payer')
  const aujourdhui = new Date()
  const moisCourant = aujourdhui.getMonth()
  const caAn = (y) => Object.entries(ca).filter(([k]) => k.startsWith(`${y}-`)).reduce((s, [, v]) => s + v, 0)
  const paye = (type, periode) => paiements.filter((p) => p.type_impot === type && String(p.periode).slice(0, 7) === periode.slice(0, 7)).reduce((s, p) => s + Number(p.montant), 0)
  const etat = (du, deja, echeance) => {
    if (du <= 0) return <span className="tag muted">{t('compta.imp.nothing')}</span>
    if (deja >= du) return <span className="tag ok">{t('compta.imp.paid')}</span>
    if (aujourdhui > echeance) return <span className="tag danger">{t('compta.imp.late')}</span>
    return <span className="tag warn">{t('compta.imp.toPay', { d: day(iso(echeance), lang) })}</span>
  }
  const igs = soc.regime_fiscal === 'igs'
  const caAnnee = caAn(annee)
  const acomptesPayes = paiements.filter((p) => p.type_impot === 'acompte_is').reduce((s, p) => s + Number(p.montant), 0)
  const resultat = caAnnee - charges
  const impotBenefice = Math.round(Math.max(0, resultat) * Number(soc.taux_is) / 100)
  const minimum = Math.round(caAnnee * Number(soc.taux_acompte) / 100)
  const impotAnnee = Math.max(impotBenefice, minimum)

  // IGS: class from last year's turnover, −50 % for a CGA member, + 10 % local surcharge
  const caPrecedent = caAn(annee - 1)
  const classe = bareme.find((b) => caPrecedent >= Number(b.ca_min) && (b.ca_max == null || caPrecedent < Number(b.ca_max)))
  const igsAn = classe ? Math.round(Number(classe.montant) * (soc.adherent_cga ? 0.5 : 1) * 1.1) : 0
  const tvaMois = (m) => (soc.assujetti_tva ? Math.round(m * Number(soc.taux_tva) / (100 + Number(soc.taux_tva))) : 0)

  return (
    <>
      <Panel icon="wallet" tone="yolk" title={t('compta.imp.title', { annee })} subtitle={t(`compta.regimes.${soc.regime_fiscal ?? 'reel'}`)}>
        <div className="kpis">
          <div className="kpi"><span className="kpi-label">{t('compta.imp.turnover')}</span><strong className="kpi-value">{money(caAnnee, lang)}</strong></div>
          {!igs && <div className="kpi"><span className="kpi-label">{t('compta.imp.advancesPaid')}</span><strong className="kpi-value">{money(acomptesPayes, lang)}</strong></div>}
          {igs && <div className="kpi"><span className="kpi-label">{t('compta.imp.igsYear')}</span><strong className="kpi-value">{money(igsAn, lang)}</strong></div>}
        </div>
        <p className="muted small">
          {[soc.adherent_cga ? t('compta.imp.cgaYes') : t('compta.imp.cgaNo'), soc.assujetti_tva ? t('compta.imp.tvaYes', { taux: soc.taux_tva }) : t('compta.imp.tvaNo'),
            !igs && t('compta.imp.rate', { taux: soc.taux_acompte })].filter(Boolean).join(' · ')}
        </p>
        {!soc.niu && <div className="alert warn"><Icon name="alert" size={16} />{t('compta.imp.noNiu')}</div>}
      </Panel>

      {!igs && (
        <Panel icon="calendar" tone="green" title={t('compta.imp.monthly')} subtitle={t('compta.imp.monthlyHint')}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('compta.imp.month')}</th><th className="num">{t('compta.imp.turnover')}</th><th className="num">{t('compta.imp.advance')}</th>
                {soc.assujetti_tva && <th className="num">{t('compta.imp.vat')}</th>}<th className="num">{t('compta.imp.paidCol')}</th><th /></tr></thead>
              <tbody>
                {Array.from({ length: moisCourant + 1 }, (_, m) => {
                  const cle = `${annee}-${String(m + 1).padStart(2, '0')}-01`
                  const chiffre = ca[cle.slice(0, 7)] ?? 0
                  const du = Math.round(chiffre * Number(soc.taux_acompte) / 100)
                  const deja = paye('acompte_is', cle)
                  const libelle = `${t('compta.imp.advance')} – ${new Date(annee, m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' })}`
                  return (
                    <tr key={cle}>
                      <td>{new Date(annee, m, 1).toLocaleDateString(lang, { month: 'long' })}</td>
                      <td className="num">{money(chiffre, lang)}</td>
                      <td className="num">{money(du, lang)}</td>
                      {soc.assujetti_tva && <td className="num">{money(tvaMois(chiffre), lang)}</td>}
                      <td className="num">{money(deja, lang)}</td>
                      <td>
                        {etat(du, deja, finMois(annee, m))}
                        {payeur && du > deja && <button className="btn ghost sm" onClick={() => payer('acompte_is', cle, du - deja, libelle)}>{t('compta.imp.pay')}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {soc.assujetti_tva && <p className="muted small">{t('compta.imp.vatHint')}</p>}
        </Panel>
      )}

      {igs && (
        <Panel icon="calendar" tone="green" title={t('compta.imp.igsTitle')}
          subtitle={classe ? t('compta.imp.igsClass', { classe: classe.classe, ca: money(caPrecedent, lang) }) : t('compta.imp.igsNoData')}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('compta.imp.quarter')}</th><th className="num">{t('compta.imp.due')}</th><th className="num">{t('compta.imp.paidCol')}</th><th /></tr></thead>
              <tbody>
                {[0, 1, 2, 3].map((tr) => {
                  const cle = `${annee}-${String(tr * 3 + 1).padStart(2, '0')}-01`
                  const du = Math.round(igsAn / 4)
                  const deja = paye('igs', cle)
                  return (
                    <tr key={cle}>
                      <td>{t('compta.imp.quarterN', { n: tr + 1 })}</td>
                      <td className="num">{money(du, lang)}</td>
                      <td className="num">{money(deja, lang)}</td>
                      <td>
                        {etat(du, deja, finTrimestre(annee, tr))}
                        {payeur && du > deja && <button className="btn ghost sm" onClick={() => payer('igs', cle, du - deja, `IGS – ${t('compta.imp.quarterN', { n: tr + 1 })} ${annee}`)}>{t('compta.imp.pay')}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('compta.imp.igsHint')}</p>
        </Panel>
      )}

      {!igs && (
        <Panel icon="chart" tone="sky" title={t('compta.imp.estimate')} subtitle={t('compta.imp.estimateHint')}>
          <dl className="receipt-totals">
            <div><dt>{t('compta.imp.turnover')}</dt><dd>{money(caAnnee, lang)}</dd></div>
            <div><dt>− {t('compta.imp.charges')}</dt><dd>{money(charges, lang)}</dd></div>
            <div className="main"><dt>{t('compta.imp.result')}</dt><dd>{money(resultat, lang)}</dd></div>
            <div><dt>{t('compta.imp.onProfit', { taux: soc.taux_is })}</dt><dd>{money(impotBenefice, lang)}</dd></div>
            <div><dt>{t('compta.imp.minimum', { taux: soc.taux_acompte })}</dt><dd>{money(minimum, lang)}</dd></div>
            <div className="main"><dt>{t('compta.imp.taxYear')}</dt><dd>{money(impotAnnee, lang)}</dd></div>
            <div><dt>− {t('compta.imp.advancesPaid')}</dt><dd>{money(acomptesPayes, lang)}</dd></div>
            <div className="due"><dt>{t('compta.imp.remaining')}</dt><dd>{money(Math.max(0, impotAnnee - acomptesPayes), lang)}</dd></div>
          </dl>
          <p className="muted small">{impotBenefice >= minimum ? t('compta.imp.profitApplies') : t('compta.imp.minimumApplies')}</p>
        </Panel>
      )}

      <Panel icon="receipt" tone="green" title={t('compta.imp.payments')}>
        {paiements.length === 0 ? <p className="muted">{t('compta.imp.noPayment')}</p> : (
          <ul className="list">
            {paiements.map((p) => (
              <li key={p.id}>
                <div className="grow">
                  <strong>{t(`compta.imp.types.${p.type_impot}`)}</strong> · {new Date(p.periode).toLocaleDateString(lang, { month: 'long', year: 'numeric' })}
                  <div className="muted small">{day(p.date_paiement, lang)}{p.reference ? ` · ${t('compta.imp.receipt')} ${p.reference}` : ''}</div>
                </div>
                <strong>{money(p.montant, lang)}</strong>
              </li>
            ))}
          </ul>
        )}
        {payeur && (
          <div className="row-actions">
            <button className="btn ghost sm" onClick={() => payer('patente', `${annee}-01-01`, 0, `${t('compta.imp.types.patente')} ${annee}`)}>{t('compta.imp.payOther', { x: t('compta.imp.types.patente') })}</button>
            <button className="btn ghost sm" onClick={() => payer('solde_is', `${annee}-01-01`, 0, t('compta.imp.types.solde_is'))}>{t('compta.imp.payOther', { x: t('compta.imp.types.solde_is') })}</button>
            <button className="btn ghost sm" onClick={() => payer('autre', iso(aujourdhui).slice(0, 8) + '01', 0, t('compta.imp.types.autre'))}>{t('compta.imp.payOther', { x: t('compta.imp.types.autre') })}</button>
          </div>
        )}
        <p className="muted small">{t('compta.imp.cancelHint')}</p>
      </Panel>
    </>
  )
}
