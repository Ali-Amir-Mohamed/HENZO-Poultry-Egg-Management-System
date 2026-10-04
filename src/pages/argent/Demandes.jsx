import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Ask the director for a correction (finance, exploitation). Returns a function to call with the record.
// kind: 'ventes' | 'depenses' (cancellation) or 'ecritures' (cash correction)
export function useDemandeCorrection(onDone) {
  const { t } = useTranslation()
  const ask = useAsk()
  const run = useRun()
  return async (kind, id, resume) => {
    const corriger = kind === 'ecritures'
    const v = await ask.form({
      title: t('demandes.askTitle'), icon: 'note', submit: t('demandes.send'), message: t('demandes.askHint', { resume }),
      fields: [
        ...(corriger ? [
          { name: 'sens', label: t('argent.correctionDirection'), type: 'select', value: 'sortie',
            options: [{ value: 'entree', label: t('argent.correctionAdd') }, { value: 'sortie', label: t('argent.correctionRemove') }] },
          { name: 'montant', label: t('argent.correctionAmountLabel'), type: 'number', min: 1, required: true }
        ] : []),
        { name: 'motif', label: t('demandes.reason'), type: 'textarea', required: true, placeholder: t('demandes.reasonPh') }
      ]
    })
    if (!v) return
    const ok = await run(supabase.from('demandes_correction').insert({
      cible_table: kind, cible_id: id, action: corriger ? 'corriger' : 'annuler',
      sens: corriger ? v.sens : null, montant: corriger ? v.montant : null, resume, motif: v.motif.trim()
    }), onDone)
    if (ok) await ask.info(t('demandes.sentTitle'), t('demandes.sentText'))
  }
}

// Pending requests (director decides) and the requester's own requests
export default function Demandes({ onChange }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const directeur = can(role, 'correction')
  const q = useQuery(async () => must(await supabase.from('demandes_correction')
    .select('*, demandeur:profiles!demandes_correction_demande_par_fkey(nom_complet, identifiant)')
    .order('created_at', { ascending: false }).limit(directeur ? 50 : 20)))
  const reload = () => { q.reload(); onChange?.() }

  const decider = async (d, accepter) => {
    if (accepter) {
      if (!(await ask.confirm(t('demandes.confirmAccept', { resume: d.resume }), { title: t('demandes.accept'), icon: 'check', submit: t('demandes.accept') }))) return
      await run(supabase.rpc('decider_demande', { p_demande: d.id, p_accepter: true }), reload)
    } else {
      const motif = await ask.reason(t('demandes.refuseTitle'))
      if (motif) await run(supabase.rpc('decider_demande', { p_demande: d.id, p_accepter: false, p_motif_refus: motif }), reload)
    }
  }

  const rows = q.data ?? []
  const attente = rows.filter((d) => d.statut === 'en_attente')
  // Director: shown when something waits; requester: his own requests and their answers
  if (directeur ? !attente.length : !rows.length) return null
  const desc = (d) => d.action === 'annuler'
    ? t(`demandes.cancel_${d.cible_table}`)
    : t('demandes.correctLine', { sens: t(d.sens === 'entree' ? 'argent.correctionAdd' : 'argent.correctionRemove'), n: Number(d.montant).toLocaleString(lang) })

  return (
    <Panel icon="note" tone="rose" title={directeur ? t('demandes.titleDirector', { count: attente.length }) : t('demandes.titleMine')}>
      <ul className="list">
        {(directeur ? attente : rows).map((d) => (
          <li key={d.id}>
            <div className="grow">
              <strong>{d.resume}</strong>
              <div className="small">{desc(d)} · « {d.motif} »</div>
              <div className="muted small">
                {new Date(d.created_at).toLocaleString(lang)}
                {directeur ? ` · ${d.demandeur?.nom_complet || d.demandeur?.identifiant || ''}` : ''}
                {d.motif_refus ? ` · ${t('demandes.refusedBecause', { motif: d.motif_refus })}` : ''}
              </div>
              {directeur && d.statut === 'en_attente' && (
                <div className="row-actions">
                  <button className="btn primary sm" onClick={() => decider(d, true)}><Icon name="check" size={14} />{t('demandes.accept')}</button>
                  <button className="btn ghost sm" onClick={() => decider(d, false)}>{t('demandes.refuse')}</button>
                </div>
              )}
            </div>
            <span className={`tag ${d.statut === 'acceptee' ? 'ok' : d.statut === 'refusee' ? 'danger' : 'warn'}`}>{t(`demandes.statuts.${d.statut}`)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
