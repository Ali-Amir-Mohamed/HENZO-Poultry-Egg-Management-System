import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { day, Field, FormCard, Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Shipments farm → shop: created by the direction / exploitation / an employee, confirmed by the seller on arrival
const ligneVide = () => ({ produit: 'poulet', origine: '', quantite: '' })

export default function Envois({ boutique }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const envoyer = can(role, 'boutique.envoi')
  const recevoir = can(role, 'boutique.recevoir')
  const q = useQuery(async () => {
    const env = await supabase.from('envois_boutique').select('*, lignes:envois_lignes(id, produit, quantite_envoyee, quantite_recue, bande:bandes(code), lot:lots_pondeuses(code))')
      .eq('boutique_id', boutique.id).order('created_at', { ascending: false }).limit(20)
    let sources = { bandes: [], lots: [], oeufs: null, opp: 30 }
    if (envoyer) {
      const [b, l, o] = await Promise.all([
        supabase.from('effectif_bandes').select('bande_id, code, restants').neq('statut', 'cloturee').order('date_arrivee'),
        supabase.from('effectif_lots').select('lot_id, code, effectif').eq('statut', 'en_production').order('date_arrivee'),
        supabase.from('stock_oeufs').select('stock_oeufs, oeufs_par_plateau').maybeSingle()
      ])
      sources = { bandes: b.data ?? [], lots: l.data ?? [], oeufs: o.data?.stock_oeufs ?? null, opp: o.data?.oeufs_par_plateau ?? 30 }
    }
    return { envois: must(env), sources }
  }, [boutique.id])
  const [lignes, setLignes] = useState([ligneVide()])
  const [notes, setNotes] = useState('')
  const n = (v) => Number(v ?? 0).toLocaleString(lang)
  const unite = (p) => (p === 'oeufs' ? t('oeufs.eggs') : t('boutique.birdsShort'))
  const majLigne = (i, k) => (e) => setLignes(lignes.map((l, j) => (j === i ? { ...l, [k]: e.target.value, ...(k === 'produit' ? { origine: '' } : {}) } : l)))

  const creer = async () => {
    const payload = lignes.filter((l) => Number(l.quantite) > 0 && l.origine).map((l) => ({
      produit: l.produit, quantite: Number(l.quantite), ...(l.produit === 'poulet' ? { bande_id: l.origine } : { lot_id: l.origine })
    }))
    if (!payload.length) throw new Error(t('boutique.nothingToSend'))
    must(await supabase.rpc('creer_envoi', { p_boutique: boutique.id, p_lignes: payload, p_notes: notes || null }))
    setLignes([ligneVide()]); setNotes('')
    q.reload()
    return t('boutique.sent', { nom: boutique.nom })
  }

  const confirmer = async (e) => {
    const v = await ask.form({ title: t('boutique.receiveTitle', { d: day(e.date_envoi, lang) }), icon: 'check', submit: t('boutique.receive'),
      message: t('boutique.receiveHint'),
      fields: e.lignes.map((l) => ({ name: l.id, label: `${t(`boutique.produits.${l.produit}`)} ${l.bande?.code ?? l.lot?.code ?? ''} — ${t('boutique.sentN', { n: n(l.quantite_envoyee), unite: unite(l.produit) })}`,
        type: 'number', min: 0, max: l.quantite_envoyee, value: l.quantite_envoyee, required: true })) })
    if (!v) return
    const manque = e.lignes.reduce((s, l) => s + (l.quantite_envoyee - Number(v[l.id])), 0)
    if (manque > 0 && !(await ask.confirm(t('boutique.missingConfirm', { n: n(manque) }), { title: t('boutique.receive'), icon: 'alert' }))) return
    await run(supabase.rpc('recevoir_envoi', { p_envoi: e.id, p_recus: e.lignes.map((l) => ({ ligne_id: l.id, recu: Number(v[l.id]) })) }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const { envois, sources } = q.data
  const enRoute = envois.filter((e) => e.statut === 'en_route')

  return (
    <>
      {enRoute.length > 0 && (
        <Panel icon="drumstick" tone="yolk" title={t('boutique.onTheWay', { count: enRoute.length })} subtitle={recevoir ? t('boutique.onTheWayHint') : null}>
          <ul className="list">
            {enRoute.map((e) => (
              <li key={e.id}>
                <div className="grow">
                  <strong>{t('boutique.shipmentOf', { d: day(e.date_envoi, lang) })}</strong>
                  <div className="muted small">{e.lignes.map((l) => `${n(l.quantite_envoyee)} ${t(`boutique.produits.${l.produit}`)} (${l.bande?.code ?? l.lot?.code ?? ''})`).join(' · ')}</div>
                  {e.notes && <div className="small">{e.notes}</div>}
                  {recevoir && <div className="row-actions"><button className="btn primary sm" onClick={() => confirmer(e)}><Icon name="check" size={14} />{t('boutique.receive')}</button></div>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {envoyer && (
        <FormCard title={t('boutique.newShipment', { nom: boutique.nom })} icon="drumstick" onSubmit={creer}>
          {lignes.map((l, i) => (
            <div key={i} className="start-line">
              <Field label={t('boutique.product')}>
                <select value={l.produit} onChange={majLigne(i, 'produit')}>{['poulet', 'oeufs', 'poule_reformee'].map((p) => <option key={p} value={p}>{t(`boutique.produits.${p}`)}</option>)}</select>
              </Field>
              <Field label={l.produit === 'poulet' ? t('saisie.bande') : t('saisie.lot')}>
                <select required value={l.origine} onChange={majLigne(i, 'origine')}>
                  <option value="">—</option>
                  {l.produit === 'poulet'
                    ? sources.bandes.map((b) => <option key={b.bande_id} value={b.bande_id}>{b.code} · {t('saisie.restants', { n: b.restants })}</option>)
                    : sources.lots.map((x) => <option key={x.lot_id} value={x.lot_id}>{x.code}{l.produit === 'poule_reformee' ? ` · ${t('saisie.restants', { n: x.effectif })}` : ''}</option>)}
                </select>
              </Field>
              <Field label={t('boutique.qtyIn', { unite: unite(l.produit) })}>
                <input type="number" min="1" required value={l.quantite} onChange={majLigne(i, 'quantite')} />
              </Field>
              {lignes.length > 1 && <button type="button" className="icon-btn dark" onClick={() => setLignes(lignes.filter((_, j) => j !== i))} aria-label={t('stock.remove')}><Icon name="trash" size={16} /></button>}
            </div>
          ))}
          {sources.oeufs != null && <p className="muted small">{t('boutique.farmEggs', { n: n(sources.oeufs), p: n(Math.floor(sources.oeufs / sources.opp)) })}</p>}
          <button type="button" className="btn ghost sm" onClick={() => setLignes([...lignes, ligneVide()])}><Icon name="plus" size={14} />{t('boutique.addLine')}</button>
          <Field label={t('saisie.notes')}><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('boutique.notesPh')} /></Field>
        </FormCard>
      )}

      <Panel icon="clock" tone="sky" title={t('boutique.shipments')}>
        {envois.filter((e) => e.statut === 'recu').length === 0 ? <p className="muted">{t('boutique.noShipment')}</p> : (
          <ul className="list">
            {envois.filter((e) => e.statut === 'recu').map((e) => {
              const manque = e.lignes.reduce((s, l) => s + (l.quantite_envoyee - (l.quantite_recue ?? l.quantite_envoyee)), 0)
              return (
                <li key={e.id}>
                  <div className="grow">
                    <strong>{t('boutique.shipmentOf', { d: day(e.date_envoi, lang) })}</strong>
                    <div className="muted small">{e.lignes.map((l) => `${n(l.quantite_recue)} / ${n(l.quantite_envoyee)} ${t(`boutique.produits.${l.produit}`)}`).join(' · ')}</div>
                  </div>
                  <span className={`tag ${manque ? 'warn' : 'ok'}`}>{manque ? t('boutique.missingN', { n: n(manque) }) : t('boutique.complete')}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </>
  )
}
