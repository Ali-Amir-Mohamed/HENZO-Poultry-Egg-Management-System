import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import { useAuth } from '../../auth/AuthProvider'
import Icon from '../../components/Icon'
import { day, Empty, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Employees and salaries (director, finance; only finance pays and sets salaries; employees are added by
// operations in Ferme > Équipe): advances paid at once, monthly pay = salary + bonus − deductions − advances.
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
  const modes = MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) }))

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
    const v = await ask.form({ title: t('salaires.editTitle', { nom: e.nom }), icon: 'users', submit: t('dialog.save'), message: t('salaires.editHint'), fields: [
      { name: 'salaire_mensuel', label: t('salaires.salary'), type: 'number', min: 0, value: e.salaire_mensuel, required: true },
      { name: 'activite', label: t('salaires.paidBy'), type: 'select', value: e.activite, options: ['chair', 'pondeuse'].map((a) => ({ value: a, label: t(`argent.caisse.${a}`) })) }
    ] })
    if (v) await run(supabase.from('employes').update({ activite: v.activite, salaire_mensuel: Number(v.salaire_mensuel) }).eq('id', e.id), q.reload)
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
                        {payeur && <button className="btn ghost sm" onClick={() => modifier(e)}>{t('salaires.editSalary')}</button>}
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

      <p className="note"><Icon name="users" size={16} />{t('salaires.addedByKenfack')}</p>

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
