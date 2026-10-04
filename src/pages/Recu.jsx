import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import { db } from '../lib/offlineQueue'
import { readCachedReference } from '../lib/referenceData'
import Icon, { Logo } from '../components/Icon'
import { day, Loading, money } from '../components/ui'

// Sale receipt: printable (or saved as PDF from the print window) and shareable on WhatsApp
export default function Recu() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const q = useQuery(async () => {
    if (navigator.onLine) {
      const [v, f] = await Promise.all([
        supabase.from('ventes').select('*, client:tiers(nom, telephone), bande:bandes(code), lot:lots_pondeuses(code)').eq('id', id).maybeSingle(),
        supabase.from('fermes').select('nom').limit(1).maybeSingle()
      ])
      if (v.data) return { v: v.data, ferme: f.data?.nom }
      if (v.error && !/fetch/i.test(v.error.message)) must(v)
    }
    // Not sent yet (offline): the sale is still in this phone's outbox
    const item = (await db.outbox.where('table').equals('ventes').toArray()).find((x) => x.row.id === id)
    if (!item) throw new Error(t('recu.notFound'))
    const ref = readCachedReference()
    const r = item.row
    const client = ref.clients.find((c) => c.id === r.client_id)
    return {
      pending: true,
      ferme: ref.ferme,
      v: {
        ...r, montant: Math.round(Number(r.quantite) * Number(r.prix_unitaire)), annulee: false,
        client: client ? { nom: client.nom, telephone: client.telephone } : null
      }
    }
  }, [id])

  if (!q.data) return <Loading error={q.error} />
  const { v, ferme } = q.data
  const numero = v.id.slice(0, 8).toUpperCase()
  const reste = Number(v.montant) - Number(v.montant_encaisse)
  const ligne = `${Number(v.quantite).toLocaleString(lang)} ${t(`unites.${v.unite}`)} ${t(`produits.${v.produit}`)}`
  const nomFerme = ferme || t('app.name')

  const texte = [
    `*${nomFerme}* – ${t('recu.title')} n° ${numero}`,
    `${t('recu.date')} : ${day(v.date_vente, lang)}`,
    v.client ? `${t('recu.client')} : ${v.client.nom}` : null,
    `${ligne} × ${money(v.prix_unitaire, lang)}`,
    v.nombre_sujets && v.unite === 'kg' ? t('argent.birds', { n: v.nombre_sujets }) : null,
    `*${t('recu.total')} : ${money(v.montant, lang)}*`,
    `${t('recu.paid')} : ${money(v.montant_encaisse, lang)}${v.mode_paiement && Number(v.montant_encaisse) > 0 ? ` (${t(`modes.${v.mode_paiement}`)})` : ''}`,
    reste > 0 ? `${t('recu.due')} : ${money(reste, lang)}${v.date_echeance ? ` – ${t('recu.dueOn', { d: day(v.date_echeance, lang) })}` : ''}` : null,
    t('recu.thanks')
  ].filter(Boolean).join('\n')
  // WhatsApp: straight to the customer when their number is known (Cameroon numbers: 237 prefix added)
  const tel = (v.client?.telephone ?? '').replace(/\D/g, '')
  const numeroWa = tel.length === 9 ? `237${tel}` : tel
  const whatsapp = `https://wa.me/${numeroWa}?text=${encodeURIComponent(texte)}`

  return (
    <div className="stack">
      <button className="back no-print" onClick={() => navigate(-1)}><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</button>

      <article className={`receipt ${v.annulee ? 'cancelled' : ''}`}>
        <header>
          <Logo size={42} />
          <div>
            <strong>{nomFerme}</strong>
            <small>{t('recu.title')} n° {numero}</small>
          </div>
          <span className="spacer" />
          <span>{day(v.date_vente, lang)}</span>
        </header>
        {q.data.pending && <div className="alert warn no-print"><Icon name="cloud" size={16} />{t('recu.pending')}</div>}
        {v.annulee && <div className="alert danger"><Icon name="alert" size={16} />{t('argent.cancelled')} : {v.motif_annulation}</div>}
        {v.client && <p><span className="muted">{t('recu.client')} :</span> <strong>{v.client.nom}</strong>{v.client.telephone ? ` · ${v.client.telephone}` : ''}</p>}
        <table className="table">
          <thead><tr><th>{t('recu.item')}</th><th>{t('recu.qty')}</th><th>{t('recu.price')}</th><th>{t('recu.amount')}</th></tr></thead>
          <tbody>
            <tr>
              <td>{t(`produits.${v.produit}`)}{v.nombre_sujets && v.unite === 'kg' ? ` (${t('argent.birds', { n: v.nombre_sujets })})` : ''}</td>
              <td>{Number(v.quantite).toLocaleString(lang)} {t(`unites.${v.unite}`)}</td>
              <td>{money(v.prix_unitaire, lang)}</td>
              <td>{money(v.montant, lang)}</td>
            </tr>
          </tbody>
        </table>
        <dl className="receipt-totals">
          <div className="main"><dt>{t('recu.total')}</dt><dd>{money(v.montant, lang)}</dd></div>
          <div><dt>{t('recu.paid')}{v.mode_paiement && Number(v.montant_encaisse) > 0 ? ` (${t(`modes.${v.mode_paiement}`)})` : ''}</dt><dd>{money(v.montant_encaisse, lang)}</dd></div>
          {reste > 0 && <div className="due"><dt>{t('recu.due')}{v.date_echeance ? ` – ${t('recu.dueOn', { d: day(v.date_echeance, lang) })}` : ''}</dt><dd>{money(reste, lang)}</dd></div>}
        </dl>
        <p className="muted small center">{t('recu.thanks')}</p>
      </article>

      {!v.annulee && (
        <div className="row no-print">
          <button className="btn primary" onClick={() => window.print()}><Icon name="download" size={16} />{t('recu.print')}</button>
          <a className="btn ghost" href={whatsapp} target="_blank" rel="noreferrer"><Icon name="users" size={16} />{t('recu.whatsapp')}</a>
        </div>
      )}
    </div>
  )
}
