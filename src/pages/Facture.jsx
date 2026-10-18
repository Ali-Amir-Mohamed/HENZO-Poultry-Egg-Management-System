import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can } from '../config'
import { estNegoce } from '../lib/systeme'
import { montantEnLettres } from '../lib/montantEnLettres'
import { envoyerImageWhatsApp } from '../lib/whatsapp'
import Icon, { Logo } from '../components/Icon'
import { day, Loading } from '../components/ui'
import { useAsk, useRun } from '../components/Dialog'

// Invoice in the classic Cameroonian layout (like a utility cash receipt): company block, bilingual boxed table, totals with the
// net to pay shaded, amount in words, signature. A5 landscape when printed; the same picture goes on WhatsApp.
// Printable (or saved as PDF from the print window) and shareable on WhatsApp.
const nombre = (n) => Number(n ?? 0).toLocaleString('fr-FR')
// "300 pièces", "10 plateaux", but "26,5 kg" (every unit label takes an s in the plural, in French and English, except kg)
const pluriel = (l, label) => (Number(l.quantite) >= 2 && l.unite !== 'kg' ? `${label}s` : label)

export default function Facture() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role, profile } = useAuth()
  const ask = useAsk()
  const docRef = useRef(null)   // the document, turned into an image for WhatsApp
  const run = useRun()
  // the invoice keeps its paper layout (760 px wide); on a phone it is shown smaller instead of being cut
  const [zoom, setZoom] = useState(1)
  const wrapRef = useRef(null)
  const q = useQuery(async () => {
    const r = must(await supabase.rpc('facture_complete', { p_facture: id }))
    if (!r) throw new Error(t('compta.fact.notFound'))
    return { f: r.facture, lignes: r.lignes, s: r.societe ?? {}, reste: Number(r.reste ?? 0), paiement: r.paiement ?? [], caissier: r.caissier }
  }, [id])
  useEffect(() => {
    const el = wrapRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setZoom(Math.min(1, el.clientWidth / 760)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [q.data])

  const annuler = async () => {
    const motif = await ask.reason(t('compta.fact.cancelTitle', { n: q.data.f.numero }))
    if (motif) await run(supabase.rpc('annuler_facture', { p_facture: id, p_motif: motif }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const uniteDe = (l) => (l.unite ? pluriel(l, t(`unites.${l.unite}`)) : '')
  const { f, lignes, s, reste, paiement, caissier } = q.data
  const nom = s.raison_sociale || s.nom || t('app.name')
  const identite = [
    s.forme_juridique && s.capital_social ? `${s.forme_juridique} au capital de ${nombre(s.capital_social)} FCFA` : s.forme_juridique,
    s.niu && `NIU : ${s.niu}`, s.rccm && `RCCM : ${s.rccm}`
  ].filter(Boolean)
  const contact = [s.adresse_siege, s.telephone_societe && `Tél. ${s.telephone_societe}`, s.email_societe].filter(Boolean)
  const negoce = estNegoce(profile)
  const manque = !s.niu || !s.rccm || !s.raison_sociale
  const paye = Number(f.total_ttc) - reste

  const texte = [
    `*${nom}* – ${t('compta.fact.invoice')} n° ${f.numero}`,
    `${t('recu.date')} : ${day(f.date_facture, lang)}`,
    `${t('recu.client')} : ${f.client_nom}`,
    ...lignes.map((l) => `${l.designation} : ${nombre(l.quantite)} × ${nombre(l.prix_unitaire)} = ${nombre(l.montant)} FCFA`),
    `*${t('compta.fact.totalTtc')} : ${nombre(f.total_ttc)} FCFA*`,
    reste > 0 ? `${t('compta.fact.left')} : ${nombre(reste)} FCFA` : t('compta.fact.paid')
  ].join('\n')

  return (
    <div className="stack">
      <style>{'@page { size: A5 landscape; margin: 7mm; }'}</style>{/* printed on half an A4 sheet, lying flat, only while the invoice is open */}
      <button className="back no-print" onClick={() => navigate(-1)}><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</button>
      {manque && <div className="alert warn no-print"><Icon name="alert" size={16} />{t('compta.fact.missingIdentity')}</div>}

      <div className="fc-wrap" ref={wrapRef} style={{ zoom }}>
      <article ref={docRef} className={`fc ${f.annulee ? 'cancelled' : ''}`}>
        {!negoce && <img src="/logo-societe.png" alt="" className="fc-wm" />}
        {f.annulee && <div className="fc-stamp">{t('compta.fact.cancelledStamp')}</div>}

        <header className="fc-head">
          <div className="fc-soc">
            {negoce ? <Logo size={44} /> : <img src="/logo-societe.png" alt="" className="fc-logo" />}
            <div>
              <strong>{nom}</strong>
              {identite.map((x) => <small key={x}>{x}</small>)}
              {contact.map((x) => <small key={x}>{x}</small>)}
            </div>
          </div>
          <div className="fc-doc">
            <h2>FACTURE<small>INVOICE</small></h2>
            <div className="fc-num">N° <b>{f.numero}</b></div>
            <div className="fc-kv"><span>DATE<small>Date</small></span><b>{day(f.date_facture, lang)}</b></div>
            {paiement.length > 0 && <div className="fc-kv"><span>MODE DE PAIEMENT<small>Mode of payment</small></span><b>{paiement.map((m) => t(`modes.${m}`)).join(' + ')}</b></div>}
            {caissier && <div className="fc-kv"><span>CAISSIER<small>Cashier</small></span><b>{caissier}</b></div>}
          </div>
        </header>

        <div className="fc-client">
          <span className="fc-lbl">CLIENT<small>Customer</small></span>
          <div>
            <b>{f.client_nom}</b>
            {[f.client_niu && `NIU : ${f.client_niu}`, f.client_rccm && `RCCM : ${f.client_rccm}`, f.client_adresse, f.client_telephone && `Tél. ${f.client_telephone}`]
              .filter(Boolean).map((x) => <span key={x}> · {x}</span>)}
          </div>
        </div>

        <table className="fc-table">
          <thead>
            <tr><th>LIBELLÉ<small>Wording</small></th><th className="num">QTÉ<small>Qty</small></th><th className="num">PRIX UNIT.<small>Unit price</small></th><th className="num">MONTANT<small>Amount</small></th></tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id}>
                <td>{l.designation}</td>
                <td className="num">{nombre(l.quantite)} {uniteDe(l)}</td>
                <td className="num">{nombre(l.prix_unitaire)}</td>
                <td className="num">{nombre(l.montant)}</td>
              </tr>
            ))}
            <tr className="fc-fill"><td /><td /><td /><td /></tr>
          </tbody>
        </table>

        <div className="fc-bottom">
          <div className="fc-left">
            {!f.annulee && (
              <div className="fc-paid">
                <div><span>PAYÉ<small>Paid</small></span><b>{nombre(paye)}</b></div>
                <div className={reste > 0 ? 'due' : ''}><span>RESTE À PAYER<small>Balance due</small></span><b>{nombre(reste)}</b></div>
              </div>
            )}
            <div className="fc-words">
              <span>MONTANT EN LETTRES<small>Amount in words</small></span>
              <p>{t('compta.fact.words', { montant: montantEnLettres(f.total_ttc) }).toUpperCase()}</p>
            </div>
            {f.annulee && <p className="fc-cancel">{t('compta.fact.cancelled')} : {f.motif_annulation}</p>}
            {f.notes && <p className="fc-notes">{f.notes}</p>}
          </div>
          <div className="fc-totals">
            {f.tva_applicable && <div><span>TOTAL HT<small>Subtotal</small></span><b>{nombre(f.total_ht)}</b></div>}
            <div><span>T.V.A.<small>Tax</small></span><b>{f.tva_applicable ? `${nombre(f.total_tva)} (${Number(f.taux_tva).toLocaleString('fr-FR')} %)` : t('compta.fact.noVatShort')}</b></div>
            <div className="net"><span>NET À PAYER<small>Net to be paid</small></span><b>{nombre(f.total_ttc)} FCFA</b></div>
          </div>
        </div>

        <footer className="fc-foot">
          <div className="fc-mentions">
            {s.banque_paiement && <small>{t('compta.fact.bank')} : {s.banque_paiement}</small>}
            {s.mentions_facture && <small>{s.mentions_facture}</small>}
          </div>
          <div className="fc-sign">{t('compta.fact.signature')}<small>Signature and stamp</small></div>
        </footer>
      </article>
      </div>

      <div className="row no-print">
        <button className="btn primary" onClick={() => window.print()}><Icon name="download" size={16} />{t('recu.print')}</button>
        {!f.annulee && <button type="button" className="btn ghost" onClick={() => envoyerImageWhatsApp(ask, t, { element: docRef.current, nom: `facture-${f.numero}`, telephone: f.client_telephone, texte, legende: `${nom} – ${t('compta.fact.invoice')} ${f.numero} – ${nombre(f.total_ttc)} FCFA` })}><Icon name="users" size={16} />{t('recu.whatsapp')}</button>}
        {!f.annulee && can(role, 'facture.annuler') && <button className="btn ghost danger" onClick={annuler}>{t('compta.fact.cancel')}</button>}
      </div>
    </div>
  )
}
