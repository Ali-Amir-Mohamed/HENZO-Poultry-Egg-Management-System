import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import Icon from '../../components/Icon'
import { Empty, Field, Loading, money, Panel } from '../../components/ui'

// HENZO AGRO profits for a period: sales − purchase cost of what was sold (average purchase cost of each item)
// + delivery fees + commissions − charges (every validated expense except stock purchases and partners' withdrawals),
// and the margin of each item.
const iso = (d) => d.toLocaleDateString('en-CA')
const periodes = () => {
  const now = new Date()
  const debutMois = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    mois: [iso(debutMois), iso(now)],
    moisDernier: [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))],
    annee: [iso(new Date(now.getFullYear(), 0, 1)), iso(now)]
  }
}

export default function Benefices() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [choix, setChoix] = useState('mois')
  const [dates, setDates] = useState(periodes().mois)
  const choisir = (k) => { setChoix(k); if (k !== 'autre') setDates(periodes()[k]) }
  const q = useQuery(async () => {
    const [resume, articles] = await Promise.all([
      supabase.rpc('resume_benefices', { p_debut: dates[0], p_fin: dates[1] }),
      supabase.rpc('benefices_articles', { p_debut: dates[0], p_fin: dates[1] })
    ])
    return { r: must(resume), articles: must(articles) ?? [] }
  }, [dates[0], dates[1]])

  const pct = (marge, ventes) => (Number(ventes) > 0 ? `${Math.round((Number(marge) / Number(ventes)) * 100)} %` : '—')
  const ligne = (label, n, signe, fort) => (
    <div className={`benef-ligne ${fort ? 'fort' : ''}`}><span>{signe ? `${signe} ` : ''}{label}</span><strong>{money(n, lang)}</strong></div>
  )

  return (
    <div className="stack">
      <Panel icon="chart" tone="green" title={t('benefices.title')} subtitle={t('benefices.subtitle')}>
        <div className="row benef-periodes">
          {['mois', 'moisDernier', 'annee', 'autre'].map((k) => (
            <button key={k} type="button" className={`btn sm ${choix === k ? 'primary' : 'ghost'}`} onClick={() => choisir(k)}>{t(`benefices.periods.${k}`)}</button>
          ))}
        </div>
        {choix === 'autre' && (
          <div className="grid-2">
            <Field label={t('benefices.from')}><input type="date" value={dates[0]} onChange={(e) => setDates([e.target.value, dates[1]])} /></Field>
            <Field label={t('benefices.to')}><input type="date" value={dates[1]} onChange={(e) => setDates([dates[0], e.target.value])} /></Field>
          </div>
        )}
      </Panel>

      {!q.data ? <Loading error={q.error} /> : (
        <>
          <section className="kpis three">
            <div className="kpi"><span className="kpi-label">{t('benefices.sales')}</span><strong className="kpi-value">{money(Number(q.data.r.ventes) + Number(q.data.r.livraisons), lang)}</strong></div>
            <div className="kpi"><span className="kpi-label">{t('benefices.grossMargin')}</span><strong className="kpi-value">{money(q.data.r.marge, lang)}</strong></div>
            <div className="kpi"><span className="kpi-label">{t('benefices.profit')}</span><strong className={`kpi-value ${Number(q.data.r.benefice) < 0 ? 'neg' : 'pos'}`}>{money(q.data.r.benefice, lang)}</strong></div>
          </section>

          <Panel icon="receipt" tone="sky" title={t('benefices.detailTitle')}>
            <div className="benef-calcul">
              {ligne(t('benefices.goodsSales'), q.data.r.ventes)}
              {ligne(t('benefices.purchaseCost'), q.data.r.cout, '−')}
              {ligne(t('benefices.grossMargin'), q.data.r.marge, '=', true)}
              {Number(q.data.r.livraisons) > 0 && ligne(t('benefices.deliveries'), q.data.r.livraisons, '+')}
              {Number(q.data.r.commissions) > 0 && ligne(t('benefices.commissions'), q.data.r.commissions, '+')}
              {ligne(t('benefices.charges'), q.data.r.charges, '−')}
              {ligne(t('benefices.profit'), q.data.r.benefice, '=', true)}
            </div>
            {Number(q.data.r.articles_sans_cout) > 0 && <p className="note"><Icon name="alert" size={16} />{t('benefices.unknownCost', { count: Number(q.data.r.articles_sans_cout) })}</p>}
            <p className="muted small">{t('benefices.howTo')}</p>
          </Panel>

          <Panel icon="box" tone="yolk" title={t('benefices.byItem')}>
            {q.data.articles.length === 0 ? <Empty icon="box" text={t('benefices.noSale')} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('negoce.product')}</th><th className="num">{t('benefices.sold')}</th><th className="num">{t('benefices.sales')}</th><th className="num">{t('benefices.purchaseCost')}</th><th className="num">{t('benefices.margin')}</th><th className="num">%</th></tr></thead>
                  <tbody>
                    {q.data.articles.map((a) => (
                      <tr key={a.article_id}>
                        <td>{a.nom}{!a.cout_connu && <span className="warn-text"> · {t('benefices.noCost')}</span>}</td>
                        <td className="num">{Number(a.quantite).toLocaleString(lang)} {t(`unites.${a.unite}`)}{Number(a.quantite) >= 2 && a.unite !== 'kg' ? 's' : ''}</td>
                        <td className="num">{money(a.ventes, lang)}</td>
                        <td className="num">{a.cout_connu ? money(a.cout, lang) : '—'}</td>
                        <td className="num"><strong>{money(a.marge, lang)}</strong></td>
                        <td className="num">{a.cout_connu ? pct(a.marge, a.ventes) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
