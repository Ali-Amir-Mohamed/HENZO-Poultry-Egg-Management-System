import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useQuery } from '../../hooks'
import { db } from '../../lib/offlineQueue'
import Icon, { Logo } from '../../components/Icon'
import { day, Loading, money } from '../../components/ui'
import { readRefBoutique } from './data'
import BoutonFacture from '../../components/BoutonFacture'

// Receipt of a shop sale (printable, WhatsApp); also works for a sale not sent yet (offline)
export default function RecuBoutique() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const q = useQuery(async () => {
    if (navigator.onLine) {
      const { data, error } = await supabase.from('ventes_boutique').select('*, boutique:boutiques(nom, adresse, telephone, ferme:fermes(nom))').eq('id', id).maybeSingle()
      if (data) return { v: data, boutique: data.boutique?.nom, ferme: data.boutique?.ferme?.nom, adresse: data.boutique?.adresse, tel: data.boutique?.telephone }
      if (error && !/fetch/i.test(error.message)) throw error
    }
    const item = (await db.outbox.where('table').equals('ventes_boutique').toArray()).find((x) => x.row.id === id)
    if (!item) throw new Error(t('recu.notFound'))
    const ref = readRefBoutique(item.row.boutique_id)
    return { v: item.row, boutique: ref?.nom, ferme: ref?.ferme, pending: true }
  }, [id])

  if (!q.data) return <Loading error={q.error} />
  const { v } = q.data
  const numero = v.id.slice(0, 8).toUpperCase()
  const article = `${t(`boutique.produits.${v.produit}`)}${v.forme ? ` ${t(`boutique.formes.${v.forme}`).toLowerCase()}` : ''}`
  const qte = v.produit === 'oeufs' ? `${Number(v.quantite).toLocaleString(lang)} ${t(`unites.${v.unite}`)}`
    : `${v.nombre_sujets} ${t('boutique.birdsShort')}${v.unite === 'kg' ? ` (${Number(v.quantite).toLocaleString(lang)} kg)` : ''}`
  const entete = [q.data.boutique, q.data.ferme].filter(Boolean).join(' – ')
  const texte = [`*${entete || 'HENZO'}* – ${t('recu.title')} n° ${numero}`, `${t('recu.date')} : ${day(v.date_vente, lang)}`,
    v.client_nom ? `${t('recu.client')} : ${v.client_nom}` : null, `${article} : ${qte} × ${money(v.prix_unitaire, lang)}`,
    `*${t('recu.total')} : ${money(v.montant, lang)}* (${t(`modes.${v.mode_paiement}`)})`, t('recu.thanks')].filter(Boolean).join('\n')
  const tel = (v.client_telephone ?? '').replace(/\D/g, '')
  const whatsapp = `https://wa.me/${tel.length === 9 ? `237${tel}` : tel}?text=${encodeURIComponent(texte)}`

  return (
    <div className="stack">
      <button className="back no-print" onClick={() => navigate(-1)}><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</button>
      <article className={`receipt ${v.annulee ? 'cancelled' : ''}`}>
        <header>
          <Logo size={42} />
          <div><strong>{q.data.boutique || 'HENZO'}</strong><small>{q.data.ferme}{q.data.adresse ? ` · ${q.data.adresse}` : ''}</small><small>{t('recu.title')} n° {numero}</small></div>
          <span className="spacer" /><span>{day(v.date_vente, lang)}</span>
        </header>
        {q.data.pending && <div className="alert warn no-print"><Icon name="cloud" size={16} />{t('recu.pending')}</div>}
        {v.annulee && <div className="alert danger"><Icon name="alert" size={16} />{t('argent.cancelled')} : {v.motif_annulation}</div>}
        {v.client_nom && <p><span className="muted">{t('recu.client')} :</span> <strong>{v.client_nom}</strong></p>}
        <table className="table">
          <thead><tr><th>{t('recu.item')}</th><th>{t('recu.qty')}</th><th>{t('recu.price')}</th><th>{t('recu.amount')}</th></tr></thead>
          <tbody><tr><td>{article}</td><td>{qte}</td><td>{money(v.prix_unitaire, lang)}</td><td>{money(v.montant, lang)}</td></tr></tbody>
        </table>
        <dl className="receipt-totals">
          <div className="main"><dt>{t('recu.total')}</dt><dd>{money(v.montant, lang)}</dd></div>
          <div><dt>{t('recu.paid')} ({t(`modes.${v.mode_paiement}`)})</dt><dd>{money(v.montant, lang)}</dd></div>
        </dl>
        <p className="muted small center">{t('recu.thanks')}</p>
      </article>
      {!v.annulee && (
        <>
        <BoutonFacture venteBoutique={v.id} enAttente={q.data.pending} big />
        <div className="row no-print">
          <button className="btn primary" onClick={() => window.print()}><Icon name="download" size={16} />{t('recu.print')}</button>
          <a className="btn ghost" href={whatsapp} target="_blank" rel="noreferrer"><Icon name="users" size={16} />{t('recu.whatsapp')}</a>
        </div>
        </>
      )}
    </div>
  )
}
