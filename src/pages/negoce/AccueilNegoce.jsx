import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, TABLES } from '../../config'
import Icon from '../../components/Icon'
import { day, Empty, Loading, money, Panel } from '../../components/ui'
import VenteMarchandise from './VenteMarchandise'
import LivraisonsGroupe from '../stock/LivraisonsGroupe'

// HENZO AGRO home: sell, the next chick deliveries, the stock left, the day's sales and the deliveries to group companies.
export default function AccueilNegoce() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { profile, role } = useAuth()
  const aujourdhui = new Date().toLocaleDateString('en-CA')
  const q = useQuery(async () => {
    const [stock, ventes, commandes] = await Promise.all([
      supabase.from('stock_articles').select('article_id, nom, categorie, unite, stock, seuil_minimum').eq('actif', true).order('nom'),
      supabase.from(TABLES.ventes).select('id, date_vente, quantite, unite, montant, a_credit, annulee, client:tiers(nom), article:articles(nom)')
        .eq('produit', 'marchandise').order('created_at', { ascending: false }).limit(15),
      supabase.from('commandes_eleveurs_situation').select('id, client_nom, quantite, souche, date_livraison, type_vente').eq('statut', 'en_cours').order('date_livraison').limit(5)
    ])
    return { stock: must(stock), ventes: must(ventes), commandes: commandes.error ? [] : commandes.data }
  })
  const prenom = (profile?.nom_complet || '').split(' ')[0]
  const jour = (q.data?.ventes ?? []).filter((v) => !v.annulee && v.date_vente === aujourdhui).reduce((s, v) => s + Number(v.montant), 0)

  return (
    <div className="stack">
      <section className="hero negoce">
        <div>
          <p className="hero-date">{new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{t('dashboard.welcome', { name: prenom })}</h1>
          <span className="chip">{profile?.ferme?.nom} · {t('systeme.negoce')}</span>
        </div>
      </section>

      {can(role, 'vente.marchandise') && <VenteMarchandise onVendu={q.reload} />}

      {!q.data ? <Loading error={q.error} /> : (
        <>
          {q.data.commandes.length > 0 && (
            <Panel icon="calendar" tone="sky" title={t('negoce.ordersTitle')} actions={<Link to="/commandes" className="btn ghost sm">{t('negoce.allOrders')}</Link>}>
              <ul className="list">
                {q.data.commandes.map((c) => (
                  <li key={c.id}>
                    <div className="grow"><strong>{c.client_nom}</strong><div className="muted small">{day(c.date_livraison, lang)} · {t(`commandes.type.${c.type_vente}`)}</div></div>
                    <span className="tag">{Number(c.quantite).toLocaleString(lang)} {t('commandes.chicks')}{c.souche ? ` ${c.souche}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel icon="box" tone="green" title={t('negoce.stockTitle')} actions={<Link to="/stock" className="btn ghost sm">{t('negoce.manageStock')}</Link>}>
            {q.data.stock.length === 0 ? <Empty icon="box" text={t('negoce.noStock')} /> : (
              <ul className="list">
                {q.data.stock.map((a) => (
                  <li key={a.article_id}>
                    <div className="grow"><strong>{a.nom}</strong><div className="muted small">{t(`articleCategories.${a.categorie}`)}</div></div>
                    <span className={`tag ${Number(a.stock) <= Number(a.seuil_minimum) ? 'warn' : 'ok'}`}>{Number(a.stock).toLocaleString(lang)} {t(`unites.${a.unite}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel icon="receipt" tone="yolk" title={t('negoce.salesTitle')} subtitle={t('negoce.today', { n: money(jour, lang) })}>
            {q.data.ventes.length === 0 ? <Empty icon="cart" text={t('argent.noSales')} /> : (
              <ul className="list">
                {q.data.ventes.map((v) => (
                  <li key={v.id} className={v.annulee ? 'cancelled' : ''}>
                    <div className="grow">
                      <strong>{v.article?.nom}</strong> · {Number(v.quantite).toLocaleString(lang)} {t(`unites.${v.unite}`)}
                      <div className="muted small">{day(v.date_vente, lang)} · {v.client?.nom ?? t('negoce.walkIn')}{v.a_credit ? ` · ${t('modes.credit')}` : ''}</div>
                    </div>
                    <Link to={`/recu/${v.id}`} className="btn ghost sm"><Icon name="receipt" size={14} /></Link>
                    <strong>{money(v.montant, lang)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
      <LivraisonsGroupe />
    </div>
  )
}
