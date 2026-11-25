import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import { useAuth } from '../../auth/AuthProvider'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { day, Empty, Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

const STATUTS = ['present', 'absent', 'retard', 'permission']

// Attendance of the day (Kenfack): one tap per employee, minutes for a late arrival, an absence can be justified.
// Unjustified absences propose a deduction when Dahirou prepares the pay (0068).
export function Presences() {
  const { t, i18n } = useTranslation()
  const run = useRun()
  const [date, setDate] = useState(localDate)
  const [lignes, setLignes] = useState({})
  const q = useQuery(async () => {
    const [eq, pr] = await Promise.all([
      supabase.from('equipe').select('id, nom, poste').eq('actif', true).order('nom'),
      supabase.from('presences').select('*').eq('date_jour', date)
    ])
    return { equipe: must(eq), presences: must(pr) }
  }, [date])
  useEffect(() => {
    if (q.data) setLignes(Object.fromEntries(q.data.presences.map((p) => [p.employe_id, { statut: p.statut, minutes_retard: p.minutes_retard, justifiee: p.justifiee }])))
  }, [q.data])

  if (!q.data) return <Loading error={q.error} />
  const set = (id, patch) => setLignes({ ...lignes, [id]: { ...(lignes[id] ?? {}), ...patch } })
  const tousPresents = () => setLignes(Object.fromEntries(q.data.equipe.map((e) => [e.id, lignes[e.id]?.statut ? lignes[e.id] : { statut: 'present' }])))
  const enregistrer = () => run(supabase.rpc('noter_presences', {
    p_date: date, p_lignes: q.data.equipe.filter((e) => lignes[e.id]?.statut).map((e) => ({ employe_id: e.id, ...lignes[e.id] }))
  }), q.reload)

  return (
    <Panel icon="check" tone="green" title={t('rh.attendance')} subtitle={t('rh.attendanceHint')}
      actions={<input type="date" value={date} max={localDate()} onChange={(ev) => ev.target.value && setDate(ev.target.value)} aria-label={t('saisie.date')} />}>
      {q.data.equipe.length === 0 ? <Empty icon="users" text={t('salaires.none')} /> : (
        <>
          <ul className="list presences">
            {q.data.equipe.map((e) => {
              const l = lignes[e.id] ?? {}
              return (
                <li key={e.id}>
                  <div className="grow"><strong>{e.nom}</strong>{e.poste ? <span className="muted"> · {e.poste}</span> : null}</div>
                  <div className="segmented small" role="group" aria-label={e.nom}>
                    {STATUTS.map((s) => <button key={s} type="button" className={l.statut === s ? 'active' : ''} onClick={() => set(e.id, { statut: s })}>{t(`rh.status.${s}`)}</button>)}
                  </div>
                  {l.statut === 'retard' && (
                    <label className="presence-extra">{t('rh.minutes')}
                      <input type="number" min="0" max="600" value={l.minutes_retard ?? ''} onChange={(ev) => set(e.id, { minutes_retard: Number(ev.target.value) })} /></label>
                  )}
                  {l.statut === 'absent' && (
                    <label className="presence-extra"><input type="checkbox" checked={!!l.justifiee} onChange={(ev) => set(e.id, { justifiee: ev.target.checked })} />{t('rh.justified')}</label>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="row">
            <button type="button" className="btn ghost" onClick={tousPresents}>{t('rh.allPresent')}</button>
            <button type="button" className="btn primary" style={{ flex: 1 }} onClick={enregistrer}><Icon name="check" size={18} />{t('rh.saveDay', { d: day(date, i18n.resolvedLanguage) })}</button>
          </div>
        </>
      )}
    </Panel>
  )
}

// Overtime: Kenfack declares, Ali authorises or refuses (only authorised hours go into the pay)
export function HeuresSup() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const declare = can(role, 'rh.heuresSup')
  const decide = can(role, 'rh.autoriser')
  const debut = `${localDate().slice(0, 7)}-01`
  const q = useQuery(async () => {
    const [eq, hs] = await Promise.all([
      supabase.from('equipe').select('id, nom').eq('actif', true).order('nom'),
      supabase.from('heures_sup').select('*').gte('date_jour', new Date(new Date(debut).setMonth(new Date(debut).getMonth() - 1)).toLocaleDateString('en-CA')).order('date_jour', { ascending: false })
    ])
    return { equipe: must(eq), hs: must(hs) }
  })

  const declarer = async () => {
    const v = await ask.form({ title: t('rh.otDeclare'), icon: 'clock', submit: t('rh.otSend'), message: t('rh.otHint'), fields: [
      { name: 'employe', label: t('rh.employee'), type: 'select', required: true, value: q.data.equipe[0]?.id ?? '', options: q.data.equipe.map((e) => ({ value: e.id, label: e.nom })) },
      { name: 'date', label: t('saisie.date'), type: 'date', value: localDate(), required: true },
      { name: 'heures', label: t('rh.hours'), type: 'number', min: 0.5, step: 0.5, max: 16, required: true },
      { name: 'nature', label: t('rh.otKind'), type: 'select', value: 'jour', options: [{ value: 'jour', label: t('rh.otDay') }, { value: 'nuit_dimanche_ferie', label: t('rh.otNight') }] },
      { name: 'motif', label: t('rh.otReason'), required: true }
    ] })
    if (v) await run(supabase.rpc('declarer_heures_sup', { p_employe: v.employe, p_date: v.date, p_heures: Number(v.heures), p_nature: v.nature, p_motif: v.motif }), q.reload)
  }
  const decider = async (ids, oui) => {
    let motif = null
    if (!oui) { motif = await ask.reason(t('rh.otRefuseTitle')); if (!motif) return }
    await run(supabase.rpc('decider_heures_sup', { p_ids: ids, p_autoriser: oui, p_motif: motif }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const nom = (id) => q.data.equipe.find((e) => e.id === id)?.nom ?? '—'
  const attente = q.data.hs.filter((h) => h.statut === 'demandee')
  return (
    <Panel icon="clock" tone="yolk" title={t('rh.overtime')} subtitle={t('rh.overtimeHint')}
      actions={declare && q.data.equipe.length > 0 ? <button className="btn primary sm" onClick={declarer}><Icon name="plus" size={14} />{t('rh.otDeclare')}</button> : null}>
      {decide && attente.length > 1 && <button className="btn primary sm" onClick={() => decider(attente.map((h) => h.id), true)}><Icon name="check" size={14} />{t('rh.otAuthoriseAll', { count: attente.length })}</button>}
      {q.data.hs.length === 0 ? <p className="muted">{t('rh.otNone')}</p> : (
        <ul className="list">
          {q.data.hs.map((h) => (
            <li key={h.id} className={h.statut === 'refusee' ? 'read' : ''}>
              <div className="grow">
                <strong>{nom(h.employe_id)}</strong> · {t('rh.otLine', { h: Number(h.heures).toLocaleString(lang), d: day(h.date_jour, lang) })}
                {h.nature === 'nuit_dimanche_ferie' && <span className="muted"> · {t('rh.otNightShort')}</span>}
                <div className="muted small">{h.motif}{h.motif_refus ? ` · ${t('rh.refused')} : ${h.motif_refus}` : ''}</div>
              </div>
              <span className={`tag ${h.statut === 'autorisee' ? 'ok' : h.statut === 'refusee' ? 'danger' : 'warn'}`}>{t(`rh.otStatus.${h.statut}`)}</span>
              {decide && h.statut === 'demandee' && (
                <div className="row-actions">
                  <button className="btn primary sm" onClick={() => decider([h.id], true)}>{t('rh.authorise')}</button>
                  <button className="btn ghost sm" onClick={() => decider([h.id], false)}>{t('rh.refuse')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
