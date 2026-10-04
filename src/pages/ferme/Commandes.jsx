import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { day, Field, FormCard, Loading, money, Panel } from '../../components/ui'

// Chick orders (exploitation): order, planned deliveries, tick « Livré » with the number received,
// new date for the rest. The first reception creates the flock.
export default function Commandes({ onChange }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const manage = can(role, 'bande.create')
  const today = localDate()

  const q = useQuery(async () => {
    const [cmd, fournisseurs] = await Promise.all([
      supabase.from('commandes_poussins')
        .select('*, fournisseur:tiers(nom), livraisons:livraisons_poussins(id, statut, nombre, date_prevue, date_livraison, notes)')
        .order('date_livraison_prevue', { ascending: false }).limit(30),
      supabase.from('tiers').select('id, nom').in('type_tiers', ['fournisseur', 'client_fournisseur']).order('nom')
    ])
    return { commandes: must(cmd), fournisseurs: must(fournisseurs) }
  })
  const reload = () => { q.reload(); onChange?.() }

  // One order to the hatchery can cover several flocks started at the same time
  const empty = { fournisseur_id: '', souche: '', date_livraison_prevue: today, prix_unitaire: '', notes: '', lignes: [{ code_bande: '', nombre_commande: '' }] }
  const [form, setForm] = useState(empty)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setLigne = (i, k) => (e) => setForm({ ...form, lignes: form.lignes.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)) })
  const addLigne = () => setForm({ ...form, lignes: [...form.lignes, { code_bande: '', nombre_commande: '' }] })
  const removeLigne = (i) => setForm({ ...form, lignes: form.lignes.filter((_, j) => j !== i) })
  const total = form.lignes.reduce((s, l) => s + (Number(l.nombre_commande) || 0), 0)

  const commander = async () => {
    const reference = `CMD-${today.replaceAll('-', '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    must(await supabase.from('commandes_poussins').insert(form.lignes.map((l) => ({
      reference,
      code_bande: l.code_bande,
      nombre_commande: Number(l.nombre_commande),
      date_livraison_prevue: form.date_livraison_prevue,
      fournisseur_id: form.fournisseur_id || null,
      souche: form.souche || null,
      prix_unitaire: form.prix_unitaire ? Number(form.prix_unitaire) : null,
      notes: form.notes || null
    }))))
    setForm(empty)
    reload()
    return t('commandes.created')
  }

  const rpc = async (fn, args) => {
    const { error } = await supabase.rpc(fn, args)
    if (error) window.alert(error.message)
    reload()
  }

  // « Livré » : number actually received; if some are missing, the new date announced for the rest
  const livrer = async (l) => {
    const recu = Number(window.prompt(t('commandes.receivedPrompt', { n: l.nombre }), l.nombre))
    if (!recu || recu <= 0) return
    const date = window.prompt(t('commandes.receivedDatePrompt'), today)
    if (!date) return
    let reste = null
    if (recu < l.nombre) {
      reste = window.prompt(t('commandes.restPrompt', { n: l.nombre - recu }), '') || null
    }
    await rpc('receptionner_livraison', { p_livraison: l.id, p_nombre: recu, p_date: date, p_date_reste: reste })
  }
  const reporter = async (l) => {
    const date = window.prompt(t('commandes.postponePrompt'), l.date_prevue)
    if (date) await rpc('reporter_livraison', { p_livraison: l.id, p_date: date })
  }
  const annuler = async (l) => {
    if (window.confirm(t('commandes.confirmCancel', { n: l.nombre }))) await rpc('annuler_livraison_prevue', { p_livraison: l.id })
  }

  if (!q.data) return <Loading error={q.error} />
  // Group the flock lines by order reference
  const groupes = Object.values(q.data.commandes.reduce((acc, c) => {
    (acc[c.reference] ??= { reference: c.reference, fournisseur: c.fournisseur, date: c.date_commande, lignes: [] }).lignes.push(c)
    return acc
  }, {}))
  const actif = (g) => g.lignes.some((c) => ['en_attente', 'partielle'].includes(c.statut))
  const enCours = groupes.filter(actif)
  const terminees = groupes.filter((g) => !actif(g)).slice(0, 5)
  const recus = (c) => c.livraisons.filter((l) => l.statut === 'livree').reduce((s, l) => s + l.nombre, 0)

  return (
    <>
      {enCours.map((g) => (
        <Panel key={g.reference} icon="drumstick" tone="yolk"
          title={`${t('commandes.orderOf', { d: day(g.date, lang) })}${g.fournisseur ? ` · ${g.fournisseur.nom}` : ''}`}
          subtitle={t('commandes.groupSummary', {
            flocks: g.lignes.length,
            total: g.lignes.reduce((s, c) => s + c.nombre_commande, 0).toLocaleString(lang),
            recus: g.lignes.reduce((s, c) => s + recus(c), 0).toLocaleString(lang)
          })}>
          <ul className="list">
            {g.lignes.map((c) => {
              const nRecus = recus(c)
              return (
                <li key={c.id} className="commande">
                  <div className="grow">
                    <strong>{t('saisie.bande')} {c.code_bande} · {t('commandes.ordered', { n: c.nombre_commande })}</strong>
                    <div className="muted small">
                      {t('commandes.received', { n: nRecus, total: c.nombre_commande })}
                      {c.souche ? ` · ${c.souche}` : ''}
                      {c.prix_unitaire ? ` · ${money(c.prix_unitaire, lang)} / ${t('unites.piece')}` : ''}
                    </div>
                    <div className="progress"><div style={{ width: `${Math.min(100, (nRecus / c.nombre_commande) * 100)}%` }} /></div>
                    <ul className="deliveries">
                      {[...c.livraisons].sort((a, b) => String(a.date_prevue ?? a.date_livraison).localeCompare(String(b.date_prevue ?? b.date_livraison))).map((l) => (
                        <li key={l.id} className={l.statut}>
                          <span className={`task-check ${l.statut === 'livree' ? 'ok' : ''}`}>{l.statut === 'livree' ? <Icon name="check" size={12} /> : null}</span>
                          <span className="grow">
                            {l.statut === 'livree'
                              ? t('commandes.deliveredLine', { n: l.nombre, d: day(l.date_livraison, lang) })
                              : l.statut === 'annulee'
                                ? t('commandes.cancelledLine', { n: l.nombre })
                                : t('commandes.plannedLine', { n: l.nombre, d: day(l.date_prevue, lang) })}
                            {l.statut === 'prevue' && l.date_prevue < today && <span className="tag danger">{t('argent.late')}</span>}
                          </span>
                          {l.statut === 'prevue' && manage && (
                            <span className="row-actions">
                              <button className="btn primary sm" onClick={() => livrer(l)}><Icon name="check" size={14} />{t('commandes.delivered')}</button>
                              <button className="btn ghost sm" onClick={() => reporter(l)}>{t('planning.postpone')}</button>
                              <button className="btn ghost sm" onClick={() => annuler(l)}>{t('argent.cancel')}</button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {c.bande_id && <Link to={`/ferme/bande/${c.bande_id}`} className="small">{t('fiche.open')} →</Link>}
                  </div>
                  <span className={`tag ${c.statut === 'partielle' ? 'warn' : 'muted'}`}>{t(`commandes.statuts.${c.statut}`)}</span>
                </li>
              )
            })}
          </ul>
        </Panel>
      ))}

      {manage && (
        <FormCard title={t('commandes.new')} icon="drumstick" onSubmit={commander}>
          <div className="grid-2">
            <Field label={t('ferme.supplier')}>
              <select value={form.fournisseur_id} onChange={set('fournisseur_id')}>
                <option value="">—</option>
                {q.data.fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </Field>
            <Field label={t('commandes.expectedDate')}><input type="date" required value={form.date_livraison_prevue} onChange={set('date_livraison_prevue')} /></Field>
            <Field label={t('ferme.strain')}><input value={form.souche} onChange={set('souche')} placeholder="ex. Cobb 500" /></Field>
            <Field label={t('commandes.unitPrice')}><input type="number" min="0" value={form.prix_unitaire} onChange={set('prix_unitaire')} /></Field>
          </div>

          <div className="field"><span>{t('commandes.flocksOfOrder')}</span></div>
          {form.lignes.map((l, i) => (
            <div key={i} className="grid-2 order-line">
              <Field label={t('commandes.flockCode')}>
                <input required value={l.code_bande} onChange={setLigne(i, 'code_bande')} placeholder={`ex. B${i + 1}-2026`} />
              </Field>
              <Field label={t('commandes.quantity')}>
                <span className="row">
                  <input type="number" min="1" required value={l.nombre_commande} onChange={setLigne(i, 'nombre_commande')} />
                  {form.lignes.length > 1 && (
                    <button type="button" className="icon-btn dark" onClick={() => removeLigne(i)} aria-label={t('common.close')}><Icon name="trash" size={16} /></button>
                  )}
                </span>
              </Field>
            </div>
          ))}
          <button type="button" className="btn ghost sm" onClick={addLigne}><Icon name="plus" size={14} />{t('commandes.addFlock')}</button>
          <div className="total-box"><span>{t('commandes.totalOrdered')}</span><strong>{total.toLocaleString(lang)}</strong></div>

          <Field label={t('saisie.notes')}><input value={form.notes} onChange={set('notes')} /></Field>
          <p className="note"><Icon name="clock" size={16} />{t('commandes.hint')}</p>
        </FormCard>
      )}

      {terminees.length > 0 && (
        <details>
          <summary>{t('commandes.done', { count: terminees.length })}</summary>
          <ul className="list">
            {terminees.map((g) => (
              <li key={g.reference}>
                <div className="grow">
                  <strong>{t('commandes.orderOf', { d: day(g.date, lang) })}{g.fournisseur ? ` · ${g.fournisseur.nom}` : ''}</strong>
                  <div className="muted small">
                    {g.lignes.map((c) => `${c.code_bande} : ${t('commandes.received', { n: recus(c), total: c.nombre_commande })}`).join(' · ')}
                  </div>
                </div>
                <span className="tag muted">{t(`commandes.statuts.${g.lignes.every((c) => c.statut === 'annulee') ? 'annulee' : 'livree'}`)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
