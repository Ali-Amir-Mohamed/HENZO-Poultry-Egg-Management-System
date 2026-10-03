import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import { TABLES } from '../config'
import Icon from '../components/Icon'
import { day, Loading, money, Panel } from '../components/ui'
import { Fact, Timeline, WeightCurve } from '../components/fiche'

// One broiler flock as a single file: production, mortality, weight, feed,
// expenses, sales, stock used, profitability and full history.
export default function FicheBande() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const n = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString(lang, { maximumFractionDigits: d }))

  const q = useQuery(async () => {
    const [bande, ind, bilan, morts, pesees, conso, ventes, depenses] = await Promise.all([
      supabase.from(TABLES.bandes).select('*, fournisseur:tiers(nom)').eq('id', id).single(),
      supabase.from('indicateurs_bandes').select('*').eq('bande_id', id).maybeSingle(),
      supabase.from('bilans_bandes').select('*').eq('bande_id', id).maybeSingle(),
      supabase.from(TABLES.mortalites).select('id, date_constat, nombre, cause, created_at').eq('bande_id', id),
      supabase.from(TABLES.pesees).select('id, date_pesee, poids_moyen_g, nombre_peses, created_at').eq('bande_id', id).order('date_pesee'),
      supabase.from(TABLES.mouvementsStock).select('id, date_mouvement, quantite, created_at, article:articles(nom, unite)').eq('bande_id', id).eq('type_mouvement', 'sortie'),
      supabase.from(TABLES.ventes).select('id, date_vente, produit, unite, quantite, prix_unitaire, montant, nombre_sujets, annulee, created_at, client:tiers(nom)').eq('bande_id', id),
      supabase.from(TABLES.depenses).select('id, date_depense, categorie, libelle, montant, statut, annulee, created_at').eq('bande_id', id)
    ])
    return {
      bande: must(bande), ind: must(ind), bilan: must(bilan), morts: must(morts), pesees: must(pesees),
      conso: must(conso), ventes: must(ventes), depenses: must(depenses)
    }
  }, [id])

  if (!q.data) return <Loading error={q.error} />
  const { bande, bilan, morts, pesees, conso, ventes, depenses } = q.data
  // Closed flock: show the frozen report ; otherwise live figures
  const ind = bilan ?? q.data.ind

  const events = [
    { date: bande.date_arrivee, icon: 'drumstick', tone: 'green', text: t('fiche.ev.arrival', { n: bande.nombre_initial }) },
    ...morts.map((m) => ({ date: m.date_constat, icon: 'alert', tone: 'rose', text: t('fiche.ev.death', { n: m.nombre }) + (m.cause ? ` · ${m.cause}` : '') })),
    ...pesees.map((p) => ({ date: p.date_pesee, icon: 'scale', tone: 'yolk', text: t('fiche.ev.weight', { g: n(p.poids_moyen_g), n: p.nombre_peses }) })),
    ...conso.map((c) => ({ date: c.date_mouvement, icon: 'box', tone: 'sky', text: `${n(c.quantite, 2)} ${t(`unites.${c.article?.unite}`)} ${c.article?.nom}` })),
    ...ventes.map((v) => ({ date: v.date_vente, icon: 'cart', tone: 'green', cancelled: v.annulee,
      text: `${t('fiche.ev.sale', { n: v.nombre_sujets ?? n(v.quantite, 2), produit: t(`produits.${v.produit}`) })} · ${money(v.montant, lang)}${v.client ? ` · ${v.client.nom}` : ''}` })),
    ...depenses.map((d) => ({ date: d.date_depense, icon: 'receipt', tone: 'rose', cancelled: d.annulee || d.statut === 'rejetee',
      text: `${d.libelle} · ${money(d.montant, lang)}${d.statut === 'a_valider' ? ` (${t('statuts.a_valider')})` : ''}` })),
    ...(bande.date_cloture ? [{ date: bande.date_cloture, icon: 'flag', tone: 'yolk', text: t(`statuts.${bande.statut}`) }] : [])
  ]

  return (
    <div className="stack">
      <Link to="/ferme" className="back"><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</Link>

      <section className="hero compact">
        <div>
          <p className="hero-date">{t('types.chair_pl')}{bande.souche ? ` · ${bande.souche}` : ''}{bande.fournisseur ? ` · ${bande.fournisseur.nom}` : ''}</p>
          <h1>{bande.code}</h1>
          <span className="chip">{t(`statuts.${bande.statut}`)}</span>
        </div>
        <div className="hero-facts">
          <div><span>{t('dashboard.age')}</span><strong>{t('dashboard.days', { n: ind?.age_jours })}</strong></div>
          <div><span>{t('ferme.remaining')}</span><strong>{n(ind?.restants)} / {n(bande.nombre_initial)}</strong></div>
        </div>
      </section>

      {bilan && (
        <div className="alert success"><Icon name="flag" size={18} />{t('fiche.frozen', { d: day(bilan.fige_le, lang) })}</div>
      )}

      {ind && (
        <>
          <h2 className="section-title"><span className="kpi-icon green sm"><Icon name="chart" size={18} /></span>{bilan ? t('fiche.report') : t('fiche.indicators')}</h2>
          <div className="facts big">
            <Fact label={t('fiche.mortality')} value={`${n(ind.morts)} (${n(ind.taux_mortalite, 1)} %)`} tone={Number(ind.taux_mortalite) > 5 ? 'bad' : ''} />
            <Fact label={t('ferme.sold')} value={n(ind.poulets_vendus)} />
            <Fact label={t('dashboard.weight')} value={ind.poids_moyen_g ? `${n(ind.poids_moyen_g)} g` : '—'} />
            <Fact label={t('fiche.gmq')} value={ind.gmq_g_jour ? `${n(ind.gmq_g_jour, 1)} g/j` : '—'} />
            <Fact label={t('fiche.feed')} value={`${n(ind.aliment_kg)} kg`} />
            <Fact label="FCR" value={n(ind.fcr, 2)} hint={t('fiche.fcrHint')} />
            <Fact label={t('fiche.duration')} value={t('dashboard.days', { n: ind.duree_jours })} />
            <Fact label={t('fiche.liveWeight')} value={`${n(ind.poids_vif_kg)} kg`} />
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
            <div className="facts">
              <Fact label={t('fiche.costPerBird')} value={ind.cout_par_poulet_vendu ? money(ind.cout_par_poulet_vendu, lang) : '—'} />
              <Fact label={t('fiche.costPerKg')} value={ind.cout_par_kg ? money(ind.cout_par_kg, lang) : '—'} />
              <Fact label={t('fiche.avgPrice')} value={ind.prix_moyen_poulet ? money(ind.prix_moyen_poulet, lang) : '—'} />
            </div>
            {!bilan && <p className="note"><Icon name="clock" size={16} />{t('fiche.liveNote')}</p>}
          </Panel>
        </>
      )}

      {pesees.length > 1 && (
        <Panel icon="scale" tone="yolk" title={t('fiche.growth')}>
          <WeightCurve points={pesees.map((p) => ({ date: p.date_pesee, value: Number(p.poids_moyen_g) }))} lang={lang} />
        </Panel>
      )}

      <Panel icon="clock" tone="sky" title={t('fiche.history')}>
        <Timeline events={events} lang={lang} />
      </Panel>
    </div>
  )
}
