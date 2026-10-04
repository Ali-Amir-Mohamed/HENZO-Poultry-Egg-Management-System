import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { Empty, Field, FormCard, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Investors: separate capital register, 10 % due at each broiler flock closure
export default function Investisseurs() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const manage = can(role, 'capital.manage')
  const ask = useAsk()
  const run = useRun()

  const list = useQuery(async () => must(await supabase.from('situation_investisseurs').select('*').order('nom')))
  const pending = useQuery(async () => must(await supabase.from('distributions_investisseurs')
    .select('*, investisseur:investisseurs(nom), bande:bandes(code)').eq('statut', 'en_attente').order('created_at')))
  const reload = () => { list.reload(); pending.reload() }

  const [inv, setInv] = useState({ nom: '', telephone: '', adresse: '', piece_identite: '' })
  const [op, setOp] = useState({ investisseur_id: '', type_operation: 'apport', montant: '', activite: 'chair', mode_paiement: 'banque', date_operation: localDate(), notes: '' })

  const createInvestor = async () => {
    must(await supabase.from('investisseurs').insert({ ...inv, telephone: inv.telephone || null, adresse: inv.adresse || null, piece_identite: inv.piece_identite || null }))
    setInv({ nom: '', telephone: '', adresse: '', piece_identite: '' })
    reload()
  }
  const createOperation = async () => {
    must(await supabase.from('operations_investisseurs').insert({ ...op, montant: Number(op.montant), notes: op.notes || null }))
    setOp({ ...op, montant: '', notes: '' })
    reload()
  }
  const decide = async (d, statut) => {
    let mode = null
    if (statut === 'retire') {
      const v = await ask.form({
        title: t('capital.payoutTitle', { n: money(d.montant, lang), nom: d.investisseur.nom }), icon: 'wallet', submit: t('capital.payout'),
        fields: [{ name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'especes', options: MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) })) }]
      })
      if (!v) return
      mode = v.mode
    } else if (!(await ask.confirm(t('capital.confirmReinvest', { n: money(d.montant, lang), nom: d.investisseur.nom }), { title: t('capital.reinvest'), icon: 'users' }))) return
    await run(supabase.from('distributions_investisseurs').update({ statut, mode_paiement: mode }).eq('id', d.id), reload)
  }

  return (
    <>
      {pending.data?.length > 0 && (
        <Panel icon="clock" tone="yolk" title={t('capital.pendingTitle')} subtitle={t('capital.pendingHint')}>
          <ul className="list">
            {pending.data.map((d) => (
              <li key={d.id}>
                <div className="grow">
                  <strong>{d.investisseur.nom}</strong>
                  <div className="muted small">{t('capital.fromFlock', { code: d.bande.code, taux: d.taux, base: money(d.capital_base, lang) })}</div>
                  {manage && (
                    <div className="row-actions">
                      <button className="btn primary sm" onClick={() => decide(d, 'retire')}>{t('capital.payout')}</button>
                      <button className="btn ghost sm" onClick={() => decide(d, 'reinvesti')}>{t('capital.reinvest')}</button>
                    </div>
                  )}
                </div>
                <strong>{money(d.montant, lang)}</strong>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <Empty icon="users" text={t('capital.none')} /> : (
        <div className="cards">
          {list.data.map((i) => (
            <article key={i.investisseur_id} className="card-item">
              <header>
                <Link to={`/argent/investisseur/${i.investisseur_id}`} className="card-title">{i.nom}<Icon name="chevron" size={16} /></Link>
                {!i.actif && <span className="tag muted">{t('capital.inactive')}</span>}
              </header>
              <div className="stock-level"><strong>{money(i.capital_restant, lang)}</strong></div>
              <div className="facts">
                <div className="fact"><span>{t('capital.contributed')}</span><strong>{money(i.capital_apporte, lang)}</strong></div>
                <div className="fact"><span>{t('capital.reinvested')}</span><strong>{money(i.capital_reinvesti, lang)}</strong></div>
                <div className="fact"><span>{t('capital.withdrawn')}</span><strong>{money(i.capital_retire, lang)}</strong></div>
                <div className="fact"><span>{t('capital.paid10')}</span><strong>{money(i.dix_pourcent_verses, lang)}</strong></div>
              </div>
              <footer>
                <Link to={`/argent/investisseur/${i.investisseur_id}`} className="btn primary"><Icon name="note" size={16} />{t('capital.statement')}</Link>
              </footer>
            </article>
          ))}
        </div>
      )}

      {manage && list.data?.length > 0 && (
        <FormCard title={t('capital.newOperation')} icon="wallet" onSubmit={createOperation}>
          <div className="segmented small">
            {['apport', 'retrait_capital'].map((k) => (
              <button key={k} type="button" className={op.type_operation === k ? 'active' : ''} onClick={() => setOp({ ...op, type_operation: k })}>
                {t(`capital.types.${k}`)}
              </button>
            ))}
          </div>
          <div className="grid-2">
            <Field label={t('capital.investor')}>
              <select required value={op.investisseur_id} onChange={(e) => setOp({ ...op, investisseur_id: e.target.value })}>
                <option value="" disabled>{t('saisie.choose')}</option>
                {list.data.filter((i) => i.actif).map((i) => <option key={i.investisseur_id} value={i.investisseur_id}>{i.nom}</option>)}
              </select>
            </Field>
            <Field label={t('argent.amount')} className="big"><input type="number" min="1" required value={op.montant} onChange={(e) => setOp({ ...op, montant: e.target.value })} /></Field>
            <Field label={t('argent.caisseLabel')}>
              <select value={op.activite} onChange={(e) => setOp({ ...op, activite: e.target.value })}>
                <option value="chair">{t('argent.caisse.chair')}</option>
                <option value="pondeuse">{t('argent.caisse.pondeuse')}</option>
              </select>
            </Field>
            <Field label={t('saisie.modeAcompte')}>
              <select value={op.mode_paiement} onChange={(e) => setOp({ ...op, mode_paiement: e.target.value })}>
                {MODES_PAIEMENT.map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
              </select>
            </Field>
            <Field label={t('saisie.date')}><input type="date" required value={op.date_operation} onChange={(e) => setOp({ ...op, date_operation: e.target.value })} /></Field>
          </div>
          <Field label={t('saisie.notes')}><input value={op.notes} onChange={(e) => setOp({ ...op, notes: e.target.value })} /></Field>
        </FormCard>
      )}

      {manage && (
        <FormCard title={t('capital.newInvestor')} icon="users" onSubmit={createInvestor}>
          <div className="grid-2">
            <Field label={t('reglages.name')}><input required value={inv.nom} onChange={(e) => setInv({ ...inv, nom: e.target.value })} /></Field>
            <Field label={t('reglages.phone')}><input type="tel" value={inv.telephone} onChange={(e) => setInv({ ...inv, telephone: e.target.value })} /></Field>
            <Field label={t('reglages.address')}><input value={inv.adresse} onChange={(e) => setInv({ ...inv, adresse: e.target.value })} /></Field>
            <Field label={t('capital.idDoc')}><input value={inv.piece_identite} onChange={(e) => setInv({ ...inv, piece_identite: e.target.value })} /></Field>
          </div>
          <p className="note"><Icon name="clock" size={16} />{t('capital.rule')}</p>
        </FormCard>
      )}
    </>
  )
}
