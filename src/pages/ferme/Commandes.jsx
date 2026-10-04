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

  const empty = { code_bande: '', fournisseur_id: '', souche: '', nombre_commande: '', date_livraison_prevue: today, prix_unitaire: '', notes: '' }
  const [form, setForm] = useState(empty)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const commander = async () => {
    must(await supabase.from('commandes_poussins').insert({
      ...form,
      nombre_commande: Number(form.nombre_commande),
      fournisseur_id: form.fournisseur_id || null,
      souche: form.souche || null,
      prix_unitaire: form.prix_unitaire ? Number(form.prix_unitaire) : null,
      notes: form.notes || null
    }))
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
  const enCours = q.data.commandes.filter((c) => ['en_attente', 'partielle'].includes(c.statut))
  const terminees = q.data.commandes.filter((c) => !['en_attente', 'partielle'].includes(c.statut)).slice(0, 5)

  return (
    <>
      {enCours.length > 0 && (
        <Panel icon="drumstick" tone="yolk" title={t('commandes.title', { count: enCours.length })}>
          <ul className="list">
            {enCours.map((c) => {
              const recus = c.livraisons.filter((l) => l.statut === 'livree').reduce((s, l) => s + l.nombre, 0)
              return (
                <li key={c.id} className="commande">
                  <div className="grow">
                    <strong>{c.code_bande} · {t('commandes.ordered', { n: c.nombre_commande })}</strong>
                    <div className="muted small">
                      {c.fournisseur?.nom ?? t('commandes.noSupplier')}{c.souche ? ` · ${c.souche}` : ''}
                      {` · ${t('commandes.received', { n: recus, total: c.nombre_commande })}`}
                      {c.prix_unitaire ? ` · ${money(c.prix_unitaire, lang)} / ${t('unites.piece')}` : ''}
                    </div>
                    <div className="progress"><div style={{ width: `${Math.min(100, (recus / c.nombre_commande) * 100)}%` }} /></div>
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
      )}

      {manage && (
        <FormCard title={t('commandes.new')} icon="drumstick" onSubmit={commander}>
          <div className="grid-2">
            <Field label={t('commandes.flockCode')}><input required value={form.code_bande} onChange={set('code_bande')} placeholder="ex. B2-2026" /></Field>
            <Field label={t('ferme.supplier')}>
              <select value={form.fournisseur_id} onChange={set('fournisseur_id')}>
                <option value="">—</option>
                {q.data.fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </Field>
            <Field label={t('commandes.quantity')} className="big"><input type="number" min="1" required value={form.nombre_commande} onChange={set('nombre_commande')} /></Field>
            <Field label={t('commandes.expectedDate')}><input type="date" required value={form.date_livraison_prevue} onChange={set('date_livraison_prevue')} /></Field>
            <Field label={t('ferme.strain')}><input value={form.souche} onChange={set('souche')} placeholder="ex. Cobb 500" /></Field>
            <Field label={t('commandes.unitPrice')}><input type="number" min="0" value={form.prix_unitaire} onChange={set('prix_unitaire')} /></Field>
          </div>
          <Field label={t('saisie.notes')}><input value={form.notes} onChange={set('notes')} /></Field>
          <p className="note"><Icon name="clock" size={16} />{t('commandes.hint')}</p>
        </FormCard>
      )}

      {terminees.length > 0 && (
        <details>
          <summary>{t('commandes.done', { count: terminees.length })}</summary>
          <ul className="list">
            {terminees.map((c) => (
              <li key={c.id}>
                <div className="grow">
                  <strong>{c.code_bande}</strong>
                  <div className="muted small">
                    {t('commandes.received', { n: c.livraisons.filter((l) => l.statut === 'livree').reduce((s, l) => s + l.nombre, 0), total: c.nombre_commande })}
                    {c.fournisseur ? ` · ${c.fournisseur.nom}` : ''}
                  </div>
                </div>
                <span className="tag muted">{t(`commandes.statuts.${c.statut}`)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
