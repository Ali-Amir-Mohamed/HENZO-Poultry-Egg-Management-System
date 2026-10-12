import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import Icon from '../../components/Icon'
import { Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'
import { PRODUITS_BOUTIQUE } from './data'

// Shop stock (chickens and laying hens in birds, eggs in eggs), losses and stock counts
export default function StockBoutique({ boutique }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const agir = ['vendeur', 'directeur', 'exploitation'].includes(role)
  const q = useQuery(async () => {
    const [stock, mouv, ferme] = await Promise.all([
      supabase.from('stock_boutiques').select('produit, stock').eq('boutique_id', boutique.id),
      supabase.from('mouvements_stock_boutique').select('*').eq('boutique_id', boutique.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('boutiques').select('ferme:fermes(oeufs_par_plateau)').eq('id', boutique.id).maybeSingle()
    ])
    return { stock: Object.fromEntries(must(stock).map((s) => [s.produit, s.stock])), mouv: must(mouv), opp: ferme.data?.ferme?.oeufs_par_plateau ?? 30 }
  }, [boutique.id])
  const n = (v) => Number(v ?? 0).toLocaleString(lang)
  const unite = (p) => (p === 'oeufs' ? t('oeufs.eggs') : t('boutique.birdsShort'))

  const perte = async (p) => {
    const v = await ask.form({ title: t('boutique.lossTitle', { produit: t(`boutique.produits.${p}`) }), icon: 'alert', submit: t('boutique.lossSave'),
      message: p === 'oeufs' ? t('boutique.lossHintEggs') : t('boutique.lossHintBirds'),
      fields: [{ name: 'q', label: t('boutique.lossQty', { unite: unite(p) }), type: 'number', min: 1, max: q.data.stock[p] ?? 0, required: true },
               { name: 'motif', label: t('salaires.reason'), type: 'text', required: true, placeholder: p === 'oeufs' ? t('boutique.lossPhEggs') : t('boutique.lossPhBirds') }] })
    if (v) await run(supabase.rpc('declarer_perte_boutique', { p_boutique: boutique.id, p_produit: p, p_quantite: v.q, p_motif: v.motif }), q.reload)
  }
  const inventaire = async (p) => {
    const v = await ask.form({ title: t('boutique.countTitle', { produit: t(`boutique.produits.${p}`) }), icon: 'box', submit: t('dialog.save'),
      message: t('boutique.countHint', { n: n(q.data.stock[p]), unite: unite(p) }),
      fields: [{ name: 'c', label: t('boutique.counted', { unite: unite(p) }), type: 'number', min: 0, required: true }] })
    if (!v) return
    const res = await run(supabase.rpc('inventaire_boutique', { p_boutique: boutique.id, p_produit: p, p_compte: v.c }), q.reload)
    if (res !== null && res !== undefined && typeof res !== 'boolean' && Number(res) !== 0) await ask.info(t('boutique.countDone'), t('boutique.countGap', { n: n(res) }))
  }

  if (!q.data) return <Loading error={q.error} />
  return (
    <>
      <div className="cards">
        {PRODUITS_BOUTIQUE.map((p) => (
          <article key={p} className="card-item">
            <header><strong>{t(`boutique.produits.${p}`)}</strong></header>
            <div className="stock-level"><strong>{n(q.data.stock[p])}</strong><span>{unite(p)}</span>
              {p === 'oeufs' && q.data.stock[p] > 0 && <span className="muted">≈ {n(Math.floor(q.data.stock[p] / q.data.opp))} {t('unites.plateau')}</span>}
            </div>
            {agir && (
              <footer>
                <button className="btn ghost sm" onClick={() => perte(p)} disabled={!q.data.stock[p]}><Icon name="alert" size={14} />{t('boutique.loss')}</button>
                <button className="btn ghost sm" onClick={() => inventaire(p)}><Icon name="box" size={14} />{t('boutique.count')}</button>
              </footer>
            )}
          </article>
        ))}
      </div>
      <Panel icon="clock" tone="sky" title={t('boutique.stockHistory')}>
        {q.data.mouv.length === 0 ? <p className="muted">{t('boutique.noMoves')}</p> : (
          <ul className="list">
            {q.data.mouv.map((m) => (
              <li key={m.id}>
                <div className="grow">
                  <strong>{t(`boutique.mouv.${m.type_mouvement}`)} · {t(`boutique.produits.${m.produit}`)}</strong>
                  <div className="muted small">{new Date(m.created_at).toLocaleString(lang)}{m.motif ? ` · ${m.motif}` : ''}</div>
                </div>
                <strong className={m.quantite < 0 ? 'error' : 'success'}>{m.quantite > 0 ? '+' : ''}{n(m.quantite)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
