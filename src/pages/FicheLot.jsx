import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import { TABLES } from '../config'
import Icon from '../components/Icon'
import { Loading, money, Panel } from '../components/ui'
import { Fact, Timeline, WeightCurve } from '../components/fiche'

// One layer flock as a single file: laying, mortality, feed, sales, expenses, profit
export default function FicheLot() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const n = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString(lang, { maximumFractionDigits: d }))

  const q = useQuery(async () => {
    const since = new Date()
    since.setDate(since.getDate() - 29)
    const [lot, ind, ponte, morts, conso, ventes, depenses] = await Promise.all([
      supabase.from(TABLES.lots).select('*, fournisseur:tiers(nom)').eq('id', id).single(),
      supabase.from('indicateurs_lots').select('*').eq('lot_id', id).maybeSingle(),
      supabase.from('ponte_journaliere').select('*').eq('lot_id', id).gte('date_ponte', since.toLocaleDateString('en-CA')).order('date_ponte'),
      supabase.from(TABLES.mortalites).select('id, date_constat, nombre, cause').eq('lot_id', id),
      supabase.from(TABLES.mouvementsStock).select('id, date_mouvement, quantite, article:articles(nom, unite)').eq('lot_id', id).eq('type_mouvement', 'sortie'),
      supabase.from(TABLES.ventes).select('id, date_vente, produit, unite, quantite, montant, annulee, client:tiers(nom)').eq('lot_id', id),
      supabase.from(TABLES.depenses).select('id, date_depense, libelle, montant, statut, annulee').eq('lot_id', id)
    ])
    return { lot: must(lot), ind: must(ind), ponte: must(ponte), morts: must(morts), conso: must(conso), ventes: must(ventes), depenses: must(depenses) }
  }, [id])

  if (!q.data) return <Loading error={q.error} />
  const { lot, ind, ponte, morts, conso, ventes, depenses } = q.data

  const events = [
    { date: lot.date_arrivee, icon: 'egg', tone: 'green', text: t('fiche.ev.arrivalLot', { n: lot.effectif_initial }) },
    ...morts.map((m) => ({ date: m.date_constat, icon: 'alert', tone: 'rose', text: t('fiche.ev.death', { n: m.nombre }) + (m.cause ? ` · ${m.cause}` : '') })),
    ...conso.map((c) => ({ date: c.date_mouvement, icon: 'box', tone: 'sky', text: `${n(c.quantite, 2)} ${t(`unites.${c.article?.unite}`)} ${c.article?.nom}` })),
    ...ventes.map((v) => ({ date: v.date_vente, icon: 'cart', tone: 'green', cancelled: v.annulee,
      text: `${n(v.quantite, 2)} ${t(`unites.${v.unite}`)} ${t(`produits.${v.produit}`)} · ${money(v.montant, lang)}${v.client ? ` · ${v.client.nom}` : ''}` })),
    ...depenses.map((d) => ({ date: d.date_depense, icon: 'receipt', tone: 'rose', cancelled: d.annulee || d.statut === 'rejetee', text: `${d.libelle} · ${money(d.montant, lang)}` })),
    ...(lot.date_reforme ? [{ date: lot.date_reforme, icon: 'flag', tone: 'yolk', text: t('statuts.reforme') }] : [])
  ]

  return (
    <div className="stack">
      <Link to="/ferme" className="back"><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</Link>

      <section className="hero compact">
        <div>
          <p className="hero-date">{t('types.pondeuse_pl')}{lot.souche ? ` · ${lot.souche}` : ''}{lot.fournisseur ? ` · ${lot.fournisseur.nom}` : ''}</p>
          <h1>{lot.code}</h1>
          <span className="chip">{t(`statuts.${lot.statut}`)}</span>
        </div>
        <div className="hero-facts">
          <div><span>{t('dashboard.age')}</span><strong>{t('ferme.weeks', { n: ind?.age_semaines })}</strong></div>
          <div><span>{t('dashboard.birds')}</span><strong>{n(ind?.effectif)} / {n(lot.effectif_initial)}</strong></div>
        </div>
      </section>

      {ind && (
        <>
          <div className="facts big">
            <Fact label={t('fiche.layingRate7')} value={ind.taux_ponte_7j ? `${n(ind.taux_ponte_7j, 1)} %` : '—'} />
            <Fact label={t('fiche.eggsTotal')} value={n(ind.oeufs_total)} />
            <Fact label={t('fiche.breakRate')} value={ind.taux_casse ? `${n(ind.taux_casse, 1)} %` : '—'} tone={Number(ind.taux_casse) > 3 ? 'bad' : ''} />
            <Fact label={t('fiche.mortality')} value={`${n(ind.morts)} (${n(ind.taux_mortalite, 1)} %)`} />
            <Fact label={t('fiche.feed')} value={`${n(ind.aliment_kg)} kg`} />
            <Fact label={t('fiche.costPerEgg')} value={ind.cout_par_oeuf ? `${n(ind.cout_par_oeuf, 1)} F` : '—'} />
          </div>
          <Panel icon="wallet" tone="green" title={t('fiche.profitability')}>
            <table className="table money-table">
              <tbody>
                <tr><td>{t('fiche.costFeed')}</td><td>{money(ind.cout_aliment, lang)}</td></tr>
                <tr><td>{t('fiche.costHealth')}</td><td>{money(ind.cout_produits_sante, lang)}</td></tr>
                <tr><td>{t('fiche.costOther')}</td><td>{money(ind.autres_charges_directes, lang)}</td></tr>
                <tr className="sum"><td>{t('fiche.costTotal')}</td><td>{money(ind.cout_total, lang)}</td></tr>
                <tr><td>{t('fiche.turnover')}</td><td>{money(ind.chiffre_affaires, lang)}</td></tr>
                <tr className={`sum ${Number(ind.marge_brute) < 0 ? 'bad' : 'good'}`}><td>{t('fiche.margin')}</td><td>{money(ind.marge_brute, lang)}</td></tr>
              </tbody>
            </table>
          </Panel>
        </>
      )}

      {ponte.length > 1 && (
        <Panel icon="egg" tone="yolk" title={t('fiche.layingCurve')}>
          <WeightCurve points={ponte.map((p) => ({ date: p.date_ponte, value: Number(p.taux_ponte ?? 0) }))} lang={lang} unit="%" />
        </Panel>
      )}

      <Panel icon="clock" tone="sky" title={t('fiche.history')}>
        <Timeline events={events} lang={lang} />
      </Panel>
    </div>
  )
}
