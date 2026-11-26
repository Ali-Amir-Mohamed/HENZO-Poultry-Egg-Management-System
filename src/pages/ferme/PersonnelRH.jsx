import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import { useAuth } from '../../auth/AuthProvider'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { day, Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// HR step 3 (0069): contract and documents on each employee file (Dahirou, Ali), leave and permissions,
// evaluations (Kenfack). Files live in the private « administration » folder: <company>/employes/<employee>/…
const BUCKET = 'administration'
const TYPES_CONTRAT = ['cdi', 'cdd', 'stage', 'journalier']
const TYPES_DOC = ['contrat', 'identite', 'cv', 'diplome', 'certificat', 'autre']
const nomFichier = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)

// one line under the employee's name: « CDD jusqu'au 15/12/2026 · essai jusqu'au … »
export function ligneContrat(e, t, lang) {
  if (!e.type_contrat) return null
  return [t(`rh3.contract.${e.type_contrat}`),
    e.date_fin_contrat && t('rh3.until', { d: day(e.date_fin_contrat, lang) }),
    e.fin_periode_essai && t('rh3.trialUntil', { d: day(e.fin_periode_essai, lang) })].filter(Boolean).join(' · ')
}

export function useContrat(reload) {
  const { t } = useTranslation()
  const ask = useAsk()
  const run = useRun()
  return async (e) => {
    const v = await ask.form({ title: t('rh3.contractTitle', { nom: e.nom }), icon: 'note', submit: t('dialog.save'), message: t('rh3.contractHint'), fields: [
      { name: 'type', label: t('rh3.contractType'), type: 'select', value: e.type_contrat ?? 'cdi', options: TYPES_CONTRAT.map((c) => ({ value: c, label: t(`rh3.contract.${c}`) })) },
      { name: 'debut', label: t('rh3.start'), type: 'date', value: e.date_debut_contrat ?? e.date_embauche ?? '' },
      { name: 'fin', label: t('rh3.end'), type: 'date', value: e.date_fin_contrat ?? '', showIf: (x) => x.type !== 'cdi' },
      { name: 'essai', label: t('rh3.trialEnd'), type: 'date', value: e.fin_periode_essai ?? '' }
    ] })
    if (v) await run(supabase.rpc('maj_contrat', { p_employe: e.id, p_type: v.type, p_debut: v.debut || null, p_fin: v.type === 'cdi' ? null : v.fin || null, p_fin_essai: v.essai || null }), reload)
  }
}

// Documents of one employee, shown under his line: Ali and Dahirou add and remove, Kenfack (a partner) only opens them
export function DocumentsEmploye({ employe, onClose, lecture = false }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const [type, setType] = useState('contrat')
  const [busy, setBusy] = useState(false)
  const q = useQuery(async () => must(await supabase.from('documents_employes').select('*').eq('employe_id', employe.id).order('created_at', { ascending: false })), [employe.id])

  const ajouter = async (ev) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    if (f.size > 20 * 1048576) return ask.error(t('admin.doc.tooBig'))
    setBusy(true)
    try {
      const doc = must(await supabase.from('documents_employes').insert({ employe_id: employe.id, type_doc: type, titre: `${t(`rh3.doc.${type}`)} – ${f.name}` }).select().single())
      const chemin = `${doc.ferme_id}/employes/${employe.id}/${doc.id}-${nomFichier(f.name)}`
      const up = await supabase.storage.from(BUCKET).upload(chemin, f, { contentType: f.type || undefined })
      if (up.error) {
        await supabase.from('documents_employes').delete().eq('id', doc.id)
        throw new Error(t('admin.doc.uploadFailed', { e: up.error.message }))
      }
      must(await supabase.from('documents_employes').update({ fichier: chemin, type_fichier: f.type || null, taille: f.size }).eq('id', doc.id))
      q.reload()
    } catch (err) { ask.error(err.message) } finally { setBusy(false) }
  }
  const ouvrir = async (d) => {
    const w = window.open('', '_blank')
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.fichier, 300)
    if (error) { w?.close(); return ask.error(error.message) }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl
  }
  const supprimer = async (d) => {
    if (!(await ask.confirm(t('admin.deleteConfirm', { x: d.titre }), { title: t('admin.delete'), icon: 'trash', danger: true, submit: t('admin.delete') }))) return
    if (d.fichier) { const { error } = await supabase.storage.from(BUCKET).remove([d.fichier]); if (error) return ask.error(error.message) }
    await run(supabase.from('documents_employes').delete().eq('id', d.id), q.reload)
  }

  return (
    <div className="rh-docs">
      <div className="rh-docs-head"><strong>{t('rh3.docsOf', { nom: employe.nom })}</strong><button type="button" className="btn ghost sm" onClick={onClose}>{t('common.close')}</button></div>
      {!q.data ? <Loading error={q.error} /> : q.data.length === 0 ? <p className="muted small">{t('rh3.noDoc')}</p> : (
        <ul className="list">
          {q.data.map((d) => (
            <li key={d.id}>
              <div className="grow"><strong>{d.titre}</strong><div className="muted small">{day(d.created_at, lang)}</div></div>
              {d.fichier && <button type="button" className="btn ghost sm" onClick={() => ouvrir(d)}><Icon name="download" size={14} />{t('rh3.open')}</button>}
              {!lecture && <button type="button" className="btn ghost sm" onClick={() => supprimer(d)} aria-label={t('admin.delete')}><Icon name="trash" size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      {!lecture && <div className="row">
        <select value={type} onChange={(ev) => setType(ev.target.value)} aria-label={t('rh3.docType')}>
          {TYPES_DOC.map((x) => <option key={x} value={x}>{t(`rh3.doc.${x}`)}</option>)}
        </select>
        <label className={`btn primary sm ${busy ? 'disabled' : ''}`}>
          <Icon name="plus" size={14} />{busy ? t('common.loading') : t('rh3.addDoc')}
          <input type="file" hidden disabled={busy} onChange={ajouter} accept="image/*,application/pdf" />
        </label>
      </div>}
    </div>
  )
}

// Leave and permissions: requested by Kenfack (or Dahirou, Ali), granted or refused by Ali or Dahirou
export function Conges({ employes }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const decide = can(role, 'rh.conges.decider')
  const q = useQuery(async () => {
    const debut = new Date(); debut.setMonth(debut.getMonth() - 3)
    const conges = must(await supabase.from('conges').select('*').gte('date_fin', debut.toLocaleDateString('en-CA')).order('date_debut', { ascending: false }))
    const soldes = Object.fromEntries(await Promise.all(employes.map(async (e) => [e.id, (await supabase.rpc('solde_conges', { p_employe: e.id })).data])))
    return { conges, soldes }
  }, [employes.map((e) => e.id).join()])
  const nom = (id) => employes.find((e) => e.id === id)?.nom ?? '—'

  const demander = async () => {
    const v = await ask.form({ title: t('rh3.leaveAsk'), icon: 'calendar', submit: t('rh3.leaveSend'), message: t('rh3.leaveHint'), fields: [
      { name: 'employe', label: t('rh.employee'), type: 'select', required: true, value: employes[0]?.id ?? '',
        options: employes.map((e) => ({ value: e.id, label: `${e.nom}${q.data?.soldes[e.id] ? ` (${t('rh3.balanceShort', { n: Number(q.data.soldes[e.id].reste).toLocaleString(lang) })})` : ''}` })) },
      { name: 'type', label: t('rh3.leaveType'), type: 'select', value: 'conge', options: ['conge', 'permission', 'maladie'].map((x) => ({ value: x, label: t(`rh3.leave.${x}`) })) },
      { name: 'debut', label: t('rh3.from'), type: 'date', value: localDate(), required: true },
      { name: 'fin', label: t('rh3.to'), type: 'date', value: localDate(), required: true },
      { name: 'motif', label: t('rh3.leaveReason'), showIf: (x) => x.type !== 'conge' }
    ] })
    if (v) await run(supabase.rpc('demander_conge', { p_employe: v.employe, p_type: v.type, p_debut: v.debut, p_fin: v.fin, p_motif: v.motif || null }), q.reload)
  }
  const decider = async (c, oui) => {
    let motif = null
    if (!oui) { motif = await ask.reason(t('rh3.leaveRefuse')); if (!motif) return }
    await run(supabase.rpc('decider_conge', { p_id: c.id, p_accorder: oui, p_motif: motif }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  return (
    <Panel icon="calendar" tone="sky" title={t('rh3.leaveTitle')} subtitle={t('rh3.leaveSubtitle')}
      actions={<button className="btn primary sm" onClick={demander}><Icon name="plus" size={14} />{t('rh3.leaveAsk')}</button>}>
      <div className="rh-soldes">
        {employes.map((e) => q.data.soldes[e.id] && (
          <span key={e.id}><strong>{e.nom}</strong> {t('rh3.balance', { n: Number(q.data.soldes[e.id].reste).toLocaleString(lang), a: Number(q.data.soldes[e.id].acquis).toLocaleString(lang) })}</span>
        ))}
      </div>
      {q.data.conges.length === 0 ? <p className="muted">{t('rh3.noLeave')}</p> : (
        <ul className="list">
          {q.data.conges.map((c) => (
            <li key={c.id} className={c.statut === 'refusee' ? 'read' : ''}>
              <div className="grow">
                <strong>{nom(c.employe_id)}</strong> · {t(`rh3.leave.${c.type_conge}`)} · {t('rh3.leaveLine', { a: day(c.date_debut, lang), b: day(c.date_fin, lang), n: Number(c.jours).toLocaleString(lang) })}
                {(c.motif || c.motif_refus) && <div className="muted small">{[c.motif, c.motif_refus && `${t('rh.refused')} : ${c.motif_refus}`].filter(Boolean).join(' · ')}</div>}
              </div>
              <span className={`tag ${c.statut === 'accordee' ? 'ok' : c.statut === 'refusee' ? 'danger' : 'warn'}`}>{t(`rh3.leaveStatus.${c.statut}`)}</span>
              {decide && c.statut === 'demandee' && (
                <div className="row-actions">
                  <button className="btn primary sm" onClick={() => decider(c, true)}>{t('rh3.grant')}</button>
                  <button className="btn ghost sm" onClick={() => decider(c, false)}>{t('rh.refuse')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// Evaluations by Kenfack: punctuality, work, behaviour from 1 to 5, and a comment
export function Evaluations({ employes }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const evalue = can(role, 'rh.evaluer')
  const q = useQuery(async () => must(await supabase.from('evaluations').select('*').order('date_eval', { ascending: false }).order('created_at', { ascending: false })))
  const notes = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} – ${t(`rh3.mark.${n}`)}` }))

  const evaluer = async (e) => {
    const v = await ask.form({ title: t('rh3.evalTitle', { nom: e.nom }), icon: 'check', submit: t('dialog.save'), fields: [
      { name: 'ponctualite', label: t('rh3.punctuality'), type: 'select', value: '3', options: notes },
      { name: 'travail', label: t('rh3.work'), type: 'select', value: '3', options: notes },
      { name: 'comportement', label: t('rh3.behaviour'), type: 'select', value: '3', options: notes },
      { name: 'commentaire', label: t('rh3.comment'), type: 'textarea' }
    ] })
    if (v) await run(supabase.rpc('evaluer_employe', { p_employe: e.id, p_ponctualite: Number(v.ponctualite), p_travail: Number(v.travail), p_comportement: Number(v.comportement), p_commentaire: v.commentaire || null }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  return (
    <Panel icon="chart" tone="green" title={t('rh3.evalPanel')} subtitle={t('rh3.evalHint')}>
      <ul className="list">
        {employes.map((e) => {
          const der = q.data.find((x) => x.employe_id === e.id)
          const moy = der ? ((der.ponctualite + der.travail + der.comportement) / 3).toLocaleString(lang, { maximumFractionDigits: 1 }) : null
          return (
            <li key={e.id}>
              <div className="grow">
                <strong>{e.nom}</strong>
                <div className="muted small">{der
                  ? `${t('rh3.lastEval', { d: day(der.date_eval, lang), m: moy })} · ${t('rh3.punctuality')} ${der.ponctualite}/5 · ${t('rh3.work')} ${der.travail}/5 · ${t('rh3.behaviour')} ${der.comportement}/5${der.commentaire ? ` · « ${der.commentaire} »` : ''}`
                  : t('rh3.neverEvaluated')}</div>
              </div>
              {evalue && <button className="btn ghost sm" onClick={() => evaluer(e)}>{t('rh3.evaluate')}</button>}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
