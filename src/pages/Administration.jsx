import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../config'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import Icon from '../components/Icon'
import { day, Empty, Field, FormCard, Loading, money, Panel, Tabs } from '../components/ui'
import { useAsk, useRun } from '../components/Dialog'

// Administration: the director has deadlines with phone reminders, company documents (private storage),
// land and bank accounts; finance manages the bank accounts and sees the land; operations sees the land.
// Never a password or a PIN code here.
const BUCKET = 'administration'
const CAT_DOCS = ['entreprise', 'impots', 'banque', 'foncier', 'contrat', 'autre']
const CAT_ECH = ['impots', 'entreprise', 'banque', 'foncier', 'autre']
const RECURRENCES = ['aucune', 'mensuelle', 'trimestrielle', 'annuelle']
const STATUTS = ['prospection', 'en_cours', 'achete', 'titre']
const TABS = [
  { id: 'echeances', label: 'admin.tabs.echeances', icon: 'calendar' },
  { id: 'documents', label: 'admin.tabs.documents', icon: 'note' },
  { id: 'terrains', label: 'admin.tabs.terrains', icon: 'flag' },
  { id: 'banques', label: 'admin.tabs.banques', icon: 'wallet' }
]
const today = () => new Date().toLocaleDateString('en-CA')
const joursAvant = (d) => Math.round((new Date(`${d}T00:00`) - new Date(`${today()}T00:00`)) / 86400000)

export default function Administration() {
  const { role } = useAuth()
  const tabs = can(role, 'admin.complet') ? TABS
    : TABS.filter((x) => (x.id === 'terrains' && can(role, 'admin.terrains')) || (x.id === 'banques' && can(role, 'admin.banques')))
  const [choix, setTab] = useState(() => { try { return localStorage.getItem('henzo.admin.tab') || 'echeances' } catch { return 'echeances' } })
  const tab = tabs.some((x) => x.id === choix) ? choix : tabs[0].id
  useEffect(() => { try { localStorage.setItem('henzo.admin.tab', tab) } catch { /* ignore */ } }, [tab])
  return (
    <div className="stack">
      {tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs} />}
      {tab === 'echeances' && <Echeances />}
      {tab === 'documents' && <Documents />}
      {tab === 'terrains' && <Terrains />}
      {tab === 'banques' && <Banques />}
    </div>
  )
}

// ---------------------------------------------------------------- Deadlines
function Echeances() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => must(await supabase.from('admin_echeances').select('*').order('date_echeance')))
  const vide = { titre: '', categorie: 'impots', date_echeance: '', rappel_jours: 7, montant: '', recurrence: 'aucune', notes: '' }
  const [form, setForm] = useState(vide)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const opts = (list, prefix) => list.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }))

  const creer = async () => {
    must(await supabase.from('admin_echeances').insert({ ...form, rappel_jours: Number(form.rappel_jours) || 0, montant: form.montant === '' ? null : Number(form.montant), notes: form.notes || null }))
    setForm(vide); q.reload()
    return t('admin.ech.created')
  }
  const faite = async (e) => {
    const msg = e.recurrence === 'aucune' ? t('admin.ech.doneConfirm') : t('admin.ech.doneNext', { r: t(`admin.recurrence.${e.recurrence}`).toLowerCase() })
    if (await ask.confirm(msg, { title: e.titre, icon: 'check', submit: t('admin.ech.done') })) await run(supabase.from('admin_echeances').update({ faite: true }).eq('id', e.id), q.reload)
  }
  const modifier = async (e) => {
    const v = await ask.form({ title: e.titre, icon: 'calendar', submit: t('dialog.save'), fields: [
      { name: 'titre', label: t('admin.title'), value: e.titre, required: true },
      { name: 'categorie', label: t('admin.category'), type: 'select', value: e.categorie, options: opts(CAT_ECH, 'admin.cat') },
      { name: 'date_echeance', label: t('admin.ech.date'), type: 'date', value: e.date_echeance, required: true },
      { name: 'rappel_jours', label: t('admin.ech.remind'), type: 'number', min: 0, max: 90, value: e.rappel_jours, required: true },
      { name: 'montant', label: t('admin.ech.amount'), type: 'number', min: 0, value: e.montant ?? '' },
      { name: 'recurrence', label: t('admin.ech.repeat'), type: 'select', value: e.recurrence, options: opts(RECURRENCES, 'admin.recurrence') },
      { name: 'notes', label: t('admin.notes'), type: 'textarea', value: e.notes ?? '' }
    ] })
    if (v) await run(supabase.from('admin_echeances').update({ ...v, montant: v.montant === '' ? null : v.montant, notes: v.notes || null }).eq('id', e.id), q.reload)
  }
  const supprimer = async (e) => {
    if (await ask.confirm(t('admin.deleteConfirm', { x: e.titre }), { title: t('admin.delete'), icon: 'trash', danger: true, submit: t('admin.delete') })) await run(supabase.from('admin_echeances').delete().eq('id', e.id), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const aFaire = q.data.filter((e) => !e.faite)
  const faites = q.data.filter((e) => e.faite).sort((a, b) => (b.faite_le ?? '').localeCompare(a.faite_le ?? '')).slice(0, 10)
  const etat = (e) => {
    const n = joursAvant(e.date_echeance)
    if (n < 0) return <span className="tag danger">{t('admin.ech.late', { count: -n })}</span>
    if (n === 0) return <span className="tag warn">{t('admin.ech.today')}</span>
    return <span className={`tag ${n <= e.rappel_jours ? 'warn' : 'muted'}`}>{t('admin.ech.inDays', { count: n })}</span>
  }

  return (
    <>
      <Panel icon="calendar" tone="yolk" title={t('admin.ech.title')} subtitle={t('admin.ech.hint')}>
        {aFaire.length === 0 ? <Empty icon="calendar" text={t('admin.ech.none')} /> : (
          <ul className="list">
            {aFaire.map((e) => (
              <li key={e.id}>
                <div className="grow">
                  <strong>{e.titre}</strong>
                  <div className="muted small">
                    {day(e.date_echeance, lang)} · {t(`admin.cat.${e.categorie}`)}{e.montant != null ? ` · ${money(e.montant, lang)}` : ''}
                    {e.recurrence !== 'aucune' ? ` · ${t(`admin.recurrence.${e.recurrence}`)}` : ''}
                  </div>
                  {e.notes && <div className="muted small">{e.notes}</div>}
                  <div className="row-actions">
                    <button className="btn primary sm" onClick={() => faite(e)}><Icon name="check" size={14} />{t('admin.ech.done')}</button>
                    <button className="btn ghost sm" onClick={() => modifier(e)}>{t('common.edit')}</button>
                    <button className="btn ghost sm" onClick={() => supprimer(e)} aria-label={t('admin.delete')}><Icon name="trash" size={14} /></button>
                  </div>
                </div>
                {etat(e)}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <FormCard title={t('admin.ech.new')} icon="calendar" onSubmit={creer}>
        <div className="grid-2">
          <Field label={t('admin.title')}><input required value={form.titre} onChange={set('titre')} placeholder={t('admin.ech.titlePh')} /></Field>
          <Field label={t('admin.category')}><select value={form.categorie} onChange={set('categorie')}>{CAT_ECH.map((c) => <option key={c} value={c}>{t(`admin.cat.${c}`)}</option>)}</select></Field>
          <Field label={t('admin.ech.date')}><input type="date" required value={form.date_echeance} onChange={set('date_echeance')} /></Field>
          <Field label={t('admin.ech.remind')}><input type="number" min="0" max="90" required value={form.rappel_jours} onChange={set('rappel_jours')} /></Field>
          <Field label={t('admin.ech.amount')}><input type="number" min="0" value={form.montant} onChange={set('montant')} /></Field>
          <Field label={t('admin.ech.repeat')}><select value={form.recurrence} onChange={set('recurrence')}>{RECURRENCES.map((r) => <option key={r} value={r}>{t(`admin.recurrence.${r}`)}</option>)}</select></Field>
        </div>
        <Field label={t('admin.notes')}><textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </FormCard>

      {faites.length > 0 && (
        <Panel icon="check" tone="green" title={t('admin.ech.doneTitle')}>
          <ul className="list">
            {faites.map((e) => (
              <li key={e.id} className="read">
                <div className="grow"><strong>{e.titre}</strong><div className="muted small">{t('admin.ech.doneOn', { d: day(e.faite_le, lang) })} · {t('admin.ech.planned', { d: day(e.date_echeance, lang) })}</div></div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  )
}

// ---------------------------------------------------------------- Documents
const nomFichier = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80)
const taille = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`)

function Documents() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => {
    const [docs, terrains] = await Promise.all([
      supabase.from('admin_documents').select('*').order('created_at', { ascending: false }),
      supabase.from('admin_terrains').select('id, nom').order('nom')
    ])
    return { docs: must(docs), terrains: must(terrains) }
  })
  const vide = { titre: '', categorie: 'entreprise', date_document: '', date_expiration: '', terrain_id: '', notes: '' }
  const [form, setForm] = useState(vide)
  const [fichier, setFichier] = useState(null)
  const [filtre, setFiltre] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const creer = async () => {
    if (fichier && fichier.size > 20 * 1048576) throw new Error(t('admin.doc.tooBig'))
    const doc = must(await supabase.from('admin_documents').insert({
      titre: form.titre, categorie: form.categorie, date_document: form.date_document || null, date_expiration: form.date_expiration || null,
      terrain_id: form.terrain_id || null, notes: form.notes || null
    }).select().single())
    if (fichier) {
      const chemin = `${doc.ferme_id}/${doc.id}/${nomFichier(fichier.name)}`
      const up = await supabase.storage.from(BUCKET).upload(chemin, fichier, { contentType: fichier.type || undefined })
      if (up.error) {
        await supabase.from('admin_documents').delete().eq('id', doc.id)
        throw new Error(t('admin.doc.uploadFailed', { e: up.error.message }))
      }
      must(await supabase.from('admin_documents').update({ fichier: chemin, type_fichier: fichier.type || null, taille: fichier.size }).eq('id', doc.id))
    }
    setForm(vide); setFichier(null); q.reload()
    return t('admin.doc.created')
  }
  const ouvrir = async (d) => {
    const w = window.open('', '_blank')   // opened now: phones block windows opened after a wait
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.fichier, 300)
    if (error) { w?.close(); return ask.error(error.message) }
    if (w) w.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  }
  const modifier = async (d) => {
    const v = await ask.form({ title: d.titre, icon: 'note', submit: t('dialog.save'), fields: [
      { name: 'titre', label: t('admin.title'), value: d.titre, required: true },
      { name: 'categorie', label: t('admin.category'), type: 'select', value: d.categorie, options: CAT_DOCS.map((c) => ({ value: c, label: t(`admin.cat.${c}`) })) },
      { name: 'date_document', label: t('admin.doc.date'), type: 'date', value: d.date_document ?? '' },
      { name: 'date_expiration', label: t('admin.doc.expires'), type: 'date', value: d.date_expiration ?? '' },
      { name: 'terrain_id', label: t('admin.doc.land'), type: 'select', value: d.terrain_id ?? '', options: [{ value: '', label: '—' }, ...q.data.terrains.map((x) => ({ value: x.id, label: x.nom }))] },
      { name: 'notes', label: t('admin.notes'), type: 'textarea', value: d.notes ?? '' }
    ] })
    if (v) await run(supabase.from('admin_documents').update({ ...v, date_document: v.date_document || null, date_expiration: v.date_expiration || null, terrain_id: v.terrain_id || null, notes: v.notes || null }).eq('id', d.id), q.reload)
  }
  const supprimer = async (d) => {
    if (!(await ask.confirm(t('admin.deleteConfirm', { x: d.titre }), { title: t('admin.delete'), icon: 'trash', danger: true, submit: t('admin.delete') }))) return
    if (d.fichier) {
      const { error } = await supabase.storage.from(BUCKET).remove([d.fichier])
      if (error) return ask.error(error.message)
    }
    await run(supabase.from('admin_documents').delete().eq('id', d.id), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const docs = q.data.docs.filter((d) => !filtre || d.categorie === filtre)
  const terrain = (id) => q.data.terrains.find((x) => x.id === id)?.nom
  const expiration = (d) => {
    if (!d.date_expiration) return null
    const n = joursAvant(d.date_expiration)
    if (n < 0) return <span className="tag danger">{t('admin.doc.expired')}</span>
    if (n <= 30) return <span className="tag warn">{t('admin.doc.expiresIn', { count: n })}</span>
    return null
  }

  return (
    <>
      <Panel icon="note" tone="sky" title={t('admin.doc.title')} subtitle={t('admin.doc.hint')}
        actions={<select className="compact" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label={t('admin.category')}>
          <option value="">{t('admin.all')}</option>{CAT_DOCS.map((c) => <option key={c} value={c}>{t(`admin.cat.${c}`)}</option>)}
        </select>}>
        {docs.length === 0 ? <Empty icon="note" text={t('admin.doc.none')} /> : (
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id}>
                <div className="grow">
                  <strong>{d.titre}</strong>
                  <div className="muted small">
                    {[t(`admin.cat.${d.categorie}`), d.date_document && day(d.date_document, lang), d.date_expiration && t('admin.doc.until', { d: day(d.date_expiration, lang) }),
                      terrain(d.terrain_id), d.taille && taille(d.taille)].filter(Boolean).join(' · ')}
                  </div>
                  {d.notes && <div className="muted small">{d.notes}</div>}
                  <div className="row-actions">
                    {d.fichier ? <button className="btn primary sm" onClick={() => ouvrir(d)}><Icon name="download" size={14} />{t('admin.doc.open')}</button>
                      : <span className="tag muted">{t('admin.doc.noFile')}</span>}
                    <button className="btn ghost sm" onClick={() => modifier(d)}>{t('common.edit')}</button>
                    <button className="btn ghost sm" onClick={() => supprimer(d)} aria-label={t('admin.delete')}><Icon name="trash" size={14} /></button>
                  </div>
                </div>
                {expiration(d)}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <FormCard title={t('admin.doc.new')} icon="note" onSubmit={creer}>
        <div className="grid-2">
          <Field label={t('admin.title')}><input required value={form.titre} onChange={set('titre')} placeholder={t('admin.doc.titlePh')} /></Field>
          <Field label={t('admin.category')}><select value={form.categorie} onChange={set('categorie')}>{CAT_DOCS.map((c) => <option key={c} value={c}>{t(`admin.cat.${c}`)}</option>)}</select></Field>
          <Field label={t('admin.doc.file')}><input type="file" accept="image/*,application/pdf" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} /></Field>
          <Field label={t('admin.doc.date')}><input type="date" value={form.date_document} onChange={set('date_document')} /></Field>
          <Field label={t('admin.doc.expires')}><input type="date" value={form.date_expiration} onChange={set('date_expiration')} /></Field>
          {q.data.terrains.length > 0 && (
            <Field label={t('admin.doc.land')}><select value={form.terrain_id} onChange={set('terrain_id')}><option value="">—</option>{q.data.terrains.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></Field>
          )}
        </div>
        <Field label={t('admin.notes')}><textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
        <p className="note"><Icon name="alert" size={16} />{t('admin.doc.fileHint')}</p>
      </FormCard>
    </>
  )
}

// ---------------------------------------------------------------- Land
function Terrains() {
  const { role } = useAuth()
  const gere = can(role, 'admin.complet')
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => {
    const [terrains, docs] = await Promise.all([
      supabase.from('admin_terrains').select('*').order('created_at', { ascending: false }),
      gere ? supabase.from('admin_documents').select('id, terrain_id').not('terrain_id', 'is', null) : { data: [] }
    ])
    return { terrains: must(terrains), docs: must(docs) }
  }, [gere])
  const vide = { nom: '', localisation: '', surface_m2: '', prix: '', statut: 'prospection', date_acquisition: '', vendeur: '', notes: '' }
  const [form, setForm] = useState(vide)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const propre = (v) => ({ ...v, surface_m2: v.surface_m2 === '' ? null : Number(v.surface_m2), prix: v.prix === '' ? null : Number(v.prix),
    localisation: v.localisation || null, date_acquisition: v.date_acquisition || null, vendeur: v.vendeur || null, notes: v.notes || null })

  const creer = async () => {
    must(await supabase.from('admin_terrains').insert(propre(form)))
    setForm(vide); q.reload()
    return t('admin.land.created')
  }
  const modifier = async (x) => {
    const v = await ask.form({ title: x.nom, icon: 'flag', submit: t('dialog.save'), fields: [
      { name: 'nom', label: t('reglages.name'), value: x.nom, required: true },
      { name: 'localisation', label: t('admin.land.place'), value: x.localisation ?? '' },
      { name: 'surface_m2', label: t('admin.land.surface'), type: 'number', min: 0, value: x.surface_m2 ?? '' },
      { name: 'prix', label: t('admin.land.price'), type: 'number', min: 0, value: x.prix ?? '' },
      { name: 'statut', label: t('stock.status'), type: 'select', value: x.statut, options: STATUTS.map((s) => ({ value: s, label: t(`admin.land.statut.${s}`) })) },
      { name: 'date_acquisition', label: t('admin.land.date'), type: 'date', value: x.date_acquisition ?? '' },
      { name: 'vendeur', label: t('admin.land.seller'), value: x.vendeur ?? '' },
      { name: 'notes', label: t('admin.notes'), type: 'textarea', value: x.notes ?? '' }
    ] })
    if (v) await run(supabase.from('admin_terrains').update(propre(v)).eq('id', x.id), q.reload)
  }
  const supprimer = async (x) => {
    if (await ask.confirm(t('admin.land.deleteConfirm', { x: x.nom }), { title: t('admin.delete'), icon: 'trash', danger: true, submit: t('admin.delete') })) await run(supabase.from('admin_terrains').delete().eq('id', x.id), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const tone = { prospection: 'muted', en_cours: 'warn', achete: 'ok', titre: 'ok' }
  return (
    <>
      <Panel icon="flag" tone="green" title={t('admin.land.title')} subtitle={gere ? t('admin.land.hint') : t('admin.land.readOnly')}>
        {q.data.terrains.length === 0 ? <Empty icon="flag" text={t('admin.land.none')} /> : (
          <ul className="list">
            {q.data.terrains.map((x) => {
              const nDocs = q.data.docs.filter((d) => d.terrain_id === x.id).length
              return (
                <li key={x.id}>
                  <div className="grow">
                    <strong>{x.nom}</strong>
                    <div className="muted small">
                      {[x.localisation, x.surface_m2 && `${Number(x.surface_m2).toLocaleString(lang)} m²`, x.prix != null && money(x.prix, lang),
                        x.date_acquisition && day(x.date_acquisition, lang), x.vendeur, gere && t('admin.land.docs', { count: nDocs })].filter(Boolean).join(' · ')}
                    </div>
                    {x.notes && <div className="muted small">{x.notes}</div>}
                    {gere && (
                      <div className="row-actions">
                        <button className="btn ghost sm" onClick={() => modifier(x)}>{t('common.edit')}</button>
                        <button className="btn ghost sm" onClick={() => supprimer(x)} aria-label={t('admin.delete')}><Icon name="trash" size={14} /></button>
                      </div>
                    )}
                  </div>
                  <span className={`tag ${tone[x.statut]}`}>{t(`admin.land.statut.${x.statut}`)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {gere && <FormCard title={t('admin.land.new')} icon="flag" onSubmit={creer}>
        <div className="grid-2">
          <Field label={t('reglages.name')}><input required value={form.nom} onChange={set('nom')} placeholder={t('admin.land.namePh')} /></Field>
          <Field label={t('admin.land.place')}><input value={form.localisation} onChange={set('localisation')} /></Field>
          <Field label={t('admin.land.surface')}><input type="number" min="0" step="0.01" value={form.surface_m2} onChange={set('surface_m2')} /></Field>
          <Field label={t('admin.land.price')}><input type="number" min="0" value={form.prix} onChange={set('prix')} /></Field>
          <Field label={t('stock.status')}><select value={form.statut} onChange={set('statut')}>{STATUTS.map((s) => <option key={s} value={s}>{t(`admin.land.statut.${s}`)}</option>)}</select></Field>
          <Field label={t('admin.land.date')}><input type="date" value={form.date_acquisition} onChange={set('date_acquisition')} /></Field>
          <Field label={t('admin.land.seller')}><input value={form.vendeur} onChange={set('vendeur')} /></Field>
        </div>
        <Field label={t('admin.notes')}><textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </FormCard>}
    </>
  )
}

// ---------------------------------------------------------------- Bank accounts
function Banques() {
  const { t } = useTranslation()
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => must(await supabase.from('admin_comptes_bancaires').select('*').order('actif', { ascending: false }).order('banque')))
  const vide = { banque: '', intitule: '', numero: '', agence: '', contact: '', notes: '' }
  const [form, setForm] = useState(vide)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const propre = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]))

  const creer = async () => {
    must(await supabase.from('admin_comptes_bancaires').insert(propre(form)))
    setForm(vide); q.reload()
    return t('admin.bank.created')
  }
  const modifier = async (c) => {
    const v = await ask.form({ title: c.banque, icon: 'wallet', submit: t('dialog.save'), message: t('admin.bank.never'), fields: [
      { name: 'banque', label: t('admin.bank.bank'), value: c.banque, required: true },
      { name: 'intitule', label: t('admin.bank.holder'), value: c.intitule ?? '' },
      { name: 'numero', label: t('admin.bank.number'), value: c.numero ?? '' },
      { name: 'agence', label: t('admin.bank.branch'), value: c.agence ?? '' },
      { name: 'contact', label: t('admin.bank.contact'), value: c.contact ?? '' },
      { name: 'actif', label: t('stock.status'), type: 'select', value: c.actif ? 'oui' : 'non', options: [{ value: 'oui', label: t('admin.bank.open') }, { value: 'non', label: t('admin.bank.closed') }] },
      { name: 'notes', label: t('admin.notes'), type: 'textarea', value: c.notes ?? '' }
    ] })
    if (v) await run(supabase.from('admin_comptes_bancaires').update({ ...propre(v), banque: v.banque, actif: v.actif === 'oui' }).eq('id', c.id), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  return (
    <>
      <div className="alert warn"><Icon name="alert" size={18} />{t('admin.bank.never')}</div>
      <Panel icon="wallet" tone="green" title={t('admin.bank.title')} subtitle={t('admin.bank.hint')}>
        {q.data.length === 0 ? <Empty icon="wallet" text={t('admin.bank.none')} /> : (
          <ul className="list">
            {q.data.map((c) => (
              <li key={c.id} className={c.actif ? '' : 'read'}>
                <div className="grow">
                  <strong>{c.banque}</strong>{c.intitule ? <span className="muted"> · {c.intitule}</span> : null}
                  <div className="muted small">{[c.numero, c.agence, c.contact].filter(Boolean).join(' · ') || '—'}</div>
                  {c.notes && <div className="muted small">{c.notes}</div>}
                  <div className="row-actions"><button className="btn ghost sm" onClick={() => modifier(c)}>{t('common.edit')}</button></div>
                </div>
                {!c.actif && <span className="tag muted">{t('admin.bank.closed')}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <FormCard title={t('admin.bank.new')} icon="wallet" onSubmit={creer}>
        <div className="grid-2">
          <Field label={t('admin.bank.bank')}><input required value={form.banque} onChange={set('banque')} /></Field>
          <Field label={t('admin.bank.holder')}><input value={form.intitule} onChange={set('intitule')} /></Field>
          <Field label={t('admin.bank.number')}><input value={form.numero} onChange={set('numero')} autoComplete="off" /></Field>
          <Field label={t('admin.bank.branch')}><input value={form.agence} onChange={set('agence')} /></Field>
          <Field label={t('admin.bank.contact')}><input value={form.contact} onChange={set('contact')} placeholder={t('admin.bank.contactPh')} /></Field>
        </div>
        <Field label={t('admin.notes')}><textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </FormCard>
    </>
  )
}
