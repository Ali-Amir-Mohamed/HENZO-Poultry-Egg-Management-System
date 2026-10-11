import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Investors' capital placed in this broiler flock (director, finance, exploitation). At closure: rate × amount placed.
// An allocation is locked once saved: only the director can cancel it (with a reason) before closure.
export default function CapitalBande({ bande }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const manage = can(role, 'capital.allocate') && bande.statut !== 'cloturee'
  const q = useQuery(async () => {
    const [alloc, libres, ferme] = await Promise.all([
      supabase.from('capital_bandes').select('id, montant, created_at, investisseur:investisseurs(id, nom)').eq('bande_id', bande.id).eq('annulee', false).order('created_at'),
      supabase.from('capital_libre_investisseurs').select('investisseur_id, nom, libre').order('nom'),
      supabase.from('fermes').select('taux_investisseurs').limit(1).maybeSingle()
    ])
    return { alloc: must(alloc), libres: must(libres), taux: Number(ferme.data?.taux_investisseurs ?? 10) }
  }, [bande.id])

  if (!q.data) return null // nothing to show (or migration 0020 not run yet)
  const { alloc, libres, taux } = q.data
  const total = alloc.reduce((s, a) => s + Number(a.montant), 0)
  const dejaIci = new Set(alloc.map((a) => a.investisseur.id))
  const disponibles = libres.filter((l) => Number(l.libre) > 0 && !dejaIci.has(l.investisseur_id))
  if (!alloc.length && !disponibles.length && !manage) return null

  const placer = async () => {
    const v = await ask.form({
      title: t('capitalBande.placeTitle', { code: bande.code }), icon: 'users', submit: t('capitalBande.save'),
      message: t('capitalBande.placeHint', { taux }),
      fields: disponibles.map((l) => ({ name: l.investisseur_id, label: `${l.nom} — ${t('capitalBande.freeN', { n: money(l.libre, lang) })}`, type: 'number', min: 0, max: Number(l.libre), placeholder: '0' }))
    })
    if (!v) return
    const lignes = disponibles.filter((l) => Number(v[l.investisseur_id]) > 0).map((l) => ({ bande_id: bande.id, investisseur_id: l.investisseur_id, montant: Number(v[l.investisseur_id]), nom: l.nom }))
    if (!lignes.length) return
    const resume = lignes.map((l) => `${l.nom} : ${money(l.montant, lang)} → 10 % = ${money(Math.round(l.montant * taux / 100), lang)}`).join('\n')
    if (!(await ask.confirm(t('capitalBande.confirm', { code: bande.code, resume }), { title: t('capitalBande.placeTitle', { code: bande.code }), icon: 'users', submit: t('capitalBande.save') }))) return
    await run(supabase.from('capital_bandes').insert(lignes.map(({ nom, ...l }) => l)), q.reload) // eslint-disable-line no-unused-vars
  }

  const annuler = async (a) => {
    const motif = await ask.reason(t('capitalBande.cancelTitle', { nom: a.investisseur.nom, n: money(a.montant, lang) }))
    if (motif) await run(supabase.from('capital_bandes').update({ annulee: true, motif_annulation: motif }).eq('id', a.id), q.reload)
  }

  return (
    <Panel icon="users" tone="yolk" title={t('capitalBande.title')}
      subtitle={bande.statut === 'cloturee' ? t('capitalBande.closedHint') : t('capitalBande.hint', { taux })}>
      {alloc.length === 0 ? <p className="muted">{t('capitalBande.none')}</p> : (
        <table className="table money-table">
          <thead><tr><th>{t('capital.investor')}</th><th>{t('capitalBande.amount')}</th><th>{t('capitalBande.due', { taux })}</th></tr></thead>
          <tbody>
            {alloc.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.investisseur.nom}
                  {can(role, 'correction') && bande.statut !== 'cloturee' && (
                    <button className="link-btn small muted" style={{ marginLeft: '.5rem' }} onClick={() => annuler(a)}>{t('argent.cancel')}</button>
                  )}
                </td>
                <td>{money(a.montant, lang)}</td>
                <td>{money(Math.round(Number(a.montant) * taux / 100), lang)}</td>
              </tr>
            ))}
            <tr className="sum"><td>{t('analyses.r.total')}</td><td>{money(total, lang)}</td><td>{money(Math.round(total * taux / 100), lang)}</td></tr>
          </tbody>
        </table>
      )}
      {manage && (disponibles.length > 0
        ? <button className="btn ghost block" onClick={placer}><Icon name="plus" size={16} />{t('capitalBande.place')}</button>
        : <p className="muted small">{t('capitalBande.noFree')}</p>)}
      <p className="note"><Icon name="alert" size={16} />{t('capitalBande.locked')}</p>
    </Panel>
  )
}
