import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { exportExcel } from '../../lib/export'
import Icon from '../../components/Icon'
import { Empty, Loading, money, Panel } from '../../components/ui'
import { ParametresPaie } from '../argent/Paie'

// Payroll for the accounts: monthly totals of the whole company (gross, to pay over to the CNPS and the tax office,
// already paid) – never an individual salary – and the payroll settings, which the accountant may correct.
export default function PaieTotaux() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const depuis = `${new Date().getFullYear() - 1}-01-01`
  const q = useQuery(async () => must(await supabase.rpc('charges_salaires_societe', { p_depuis: depuis })))
  const mois = (m) => new Date(`${String(m).slice(0, 10)}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })
  const exporter = () => exportExcel('paie-totaux', [
    { label: t('compta.imp.month'), value: (r) => String(r.mois).slice(0, 7) },
    { label: t('paie.grossTotal'), value: (r) => Number(r.masse_brute) },
    { label: t('paie.over.cnps'), value: (r) => Number(r.a_reverser_cnps) },
    { label: t('paie.paidCnps'), value: (r) => Number(r.paye_cnps) },
    { label: t('paie.over.impots_salaires'), value: (r) => Number(r.a_reverser_impots) },
    { label: t('paie.paidTaxes'), value: (r) => Number(r.paye_impots) },
    { label: t('paie.employerContrib'), value: (r) => Number(r.charges_patronales) }
  ], q.data ?? [])

  return (
    <>
      <Panel icon="users" tone="green" title={t('paie.totalsTitle')} subtitle={t('paie.totalsHint')}
        actions={q.data?.length > 0 && <button className="btn ghost sm" onClick={exporter}><Icon name="download" size={14} />{t('export.button')}</button>}>
        {!q.data ? <Loading error={q.error} /> : q.data.length === 0 ? <Empty icon="users" text={t('paie.noTotals')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('compta.imp.month')}</th><th className="num">{t('paie.grossTotal')}</th><th className="num">{t('paie.over.cnps')}</th><th className="num">{t('paie.over.impots_salaires')}</th><th className="num">{t('paie.employerContrib')}</th></tr></thead>
              <tbody>
                {q.data.map((r) => {
                  const reste = Number(r.a_reverser_cnps) - Number(r.paye_cnps) + Number(r.a_reverser_impots) - Number(r.paye_impots)
                  return (
                    <tr key={r.mois}>
                      <td>{mois(r.mois)}<div className="muted small">{t('paie.payslips', { count: Number(r.bulletins) })}</div></td>
                      <td className="num">{money(r.masse_brute, lang)}</td>
                      <td className="num">{money(r.a_reverser_cnps, lang)}<div className="small muted">{t('paie.paidAmount', { n: money(r.paye_cnps, lang) })}</div></td>
                      <td className="num">{money(r.a_reverser_impots, lang)}<div className="small muted">{t('paie.paidAmount', { n: money(r.paye_impots, lang) })}</div></td>
                      <td className="num">{money(r.charges_patronales, lang)}{reste > 0 && <div><span className="tag warn">{t('paie.leftToPay', { n: money(reste, lang) })}</span></div>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ParametresPaie />
    </>
  )
}
