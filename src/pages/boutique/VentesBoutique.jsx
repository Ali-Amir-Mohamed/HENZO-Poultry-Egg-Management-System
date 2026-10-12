import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { day, Empty, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Shop sales: receipt for each sale; only the director cancels (stock and cash put back)
export default function VentesBoutique({ boutique }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => must(await supabase.from('ventes_boutique').select('*').eq('boutique_id', boutique.id)
    .order('created_at', { ascending: false }).limit(60)), [boutique.id])

  const annuler = async (v) => {
    const motif = await ask.reason(t('argent.cancelSaleTitle', { n: money(v.montant, lang) }))
    if (motif) await run(supabase.from('ventes_boutique').update({ annulee: true, motif_annulation: motif }).eq('id', v.id), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const actives = q.data.filter((v) => !v.annulee)
  const today = new Date().toLocaleDateString('en-CA')
  const jour = actives.filter((v) => v.date_vente === today).reduce((a, v) => a + Number(v.montant), 0)
  const quantite = (v) => v.produit === 'oeufs'
    ? `${Number(v.quantite).toLocaleString(lang)} ${t(`unites.${v.unite}`)}`
    : `${v.nombre_sujets} ${t('boutique.birdsShort')}${v.unite === 'kg' ? ` · ${Number(v.quantite).toLocaleString(lang)} kg` : ''}`

  return (
    <Panel icon="receipt" tone="green" title={t('boutique.salesTitle')} subtitle={t('boutique.todayTotal', { n: money(jour, lang) })}>
      {q.data.length === 0 ? <Empty icon="cart" text={t('argent.noSales')} /> : (
        <ul className="list">
          {q.data.map((v) => (
            <li key={v.id} className={v.annulee ? 'cancelled' : ''}>
              <div className="grow">
                <strong>{t(`boutique.produits.${v.produit}`)}{v.forme ? ` ${t(`boutique.formes.${v.forme}`).toLowerCase()}` : ''} · {quantite(v)}</strong>
                <div className="muted small">{day(v.date_vente, lang)} · {t(`modes.${v.mode_paiement}`)}{v.client_nom ? ` · ${v.client_nom}` : ''}</div>
                {v.annulee && <div className="error small">{t('argent.cancelled')} : {v.motif_annulation}</div>}
                {!v.annulee && (
                  <div className="row-actions">
                    <Link to={`/recu-boutique/${v.id}`} className="btn ghost sm"><Icon name="receipt" size={14} />{t('recu.open')}</Link>
                    {can(role, 'annuler') && <button className="btn ghost sm" onClick={() => annuler(v)}>{t('argent.cancel')}</button>}
                  </div>
                )}
              </div>
              <strong>{money(v.montant, lang)}</strong>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
