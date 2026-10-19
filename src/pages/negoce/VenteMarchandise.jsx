import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { MODES_PAIEMENT, TABLES } from '../../config'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { Field, Loading, money } from '../../components/ui'
import BoutonFacture from '../../components/BoutonFacture'
import { clientConnu, idClient } from '../../lib/clients'

// HENZO AGRO: sell goods from stock (chicks, feed, medicines) to a farmer or to a group company.
// Several products in one sale, plus a delivery fee when the goods are taken to the farmer: one invoice for the whole sale.
// A sale to a group company is always on credit: it becomes a delivery to receive there, and is paid from there.
// The client is typed by name: a known one is recognised, a new one is registered on the spot.
const ligneVide = () => ({ article_id: '', quantite: '', prix: '' })

export default function VenteMarchandise({ onVendu }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ref = useQuery(async () => {
    const [articles, clients, notes] = await Promise.all([
      supabase.from('stock_articles').select('article_id, nom, categorie, unite, stock').eq('actif', true).order('nom'),
      supabase.from(TABLES.tiers).select('id, nom, ferme_liee_id, credit_autorise').neq('type_tiers', 'fournisseur').order('nom'),
      supabase.from('confiance_clients').select('client_id, note, delai_moyen')
    ])
    return { articles: must(articles), clients: must(clients), notes: Object.fromEntries((notes.data ?? []).map((n) => [n.client_id, n])) }
  })
  const vide = { client_nom: '', telephone: '', paiement: 'especes', acompte: '', livrer: false, frais: '', date_vente: localDate() }
  const [form, setForm] = useState(vide)
  const [lignes, setLignes] = useState([ligneVide()])
  const [etat, setEtat] = useState(null)
  const set = (k) => (e) => { setEtat(null); setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }) }
  const setLigne = (i, k) => (e) => { setEtat(null); setLignes(lignes.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l))) }

  if (!ref.data) return <Loading error={ref.error} />
  const client = clientConnu(form.client_nom, ref.data.clients)
  const nouveau = !!form.client_nom.trim() && !client
  const groupe = !!client?.ferme_liee_id
  const credit = groupe || form.paiement === 'credit'
  const frais = !groupe && form.livrer ? Number(form.frais) || 0 : 0
  const sousTotal = lignes.reduce((s, l) => s + Math.round((Number(l.quantite) || 0) * (Number(l.prix) || 0)), 0)
  const total = sousTotal + frais
  const article = (id) => ref.data.articles.find((a) => a.article_id === id)

  const vendre = async (e) => {
    e.preventDefault()
    setEtat({ busy: true })
    let clientId
    try { clientId = await idClient(form.client_nom, form.telephone, ref.data.clients) } catch (err) { return setEtat({ error: err.message }) }
    const { data, error } = await supabase.rpc('vendre_marchandises', {
      p_client: clientId,
      p_lignes: lignes.filter((l) => l.article_id).map((l) => ({ article_id: l.article_id, quantite: Number(l.quantite), prix: Number(l.prix) })),
      p_livraison: frais, p_mode: credit ? (form.paiement === 'credit' ? 'especes' : form.paiement) : form.paiement,
      p_a_credit: credit, p_acompte: credit && !groupe ? Number(form.acompte) || 0 : 0, p_date: form.date_vente
    })
    if (error) return setEtat({ error: error.message })
    setEtat({ ok: data, total, groupe })
    setForm({ ...vide, client_nom: form.client_nom, date_vente: form.date_vente })
    setLignes([ligneVide()])
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
          <input list="clients-negoce" value={form.client_nom} onChange={set('client_nom')} placeholder={t('negoce.clientPh')} autoComplete="off" />
          <datalist id="clients-negoce">{ref.data.clients.map((c) => <option key={c.id} value={c.nom}>{c.ferme_liee_id ? t('negoce.group') : ''}</option>)}</datalist>
        </Field>
        {nouveau ? <Field label={t('negoce.newClientPhone')}><input type="tel" value={form.telephone} onChange={set('telephone')} /></Field>
          : <Field label={t('saisie.date')}><input type="date" required value={form.date_vente} onChange={set('date_vente')} /></Field>}
      </div>

      {lignes.map((l, i) => {
        const a = article(l.article_id)
        return (
          <div key={i} className="vente-ligne">
            <Field label={i === 0 ? t('negoce.product') : ''}>
              <select required value={l.article_id} onChange={setLigne(i, 'article_id')}>
                <option value="">—</option>
                {ref.data.articles.map((x) => <option key={x.article_id} value={x.article_id} disabled={Number(x.stock) <= 0}>
                  {x.nom} ({Number(x.stock).toLocaleString(lang)} {t(`unites.${x.unite}`)})</option>)}
              </select>
            </Field>
            <Field label={i === 0 ? t('recu.qty') : ''}>
              <input type="number" inputMode="decimal" min="0.01" step="0.01" max={a ? Number(a.stock) : undefined} required value={l.quantite} onChange={setLigne(i, 'quantite')}
                placeholder={a ? t(`unites.${a.unite}`) : ''} />
            </Field>
            <Field label={i === 0 ? t('compta.fact.unitPrice') : ''}>
              <input type="number" inputMode="numeric" min="0" required value={l.prix} onChange={setLigne(i, 'prix')} />
            </Field>
            {lignes.length > 1
              ? <button type="button" className="icon-btn dark" onClick={() => setLignes(lignes.filter((_, j) => j !== i))} aria-label={t('stock.remove')}><Icon name="trash" size={16} /></button>
              : <span />}
          </div>
        )
      })}
      <button type="button" className="btn ghost sm" onClick={() => setLignes([...lignes, ligneVide()])}><Icon name="plus" size={14} />{t('negoce.addProduct')}</button>

      <div className="grid-2">
        {nouveau && <Field label={t('saisie.date')}><input type="date" required value={form.date_vente} onChange={set('date_vente')} /></Field>}
        {!groupe && (
          <label className="check-line"><input type="checkbox" checked={form.livrer} onChange={set('livrer')} /><span>{t('negoce.deliver')}</span></label>
        )}
        {!groupe && form.livrer && (
          <Field label={t('negoce.deliveryFee')}><input type="number" inputMode="numeric" min="0" required value={form.frais} onChange={set('frais')} /></Field>
        )}
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
      {nouveau && <p className="note"><Icon name="users" size={16} />{t('negoce.newClient', { nom: form.client_nom.trim() })}</p>}
      {client && form.paiement === 'credit' && ['C', 'D'].includes(ref.data.notes[client.id]?.note) && (
        <div className={`alert ${ref.data.notes[client.id].note === 'D' ? 'danger' : 'warn'}`}><Icon name="alert" size={16} />{t(`confiance.saleWarn.${ref.data.notes[client.id].note}`, { nom: client.nom })}</div>
      )}
      {frais > 0 && <p className="muted small">{t('negoce.subtotal', { produits: money(sousTotal, lang), frais: money(frais, lang) })}</p>}
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
