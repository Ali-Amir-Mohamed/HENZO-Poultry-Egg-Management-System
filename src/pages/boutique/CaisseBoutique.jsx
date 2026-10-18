import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { day, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Shop cash: balances, evening closing (gap reported), deposits validated by finance into the cash boxes of the site
// where they are received (a shop belongs to the company and may be supplied by several sites)
export default function CaisseBoutique({ boutique }) {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const gerer = can(role, 'boutique.caisse')
  const valider = can(role, 'boutique.valider')
  const today = new Date().toLocaleDateString('en-CA')
  const q = useQuery(async () => {
    const [soldes, ventes, vers, clot] = await Promise.all([
      supabase.from('soldes_boutiques').select('mode, activite, solde').eq('boutique_id', boutique.id),
      supabase.from('ventes_boutique').select('montant, mode_paiement').eq('boutique_id', boutique.id).eq('date_vente', today).eq('annulee', false),
      supabase.from('versements_boutique').select('*').eq('boutique_id', boutique.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('clotures_boutique').select('*').eq('boutique_id', boutique.id).order('created_at', { ascending: false }).limit(10)
    ])
    return { soldes: must(soldes), ventes: must(ventes), versements: must(vers), clotures: must(clot) }
  }, [boutique.id])

  if (!q.data) return <Loading error={q.error} />
  const solde = (mode, act) => Number(q.data.soldes.find((s) => s.mode === mode && (!act || s.activite === act))?.solde ?? 0)
  const total = (mode) => q.data.soldes.filter((s) => s.mode === mode).reduce((a, s) => a + Number(s.solde), 0)
  const enAttente = (mode, act) => q.data.versements.filter((v) => v.statut === 'en_attente' && v.mode === mode)
    .reduce((a, v) => a + Number(act === 'chair' ? v.montant_chair : v.montant_pondeuse), 0)
  const dispo = (mode, act) => Math.max(0, solde(mode, act) - enAttente(mode, act))
  const ventesJour = q.data.ventes.reduce((a, v) => a + Number(v.montant), 0)

  const cloturer = async () => {
    const v = await ask.form({ title: t('boutique.closeTitle'), icon: 'wallet', submit: t('boutique.closeSave'),
      message: t('boutique.closeHint'),
      fields: [{ name: 'compte', label: t('boutique.cashCounted'), type: 'number', min: 0, required: true },
               { name: 'notes', label: t('saisie.notes'), type: 'text' }] })
    if (!v) return
    const ecart = await run(supabase.rpc('cloturer_journee', { p_boutique: boutique.id, p_especes_comptees: v.compte, p_notes: v.notes || null }), q.reload)
    if (ecart === null || ecart === undefined) return
    const e = Number(ecart === true ? 0 : ecart)
    await ask.info(t('boutique.closeDone'), e === 0 ? t('boutique.closeOk') : t('boutique.closeGap', { n: money(e, lang) }))
  }

  const verser = async () => {
    const v = await ask.form({ title: t('boutique.depositTitle'), icon: 'wallet', submit: t('boutique.depositSave'),
      message: t('boutique.depositHint', { chair: money(dispo('especes', 'chair'), lang), pondeuse: money(dispo('especes', 'pondeuse'), lang) }),
      fields: [
        { name: 'mode', label: t('saisie.paiement'), type: 'select', value: 'especes', options: ['especes', 'mobile_money'].map((m) => ({ value: m, label: t(`modes.${m}`) })) },
        { name: 'chair', label: t('boutique.depositChair'), type: 'number', min: 0, value: dispo('especes', 'chair') },
        { name: 'pondeuse', label: t('boutique.depositLayers'), type: 'number', min: 0, value: dispo('especes', 'pondeuse') }
      ] })
    if (!v) return
    await run(supabase.rpc('demander_versement', { p_boutique: boutique.id, p_mode: v.mode, p_chair: Number(v.chair) || 0, p_pondeuse: Number(v.pondeuse) || 0 }), q.reload)
  }

  const decider = async (v, ok) => {
    if (ok) {
      if (!(await ask.confirm(t('boutique.validateConfirm', { n: money(Number(v.montant_chair) + Number(v.montant_pondeuse), lang), mode: t(`modes.${v.mode}`), site: profile?.ferme?.nom ?? '' }), { title: t('boutique.validate'), icon: 'check' }))) return
      await run(supabase.rpc('valider_versement', { p_versement: v.id, p_accepter: true }), q.reload)
    } else {
      const motif = await ask.reason(t('boutique.refuseTitle'))
      if (motif) await run(supabase.rpc('valider_versement', { p_versement: v.id, p_accepter: false, p_motif: motif }), q.reload)
    }
  }

  return (
    <>
      <section className="kpis three">
        <div className="kpi"><span className="kpi-label">{t('modes.especes')}</span><strong className="kpi-value">{money(total('especes'), lang)}</strong>
          <span className="kpi-hint">{t('boutique.split', { chair: money(solde('especes', 'chair'), lang), pondeuse: money(solde('especes', 'pondeuse'), lang) })}</span></div>
        <div className="kpi"><span className="kpi-label">{t('modes.mobile_money')}</span><strong className="kpi-value">{money(total('mobile_money'), lang)}</strong></div>
        <div className="kpi"><span className="kpi-label">{t('boutique.salesToday')}</span><strong className="kpi-value">{money(ventesJour, lang)}</strong>
          <span className="kpi-hint">{t('boutique.salesCount', { count: q.data.ventes.length })}</span></div>
      </section>

      {gerer && (
        <div className="row">
          <button className="btn primary" onClick={cloturer}><Icon name="clock" size={16} />{t('boutique.close')}</button>
          <button className="btn ghost" onClick={verser} disabled={total('especes') + total('mobile_money') <= 0}><Icon name="wallet" size={16} />{t('boutique.deposit')}</button>
        </div>
      )}

      <Panel icon="wallet" tone="green" title={t('boutique.deposits')}>
        {q.data.versements.length === 0 ? <p className="muted">{t('boutique.noDeposit')}</p> : (
          <ul className="list">
            {q.data.versements.map((v) => (
              <li key={v.id}>
                <div className="grow">
                  <strong>{money(Number(v.montant_chair) + Number(v.montant_pondeuse), lang)} · {t(`modes.${v.mode}`)}</strong>
                  <div className="muted small">{day(v.date_versement, lang)} · {t('boutique.split', { chair: money(v.montant_chair, lang), pondeuse: money(v.montant_pondeuse, lang) })}{v.motif_refus ? ` · ${v.motif_refus}` : ''}</div>
                  {valider && v.statut === 'en_attente' && (
                    <div className="row-actions">
                      <button className="btn primary sm" onClick={() => decider(v, true)}><Icon name="check" size={14} />{t('boutique.validate')}</button>
                      <button className="btn ghost sm" onClick={() => decider(v, false)}>{t('boutique.refuse')}</button>
                    </div>
                  )}
                </div>
                <span className={`tag ${v.statut === 'valide' ? 'ok' : v.statut === 'refuse' ? 'danger' : 'warn'}`}>{t(`boutique.depositStatus.${v.statut}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel icon="clock" tone="sky" title={t('boutique.closings')}>
        {q.data.clotures.length === 0 ? <p className="muted">{t('boutique.noClosing')}</p> : (
          <ul className="list">
            {q.data.clotures.map((c) => (
              <li key={c.id}>
                <div className="grow">
                  <strong>{day(c.date_cloture, lang)}</strong>
                  <div className="muted small">{t('boutique.closingLine', { compte: money(c.especes_comptees, lang), attendu: money(c.especes_attendues, lang) })}{c.notes ? ` · ${c.notes}` : ''}</div>
                </div>
                <span className={`tag ${Number(c.ecart) === 0 ? 'ok' : 'danger'}`}>{Number(c.ecart) === 0 ? t('boutique.noGap') : money(c.ecart, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
