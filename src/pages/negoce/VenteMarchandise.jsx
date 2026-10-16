import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { MODES_PAIEMENT, TABLES } from '../../config'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { Field, Loading, money } from '../../components/ui'
import BoutonFacture from '../../components/BoutonFacture'

// HENZO AGRO: sell goods from stock (chicks, feed, medicines) to a farmer or to a group company.
// A sale to a group company is always on credit: it becomes a delivery to receive there, and is paid from there.
export default function VenteMarchandise({ onVendu }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ref = useQuery(async () => {
    const [articles, clients] = await Promise.all([
      supabase.from('stock_articles').select('article_id, nom, categorie, unite, stock').eq('actif', true).order('nom'),
      supabase.from(TABLES.tiers).select('id, nom, ferme_liee_id, credit_autorise').neq('type_tiers', 'fournisseur').order('nom')
    ])
    return { articles: must(articles), clients: must(clients) }
  })
  const vide = { client_id: '', article_id: '', quantite: '', prix_unitaire: '', paiement: 'especes', acompte: '', date_vente: localDate() }
  const [form, setForm] = useState(vide)
  const [etat, setEtat] = useState(null)
  const set = (k) => (e) => { setEtat(null); setForm({ ...form, [k]: e.target.value }) }

  if (!ref.data) return <Loading error={ref.error} />
  const article = ref.data.articles.find((a) => a.article_id === form.article_id)
  const client = ref.data.clients.find((c) => c.id === form.client_id)
  const groupe = !!client?.ferme_liee_id
  const total = Math.round((Number(form.quantite) || 0) * (Number(form.prix_unitaire) || 0))
  const credit = groupe || form.paiement === 'credit'

  const vendre = async (e) => {
    e.preventDefault()
    setEtat({ busy: true })
    const row = {
      client_id: form.client_id || null, produit: 'marchandise', article_id: form.article_id, unite: article?.unite ?? 'piece',
      quantite: Number(form.quantite), prix_unitaire: Number(form.prix_unitaire), date_vente: form.date_vente,
      a_credit: credit, mode_paiement: credit ? (Number(form.acompte) > 0 ? 'especes' : null) : form.paiement,
      montant_encaisse: credit ? Number(form.acompte) || 0 : 0
    }
    const { data, error } = await supabase.from(TABLES.ventes).insert(row).select('id').single()
    if (error) return setEtat({ error: error.message })
    setEtat({ ok: data.id, total, groupe })
    setForm({ ...vide, client_id: form.client_id, date_vente: form.date_vente })
    ref.reload()
    onVendu?.()
  }

  return (
    <form className="panel form" onSubmit={vendre}>
      <div className="panel-head">
        <span className="kpi-icon green"><Icon name="cart" size={22} /></span>
        <div><h2>{t('negoce.sellTitle')}</h2><p className="muted">{t('negoce.sellHint')}</p></div>
      </div>
      <div className="grid-2">
        <Field label={t('recu.client')}>
          <select value={form.client_id} onChange={set('client_id')}>
            <option value="">{t('negoce.walkIn')}</option>
            {ref.data.clients.map((c) => <option key={c.id} value={c.id}>{c.nom}{c.ferme_liee_id ? ` (${t('negoce.group')})` : ''}</option>)}
          </select>
        </Field>
        <Field label={t('negoce.product')}>
          <select required value={form.article_id} onChange={set('article_id')}>
            <option value="">—</option>
            {ref.data.articles.map((a) => <option key={a.article_id} value={a.article_id} disabled={Number(a.stock) <= 0}>
              {a.nom} ({Number(a.stock).toLocaleString(lang)} {t(`unites.${a.unite}`)})</option>)}
          </select>
        </Field>
        <Field label={article ? t('negoce.qtyIn', { unite: t(`unites.${article.unite}`) }) : t('recu.qty')}>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" max={article ? Number(article.stock) : undefined} required value={form.quantite} onChange={set('quantite')} />
        </Field>
        <Field label={t('compta.fact.unitPrice')}><input type="number" inputMode="numeric" min="0" required value={form.prix_unitaire} onChange={set('prix_unitaire')} /></Field>
        <Field label={t('saisie.date')}><input type="date" required value={form.date_vente} onChange={set('date_vente')} /></Field>
        {!groupe && (
          <Field label={t('saisie.paiement')}>
            <select value={form.paiement} onChange={set('paiement')}>
              {MODES_PAIEMENT.map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
              {client?.credit_autorise && <option value="credit">{t('modes.credit')}</option>}
            </select>
          </Field>
        )}
        {!groupe && form.paiement === 'credit' && (
          <Field label={t('negoce.deposit')}><input type="number" min="0" value={form.acompte} onChange={set('acompte')} /></Field>
        )}
      </div>
      {groupe && <p className="note"><Icon name="users" size={16} />{t('negoce.groupHint', { nom: client.nom })}</p>}
      <div className="total-box"><span>{credit ? t('negoce.onCredit') : t('negoce.cash')}</span><strong>{money(total, lang)}</strong></div>
      {etat?.error && <div className="alert danger"><Icon name="alert" size={18} />{etat.error}</div>}
      {etat?.ok && (
        <div className="alert success"><Icon name="check" size={18} />{etat.groupe ? t('negoce.soldGroup', { n: money(etat.total, lang) }) : t('negoce.sold', { n: money(etat.total, lang) })}
          <span style={{ marginLeft: 'auto' }}><BoutonFacture vente={etat.ok} /></span>
        </div>
      )}
      <button type="submit" className="btn primary block" disabled={etat?.busy}><Icon name="check" size={18} />{t('negoce.sell')}</button>
    </form>
  )
}
