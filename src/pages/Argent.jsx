import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can, CATEGORIES_DEPENSE, CATEGORIES_RETRAIT, MODES_PAIEMENT, TABLES } from '../config'
import { localDate } from '../lib/stats'
import Icon from '../components/Icon'
import { day, Empty, Field, FormCard, Loading, money, Panel, Tabs } from '../components/ui'
import { useAsk, useRun } from '../components/Dialog'
import Filtres, { useFiltres } from '../components/Filtres'
import { exportExcel } from '../lib/export'
import { Link } from 'react-router-dom'
import Investisseurs from './argent/Investisseurs'
import Demandes, { useDemandeCorrection } from './argent/Demandes'
import Prets from './argent/Prets'
import Verification from './argent/Verification'

// Money: cash boxes, sales, expenses, receivables and payables.
// Financial records are never edited: only validated, rejected or cancelled (database rules).
export default function Argent() {
  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem('henzo.argent.tab') || 'caisses' } catch { return 'caisses' }
  })
  // Refreshes the requests panel after a new correction request
  const [rev, setRev] = useState(0)
  const asked = () => setRev((r) => r + 1)
  const choose = (k) => { setTab(k); try { sessionStorage.setItem('henzo.argent.tab', k) } catch {} }
  return (
    <div className="stack">
      <Tabs value={tab} onChange={choose} tabs={[
        { id: 'caisses', label: 'argent.tabs.caisses', icon: 'wallet' },
        { id: 'depenses', label: 'argent.tabs.depenses', icon: 'receipt' },
        { id: 'ventes', label: 'argent.tabs.ventes', icon: 'cart' },
        { id: 'credits', label: 'argent.tabs.credits', icon: 'users' },
        { id: 'investisseurs', label: 'argent.tabs.investisseurs', icon: 'users' },
        { id: 'prets', label: 'argent.tabs.prets', icon: 'receipt' },
        { id: 'verification', label: 'argent.tabs.verification', icon: 'check' }
      ]} />
      <Demandes key={rev} />
      {tab === 'caisses' && <Caisses onAsked={asked} />}
      {tab === 'depenses' && <Depenses onAsked={asked} />}
      {tab === 'ventes' && <Ventes onAsked={asked} />}
      {tab === 'credits' && <Credits />}
      {tab === 'investisseurs' && <Investisseurs />}
      {tab === 'prets' && <Prets />}
      {tab === 'verification' && <Verification />}
    </div>
  )
}

// ---------- Cash boxes ----------
function Caisses({ onAsked }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const demander = useDemandeCorrection(onAsked)
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const soldes = useQuery(async () => must(await supabase.from('soldes_caisses').select('*')))
  const { f, setF, keep } = useFiltres()
  const ecritures = useQuery(async () => must(await supabase.from('ecritures')
    .select('id, date_operation, sens, montant, nature, libelle, caisse_id, source_id, ecriture_corrigee_id, caisse:caisses(activite, mode)')
    .gte('date_operation', f.from).lte('date_operation', f.to)
    .order('date_operation', { ascending: false }).order('created_at', { ascending: false }).limit(1000)), [f.from, f.to])
  const moves = keep(ecritures.data ?? [], { activite: (e) => e.caisse.activite, text: (e) => `${e.libelle ?? ''} ${t(`natures.${e.nature}`)}` })
  const exporter = () => exportExcel('henzo-caisses', [
    { label: t('export.date'), value: (e) => e.date_operation },
    { label: t('export.activity'), value: (e) => t(`types.${e.caisse.activite}_pl`) },
    { label: t('export.mode'), value: (e) => t(`modes.${e.caisse.mode}`) },
    { label: t('export.nature'), value: (e) => t(`natures.${e.nature}`) },
    { label: t('export.label'), value: (e) => e.libelle },
    { label: t('export.in'), value: (e) => (e.sens === 'entree' ? Number(e.montant) : null) },
    { label: t('export.out'), value: (e) => (e.sens === 'sortie' ? Number(e.montant) : null) }
  ], moves)
  const [form, setForm] = useState({ caisse_id: '', montant: '' })
  const [tr, setTr] = useState({ caisse_source: '', caisse_destination: '', montant: '', motif: '', date_transfert: localDate() })
  const reload = () => { soldes.reload(); ecritures.reload() }

  const total = (a) => (soldes.data ?? []).filter((c) => !a || c.activite === a).reduce((s, c) => s + Number(c.solde), 0)
  const label = (c) => `${t(`types.${c.activite}_pl`)} · ${t(`modes.${c.mode}`)}`

  const soldeInitial = async () => {
    must(await supabase.from('ecritures').insert({
      caisse_id: form.caisse_id, sens: 'entree', montant: Number(form.montant), nature: 'solde_initial', libelle: t('argent.openingBalance')
    }))
    reload()
  }
  const transferer = async () => {
    must(await supabase.from('transferts_caisses').insert({ ...tr, montant: Number(tr.montant) }))
    setTr({ ...tr, montant: '', motif: '' })
    reload()
  }
  // Director only: correcting entry linked to the original (the original stays in the history)
  const corriger = async (e) => {
    const v = await ask.form({
      title: t('argent.correctTitle', { libelle: e.libelle || t(`natures.${e.nature}`) }), icon: 'note', submit: t('argent.correct'),
      fields: [
        { name: 'sens', label: t('argent.correctionDirection'), type: 'select', value: 'sortie',
          options: [{ value: 'entree', label: t('argent.correctionAdd') }, { value: 'sortie', label: t('argent.correctionRemove') }] },
        { name: 'montant', label: t('argent.correctionAmountLabel'), type: 'number', min: 1, required: true },
        { name: 'motif', label: t('dialog.reason'), type: 'textarea', required: true }
      ]
    })
    if (!v) return
    await run(supabase.from('ecritures').insert({
      caisse_id: e.caisse_id, sens: v.sens, montant: v.montant, nature: 'correction', libelle: v.motif.trim(), ecriture_corrigee_id: e.id
    }), reload)
  }
  const annulerTransfert = async (e) => {
    const motif = await ask.reason(t('argent.cancelTransfer'))
    if (!motif) return
    await run(supabase.from('transferts_caisses').update({ annulee: true, motif_annulation: motif }).eq('id', e.source_id), reload)
  }

  return (
    <>
      {!soldes.data ? <Loading error={soldes.error} /> : (
        <div className="caisses">
          {['chair', 'pondeuse'].map((a) => (
            <Panel key={a} icon={a === 'chair' ? 'drumstick' : 'egg'} tone={a === 'chair' ? 'sky' : 'yolk'}
              title={t(`argent.caisse.${a}`)} actions={<strong className="big-number">{money(total(a), lang)}</strong>}>
              <div className="facts">
                {MODES_PAIEMENT.map((m) => {
                  const c = soldes.data.find((x) => x.activite === a && x.mode === m)
                  return (
                    <div key={m} className="fact">
                      <span>{t(`modes.${m}`)}</span>
                      <strong className={Number(c?.solde) < 0 ? 'error' : ''}>{money(c?.solde, lang)}</strong>
                    </div>
                  )
                })}
              </div>
            </Panel>
          ))}
          <div className="total-box"><span>{t('argent.combined')}</span><strong>{money(total(), lang)}</strong></div>
        </div>
      )}

      {can(role, 'transfert') && soldes.data && (
        <FormCard title={t('argent.transfer')} icon="sync" onSubmit={transferer}>
          <div className="grid-2">
            <Field label={t('argent.from')}>
              <select required value={tr.caisse_source} onChange={(e) => setTr({ ...tr, caisse_source: e.target.value })}>
                <option value="" disabled>{t('saisie.choose')}</option>
                {soldes.data.map((c) => <option key={c.caisse_id} value={c.caisse_id}>{label(c)} ({money(c.solde, lang)})</option>)}
              </select>
            </Field>
            <Field label={t('argent.to')}>
              <select required value={tr.caisse_destination} onChange={(e) => setTr({ ...tr, caisse_destination: e.target.value })}>
                <option value="" disabled>{t('saisie.choose')}</option>
                {soldes.data.filter((c) => c.caisse_id !== tr.caisse_source).map((c) => <option key={c.caisse_id} value={c.caisse_id}>{label(c)}</option>)}
              </select>
            </Field>
            <Field label={t('argent.amount')} className="big"><input type="number" min="1" required value={tr.montant} onChange={(e) => setTr({ ...tr, montant: e.target.value })} /></Field>
            <Field label={t('saisie.date')}><input type="date" required value={tr.date_transfert} onChange={(e) => setTr({ ...tr, date_transfert: e.target.value })} /></Field>
          </div>
          <Field label={t('argent.transferReason')}><input required value={tr.motif} onChange={(e) => setTr({ ...tr, motif: e.target.value })} placeholder={t('argent.transferPh')} /></Field>
        </FormCard>
      )}

      {can(role, 'soldeInitial') && soldes.data && (
        <FormCard title={t('argent.openingBalance')} icon="wallet" onSubmit={soldeInitial}>
          <div className="grid-2">
            <Field label={t('argent.caisseLabel')}>
              <select required value={form.caisse_id} onChange={(e) => setForm({ ...form, caisse_id: e.target.value })}>
                <option value="" disabled>{t('saisie.choose')}</option>
                {soldes.data.map((c) => <option key={c.caisse_id} value={c.caisse_id}>{t(`types.${c.activite}_pl`)} · {t(`modes.${c.mode}`)}</option>)}
              </select>
            </Field>
            <Field label={t('argent.amount')}>
              <input type="number" min="1" required value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} />
            </Field>
          </div>
        </FormCard>
      )}

      <Panel title={t('argent.lastMoves')} subtitle={ecritures.data ? t('filtres.summary', {
        count: moves.length,
        inn: money(moves.filter((e) => e.sens === 'entree').reduce((s, e) => s + Number(e.montant), 0), lang),
        out: money(moves.filter((e) => e.sens === 'sortie').reduce((s, e) => s + Number(e.montant), 0), lang)
      }) : null}>
        <Filtres f={f} setF={setF} onExport={exporter} count={moves.length} />
        {!ecritures.data ? <Loading error={ecritures.error} /> : moves.length === 0 ? <p className="muted">{t('argent.noMoves')}</p> : (
          <ul className="list">
            {moves.map((e) => (
              <li key={e.id}>
                <div className="grow">
                  <strong>{e.libelle || t(`natures.${e.nature}`)}</strong>
                  <div className="muted small">{day(e.date_operation, lang)} · {t(`types.${e.caisse.activite}_pl`)} · {t(`modes.${e.caisse.mode}`)} · {t(`natures.${e.nature}`)}</div>
                  {!['correction', 'annulation'].includes(e.nature) && (can(role, 'correction') || (e.nature === 'transfert' && can(role, 'annuler'))) && (
                    <div className="row-actions">
                      {can(role, 'correction') && <button className="btn ghost sm" onClick={() => corriger(e)}>{t('argent.correct')}</button>}
                      {e.nature === 'transfert' && e.sens === 'sortie' && can(role, 'annuler') && (
                        <button className="btn ghost sm" onClick={() => annulerTransfert(e)}>{t('argent.cancelTransfer')}</button>
                      )}
                    </div>
                  )}
                  {!['correction', 'annulation'].includes(e.nature) && can(role, 'correction.request') && (
                    <div className="row-actions">
                      <button className="btn ghost sm" onClick={() => demander('ecritures', e.id,
                        `${e.libelle || t(`natures.${e.nature}`)} · ${e.sens === 'entree' ? '+' : '−'}${money(e.montant, lang)} · ${day(e.date_operation, lang)}`)}>
                        {t('demandes.ask')}
                      </button>
                    </div>
                  )}
                </div>
                <strong className={e.sens === 'entree' ? 'success' : 'error'}>{e.sens === 'entree' ? '+' : '−'}{money(e.montant, lang)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

// ---------- Expenses ----------
// Purchases that enter stock: entered by exploitation / director only (finance has a read-only stock)
const STOCKABLES = ['aliment', 'medicament']
const emptyDepense = (portee) => ({
  portee, activite: 'chair', cible: '', categorie: CATEGORIES_DEPENSE[portee][0], categorie_retrait: 'avance_benefice',
  beneficiaire: '', libelle: '', montant: '', fournisseur_id: '', paiement: 'especes', montant_paye: '',
  mode_paye: 'especes', date_echeance: '', article_id: '', quantite: '', date_depense: localDate(), notes: ''
})

function Depenses({ onAsked }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const demander = useDemandeCorrection(onAsked)
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const porteeParDefaut = can(role, 'depense.ferme') ? 'ferme' : 'generale'
  const [form, setForm] = useState(() => emptyDepense(porteeParDefaut))
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const { f, setF, keep } = useFiltres()
  const list = useQuery(async () => must(await supabase.from(TABLES.depenses)
    .select('*, fournisseur:tiers(nom), article:articles(nom, unite), bande:bandes(code), lot:lots_pondeuses(code)')
    .gte('date_depense', f.from).lte('date_depense', f.to)
    .order('date_depense', { ascending: false }).order('created_at', { ascending: false }).limit(1000)), [f.from, f.to])
  const depenses = keep(list.data ?? [], {
    activite: (d) => d.activite,
    text: (d) => `${d.libelle} ${t(`categories.${d.categorie}`)} ${d.fournisseur?.nom ?? ''} ${d.bande?.code ?? d.lot?.code ?? ''} ${d.beneficiaire ?? ''}`
  })
  const exporter = () => exportExcel('henzo-depenses', [
    { label: t('export.date'), value: (d) => d.date_depense },
    { label: t('export.activity'), value: (d) => t(`types.${d.activite}_pl`) },
    { label: t('export.category'), value: (d) => t(`categories.${d.categorie}`) },
    { label: t('export.label'), value: (d) => d.libelle },
    { label: t('export.flock'), value: (d) => d.bande?.code ?? d.lot?.code },
    { label: t('export.supplier'), value: (d) => d.fournisseur?.nom },
    { label: t('export.amount'), value: (d) => Number(d.montant) },
    { label: t('export.paid'), value: (d) => Number(d.montant_paye) },
    { label: t('export.status'), value: (d) => (d.annulee ? t('argent.cancelled') : t(`statuts.${d.statut}`)) }
  ], depenses)
  const refs = useQuery(async () => {
    const [b, l, f, a, s] = await Promise.all([
      supabase.from('effectif_bandes').select('bande_id, code').neq('statut', 'cloturee').order('date_arrivee'),
      supabase.from('effectif_lots').select('lot_id, code').eq('statut', 'en_production'),
      supabase.from(TABLES.tiers).select('id, nom').in('type_tiers', ['fournisseur', 'client_fournisseur']).order('nom'),
      supabase.from(TABLES.articles).select('id, nom, categorie, unite').eq('actif', true).order('nom'),
      supabase.from('fermes').select('seuil_validation_depense, seuil_tiers_obligatoire').limit(1)
    ])
    const ferme = must(s)[0]
    return {
      bandes: must(b), lots: must(l), fournisseurs: must(f), articles: must(a),
      seuil: ferme?.seuil_validation_depense, seuilTiers: ferme?.seuil_tiers_obligatoire
    }
  })

  const credit = form.paiement === 'credit'
  const stockable = STOCKABLES.includes(form.categorie)
  // No big anonymous purchase: supplier required above the threshold (database rule too)
  const supplierRequired = credit || (refs.data?.seuilTiers != null && Number(form.montant) > Number(refs.data.seuilTiers)
    && !['salaires', 'retrait_associe'].includes(form.categorie))
  const articles = (refs.data?.articles ?? []).filter((a) => a.categorie === form.categorie)

  const create = async () => {
    const cible = form.cible.startsWith('b:') ? { bande_id: form.cible.slice(2) }
      : form.cible.startsWith('l:') ? { lot_id: form.cible.slice(2) } : {}
    const row = {
      portee: form.portee,
      activite: form.activite,
      ...cible,
      categorie: form.categorie,
      categorie_retrait: form.categorie === 'retrait_associe' ? form.categorie_retrait : null,
      beneficiaire: form.categorie === 'retrait_associe' ? form.beneficiaire : null,
      libelle: form.libelle,
      montant: Number(form.montant),
      fournisseur_id: form.fournisseur_id || null,
      a_credit: credit,
      mode_paiement: credit ? (Number(form.montant_paye) > 0 ? form.mode_paye : null) : form.paiement,
      montant_paye: credit ? Number(form.montant_paye) || 0 : 0,
      date_echeance: credit ? form.date_echeance || null : null,
      article_id: stockable && form.article_id ? form.article_id : null,
      quantite: stockable && form.article_id ? Number(form.quantite) : null,
      date_depense: form.date_depense,
      notes: form.notes || null
    }
    const saved = must(await supabase.from(TABLES.depenses).insert(row).select('statut').single())
    setForm(emptyDepense(form.portee))
    list.reload()
    return saved.statut === 'a_valider' ? t('argent.savedToValidate') : t('common.saved')
  }

  const decide = async (d, statut) => {
    const patch = { statut }
    if (statut === 'rejetee') {
      const motif = await ask.reason(t('argent.rejectTitle', { libelle: d.libelle }))
      if (!motif) return
      patch.motif_rejet = motif
    } else if (!(await ask.confirm(t('argent.confirmValidate', { n: money(d.montant, lang) }), { title: d.libelle, icon: 'check', submit: t('argent.validate') }))) return
    await run(supabase.from(TABLES.depenses).update(patch).eq('id', d.id), list.reload)
  }

  const annuler = async (d) => {
    const motif = await ask.reason(t('argent.cancelTitle', { libelle: d.libelle }))
    if (!motif) return
    await run(supabase.from(TABLES.depenses).update({ annulee: true, motif_annulation: motif }).eq('id', d.id), list.reload)
  }

  const portees = ['ferme', 'generale'].filter((p) => can(role, `depense.${p}`))

  return (
    <>
      {portees.length > 0 && (
        <FormCard title={t('argent.newExpense')} icon="receipt" onSubmit={create}>
          {portees.length > 1 && (
            <div className="segmented small">
              {portees.map((p) => (
                <button key={p} type="button" className={form.portee === p ? 'active' : ''} onClick={() => setForm(emptyDepense(p))}>
                  {t(`argent.portee.${p}`)}
                </button>
              ))}
            </div>
          )}
          <div className="grid-2">
            <Field label={t('saisie.date')}><input type="date" required value={form.date_depense} onChange={set('date_depense')} /></Field>
            <Field label={t('argent.category')}>
              <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value, article_id: '', quantite: '' })}>
                {CATEGORIES_DEPENSE[form.portee].filter((c) => can(role, 'stock.achat') || !STOCKABLES.includes(c))
                  .map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
              </select>
            </Field>
            {form.portee === 'ferme' ? (
              <Field label={t('argent.forFlock')}>
                <select value={form.cible} onChange={set('cible')}>
                  <option value="">{t('argent.noFlock')}</option>
                  <optgroup label={t('types.chair_pl')}>
                    {(refs.data?.bandes ?? []).map((b) => <option key={b.bande_id} value={`b:${b.bande_id}`}>{b.code}</option>)}
                  </optgroup>
                  <optgroup label={t('types.pondeuse_pl')}>
                    {(refs.data?.lots ?? []).map((l) => <option key={l.lot_id} value={`l:${l.lot_id}`}>{l.code}</option>)}
                  </optgroup>
                </select>
              </Field>
            ) : null}
            {!form.cible && (
              <Field label={t('argent.paidBy')}>
                <select value={form.activite} onChange={set('activite')}>
                  <option value="chair">{t('argent.caisse.chair')}</option>
                  <option value="pondeuse">{t('argent.caisse.pondeuse')}</option>
                </select>
              </Field>
            )}
          </div>

          {form.categorie === 'retrait_associe' && (
            <div className="grid-2">
              <Field label={t('argent.partner')}><input required value={form.beneficiaire} onChange={set('beneficiaire')} /></Field>
              <Field label={t('argent.withdrawalType')}>
                <select value={form.categorie_retrait} onChange={set('categorie_retrait')}>
                  {CATEGORIES_RETRAIT.map((c) => <option key={c} value={c}>{t(`retraits.${c}`)}</option>)}
                </select>
              </Field>
            </div>
          )}

          <div className="grid-2">
            <Field label={t('argent.label')} className="span-2"><input required value={form.libelle} onChange={set('libelle')} /></Field>
            <Field label={t('argent.amount')} className="big"><input type="number" min="1" required value={form.montant} onChange={set('montant')} /></Field>
            <Field label={supplierRequired ? t('argent.supplierRequired') : t('argent.supplier')}>
              <select required={supplierRequired} value={form.fournisseur_id} onChange={set('fournisseur_id')}>
                <option value="">—</option>
                {(refs.data?.fournisseurs ?? []).map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </Field>
          </div>

          {stockable && (
            <div className="grid-2">
              <Field label={t('argent.stockArticle')}>
                <select value={form.article_id} onChange={set('article_id')}>
                  <option value="">{t('argent.noStock')}</option>
                  {articles.map((a) => <option key={a.id} value={a.id}>{a.nom} ({t(`unites.${a.unite}`)})</option>)}
                </select>
              </Field>
              {form.article_id && (
                <Field label={t('argent.quantity')}><input type="number" min="0.01" step="0.01" required value={form.quantite} onChange={set('quantite')} /></Field>
              )}
            </div>
          )}

          <div className="field">
            <span>{t('saisie.paiement')}</span>
            <div className="segmented small">
              {[...MODES_PAIEMENT, 'credit'].map((m) => (
                <button key={m} type="button" className={form.paiement === m ? 'active' : ''} onClick={() => setForm({ ...form, paiement: m })}>
                  {t(m === 'credit' ? 'argent.supplierCredit' : `modes.${m}`)}
                </button>
              ))}
            </div>
          </div>
          {credit && (
            <div className="grid-2">
              <Field label={t('argent.paidNow')}><input type="number" min="0" value={form.montant_paye} onChange={set('montant_paye')} /></Field>
              {Number(form.montant_paye) > 0 && (
                <Field label={t('saisie.modeAcompte')}>
                  <select value={form.mode_paye} onChange={set('mode_paye')}>
                    {MODES_PAIEMENT.map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t('saisie.echeance')}><input type="date" value={form.date_echeance} onChange={set('date_echeance')} /></Field>
            </div>
          )}
          {role === 'exploitation' && refs.data?.seuil != null && Number(form.montant) > Number(refs.data.seuil) && (
            <p className="note"><Icon name="clock" size={16} />{t('argent.willNeedValidation', { n: money(refs.data.seuil, lang) })}</p>
          )}
        </FormCard>
      )}

      <Panel title={t('argent.lastExpenses')} subtitle={list.data ? t('filtres.total', {
        count: depenses.length,
        n: money(depenses.filter((d) => !d.annulee && d.statut === 'validee').reduce((s, d) => s + Number(d.montant), 0), lang)
      }) : null}>
        <Filtres f={f} setF={setF} onExport={exporter} count={depenses.length} />
        {!list.data ? <Loading error={list.error} /> : depenses.length === 0 ? <p className="muted">{t('argent.noExpenses')}</p> : (
          <ul className="list">
            {depenses.map((d) => (
              <li key={d.id} className={d.annulee ? 'cancelled' : ''}>
                <div className="grow">
                  <strong>{d.libelle}</strong>
                  <div className="muted small">
                    {day(d.date_depense, lang)} · {t(`categories.${d.categorie}`)}
                    {d.bande ? ` · ${t('saisie.bande')} ${d.bande.code}` : d.lot ? ` · ${t('saisie.lot')} ${d.lot.code}` : ''}
                    {d.fournisseur ? ` · ${d.fournisseur.nom}` : ''}
                    {d.article ? ` · ${d.quantite} ${t(`unites.${d.article.unite}`)} ${d.article.nom}` : ''}
                    {d.a_credit ? ` · ${t('argent.supplierCredit')}` : ''}
                  </div>
                  {d.motif_rejet && <div className="error small">{t('argent.rejected')} : {d.motif_rejet}</div>}
                  {d.annulee && <div className="error small">{t('argent.cancelled')} : {d.motif_annulation}</div>}
                  <div className="row-actions">
                    {d.statut === 'a_valider' && !d.annulee && can(role, d.categorie === 'retrait_associe' ? 'retrait.confirm' : 'depense.validate') && (
                      <>
                        <button className="btn primary sm" onClick={() => decide(d, 'validee')}><Icon name="check" size={14} />{t('argent.validate')}</button>
                        <button className="btn ghost sm" onClick={() => decide(d, 'rejetee')}>{t('argent.reject')}</button>
                      </>
                    )}
                    {!d.annulee && d.statut !== 'rejetee' && can(role, 'annuler') && (
                      <button className="btn ghost sm" onClick={() => annuler(d)}>{t('argent.cancel')}</button>
                    )}
                    {!d.annulee && d.statut !== 'rejetee' && can(role, 'correction.request') && (
                      <button className="btn ghost sm" onClick={() => demander('depenses', d.id, `${d.libelle} · ${money(d.montant, lang)} · ${day(d.date_depense, lang)}`)}>
                        {t('demandes.askCancel')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="right">
                  <strong>{money(d.montant, lang)}</strong>
                  <span className={`tag ${d.annulee ? 'muted' : d.statut === 'validee' ? 'ok' : d.statut === 'a_valider' ? 'warn' : 'danger'}`}>
                    {d.annulee ? t('argent.cancelled') : t(`statuts.${d.statut}`)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

// ---------- Sales ----------
function Ventes({ onAsked }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const demander = useDemandeCorrection(onAsked)
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const { f, setF, keep } = useFiltres()
  const list = useQuery(async () => must(await supabase.from(TABLES.ventes)
    .select('*, client:tiers(nom), bande:bandes(code), lot:lots_pondeuses(code)')
    .gte('date_vente', f.from).lte('date_vente', f.to)
    .order('date_vente', { ascending: false }).order('created_at', { ascending: false }).limit(1000)), [f.from, f.to])
  const ventes = keep(list.data ?? [], {
    activite: (v) => (v.bande_id ? 'chair' : 'pondeuse'),
    text: (v) => `${t(`produits.${v.produit}`)} ${v.client?.nom ?? ''} ${v.bande?.code ?? v.lot?.code ?? ''}`
  })
  const exporter = () => exportExcel('henzo-ventes', [
    { label: t('export.date'), value: (v) => v.date_vente },
    { label: t('export.product'), value: (v) => t(`produits.${v.produit}`) },
    { label: t('export.flock'), value: (v) => v.bande?.code ?? v.lot?.code },
    { label: t('export.client'), value: (v) => v.client?.nom },
    { label: t('export.quantity'), value: (v) => Number(v.quantite) },
    { label: t('export.unit'), value: (v) => t(`unites.${v.unite}`) },
    { label: t('export.birds'), value: (v) => v.nombre_sujets },
    { label: t('export.unitPrice'), value: (v) => Number(v.prix_unitaire) },
    { label: t('export.amount'), value: (v) => Number(v.montant) },
    { label: t('export.cashed'), value: (v) => Number(v.montant_encaisse) },
    { label: t('export.mode'), value: (v) => (v.a_credit ? t('modes.credit') : t(`modes.${v.mode_paiement}`)) },
    { label: t('export.status'), value: (v) => (v.annulee ? t('argent.cancelled') : '') }
  ], ventes)

  const annuler = async (v) => {
    const motif = await ask.reason(t('argent.cancelSaleTitle', { n: money(v.montant, lang) }))
    if (!motif) return
    await run(supabase.from(TABLES.ventes).update({ annulee: true, motif_annulation: motif }).eq('id', v.id), list.reload)
  }

  return (
    <Panel title={t('argent.lastSales')} subtitle={list.data ? t('filtres.total', {
      count: ventes.length, n: money(ventes.filter((v) => !v.annulee).reduce((s, v) => s + Number(v.montant), 0), lang)
    }) : null}>
      <Filtres f={f} setF={setF} onExport={exporter} count={ventes.length} />
      {!list.data ? <Loading error={list.error} /> : ventes.length === 0 ? <Empty icon="cart" text={t('argent.noSales')} /> : (
        <ul className="list">
          {ventes.map((v) => (
            <li key={v.id} className={v.annulee ? 'cancelled' : ''}>
              <div className="grow">
                <strong>{t(`produits.${v.produit}`)} · {v.bande?.code ?? v.lot?.code}</strong>
                <div className="muted small">
                  {day(v.date_vente, lang)} · {Number(v.quantite).toLocaleString(lang)} {t(`unites.${v.unite}`)} × {money(v.prix_unitaire, lang)}
                  {v.nombre_sujets ? ` · ${t('argent.birds', { n: v.nombre_sujets })}` : ''}
                  {v.client ? ` · ${v.client.nom}` : ''}
                </div>
                {v.prix_reference && Number(v.prix_reference) !== Number(v.prix_unitaire) && (
                  <div className="warn-text small">{t('argent.priceGap', { ref: money(v.prix_reference, lang) })}</div>
                )}
                {v.annulee && <div className="error small">{t('argent.cancelled')} : {v.motif_annulation}</div>}
                {!v.annulee && (
                  <div className="row-actions">
                    <Link to={`/recu/${v.id}`} className="btn ghost sm"><Icon name="receipt" size={14} />{t('recu.open')}</Link>
                    {can(role, 'annuler') && <button className="btn ghost sm" onClick={() => annuler(v)}>{t('argent.cancel')}</button>}
                    {can(role, 'correction.request') && (
                      <button className="btn ghost sm" onClick={() => demander('ventes', v.id,
                        `${t(`produits.${v.produit}`)} ${v.bande?.code ?? v.lot?.code ?? ''} · ${money(v.montant, lang)} · ${day(v.date_vente, lang)}`)}>
                        {t('demandes.askCancel')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="right">
                <strong>{money(v.montant, lang)}</strong>
                <span className={`tag ${v.a_credit ? 'warn' : 'ok'}`}>{v.a_credit ? t('modes.credit') : t(`modes.${v.mode_paiement}`)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ---------- Receivables & payables ----------
function Credits() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const creances = useQuery(async () => must(await supabase.from('creances_clients').select('*').order('date_echeance', { nullsFirst: false })))
  const dettes = useQuery(async () => must(await supabase.from('dettes_fournisseurs').select('*').order('date_echeance', { nullsFirst: false })))

  const payer = async (table, idField, row, reload, title) => {
    const v = await ask.payment(title, {
      value: Number(row.reste), max: Number(row.reste), withDate: true,
      hint: t('argent.remaining', { n: money(row.reste, lang) }), submit: t('dialog.save')
    })
    if (!v) return
    await run(supabase.from(table).insert({ [idField]: row[idField], montant: v.montant, mode_paiement: v.mode, date_paiement: v.date }), reload)
  }

  const renderList = (q, kind) => (
    !q.data ? <Loading error={q.error} /> : q.data.length === 0 ? <p className="muted">{t(`argent.no_${kind}`)}</p> : (
      <ul className="list">
        {q.data.map((r) => (
          <li key={r.vente_id ?? r.depense_id}>
            <div className="grow">
              <strong>{r.client ?? r.fournisseur}</strong>
              <div className="muted small">
                {day(r.date_vente ?? r.date_depense, lang)} · {r.libelle ?? t(`produits.${r.produit}`)} · {t('argent.of', { n: money(r.montant, lang) })}
                {r.date_echeance ? ` · ${t('argent.due', { d: day(r.date_echeance, lang) })}` : ''}
              </div>
              {can(role, 'paiement') && (
                <div className="row-actions">
                  <button className="btn primary sm" onClick={() => kind === 'creances'
                    ? payer(TABLES.paiementsClients, 'vente_id', r, q.reload, t('argent.collectFrom', { nom: r.client }))
                    : payer(TABLES.paiementsFournisseurs, 'depense_id', r, q.reload, t('argent.payTo', { nom: r.fournisseur }))}>
                    {t(kind === 'creances' ? 'argent.collect' : 'argent.pay')}
                  </button>
                </div>
              )}
            </div>
            <div className="right">
              <strong>{money(r.reste, lang)}</strong>
              {r.en_retard && <span className="tag danger">{t('argent.late')}</span>}
            </div>
          </li>
        ))}
      </ul>
    )
  )

  return (
    <>
      <Panel icon="users" tone="sky" title={t('argent.receivables')}>{renderList(creances, 'creances')}</Panel>
      <Panel icon="receipt" tone="rose" title={t('argent.payables')}>{renderList(dettes, 'dettes')}</Panel>
    </>
  )
}
