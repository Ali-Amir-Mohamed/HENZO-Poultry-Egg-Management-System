import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon, { Logo } from '../../components/Icon'
import { askReason, day, Loading, money } from '../../components/ui'

// Individual investor statement: capital register + history of the 10 %. Printable (→ PDF).
export default function ReleveInvestisseur() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage

  const q = useQuery(async () => {
    const [inv, sit, ops, dist, ferme] = await Promise.all([
      supabase.from('investisseurs').select('*').eq('id', id).single(),
      supabase.from('situation_investisseurs').select('*').eq('investisseur_id', id).single(),
      supabase.from('operations_investisseurs').select('*').eq('investisseur_id', id).order('date_operation').order('created_at'),
      supabase.from('distributions_investisseurs').select('*, bande:bandes(code)').eq('investisseur_id', id).order('created_at'),
      supabase.from('fermes').select('nom').limit(1).single()
    ])
    return { inv: must(inv), sit: must(sit), ops: must(ops), dist: must(dist), ferme: must(ferme) }
  }, [id])

  if (!q.data) return <Loading error={q.error} />
  const { inv, sit, ops, dist, ferme } = q.data

  const annuler = async (op) => {
    const motif = askReason(t('argent.cancelReason'))
    if (!motif) return
    const { error } = await supabase.from('operations_investisseurs').update({ annulee: true, motif_annulation: motif }).eq('id', op.id)
    if (error) window.alert(error.message)
    q.reload()
  }

  // Running capital balance
  let capital = 0
  const lignes = ops.map((o) => {
    if (!o.annulee) capital += o.type_operation === 'retrait_capital' ? -Number(o.montant) : Number(o.montant)
    return { ...o, capital }
  })

  return (
    <div className="stack releve">
      <div className="no-print row">
        <Link to="/argent" className="back"><Icon name="chevron" size={16} className="flip" />{t('capital.back')}</Link>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}><Icon name="download" size={16} />{t('capital.print')}</button>
      </div>

      <section className="panel">
        <div className="releve-head">
          <Logo size={48} />
          <div>
            <h1>{t('capital.statementTitle')}</h1>
            <p className="muted">{ferme.nom} · {t('capital.at', { d: day(new Date().toISOString(), lang) })}</p>
          </div>
        </div>
        <div className="facts">
          <div className="fact"><span>{t('capital.investor')}</span><strong>{inv.nom}</strong></div>
          {inv.telephone && <div className="fact"><span>{t('reglages.phone')}</span><strong>{inv.telephone}</strong></div>}
          {inv.piece_identite && <div className="fact"><span>{t('capital.idDoc')}</span><strong>{inv.piece_identite}</strong></div>}
        </div>
        <div className="facts big">
          <div className="fact"><span>{t('capital.contributed')}</span><strong>{money(sit.capital_apporte, lang)}</strong></div>
          <div className="fact"><span>{t('capital.reinvested')}</span><strong>{money(sit.capital_reinvesti, lang)}</strong></div>
          <div className="fact"><span>{t('capital.withdrawn')}</span><strong>{money(sit.capital_retire, lang)}</strong></div>
          <div className="fact"><span>{t('capital.remaining')}</span><strong>{money(sit.capital_restant, lang)}</strong></div>
          <div className="fact"><span>{t('capital.paid10')}</span><strong>{money(sit.dix_pourcent_verses, lang)}</strong></div>
          <div className="fact"><span>{t('capital.pending10')}</span><strong>{money(sit.dix_pourcent_en_attente, lang)}</strong></div>
        </div>
      </section>

      <section className="panel">
        <h2>{t('capital.operations')}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('saisie.date')}</th><th>{t('capital.operation')}</th><th>{t('argent.amount')}</th><th>{t('capital.balance')}</th><th className="no-print" /></tr></thead>
            <tbody>
              {lignes.map((o) => (
                <tr key={o.id} className={o.annulee ? 'cancelled-row' : ''}>
                  <td>{day(o.date_operation, lang)}</td>
                  <td>{t(`capital.types.${o.type_operation}`)}{o.annulee ? ` (${t('argent.cancelled')} : ${o.motif_annulation})` : ''}{o.notes ? ` · ${o.notes}` : ''}</td>
                  <td>{o.type_operation === 'retrait_capital' ? '−' : '+'}{money(o.montant, lang)}</td>
                  <td>{money(o.capital, lang)}</td>
                  <td className="no-print">
                    {!o.annulee && o.type_operation !== 'reinvestissement' && can(role, 'annuler') && (
                      <button className="btn ghost sm" onClick={() => annuler(o)}>{t('argent.cancel')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>{t('capital.history10')}</h2>
        {dist.length === 0 ? <p className="muted">{t('capital.none10')}</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('saisie.bande')}</th><th>{t('capital.base')}</th><th>{t('capital.rate')}</th><th>{t('argent.amount')}</th><th>{t('capital.choice')}</th></tr></thead>
              <tbody>
                {dist.map((d) => (
                  <tr key={d.id}>
                    <td>{d.bande.code}</td>
                    <td>{money(d.capital_base, lang)}</td>
                    <td>{Number(d.taux)} %</td>
                    <td>{money(d.montant, lang)}</td>
                    <td>{t(`capital.statuts.${d.statut}`)}{d.decide_le ? ` · ${day(d.decide_le, lang)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
