import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import { useAuth } from '../../auth/AuthProvider'
import Icon from '../../components/Icon'
import { day, Empty, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'
import { ChargesAReverser, ParametresPaie } from './Paie'

// Employees and salaries (director, finance). Each month the pay goes through three steps (0067):
// Dahirou PREPARES (bonuses, allowances, deductions: the payslip is computed at once for checking), Ali VALIDATES,
// Dahirou PAYS (the « salaires » expense, the cash box and the payslip, as before). Then Ali closes the month:
// a mistake in a closed month is corrected by a « régularisation » on a later salary. An employee declared to the CNPS
// gets a payslip (CNPS, IRPP, CAC, CFC, RAV, TDL withheld and paid over each month); the cash box pays only the net.
const moisCourant = () => new Date().toLocaleDateString('en-CA').slice(0, 7)

export default function Salaires() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const prepare = can(role, 'salaires.preparer')
  const valide = can(role, 'salaires.valider')
  const payeur = can(role, 'salaires.payer')
  const ask = useAsk()
  const run = useRun()
  const [mois, setMois] = useState(moisCourant)
  const m1 = `${mois}-01`
  const q = useQuery(async () => {
    const [emp, av, paies, bulletins, preps, periode] = await Promise.all([
      supabase.from('employes').select('*').order('categorie', { ascending: false }).order('actif', { ascending: false }).order('nom'),
      supabase.from('avances_salaire').select('*').eq('annulee', false).order('date_avance', { ascending: false }),
      supabase.from('paies').select('*, employe:employes(nom)').eq('annulee', false).order('mois', { ascending: false }).order('created_at', { ascending: false }).limit(50),
      supabase.from('bulletins_paie').select('paie_id').order('created_at', { ascending: false }).limit(200),
      supabase.from('preparations_paie').select('*').eq('mois', m1),
      supabase.from('periodes_paie').select('cloturee, cloturee_le').eq('mois', m1).maybeSingle()
    ])
    return { employes: must(emp), avances: must(av), paies: must(paies), bulletins: new Set(must(bulletins).map((b) => b.paie_id)),
      preps: must(preps), cloture: !!periode.data?.cloturee }
  }, [m1])
  const modes = MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) }))
  const moisLong = new Date(`${m1}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })

  const aDeduire = (e) => q.data.avances.filter((a) => a.employe_id === e.id && !a.paie_id).reduce((s, a) => s + Number(a.montant), 0)
  const prepDe = (e) => q.data.preps.find((p) => p.employe_id === e.id)
  const paieDe = (e) => q.data.paies.find((p) => p.employe_id === e.id && String(p.mois).slice(0, 7) === mois)

  const avance = async (e) => {
    const v = await ask.form({ title: t('salaires.advanceTitle', { nom: e.nom }), icon: 'wallet', submit: t('salaires.advancePay'),
      message: t('salaires.advanceHint'),
      fields: [
        { name: 'montant', label: t('demarrage.amount'), type: 'number', min: 1, required: true },
        { name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'especes', options: modes },
        { name: 'motif', label: t('salaires.reason'), type: 'text' },
        { name: 'date', label: t('saisie.date'), type: 'date', value: new Date().toLocaleDateString('en-CA'), required: true }
      ] })
    if (v) await run(supabase.rpc('verser_avance', { p_employe: e.id, p_montant: v.montant, p_mode: v.mode, p_motif: v.motif || null, p_date: v.date }), q.reload)
  }

  // Dahirou: bonuses (subject to CNPS and tax), allowances (subject or not), a correction, a deduction
  const preparer = async (e) => {
    const old = prepDe(e)
    const ancien = (type, libelle) => old?.elements?.find((x) => x.type === type && (!libelle || x.libelle === libelle))
    const autres = old?.elements?.filter((x) => x.type === 'indemnite' && !['Transport', 'Logement'].includes(x.libelle)) ?? []
    const oui = [{ value: 'non', label: t('circuit.notSubject') }, { value: 'oui', label: t('circuit.subject') }]
    // attendance and authorised overtime of the month (Kenfack, Ali): overtime is added by itself, the absence deduction is proposed
    const { data: pres, error } = await supabase.rpc('resume_presences', { p_employe: e.id, p_mois: m1 })
    if (error) return ask.error(error.message)
    const hs = pres.heures_sup
    const proposee = !old && Number(pres.retenue_proposee) > 0
    const v = await ask.form({ title: t('circuit.prepareTitle', { nom: e.nom, mois: moisLong }), icon: 'wallet', submit: t('circuit.prepare'),
      message: [t('circuit.prepareHint', { salaire: money(e.salaire_mensuel, lang), avances: money(aDeduire(e), lang) }),
        t('rh.monthSummary', { p: pres.presents, a: pres.absences, nj: pres.absences_non_justifiees, perm: pres.permissions, r: pres.retards, m: pres.minutes_retard }),
        Number(hs.heures) > 0 ? t('rh.otIncluded', { h: Number(hs.heures).toLocaleString(lang), n: money(hs.montant, lang) }) : null,
        Number(hs.en_attente) > 0 ? t('rh.otWaiting', { h: Number(hs.en_attente).toLocaleString(lang) }) : null,
        proposee ? t('rh.deductionProposed', { n: money(pres.retenue_proposee, lang), count: pres.absences_non_justifiees }) : null].filter(Boolean).join('\n'),
      fields: [
        { name: 'prime_libelle', label: t('circuit.bonusName'), value: ancien('prime')?.libelle ?? t('circuit.bonusDefault') },
        { name: 'prime', label: t('circuit.bonusAmount'), type: 'number', min: 0, value: ancien('prime')?.montant ?? 0 },
        { name: 'transport', label: t('circuit.transport'), type: 'number', min: 0, value: ancien('indemnite', 'Transport')?.montant ?? 0 },
        { name: 'logement', label: t('circuit.housing'), type: 'number', min: 0, value: ancien('indemnite', 'Logement')?.montant ?? 0 },
        { name: 'autre_libelle', label: t('circuit.otherName'), value: autres[0]?.libelle ?? '' },
        { name: 'autre', label: t('circuit.otherAmount'), type: 'number', min: 0, value: autres[0]?.montant ?? 0 },
        { name: 'autre_soumis', label: t('circuit.otherSubject'), type: 'select', value: autres[0]?.soumis ? 'oui' : 'non', options: oui, showIf: (x) => Number(x.autre) > 0 },
        { name: 'regul_libelle', label: t('circuit.regulName'), value: ancien('regularisation')?.libelle ?? '' },
        { name: 'regul', label: t('circuit.regulAmount'), type: 'number', min: 0, value: ancien('regularisation')?.montant ?? 0 },
        { name: 'retenues', label: t('salaires.deductions'), type: 'number', min: 0, value: old?.retenues ?? (proposee ? pres.retenue_proposee : 0) },
        { name: 'motif', label: t('salaires.deductionReason'), type: 'text', showIf: (x) => Number(x.retenues) > 0,
          value: old?.motif_retenues ?? (proposee ? t('rh.absenceReason', { count: pres.absences_non_justifiees }) : '') }
      ] })
    if (!v) return
    const elements = [
      { type: 'prime', libelle: v.prime_libelle || t('circuit.bonusDefault'), montant: Number(v.prime) || 0 },
      { type: 'indemnite', libelle: 'Transport', montant: Number(v.transport) || 0, soumis: false },
      { type: 'indemnite', libelle: 'Logement', montant: Number(v.logement) || 0, soumis: false },
      { type: 'indemnite', libelle: v.autre_libelle || t('circuit.otherDefault'), montant: Number(v.autre) || 0, soumis: v.autre_soumis === 'oui' },
      { type: 'regularisation', libelle: v.regul_libelle || t('circuit.regulDefault'), montant: Number(v.regul) || 0 }
    ].filter((x) => x.montant > 0)
    await run(supabase.rpc('preparer_paie', { p_employe: e.id, p_mois: m1, p_elements: elements, p_retenues: Number(v.retenues) || 0, p_motif_retenues: v.motif || null }), q.reload)
  }

  const retirer = async (p, e) => {
    if (await ask.confirm(t('circuit.removeConfirm', { nom: e.nom }), { title: t('circuit.remove'), icon: 'trash', submit: t('circuit.remove') }))
      await run(supabase.rpc('retirer_preparation_paie', { p_id: p.id }), q.reload)
  }
  const envoyer = async () => { await run(supabase.rpc('envoyer_paie_validation', { p_mois: m1 }), q.reload) }
  const valider = async (ids) => {
    const total = q.data.preps.filter((p) => ids.includes(p.id)).reduce((s, p) => s + Number(p.net), 0)
    if (await ask.confirm(t('circuit.validateConfirm', { count: ids.length, n: money(total, lang), mois: moisLong }), { title: t('circuit.validate'), icon: 'check', submit: t('circuit.validate') }))
      await run(supabase.rpc('valider_paie', { p_ids: ids }), q.reload)
  }
  const payer = async (p, e) => {
    const v = await ask.form({ title: t('salaires.confirmTitle', { nom: e.nom }), icon: 'wallet', submit: t('salaires.pay'),
      message: t('circuit.payHint', { n: money(p.net, lang) }),
      fields: [
        { name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'especes', options: modes },
        { name: 'date', label: t('saisie.date'), type: 'date', value: new Date().toLocaleDateString('en-CA'), required: true }
      ] })
    if (v) await run(supabase.rpc('payer_paie', { p_id: p.id, p_mode: v.mode, p_date: v.date }), q.reload)
  }
  const cloturer = async () => {
    if (await ask.confirm(t('circuit.closeConfirm', { mois: moisLong }), { title: t('circuit.close'), icon: 'check', submit: t('circuit.close') }))
      await run(supabase.rpc('cloturer_mois_paie', { p_mois: m1 }), q.reload)
  }

  const modifier = async (e) => {
    const v = await ask.form({ title: t('salaires.editTitle', { nom: e.nom }), icon: 'users', submit: t('dialog.save'), message: t('salaires.editHint'), fields: [
      { name: 'salaire_mensuel', label: t('paie.baseSalary'), type: 'number', min: 0, value: e.salaire_mensuel, required: true },
      { name: 'activite', label: t('salaires.paidBy'), type: 'select', value: e.activite, options: ['chair', 'pondeuse'].map((a) => ({ value: a, label: t(`argent.caisse.${a}`) })) },
      { name: 'declare_cnps', label: t('paie.declared'), type: 'select', value: e.declare_cnps ? 'oui' : 'non', options: [{ value: 'oui', label: t('paie.yes') }, { value: 'non', label: t('paie.no') }] },
      { name: 'numero_cnps', label: t('paie.cnpsNumber'), value: e.numero_cnps ?? '', showIf: (x) => x.declare_cnps === 'oui' }
    ] })
    if (v) {
      await run(supabase.from('employes').update({ activite: v.activite, salaire_mensuel: Number(v.salaire_mensuel), declare_cnps: v.declare_cnps === 'oui',
        numero_cnps: v.declare_cnps === 'oui' ? (v.numero_cnps || '').trim() || null : null }).eq('id', e.id), q.reload)
    }
  }

  if (!q.data) return <Loading error={q.error} />
  const actifs = q.data.employes.filter((e) => e.actif)
  const masse = actifs.reduce((s, e) => s + Number(e.salaire_mensuel), 0)
  const prepares = q.data.preps.filter((p) => p.statut === 'preparee')
  const valides = q.data.preps.filter((p) => p.statut === 'validee')
  const payes = q.data.preps.filter((p) => p.statut === 'payee')
  const ferme = q.data.cloture

  return (
    <>
      {/* ---------- The month and its three steps ---------- */}
      <Panel icon="calendar" tone="yolk" title={t('circuit.title', { mois: moisLong })}
        subtitle={ferme ? t('circuit.closed') : t('circuit.steps')}
        actions={<input type="month" value={mois} onChange={(ev) => ev.target.value && setMois(ev.target.value)} aria-label={t('salaires.month')} />}>
        <div className="circuit-steps">
          <span className={prepares.length ? 'on' : ''}><b>1</b>{t('circuit.stepPrepared', { count: prepares.length })}</span>
          <span className={valides.length ? 'on' : ''}><b>2</b>{t('circuit.stepValidated', { count: valides.length })}</span>
          <span className={payes.length ? 'on' : ''}><b>3</b>{t('circuit.stepPaid', { count: payes.length })}</span>
          <span className={ferme ? 'on' : ''}><b><Icon name="check" size={12} /></b>{ferme ? t('circuit.closedShort') : t('circuit.open')}</span>
        </div>
        <div className="row">
          {can(role, 'salaires.envoyer') && prepares.length > 0 && <button className="btn primary sm" onClick={envoyer}><Icon name="bell" size={14} />{t('circuit.send')}</button>}
          {valide && prepares.length > 0 && <button className="btn primary sm" onClick={() => valider(prepares.map((p) => p.id))}><Icon name="check" size={14} />{t('circuit.validateAll', { count: prepares.length })}</button>}
          {valide && !ferme && payes.length > 0 && prepares.length === 0 && valides.length === 0 && <button className="btn ghost sm" onClick={cloturer}>{t('circuit.close')}</button>}
        </div>
      </Panel>

      <Panel icon="users" tone="green" title={t('salaires.title')} subtitle={t('salaires.total', { count: actifs.length, n: money(masse, lang) })}>
        {q.data.employes.length === 0 ? <Empty icon="users" text={t('salaires.none')} /> : ['ferme', 'bureau'].map((cat) => {
          const liste = q.data.employes.filter((e) => (e.categorie ?? 'ferme') === cat)
          if (liste.length === 0) return null
          const sousTotal = liste.filter((e) => e.actif).reduce((s, e) => s + Number(e.salaire_mensuel), 0)
          return (
            <div key={cat} className="salaires-groupe">
              <div className="salaires-groupe-head"><strong>{t(`salaires.group.${cat}`)}</strong><span>{t('salaires.groupTotal', { n: money(sousTotal, lang) })}</span></div>
              <ul className="list">
                {liste.map((e) => {
                  const av = aDeduire(e)
                  const p = prepDe(e)
                  const paie = paieDe(e)
                  return (
                    <li key={e.id} className={e.actif ? '' : 'read'}>
                      <div className="grow">
                        <strong>{e.nom}</strong>{e.poste ? <span className="muted"> · {e.poste}</span> : null}
                        <div className="muted small">
                          {money(e.salaire_mensuel, lang)} {t('paie.grossPerMonth')} · {t(`argent.caisse.${e.activite}`)}
                          {e.declare_cnps ? (e.numero_cnps ? ` · CNPS ${e.numero_cnps}` : ` · ${t('paie.noCnpsNumber')}`) : ` · ${t('paie.notDeclaredShort')}`}
                          {Number(e.salaire_mensuel) === 0 && <> · <span className="warn-text">{t('salaires.zeroSalary')}</span></>}
                          {av > 0 && <> · <span className="warn-text">{t('salaires.toDeduct', { n: money(av, lang) })}</span></>}
                          {!e.actif && ` · ${t('salaires.left')}`}
                        </div>
                        {p && p.statut !== 'payee' && (
                          <div className="small circuit-detail">
                            {t('circuit.netLine', { n: money(p.net, lang) })}
                            {[Number(p.primes) > 0 && `${t('circuit.bonuses')} ${money(p.primes, lang)}`, Number(p.indemnites) > 0 && `${t('circuit.allowances')} ${money(p.indemnites, lang)}`,
                              Number(p.retenues_legales) > 0 && t('paie.withheld', { n: money(p.retenues_legales, lang) }), Number(p.avances) > 0 && t('salaires.advancesDeducted', { n: money(p.avances, lang) }),
                              Number(p.retenues) > 0 && `−${money(p.retenues, lang)} (${p.motif_retenues})`].filter(Boolean).map((x) => ` · ${x}`)}
                          </div>
                        )}
                        {e.actif && (
                          <div className="row-actions">
                            {paie ? <span className="tag ok"><Icon name="check" size={12} /> {t('circuit.statut.payee')}</span>
                              : p ? <span className={`tag ${p.statut === 'validee' ? 'ok' : 'warn'}`}>{t(`circuit.statut.${p.statut}`)}</span>
                                : <span className="tag">{t('circuit.statut.aucune')}</span>}
                            {!paie && !ferme && prepare && <button className={`btn ${p ? 'ghost' : 'primary'} sm`} onClick={() => preparer(e)}><Icon name="note" size={14} />{p ? t('circuit.edit') : t('circuit.prepare')}</button>}
                            {p?.statut === 'preparee' && valide && <button className="btn primary sm" onClick={() => valider([p.id])}><Icon name="check" size={14} />{t('circuit.validate')}</button>}
                            {p?.statut === 'validee' && payeur && <button className="btn primary sm" onClick={() => payer(p, e)}><Icon name="wallet" size={14} />{t('salaires.pay')}</button>}
                            {p && !paie && prepare && <button className="btn ghost sm" onClick={() => retirer(p, e)}>{t('circuit.remove')}</button>}
                            {paie && q.data.bulletins.has(paie.id) && <Link to={`/bulletin/${paie.id}`} className="btn ghost sm"><Icon name="receipt" size={14} />{t('paie.payslip')}</Link>}
                            {payeur && <button className="btn ghost sm" onClick={() => avance(e)}>{t('salaires.advance')}</button>}
                            {prepare && <button className="btn ghost sm" onClick={() => modifier(e)}>{t('salaires.editSalary')}</button>}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </Panel>

      <p className="note"><Icon name="users" size={16} />{t('circuit.filesBy')}</p>

      <ChargesAReverser />

      {(q.data.paies.length > 0 || q.data.avances.length > 0) && (
        <Panel icon="clock" tone="sky" title={t('salaires.history')}>
          <ul className="list">
            {[...q.data.paies.map((p) => ({ k: 'p' + p.id, d: p.created_at, nom: p.employe?.nom, paie: q.data.bulletins.has(p.id) ? p.id : null,
              txt: t('salaires.paidLine', { mois: new Date(`${String(p.mois).slice(0, 10)}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' }), n: money(p.net, lang) }),
              sub: [Number(p.primes) > 0 && `+${money(p.primes, lang)}`, Number(p.retenues_legales) > 0 && t('paie.withheld', { n: money(p.retenues_legales, lang) }),
                Number(p.retenues) > 0 && `−${money(p.retenues, lang)} (${p.motif_retenues})`, Number(p.avances) > 0 && t('salaires.advancesDeducted', { n: money(p.avances, lang) })].filter(Boolean).join(' · ') })),
              ...q.data.avances.map((a) => ({ k: 'a' + a.id, d: a.created_at, nom: q.data.employes.find((e) => e.id === a.employe_id)?.nom, txt: t('salaires.advanceLine', { n: money(a.montant, lang), d: day(a.date_avance, lang) }), sub: [a.motif, a.paie_id ? t('salaires.deducted') : t('salaires.notDeducted')].filter(Boolean).join(' · ') }))]
              .sort((x, y) => y.d.localeCompare(x.d)).slice(0, 30).map((r) => (
                <li key={r.k}>
                  <div className="grow"><strong>{r.nom}</strong> · {r.txt}{r.sub && <div className="muted small">{r.sub}</div>}</div>
                  {r.paie && <Link to={`/bulletin/${r.paie}`} className="btn ghost sm"><Icon name="receipt" size={14} />{t('paie.payslip')}</Link>}
                </li>
              ))}
          </ul>
          <p className="muted small">{t('circuit.cancelHint')}</p>
        </Panel>
      )}

      <ParametresPaie />
    </>
  )
}
