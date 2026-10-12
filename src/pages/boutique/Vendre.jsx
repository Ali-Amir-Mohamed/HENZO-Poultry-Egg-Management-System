import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { enqueue } from '../../lib/offlineQueue'
import Icon from '../../components/Icon'
import { money } from '../../components/ui'
import { deduireStock, FORMES, loadRefBoutique, prixDe, PRODUITS_BOUTIQUE, readRefBoutique } from './data'

// Sale in a shop: fixed price (shown, never typed), cash or Mobile Money, works offline.
// The database checks the price and the stock again when the sale is sent.
const vide = { produit: 'poulet', forme: 'vivant', unite: 'piece', nombre: '', quantite: '', mode: 'especes', client_nom: '', client_telephone: '' }

export default function Vendre({ boutique }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [ref, setRef] = useState(() => readRefBoutique(boutique.id))
  const [form, setForm] = useState(vide)
  const [faite, setFaite] = useState(null)
  const [erreur, setErreur] = useState(null)
  useEffect(() => { loadRefBoutique(boutique.id).then(setRef) }, [boutique.id])
  const set = (k) => (e) => { setFaite(null); setErreur(null); setForm({ ...form, [k]: e.target.value }) }

  const oeufs = form.produit === 'oeufs'
  const unites = oeufs ? ['piece', 'plateau'] : ['piece', 'kg']
  const unite = unites.includes(form.unite) ? form.unite : unites[0]
  const forme = form.produit === 'poule_reformee' ? 'vivant' : form.forme
  const prix = prixDe(ref, form.produit, forme, unite)
  const nombre = Number(form.nombre) || 0
  const quantite = oeufs || unite === 'kg' ? Number(form.quantite) || 0 : nombre
  const total = prix ? Math.round(quantite * prix) : 0
  const besoin = oeufs ? Math.ceil(quantite * (unite === 'plateau' ? ref?.opp ?? 30 : 1)) : nombre
  const stock = ref?.stock?.[form.produit] ?? 0
  const fmt = (n) => Number(n).toLocaleString(lang)

  const vendre = async (e) => {
    e.preventDefault()
    if (!prix) return setErreur(t('boutique.noPrice'))
    if (besoin <= 0 || quantite <= 0) return setErreur(t('boutique.noQuantity'))
    if (besoin > stock) return setErreur(t('boutique.notEnough', { n: fmt(stock) }))
    const row = await enqueue('ventes_boutique', {
      boutique_id: boutique.id, produit: form.produit, forme: oeufs ? null : forme, unite, quantite,
      nombre_sujets: oeufs ? null : nombre, prix_unitaire: prix, montant: total, mode_paiement: form.mode,
      client_nom: form.client_nom.trim() || null, client_telephone: form.client_telephone.trim() || null,
      date_vente: new Date().toLocaleDateString('en-CA')
    })
    deduireStock(boutique.id, form.produit, besoin)
    setRef(readRefBoutique(boutique.id))
    setFaite({ id: row.id, total })
    setForm({ ...vide, produit: form.produit, forme: form.forme, unite: form.unite, mode: form.mode })
  }

  if (!ref) return <p className="muted">{navigator.onLine ? t('common.loading') : t('boutique.offlineNoData')}</p>
  return (
    <form className="panel form" onSubmit={vendre}>
      <div className="panel-head">
        <span className="kpi-icon green"><Icon name="cart" size={22} /></span>
        <div><h2>{t('boutique.sellTitle')}</h2><p className="muted">{t('boutique.sellHint')}</p></div>
      </div>

      <div className="segmented small">
        {PRODUITS_BOUTIQUE.map((p) => (
          <button key={p} type="button" className={form.produit === p ? 'active' : ''} onClick={() => setForm({ ...form, produit: p, unite: p === 'oeufs' ? 'plateau' : 'piece' })}>
            {t(`boutique.produits.${p}`)} <small>({fmt(ref.stock?.[p] ?? 0)})</small>
          </button>
        ))}
      </div>

      {form.produit === 'poulet' && (
        <div className="segmented small">
          {FORMES.map((f) => <button key={f} type="button" className={forme === f ? 'active' : ''} onClick={() => setForm({ ...form, forme: f })}>{t(`boutique.formes.${f}`)}</button>)}
        </div>
      )}

      <div className="grid-2">
        <label className="field"><span>{t('saisie.unite')}</span>
          <select value={unite} onChange={set('unite')}>{unites.map((u) => <option key={u} value={u}>{t(`unites.${u}`)}</option>)}</select>
        </label>
        {!oeufs && (
          <label className="field big"><span>{t('boutique.birds')}</span>
            <input type="number" inputMode="numeric" min="1" required value={form.nombre} onChange={set('nombre')} placeholder="0" />
          </label>
        )}
        {(oeufs || unite === 'kg') && (
          <label className="field big"><span>{oeufs ? t(`boutique.qty.${unite}`) : t('boutique.weight')}</span>
            <input type="number" inputMode="decimal" min="0.01" step={oeufs && unite === 'piece' ? '1' : '0.01'} required value={form.quantite} onChange={set('quantite')} placeholder="0" />
          </label>
        )}
      </div>

      <div className="total-box">
        <span>{prix ? t('boutique.priceLine', { prix: money(prix, lang), unite: t(`unites.${unite}`) }) : t('boutique.noPrice')}</span>
        <strong>{money(total, lang)}</strong>
      </div>

      <div className="field">
        <span>{t('saisie.paiement')}</span>
        <div className="segmented small">
          {['especes', 'mobile_money'].map((m) => <button key={m} type="button" className={form.mode === m ? 'active' : ''} onClick={() => setForm({ ...form, mode: m })}>{t(`modes.${m}`)}</button>)}
        </div>
      </div>
      <div className="grid-2">
        <label className="field"><span>{t('boutique.clientName')}</span><input value={form.client_nom} onChange={set('client_nom')} /></label>
        <label className="field"><span>{t('reglages.phone')}</span><input type="tel" value={form.client_telephone} onChange={set('client_telephone')} /></label>
      </div>

      {erreur && <div className="alert danger"><Icon name="alert" size={18} />{erreur}</div>}
      {faite && (
        <div className="alert success"><Icon name="check" size={18} />{t('boutique.sold', { n: money(faite.total, lang) })}
          <Link to={`/recu-boutique/${faite.id}`} className="btn ghost sm" style={{ marginLeft: 'auto' }}><Icon name="receipt" size={14} />{t('recu.open')}</Link>
        </div>
      )}
      <button type="submit" className="btn primary block" disabled={!prix}><Icon name="check" size={18} />{t('boutique.sell')}</button>
      <p className="note"><Icon name="cloud" size={16} />{t('boutique.offlineHint')}</p>
    </form>
  )
}
