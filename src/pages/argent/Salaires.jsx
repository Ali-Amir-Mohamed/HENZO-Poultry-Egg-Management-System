import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import { useAuth } from '../../auth/AuthProvider'
import Icon from '../../components/Icon'
import { day, Empty, Field, FormCard, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Employees and salaries (director, finance; only finance pays): advances paid at once, monthly pay = salary + bonus − deductions − advances.
// Every payment is a « salaires » expense in the chosen cash box; cancelling it (director) cancels it here too.
const moisCourant = () => new Date().toLocaleDateString('en-CA').slice(0, 7)

export default function Salaires() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const payeur = can(role, 'salaires.payer')
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => {
    const [emp, av, paies] = await Promise.all([
      supabase.from('employes').select('*').order('actif', { ascending: false }).order('nom'),
      supabase.from('avances_salaire').select('*').eq('annulee', false).order('date_avance', { ascending: false }),
      supabase.from('paies').select('*, employe:employes(nom)').eq('annulee', false).order('mois', { ascending: false }).order('created_at', { ascending: false }).limit(50)
    ])
    return { employes: must(emp), avances: must(av), paies: must(paies) }
  })
  const [form, setForm] = useState({ nom: '', telephone: '', poste: '', activite: 'chair', salaire_mensuel: '', date_embauche: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const modes = MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) }))

  const creer = async () => {
    must(await supabase.from('employes').insert({ ...form, salaire_mensuel: Number(form.salaire_mensuel), telephone: form.telephone || null, poste: form.poste || null, date_embauche: form.date_embauche || null }))
    setForm({ ...form, nom: '', telephone: '', poste: '', salaire_mensuel: '', date_embauche: '' })
    q.reload()
    return t('salaires.created')
  }
  const aDeduire = (e) => q.data.avances.filter((a) => a.employe_id === e.id && !a.paie_id).reduce((s, a) => s + Number(a.montant), 0)
  const payeCeMois = (e) => q.data.paies.some((p) => p.employe_id === e.id && String(p.mois).slice(0, 7) === moisCourant())

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

  const payer = async (e) => {
    const avances = aDeduire(e)
    const v = await ask.form({ title: t('salaires.payTitle', { nom: e.nom }), icon: 'wallet', submit: t('salaires.next'),
      message: t('salaires.payHint', { salaire: money(e.salaire_mensuel, lang), avances: money(avances, lang) }),
      fields: [
        { name: 'mois', label: t('salaires.month'), type: 'month', value: moisCourant(), required: true },
        { name: 'primes', label: t('salaires.bonus'), type: 'number', min: 0, value: 0 },
        { name: 'retenues', label: t('salaires.deductions'), type: 'number', min: 0, value: 0 },
        { name: 'motif', label: t('salaires.deductionReason'), type: 'text', showIf: (x) => Number(x.retenues) > 0 },
        { name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'especes', options: modes }
      ] })
    if (!v) return
    const net = Number(e.salaire_mensuel) + (Number(v.primes) || 0) - (Number(v.retenues) || 0) - avances
    if (net < 0) return ask.error(t('salaires.negative'))
    const detail = [
      `${t('salaires.base')} : ${money(e.salaire_mensuel, lang)}`,
      Number(v.primes) > 0 && `+ ${t('salaires.bonus')} : ${money(v.primes, lang)}`,
      Number(v.retenues) > 0 && `− ${t('salaires.deductions')} : ${money(v.retenues, lang)}`,
      avances > 0 && `− ${t('salaires.advances')} : ${money(avances, lang)}`,
      `= ${t('salaires.net')} : ${money(net, lang)} (${t(`modes.${v.mode}`)})`
    ].filter(Boolean).join('\n')
    if (!(await ask.confirm(detail, { title: t('salaires.confirmTitle', { nom: e.nom }), icon: 'wallet', submit: t('salaires.pay') }))) return
    await run(supabase.rpc('payer_salaire', { p_employe: e.id, p_mois: `${v.mois}-01`, p_mode: v.mode, p_primes: Number(v.primes) || 0, p_retenues: Number(v.retenues) || 0, p_motif_retenues: v.motif || null }), q.reload)
  }

  const modifier = async (e) => {
    const v = await ask.form({ title: t('salaires.editTitle', { nom: e.nom }), icon: 'users', submit: t('dialog.save'), fields: [
      { name: 'nom', label: t('reglages.name'), value: e.nom, required: true },
      { name: 'poste', label: t('salaires.job'), value: e.poste ?? '' },
      { name: 'telephone', label: t('reglages.phone'), type: 'tel', value: e.telephone ?? '' },
      { name: 'activite', label: t('salaires.paidBy'), type: 'select', value: e.activite, options: ['chair', 'pondeuse'].map((a) => ({ value: a, label: t(`argent.caisse.${a}`) })) },
      { name: 'salaire_mensuel', label: t('salaires.salary'), type: 'number', min: 0, value: e.salaire_mensuel, required: true },
      { name: 'actif', label: t('stock.status'), type: 'select', value: e.actif ? 'oui' : 'non', options: [{ value: 'oui', label: t('salaires.active') }, { value: 'non', label: t('salaires.left') }] }
    ] })
    if (v) await run(supabase.from('employes').update({ nom: v.nom, poste: v.poste || null, telephone: v.telephone || null, activite: v.activite, salaire_mensuel: Number(v.salaire_mensuel), actif: v.actif === 'oui' }).eq('id', e.id), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const actifs = q.data.employes.filter((e) => e.actif)
  const masse = actifs.reduce((s, e) => s + Number(e.salaire_mensuel), 0)

  return (
    <>
      <Panel icon="users" tone="green" title={t('salaires.title')} subtitle={t('salaires.total', { count: actifs.length, n: money(masse, lang) })}>
        {q.data.employes.length === 0 ? <Empty icon="users" text={t('salaires.none')} /> : (
          <ul className="list">
            {q.data.employes.map((e) => {
              const av = aDeduire(e)
              return (
                <li key={e.id} className={e.actif ? '' : 'read'}>
                  <div className="grow">
                    <strong>{e.nom}</strong>{e.poste ? <span className="muted"> · {e.poste}</span> : null}
                    <div className="muted small">
                      {money(e.salaire_mensuel, lang)} / {t('salaires.perMonth')} · {t(`argent.caisse.${e.activite}`)}
                      {av > 0 && <> · <span className="warn-text">{t('salaires.toDeduct', { n: money(av, lang) })}</span></>}
                      {!e.actif && ` · ${t('salaires.left')}`}
                    </div>
                    {e.actif && (
                      <div className="row-actions">
                        {payeCeMois(e)
                          ? <span className="tag ok"><Icon name="check" size={12} /> {t('salaires.paidThisMonth')}</span>
                          : payeur ? <button className="btn primary sm" onClick={() => payer(e)}><Icon name="wallet" size={14} />{t('salaires.pay')}</button>
                            : <span className="tag warn">{t('salaires.notPaidYet')}</span>}
                        {payeur && <button className="btn ghost sm" onClick={() => avance(e)}>{t('salaires.advance')}</button>}
                        <button className="btn ghost sm" onClick={() => modifier(e)}>{t('common.edit')}</button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {!payeur && <p className="note"><Icon name="wallet" size={16} />{t('salaires.onlyFinance')}</p>}
      </Panel>

      <FormCard title={t('salaires.new')} icon="users" onSubmit={creer}>
        <div className="grid-2">
          <Field label={t('reglages.name')}><input required value={form.nom} onChange={set('nom')} /></Field>
          <Field label={t('salaires.job')}><input value={form.poste} onChange={set('poste')} placeholder={t('salaires.jobPh')} /></Field>
          <Field label={t('salaires.salary')}><input type="number" min="0" required value={form.salaire_mensuel} onChange={set('salaire_mensuel')} /></Field>
          <Field label={t('salaires.paidBy')}>
            <select value={form.activite} onChange={set('activite')}>{['chair', 'pondeuse'].map((a) => <option key={a} value={a}>{t(`argent.caisse.${a}`)}</option>)}</select>
          </Field>
          <Field label={t('reglages.phone')}><input type="tel" value={form.telephone} onChange={set('telephone')} /></Field>
          <Field label={t('salaires.hired')}><input type="date" value={form.date_embauche} onChange={set('date_embauche')} /></Field>
        </div>
      </FormCard>

      {(q.data.paies.length > 0 || q.data.avances.length > 0) && (
        <Panel icon="clock" tone="sky" title={t('salaires.history')}>
          <ul className="list">
            {[...q.data.paies.map((p) => ({ k: 'p' + p.id, d: p.created_at, nom: p.employe?.nom, txt: t('salaires.paidLine', { mois: new Date(`${String(p.mois).slice(0, 10)}T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' }), n: money(p.net, lang) }), sub: [Number(p.primes) > 0 && `+${money(p.primes, lang)}`, Number(p.retenues) > 0 && `−${money(p.retenues, lang)} (${p.motif_retenues})`, Number(p.avances) > 0 && t('salaires.advancesDeducted', { n: money(p.avances, lang) })].filter(Boolean).join(' · ') })),
              ...q.data.avances.map((a) => ({ k: 'a' + a.id, d: a.created_at, nom: q.data.employes.find((e) => e.id === a.employe_id)?.nom, txt: t('salaires.advanceLine', { n: money(a.montant, lang), d: day(a.date_avance, lang) }), sub: [a.motif, a.paie_id ? t('salaires.deducted') : t('salaires.notDeducted')].filter(Boolean).join(' · ') }))]
              .sort((x, y) => y.d.localeCompare(x.d)).slice(0, 30).map((r) => (
                <li key={r.k}><div className="grow"><strong>{r.nom}</strong> · {r.txt}{r.sub && <div className="muted small">{r.sub}</div>}</div></li>
              ))}
          </ul>
          <p className="muted small">{t('salaires.cancelHint')}</p>
        </Panel>
      )}
    </>
  )
}
