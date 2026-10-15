import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { Field, Loading, Panel } from '../../components/ui'

// The company's legal and tax sheet: printed on every invoice and used for the tax calculations.
// Director and finance edit it; the rates are to be confirmed by the accountant.
const CHAMPS = ['raison_sociale', 'forme_juridique', 'capital_social', 'niu', 'rccm', 'adresse_siege', 'telephone_societe', 'email_societe',
  'banque_paiement', 'mentions_facture', 'numero_cnps_employeur', 'prefixe_facture', 'regime_fiscal', 'adherent_cga', 'assujetti_tva', 'taux_tva', 'taux_acompte', 'taux_is']

export default function Societe() {
  const { t } = useTranslation()
  const { role, profile } = useAuth()
  const edit = can(role, 'societe.edit')
  const q = useQuery(async () => must(await supabase.from('fermes').select(CHAMPS.join(', ')).eq('id', profile.ferme_id).maybeSingle()), [profile?.ferme_id])
  const [form, setForm] = useState(null)
  const [etat, setEtat] = useState(null)
  useEffect(() => { if (q.data) setForm(Object.fromEntries(CHAMPS.map((k) => [k, q.data[k] ?? '']))) }, [q.data])
  const set = (k) => (e) => { setEtat(null); setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }) }

  const enregistrer = async (e) => {
    e.preventDefault()
    setEtat({ busy: true })
    const { error } = await supabase.rpc('maj_societe', { p: { ...form, capital_social: form.capital_social === '' ? '' : String(form.capital_social) } })
    if (error) return setEtat({ error: error.message })
    setEtat({ ok: true })
    q.reload()
  }

  if (!q.data || !form) return <Loading error={q.error} />
  const ro = !edit
  return (
    <form className="stack" onSubmit={enregistrer}>
      <Panel icon="note" tone="sky" title={t('compta.soc.identity')} subtitle={t('compta.soc.identityHint')}>
        <div className="grid-2">
          <Field label={t('compta.soc.raison')}><input disabled={ro} value={form.raison_sociale} onChange={set('raison_sociale')} placeholder="HENZO SARL" /></Field>
          <Field label={t('compta.soc.forme')}><input disabled={ro} value={form.forme_juridique} onChange={set('forme_juridique')} /></Field>
          <Field label={t('compta.soc.capital')}><input disabled={ro} type="number" min="0" value={form.capital_social} onChange={set('capital_social')} /></Field>
          <Field label="NIU"><input disabled={ro} value={form.niu} onChange={set('niu')} /></Field>
          <Field label="RCCM"><input disabled={ro} value={form.rccm} onChange={set('rccm')} /></Field>
          <Field label={t('compta.soc.siege')}><input disabled={ro} value={form.adresse_siege} onChange={set('adresse_siege')} /></Field>
          <Field label={t('reglages.phone')}><input disabled={ro} type="tel" value={form.telephone_societe} onChange={set('telephone_societe')} /></Field>
          <Field label={t('compta.soc.email')}><input disabled={ro} type="email" value={form.email_societe} onChange={set('email_societe')} /></Field>
          <Field label={t('compta.soc.cnps')}><input disabled={ro} value={form.numero_cnps_employeur} onChange={set('numero_cnps_employeur')} /></Field>
        </div>
      </Panel>

      <Panel icon="receipt" tone="green" title={t('compta.soc.invoices')}>
        <div className="grid-2">
          <Field label={t('compta.soc.prefix')}><input disabled={ro} value={form.prefixe_facture} onChange={set('prefixe_facture')} maxLength={6} /></Field>
          <Field label={t('compta.soc.bank')}><input disabled={ro} value={form.banque_paiement} onChange={set('banque_paiement')} placeholder={t('compta.soc.bankPh')} /></Field>
        </div>
        <Field label={t('compta.soc.mentions')}><textarea disabled={ro} rows={2} value={form.mentions_facture} onChange={set('mentions_facture')} placeholder={t('compta.soc.mentionsPh')} /></Field>
      </Panel>

      <Panel icon="wallet" tone="yolk" title={t('compta.soc.tax')} subtitle={t('compta.soc.taxHint')}>
        <div className="grid-2">
          <Field label={t('compta.soc.regime')}>
            <select disabled={ro} value={form.regime_fiscal} onChange={set('regime_fiscal')}>
              {['reel', 'simplifie', 'igs'].map((r) => <option key={r} value={r}>{t(`compta.regimes.${r}`)}</option>)}
            </select>
          </Field>
          <Field label={t('compta.soc.acompte')}><input disabled={ro} type="number" min="0" max="100" step="0.01" value={form.taux_acompte} onChange={set('taux_acompte')} /></Field>
          <Field label={t('compta.soc.is')}><input disabled={ro} type="number" min="0" max="100" step="0.01" value={form.taux_is} onChange={set('taux_is')} /></Field>
          <Field label={t('compta.soc.tvaRate')}><input disabled={ro} type="number" min="0" max="100" step="0.01" value={form.taux_tva} onChange={set('taux_tva')} /></Field>
        </div>
        <label className="check"><input disabled={ro} type="checkbox" checked={!!form.adherent_cga} onChange={set('adherent_cga')} />{t('compta.soc.cga')}</label>
        <label className="check"><input disabled={ro} type="checkbox" checked={!!form.assujetti_tva} onChange={set('assujetti_tva')} />{t('compta.soc.tva')}</label>
      </Panel>

      {etat?.error && <div className="alert danger"><Icon name="alert" size={18} />{etat.error}</div>}
      {etat?.ok && <div className="alert success"><Icon name="check" size={18} />{t('common.saved')}</div>}
      {edit ? <button type="submit" className="btn primary block" disabled={etat?.busy}><Icon name="check" size={18} />{t('common.save')}</button>
        : <p className="note"><Icon name="note" size={16} />{t('compta.soc.readOnly')}</p>}
    </form>
  )
}
