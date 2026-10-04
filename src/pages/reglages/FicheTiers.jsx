import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import Icon from '../../components/Icon'
import { day, Loading, money, Panel } from '../../components/ui'
import { Timeline } from '../../components/fiche'

// Customer / supplier file: contact, credit, full history of sales, purchases and payments
export default function FicheTiers() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage

  const q = useQuery(async () => {
    const [tiers, ventes, depenses, creances, dettes, bandes, lots] = await Promise.all([
      supabase.from('tiers').select('*').eq('id', id).single(),
      supabase.from('ventes').select('id, date_vente, produit, unite, quantite, montant, montant_encaisse, a_credit, annulee, paiements:paiements_clients(id, date_paiement, montant, mode_paiement), bande:bandes(code), lot:lots_pondeuses(code)').eq('client_id', id),
      supabase.from('depenses').select('id, date_depense, libelle, montant, montant_paye, a_credit, annulee, statut, paiements:paiements_fournisseurs(id, date_paiement, montant, mode_paiement)').eq('fournisseur_id', id),
      supabase.from('creances_clients').select('reste, en_retard').eq('client_id', id),
      supabase.from('dettes_fournisseurs').select('reste, en_retard').eq('fournisseur_id', id),
      supabase.from('bandes').select('id, code, date_arrivee, nombre_initial').eq('fournisseur_id', id),
      supabase.from('lots_pondeuses').select('id, code, date_arrivee, effectif_initial').eq('fournisseur_id', id)
    ])
    return {
      tiers: must(tiers), ventes: must(ventes), depenses: must(depenses), creances: must(creances),
      dettes: must(dettes), bandes: must(bandes), lots: must(lots)
    }
  }, [id])

  if (!q.data) return <Loading error={q.error} />
  const { tiers, ventes, depenses, creances, dettes, bandes, lots } = q.data
  const actives = (rows) => rows.filter((r) => !r.annulee && r.statut !== 'rejetee')
  const totalVentes = actives(ventes).reduce((s, v) => s + Number(v.montant), 0)
  const totalAchats = actives(depenses).reduce((s, d) => s + Number(d.montant), 0)
  const reste = creances.reduce((s, c) => s + Number(c.reste), 0)
  const dette = dettes.reduce((s, d) => s + Number(d.reste), 0)

  const events = [
    ...ventes.map((v) => ({ date: v.date_vente, icon: 'cart', tone: 'green', cancelled: v.annulee,
      text: `${t('fiche.ev.sale', { n: Number(v.quantite).toLocaleString(lang), produit: t(`produits.${v.produit}`) })} · ${money(v.montant, lang)}${v.a_credit ? ` · ${t('modes.credit')}` : ''} · ${v.bande?.code ?? v.lot?.code ?? ''}` })),
    ...ventes.flatMap((v) => v.paiements.map((p) => ({ date: p.date_paiement, icon: 'wallet', tone: 'sky', text: `${t('natures.encaissement_creance')} · ${money(p.montant, lang)} · ${t(`modes.${p.mode_paiement}`)}` }))),
    ...depenses.map((d) => ({ date: d.date_depense, icon: 'receipt', tone: 'rose', cancelled: d.annulee || d.statut === 'rejetee',
      text: `${d.libelle} · ${money(d.montant, lang)}${d.a_credit ? ` · ${t('argent.supplierCredit')}` : ''}` })),
    ...depenses.flatMap((d) => d.paiements.map((p) => ({ date: p.date_paiement, icon: 'wallet', tone: 'sky', text: `${t('natures.paiement_fournisseur')} · ${money(p.montant, lang)} · ${t(`modes.${p.mode_paiement}`)}` }))),
    ...bandes.map((b) => ({ date: b.date_arrivee, icon: 'drumstick', tone: 'yolk', text: t('tiers.suppliedFlock', { code: b.code, n: b.nombre_initial }) })),
    ...lots.map((l) => ({ date: l.date_arrivee, icon: 'egg', tone: 'yolk', text: t('tiers.suppliedFlock', { code: l.code, n: l.effectif_initial }) }))
  ]

  return (
    <div className="stack">
      <Link to="/reglages" className="back"><Icon name="chevron" size={16} className="flip" />{t('tiers.back')}</Link>
      <section className="hero compact">
        <div>
          <p className="hero-date">{t(`tiersTypes.${tiers.type_tiers}`)}{tiers.telephone ? ` · ${tiers.telephone}` : ''}{tiers.adresse ? ` · ${tiers.adresse}` : ''}</p>
          <h1>{tiers.nom}</h1>
          {tiers.credit_autorise && <span className="chip">{t('reglages.creditUpTo', { n: money(tiers.plafond_credit, lang) })}</span>}
        </div>
      </section>

      <div className="facts big">
        {ventes.length > 0 && <div className="fact"><span>{t('tiers.totalSales')}</span><strong>{money(totalVentes, lang)}</strong></div>}
        {ventes.length > 0 && <div className={`fact ${reste > 0 ? 'bad' : ''}`}><span>{t('tiers.owesUs')}</span><strong>{money(reste, lang)}</strong></div>}
        {depenses.length > 0 && <div className="fact"><span>{t('tiers.totalPurchases')}</span><strong>{money(totalAchats, lang)}</strong></div>}
        {depenses.length > 0 && <div className={`fact ${dette > 0 ? 'bad' : ''}`}><span>{t('tiers.weOwe')}</span><strong>{money(dette, lang)}</strong></div>}
        <div className="fact"><span>{t('tiers.operations')}</span><strong>{ventes.length + depenses.length}</strong></div>
        {(creances.some((c) => c.en_retard) || dettes.some((d) => d.en_retard)) && <div className="fact bad"><span>{t('argent.late')}</span><strong>!</strong></div>}
      </div>

      <Panel icon="clock" tone="sky" title={t('fiche.history')}>
        {events.length === 0 ? <p className="muted">{t('tiers.noHistory')}</p> : <Timeline events={events} lang={lang} />}
      </Panel>
      <p className="muted small">{t('tiers.since', { d: day(tiers.created_at, lang) })}</p>
    </div>
  )
}
