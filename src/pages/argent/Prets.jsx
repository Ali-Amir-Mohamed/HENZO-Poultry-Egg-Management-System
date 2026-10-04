import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { day, Empty, Field, FormCard, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Loans (bank / private person): schedule, repayments, balance
export default function Prets() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const manage = can(role, 'pret.manage')
  const ask = useAsk()
  const run = useRun()

  const list = useQuery(async () => {
    const [s, e, r, b] = await Promise.all([
      supabase.from('situation_prets').select('*').order('date_pret', { ascending: false }),
      supabase.from('echeances_prets').select('*').order('date_echeance'),
      supabase.from('remboursements_prets').select('*, bande:bandes(code)').order('date_remboursement', { ascending: false }),
      supabase.from('bandes').select('id, code').order('date_arrivee', { ascending: false }).limit(30)
    ])
    return { prets: must(s), echeances: must(e), remboursements: must(r), bandes: must(b) }
  })

  const [pret, setPret] = useState({ type_preteur: 'banque', preteur: '', contact: '', montant_initial: '', interets: '0', activite: 'chair', mode_paiement: 'banque', date_pret: localDate(), notes: '' })
  const createPret = async () => {
    must(await supabase.from('prets').insert({ ...pret, montant_initial: Number(pret.montant_initial), interets: Number(pret.interets) || 0, contact: pret.contact || null, notes: pret.notes || null }))
    setPret({ ...pret, preteur: '', contact: '', montant_initial: '', interets: '0', notes: '' })
    list.reload()
  }

  if (!list.data) return <Loading error={list.error} />
  const { prets, echeances, remboursements, bandes } = list.data

  const addEcheance = async (p) => {
    const v = await ask.form({
      title: t('prets.addDueTitle', { preteur: p.preteur }), icon: 'calendar', submit: t('dialog.save'),
      fields: [
        { name: 'date', label: t('prets.dueDate'), type: 'date', value: localDate(), required: true },
        { name: 'montant', label: t('argent.amount'), type: 'number', min: 1, required: true }
      ]
    })
    if (!v) return
    await run(supabase.from('echeances_prets').insert({ pret_id: p.pret_id, date_echeance: v.date, montant: v.montant }), list.reload)
  }
  const rembourser = async (p) => {
    const v = await ask.form({
      title: t('prets.repayTitle', { preteur: p.preteur }), icon: 'wallet', submit: t('prets.repay'),
      fields: [
        { name: 'montant', label: t('argent.amount'), type: 'number', value: Number(p.solde), min: 1, max: Number(p.solde), required: true, hint: t('argent.remaining', { n: money(p.solde, lang) }) },
        { name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'banque', options: MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) })) },
        { name: 'date', label: t('saisie.date'), type: 'date', value: localDate(), required: true },
        { name: 'bande', label: t('prets.linkFlockLabel'), type: 'select', value: '', options: [{ value: '', label: '—' }, ...bandes.map((b) => ({ value: b.id, label: b.code }))] }
      ]
    })
    if (!v) return
    await run(supabase.from('remboursements_prets').insert({
      pret_id: p.pret_id, montant: v.montant, mode_paiement: v.mode, date_remboursement: v.date, bande_id: v.bande || null
    }), list.reload)
  }
  const annuler = async (table, id, title) => {
    const motif = await ask.reason(title)
    if (!motif) return
    await run(supabase.from(table).update({ annulee: true, motif_annulation: motif }).eq('id', id), list.reload)
  }

  return (
    <>
      {prets.length === 0 ? <Empty icon="receipt" text={t('prets.none')} /> : prets.map((p) => {
        const sched = echeances.filter((e) => e.pret_id === p.pret_id)
        const remb = remboursements.filter((r) => r.pret_id === p.pret_id)
        const pct = Number(p.montant_du) ? Math.round((Number(p.rembourse) / Number(p.montant_du)) * 100) : 0
        return (
          <Panel key={p.pret_id} icon="receipt" tone={p.en_retard ? 'rose' : 'sky'}
            title={`${p.preteur} · ${t(`prets.types.${p.type_preteur}`)}`}
            subtitle={`${day(p.date_pret, lang)} · ${t(`argent.caisse.${p.activite}`)}${p.contact ? ` · ${p.contact}` : ''}`}
            actions={p.en_retard ? <span className="tag danger">{t('argent.late')}</span> : null}>
            <div className="facts">
              <div className="fact"><span>{t('prets.amount')}</span><strong>{money(p.montant_initial, lang)}</strong></div>
              <div className="fact"><span>{t('prets.interest')}</span><strong>{money(p.interets, lang)}</strong></div>
              <div className="fact"><span>{t('prets.repaid')}</span><strong>{money(p.rembourse, lang)}</strong></div>
              <div className="fact"><span>{t('prets.balance')}</span><strong className={Number(p.solde) > 0 ? 'error' : 'success'}>{money(p.solde, lang)}</strong></div>
              <div className="fact"><span>{t('prets.nextDue')}</span><strong>{day(p.prochaine_echeance, lang)}</strong></div>
            </div>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>

            {sched.length > 0 && (
              <details>
                <summary>{t('prets.schedule', { count: sched.length })}</summary>
                <ul className="list">
                  {sched.map((e) => <li key={e.id}><span>{day(e.date_echeance, lang)}</span><strong>{money(e.montant, lang)}</strong></li>)}
                </ul>
              </details>
            )}
            {remb.length > 0 && (
              <details>
                <summary>{t('prets.history', { count: remb.length })}</summary>
                <ul className="list">
                  {remb.map((r) => (
                    <li key={r.id} className={r.annulee ? 'cancelled' : ''}>
                      <div className="grow">
                        <strong>{money(r.montant, lang)}</strong>
                        <div className="muted small">{day(r.date_remboursement, lang)} · {t(`modes.${r.mode_paiement}`)}{r.bande ? ` · ${t('prets.flock', { code: r.bande.code })}` : ''}</div>
                        {r.annulee && <div className="error small">{t('argent.cancelled')} : {r.motif_annulation}</div>}
                      </div>
                      {!r.annulee && can(role, 'annuler') && <button className="btn ghost sm" onClick={() => annuler('remboursements_prets', r.id, t('prets.cancelRepayment', { n: money(r.montant, lang) }))}>{t('argent.cancel')}</button>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {(manage || can(role, 'annuler')) && (
              <div className="row-actions">
                {manage && Number(p.solde) > 0 && <button className="btn primary sm" onClick={() => rembourser(p)}>{t('prets.repay')}</button>}
                {manage && <button className="btn ghost sm" onClick={() => addEcheance(p)}>{t('prets.addDue')}</button>}
                {can(role, 'annuler') && <button className="btn ghost sm" onClick={() => annuler('prets', p.pret_id, t('prets.cancelLoan', { preteur: p.preteur }))}>{t('argent.cancel')}</button>}
              </div>
            )}
          </Panel>
        )
      })}

      {manage && (
        <FormCard title={t('prets.new')} icon="receipt" onSubmit={createPret}>
          <div className="segmented small">
            {['banque', 'particulier'].map((k) => (
              <button key={k} type="button" className={pret.type_preteur === k ? 'active' : ''} onClick={() => setPret({ ...pret, type_preteur: k })}>{t(`prets.types.${k}`)}</button>
            ))}
          </div>
          <div className="grid-2">
            <Field label={t('prets.lender')}><input required value={pret.preteur} onChange={(e) => setPret({ ...pret, preteur: e.target.value })} /></Field>
            <Field label={t('prets.contact')}><input value={pret.contact} onChange={(e) => setPret({ ...pret, contact: e.target.value })} /></Field>
            <Field label={t('prets.amount')} className="big"><input type="number" min="1" required value={pret.montant_initial} onChange={(e) => setPret({ ...pret, montant_initial: e.target.value })} /></Field>
            <Field label={t('prets.interestTotal')}><input type="number" min="0" value={pret.interets} onChange={(e) => setPret({ ...pret, interets: e.target.value })} /></Field>
            <Field label={t('prets.activity')}>
              <select value={pret.activite} onChange={(e) => setPret({ ...pret, activite: e.target.value })}>
                <option value="chair">{t('argent.caisse.chair')}</option>
                <option value="pondeuse">{t('argent.caisse.pondeuse')}</option>
              </select>
            </Field>
            <Field label={t('prets.receivedAs')}>
              <select value={pret.mode_paiement} onChange={(e) => setPret({ ...pret, mode_paiement: e.target.value })}>
                {MODES_PAIEMENT.map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
              </select>
            </Field>
            <Field label={t('saisie.date')}><input type="date" required value={pret.date_pret} onChange={(e) => setPret({ ...pret, date_pret: e.target.value })} /></Field>
          </div>
          <Field label={t('saisie.notes')}><input value={pret.notes} onChange={(e) => setPret({ ...pret, notes: e.target.value })} /></Field>
          <p className="note"><Icon name="clock" size={16} />{t('prets.hint')}</p>
        </FormCard>
      )}
    </>
  )
}
