import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, TABLES } from '../../config'
import { localDate } from '../../lib/stats'
import { exportExcel } from '../../lib/export'
import Icon from '../../components/Icon'
import { day, Empty, Field, FormCard, Loading, money, Panel } from '../../components/ui'

// Official invoices: built from the farm's sales (one sale = invoiced once), numbered without gaps.
// Only the director cancels one (on the invoice page), with a reason; the number is never reused.
export default function Factures() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const navigate = useNavigate()
  const q = useQuery(async () => {
    const [factures, situation, clients] = await Promise.all([
      supabase.from('factures').select('id, numero, date_facture, client_nom, total_ttc, annulee').order('annee', { ascending: false }).order('sequence', { ascending: false }).limit(200),
      supabase.from('factures_situation').select('id, reste'),
      supabase.from(TABLES.tiers).select('id, nom, type_tiers').neq('type_tiers', 'fournisseur').order('nom')
    ])
    const reste = Object.fromEntries(must(situation).map((s) => [s.id, Number(s.reste)]))
    return { factures: must(factures).map((f) => ({ ...f, reste: reste[f.id] ?? 0 })), clients: must(clients) }
  })

  // The customer's name is typed: an existing customer is recognised (its sales, its NIU), otherwise it is a new name
  // and the sales made without a customer are offered
  const [nom, setNom] = useState('')
  const norme = (x) => x.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const trouve = nom.trim() ? (q.data?.clients ?? []).find((c) => norme(c.nom) === norme(nom)) : null
  const client = !nom.trim() ? '' : trouve ? trouve.id : 'passage'
  const [date, setDate] = useState(localDate())
  const [notes, setNotes] = useState('')
  const [choix, setChoix] = useState([])
  const ventes = useQuery(async () => {
    if (!client) return []
    let req = supabase.from(TABLES.ventes).select('id, date_vente, produit, unite, quantite, prix_unitaire, montant, bande:bandes(code), lot:lots_pondeuses(code)')
      .eq('annulee', false).gte('date_vente', new Date(Date.now() - 180 * 864e5).toLocaleDateString('en-CA')).order('date_vente', { ascending: false }).limit(150)
    req = client === 'passage' ? req.is('client_id', null).is('boutique_id', null) : req.eq('client_id', client)
    const [v, l] = await Promise.all([req, supabase.from('facture_lignes').select('vente_id').eq('active', true).not('vente_id', 'is', null)])
    const deja = new Set(must(l).map((x) => x.vente_id))
    return must(v).filter((x) => !deja.has(x.id))
  }, [client])

  const creer = async () => {
    if (choix.length === 0) throw new Error(t('compta.fact.pickSales'))
    const id = must(await supabase.rpc('creer_facture', {
      p_ventes: choix, p_date: date, p_client_nom: client === 'passage' ? nom.trim() : null, p_notes: notes || null
    }))
    navigate(`/facture/${id}`)
    return t('compta.fact.created')
  }

  if (!q.data) return <Loading error={q.error} />
  const total = (ventes.data ?? []).filter((v) => choix.includes(v.id)).reduce((s, v) => s + Number(v.montant), 0)
  const toggle = (id) => setChoix((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const etat = (f) => {
    if (f.annulee) return <span className="tag danger">{t('compta.fact.cancelled')}</span>
    if (f.reste > 0) return <span className="tag warn">{t('compta.fact.due', { n: money(f.reste, lang) })}</span>
    return <span className="tag ok">{t('compta.fact.paid')}</span>
  }
  const exporter = () => exportExcel('factures', [
    { label: t('compta.fact.number'), value: (f) => f.numero },
    { label: t('saisie.date'), value: (f) => f.date_facture },
    { label: t('recu.client'), value: (f) => f.client_nom },
    { label: t('recu.total'), value: (f) => Number(f.total_ttc) },
    { label: t('compta.fact.left'), value: (f) => (f.annulee ? 0 : f.reste) },
    { label: t('stock.status'), value: (f) => (f.annulee ? t('compta.fact.cancelled') : f.reste > 0 ? t('compta.fact.unpaid') : t('compta.fact.paid')) }
  ], q.data.factures)

  return (
    <>
      {can(role, 'facture.create') && (
        <FormCard title={t('compta.fact.new')} icon="receipt" onSubmit={creer} submitLabel={t('compta.fact.create')}>
          <div className="grid-2">
            <Field label={t('recu.client')}>
              <input required list="clients-facture" value={nom} placeholder={t('compta.fact.clientPh')} autoComplete="off"
                onChange={(e) => { setNom(e.target.value); setChoix([]) }} />
              <datalist id="clients-facture">{q.data.clients.map((c) => <option key={c.id} value={c.nom} />)}</datalist>
              {nom.trim() && <small className="muted">{trouve ? t('compta.fact.knownClient') : t('compta.fact.newClient')}</small>}
            </Field>
            <Field label={t('compta.fact.date')}><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          {client && (
            !ventes.data ? <Loading error={ventes.error} /> : ventes.data.length === 0 ? <p className="muted">{t('compta.fact.noSales')}</p> : (
              <ul className="list">
                {ventes.data.map((v) => (
                  <li key={v.id}>
                    <label className="check grow">
                      <input type="checkbox" checked={choix.includes(v.id)} onChange={() => toggle(v.id)} />
                      <span>{day(v.date_vente, lang)} · {Number(v.quantite).toLocaleString(lang)} {t(`unites.${v.unite}`)} {t(`produits.${v.produit}`)}{v.bande ? ` · ${v.bande.code}` : v.lot ? ` · ${v.lot.code}` : ''}</span>
                    </label>
                    <strong>{money(v.montant, lang)}</strong>
                  </li>
                ))}
              </ul>
            )
          )}
          <Field label={t('admin.notes')}><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {choix.length > 0 && <div className="total-box"><span>{t('compta.fact.selected', { count: choix.length })}</span><strong>{money(total, lang)}</strong></div>}
        </FormCard>
      )}

      <Panel icon="receipt" tone="green" title={t('compta.fact.title')} subtitle={t('compta.fact.hint')}
        actions={q.data.factures.length > 0 && <button className="btn ghost sm" onClick={exporter}><Icon name="download" size={14} />{t('export.button')}</button>}>
        {q.data.factures.length === 0 ? <Empty icon="receipt" text={t('compta.fact.none')} /> : (
          <ul className="list">
            {q.data.factures.map((f) => (
              <li key={f.id} className={f.annulee ? 'cancelled' : ''}>
                <div className="grow">
                  <Link to={`/facture/${f.id}`} className="card-title">{f.numero}<Icon name="chevron" size={14} /></Link>
                  <div className="muted small">{day(f.date_facture, lang)} · {f.client_nom}</div>
                </div>
                <div className="right">
                  <strong>{money(f.total_ttc, lang)}</strong>
                  <div>{etat(f)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
