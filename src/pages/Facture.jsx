import { useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can } from '../config'
import { estNegoce } from '../lib/systeme'
import { envoyerImageWhatsApp } from '../lib/whatsapp'
import Icon, { Logo } from '../components/Icon'
import { day, Loading } from '../components/ui'
import { useAsk, useRun } from '../components/Dialog'

// Invoice: simple and clean – company, number and date, client, what was sold, total. Legal details in small print at the bottom.
// Printable (or saved as PDF from the print window) and shareable on WhatsApp.
const nombre = (n) => Number(n ?? 0).toLocaleString('fr-FR')

export default function Facture() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role, profile } = useAuth()
  const ask = useAsk()
  const docRef = useRef(null)   // the document, turned into an image for WhatsApp
  const run = useRun()
  const q = useQuery(async () => {
    const r = must(await supabase.rpc('facture_complete', { p_facture: id }))
    if (!r) throw new Error(t('compta.fact.notFound'))
    return { f: r.facture, lignes: r.lignes, s: r.societe ?? {}, reste: Number(r.reste ?? 0) }
  }, [id])

  const annuler = async () => {
    const motif = await ask.reason(t('compta.fact.cancelTitle', { n: q.data.f.numero }))
    if (motif) await run(supabase.rpc('annuler_facture', { p_facture: id, p_motif: motif }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const { f, lignes, s, reste } = q.data
  const nom = s.raison_sociale || s.nom || t('app.name')
  const identite = [
    s.forme_juridique && s.capital_social ? `${s.forme_juridique} au capital de ${nombre(s.capital_social)} FCFA` : s.forme_juridique,
    s.niu && `NIU : ${s.niu}`, s.rccm && `RCCM : ${s.rccm}`
  ].filter(Boolean)
  const contact = [s.adresse_siege, s.telephone_societe && `Tél. ${s.telephone_societe}`, s.email_societe].filter(Boolean)
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
      <button className="back no-print" onClick={() => navigate(-1)}><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</button>
      {manque && <div className="alert warn no-print"><Icon name="alert" size={16} />{t('compta.fact.missingIdentity')}</div>}

      <article ref={docRef} className={`fx ${f.annulee ? 'cancelled' : ''}`}>
        <header className="fx-brand">{estNegoce(profile) ? <Logo size={48} /> : <img src="/logo-societe.png" alt="" className="fx-logo" />}<strong>{nom}</strong></header>

        {f.annulee && <p className="fx-cancel">{t('compta.fact.cancelled')} : {f.motif_annulation}</p>}

        <div className="fx-head">
          <div className="fx-client">
            <span className="fx-label">{t('recu.client')}</span>
            <strong>{f.client_nom}</strong>
            {f.client_telephone && <span>{f.client_telephone}</span>}
          </div>
          <div className="fx-meta">
            <span className="fx-label">{t('compta.fact.invoice')}</span>
            <strong>{f.numero}</strong>
            <span>{day(f.date_facture, lang)}</span>
          </div>
        </div>

        <ul className="fx-lines">
          {lignes.map((l) => (
            <li key={l.id}>
              <div>
                <span>{l.designation}</span>
                <small>{nombre(l.quantite)} {l.unite ? t(`unites.${l.unite}`) : ''} × {nombre(l.prix_unitaire)} F</small>
              </div>
              <b>{nombre(l.montant)}</b>
            </li>
          ))}
        </ul>

        {f.tva_applicable && (
          <div className="fx-sub">
            <span>{t('compta.fact.totalHt')} {nombre(f.total_ht)}</span>
            <span>{t('compta.fact.vat', { taux: Number(f.taux_tva).toLocaleString('fr-FR') })} {nombre(f.total_tva)}</span>
          </div>
        )}
        <div className="fx-total"><span>{t('compta.fact.totalTtc')}</span><strong>{nombre(f.total_ttc)} FCFA</strong></div>
        {!f.annulee && (reste > 0
          ? <p className="fx-due">{paye > 0 && <>{t('recu.paid')} {nombre(paye)} · </>}<b>{t('compta.fact.left')} {nombre(reste)} FCFA</b></p>
          : <p className="fx-paid"><Icon name="check" size={14} />{t('compta.fact.paid')}</p>)}
        {f.notes && <p className="fx-notes">{f.notes}</p>}

        <footer className="fx-foot">
          {[...identite, ...contact].length > 0 && <small>{[...identite, ...contact].join(' · ')}</small>}
          {s.banque_paiement && <small>{t('compta.fact.bank')} : {s.banque_paiement}</small>}
          {s.mentions_facture && <small>{s.mentions_facture}</small>}
          {!f.tva_applicable && <small>{t('compta.fact.noVat')}</small>}
        </footer>
      </article>

      <div className="row no-print">
        <button className="btn primary" onClick={() => window.print()}><Icon name="download" size={16} />{t('recu.print')}</button>
        {!f.annulee && <button type="button" className="btn ghost" onClick={() => envoyerImageWhatsApp(ask, t, { element: docRef.current, nom: `facture-${f.numero}`, telephone: f.client_telephone, texte, legende: `${nom} – ${t('compta.fact.invoice')} ${f.numero} – ${nombre(f.total_ttc)} FCFA` })}><Icon name="users" size={16} />{t('recu.whatsapp')}</button>}
        {!f.annulee && can(role, 'facture.annuler') && <button className="btn ghost danger" onClick={annuler}>{t('compta.fact.cancel')}</button>}
      </div>
    </div>
  )
}
