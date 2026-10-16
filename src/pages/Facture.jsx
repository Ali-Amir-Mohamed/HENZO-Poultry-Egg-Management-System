import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can } from '../config'
import { montantEnLettres } from '../lib/montantEnLettres'
import Icon, { Logo } from '../components/Icon'
import { day, Loading } from '../components/ui'
import { useAsk, useRun } from '../components/Dialog'

// Official invoice: company identity (NIU, RCCM, capital, seat), client, lines, totals, amount in words.
// Printable (or saved as PDF from the print window) and shareable on WhatsApp.
const nombre = (n) => Number(n ?? 0).toLocaleString('fr-FR')

export default function Facture() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const ask = useAsk()
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
  const tel = (f.client_telephone ?? '').replace(/\D/g, '')
  const whatsapp = `https://wa.me/${tel.length === 9 ? `237${tel}` : tel}?text=${encodeURIComponent(texte)}`

  return (
    <div className="stack">
      <button className="back no-print" onClick={() => navigate(-1)}><Icon name="chevron" size={16} className="flip" />{t('fiche.back')}</button>
      {manque && <div className="alert warn no-print"><Icon name="alert" size={16} />{t('compta.fact.missingIdentity')}</div>}

      <article className={`invoice ${f.annulee ? 'cancelled' : ''}`}>
        <header className="invoice-head">
          <div className="invoice-company">
            <Logo size={44} />
            <div>
              <strong>{nom}</strong>
              {identite.map((x) => <small key={x}>{x}</small>)}
              {contact.length > 0 && <small>{contact.join(' · ')}</small>}
            </div>
          </div>
          <div className="invoice-title">
            <h2>{t('compta.fact.invoice').toUpperCase()}</h2>
            <div>N° <strong>{f.numero}</strong></div>
            <div>{t('recu.date')} : {day(f.date_facture, lang)}</div>
          </div>
        </header>

        {f.annulee && <div className="alert danger"><Icon name="alert" size={16} />{t('compta.fact.cancelled')} : {f.motif_annulation}</div>}

        <section className="invoice-client">
          <span className="muted small">{t('compta.fact.billedTo')}</span>
          <strong>{f.client_nom}</strong>
          {[f.client_niu && `NIU : ${f.client_niu}`, f.client_rccm && `RCCM : ${f.client_rccm}`, f.client_adresse, f.client_telephone].filter(Boolean).map((x) => <small key={x}>{x}</small>)}
        </section>

        <table className="table invoice-lines">
          <thead><tr><th>{t('compta.fact.designation')}</th><th className="num">{t('recu.qty')}</th><th className="num">{t('compta.fact.unitPrice')}</th><th className="num">{t('recu.amount')}</th></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id}>
                <td>{l.designation}</td>
                <td className="num">{nombre(l.quantite)} {l.unite ? t(`unites.${l.unite}`) : ''}</td>
                <td className="num">{nombre(l.prix_unitaire)}</td>
                <td className="num">{nombre(l.montant)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="receipt-totals invoice-totals">
          {f.tva_applicable ? (
            <>
              <div><dt>{t('compta.fact.totalHt')}</dt><dd>{nombre(f.total_ht)} FCFA</dd></div>
              <div><dt>{t('compta.fact.vat', { taux: Number(f.taux_tva).toLocaleString('fr-FR') })}</dt><dd>{nombre(f.total_tva)} FCFA</dd></div>
            </>
          ) : <div><dt className="muted">{t('compta.fact.noVat')}</dt><dd /></div>}
          <div className="main"><dt>{t('compta.fact.totalTtc')}</dt><dd>{nombre(f.total_ttc)} FCFA</dd></div>
          {!f.annulee && paye > 0 && <div><dt>{t('recu.paid')}</dt><dd>{nombre(paye)} FCFA</dd></div>}
          {!f.annulee && reste > 0 && <div className="due"><dt>{t('compta.fact.left')}</dt><dd>{nombre(reste)} FCFA</dd></div>}
        </dl>

        <p className="invoice-words">{t('compta.fact.words', { montant: montantEnLettres(f.total_ttc) })}</p>
        {f.notes && <p className="small">{f.notes}</p>}
        <footer className="invoice-foot">
          {s.banque_paiement && <small>{t('compta.fact.bank')} : {s.banque_paiement}</small>}
          {s.mentions_facture && <small>{s.mentions_facture}</small>}
          <small>{nom}{identite.length ? ` – ${identite.join(' – ')}` : ''}</small>
        </footer>
      </article>

      <div className="row no-print">
        <button className="btn primary" onClick={() => window.print()}><Icon name="download" size={16} />{t('recu.print')}</button>
        {!f.annulee && <a className="btn ghost" href={whatsapp} target="_blank" rel="noreferrer"><Icon name="users" size={16} />{t('recu.whatsapp')}</a>}
        {!f.annulee && can(role, 'facture.annuler') && <button className="btn ghost danger" onClick={annuler}>{t('compta.fact.cancel')}</button>}
      </div>
    </div>
  )
}
