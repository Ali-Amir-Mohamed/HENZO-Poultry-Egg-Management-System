import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import Icon from '../components/Icon'
import { Loading, money, Panel } from '../components/ui'

// Partners' dashboard: the key figures of every company the partner belongs to (the farm with all its sites, HENZO AGRO),
// side by side, without switching company. Read only; the details stay in each company's pages.
export default function Associes() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const q = useQuery(async () => must(await supabase.rpc('tableau_associes')) ?? [])
  const n = (x) => Number(x ?? 0).toLocaleString(lang)

  if (!q.data) return <Loading error={q.error} />
  const societes = q.data
  const somme = (k) => societes.reduce((s, c) => s + Number(c[k] ?? 0), 0)
  const interne = somme('groupe_a_recevoir')
  const evolution = (c) => {
    const avant = Number(c.ventes_mois_dernier)
    if (!avant) return null
    const p = Math.round(((Number(c.ventes_mois) - avant) / avant) * 100)
    return <span className={`evol ${p < 0 ? 'neg' : 'pos'}`}>{p > 0 ? '+' : ''}{p} % {t('associes.vsLastMonth')}</span>
  }
  const kpi = (label, valeur, extra, ton) => (
    <div className="kpi"><span className="kpi-label">{label}</span><strong className={`kpi-value ${ton ?? ''}`}>{valeur}</strong>{extra}</div>
  )

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <p className="hero-date">{new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <h1>{t('associes.title')}</h1>
          <span className="chip">{t('associes.subtitle', { count: societes.length })}</span>
        </div>
      </section>

      {societes.length > 1 && (
        <Panel icon="users" tone="green" title={t('associes.groupTitle')} subtitle={interne > 0 ? t('associes.internalHint', { n: money(interne, lang) }) : null}>
          <section className="kpis three">
            {kpi(t('associes.cash'), money(somme('caisse') + somme('caisse_boutiques'), lang))}
            {kpi(t('associes.result'), money(somme('resultat_mois'), lang), null, somme('resultat_mois') < 0 ? 'neg' : 'pos')}
            {kpi(t('associes.toCollect'), money(somme('a_recevoir') - interne, lang), <small className="muted">{t('associes.outsideGroup')}</small>)}
          </section>
        </Panel>
      )}

      {societes.map((c) => {
        const alertes = [
          Number(c.depenses_a_valider) > 0 && t('associes.alerts.expenses', { count: Number(c.depenses_a_valider) }),
          Number(c.versements_attente) > 0 && t('associes.alerts.deposits', { count: Number(c.versements_attente) }),
          Number(c.livraisons_attente) > 0 && t('associes.alerts.deliveries', { count: Number(c.livraisons_attente) }),
          Number(c.stock_bas) > 0 && t('associes.alerts.lowStock', { count: Number(c.stock_bas) }),
          Number(c.commandes_semaine) > 0 && t('associes.alerts.orders', { count: Number(c.commandes_semaine) })
        ].filter(Boolean)
        return (
          <Panel key={c.id} icon={c.type === 'negoce' ? 'box' : 'hen'} tone={c.type === 'negoce' ? 'yolk' : 'green'} title={c.nom}
            subtitle={[t(c.type === 'negoce' ? 'systeme.negoce' : 'systeme.elevage'), c.sites?.length > 1 && t('associes.sites', { list: c.sites.join(', ') })].filter(Boolean).join(' · ')}>
            <section className="kpis three">
              {kpi(t('associes.cash'), money(Number(c.caisse) + Number(c.caisse_boutiques), lang),
                Number(c.caisse_boutiques) > 0 ? <small className="muted">{t('associes.inShops', { n: money(c.caisse_boutiques, lang) })}</small> : null)}
              {kpi(t('associes.salesMonth'), money(c.ventes_mois, lang), evolution(c))}
              {kpi(t('associes.result'), money(c.resultat_mois, lang), <small className="muted">{t(c.type === 'negoce' ? 'associes.resultHintTrade' : 'associes.resultHintFarm')}</small>,
                Number(c.resultat_mois) < 0 ? 'neg' : 'pos')}
              {kpi(t('associes.toCollect'), money(c.a_recevoir, lang),
                Number(c.groupe_a_recevoir) > 0 ? <small className="muted">{t('associes.ofGroup', { n: money(c.groupe_a_recevoir, lang) })}</small> : null)}
              {kpi(t('associes.toPay'), money(c.a_payer, lang))}
              {c.type === 'elevage'
                ? kpi(t('associes.birds'), n(Number(c.poulets) + Number(c.pondeuses)),
                  <small className="muted">{t('associes.birdsDetail', { poulets: n(c.poulets), bandes: Number(c.bandes), pondeuses: n(c.pondeuses) })}</small>)
                : kpi(t('associes.ordersWeek'), n(c.commandes_semaine))}
            </section>
            {alertes.length > 0
              ? <ul className="associes-alertes">{alertes.map((a) => <li key={a}><Icon name="alert" size={14} />{a}</li>)}</ul>
              : <p className="muted small"><Icon name="check" size={14} /> {t('associes.nothingWaiting')}</p>}
          </Panel>
        )
      })}
      <p className="muted small">{t('associes.howTo')}</p>
    </div>
  )
}
