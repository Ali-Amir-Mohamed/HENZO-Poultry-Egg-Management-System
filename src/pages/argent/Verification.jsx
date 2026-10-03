import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { day, Field, FormCard, Loading, money, Panel } from '../../components/ui'

// Cash check: system balance vs money actually counted, justified gap
export default function Verification() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage

  const q = useQuery(async () => {
    const [s, v] = await Promise.all([
      supabase.from('soldes_caisses').select('*'),
      supabase.from('verifications_caisse').select('*, caisse:caisses(activite, mode)').order('created_at', { ascending: false }).limit(30)
    ])
    return { soldes: must(s), verifs: must(v) }
  })
  const [form, setForm] = useState({ caisse_id: '', montant_compte: '', justification: '', ajustement: false })

  const theorique = q.data?.soldes.find((c) => c.caisse_id === form.caisse_id)?.solde
  const ecart = form.caisse_id && form.montant_compte !== '' ? Number(form.montant_compte) - Number(theorique) : null

  const submit = async () => {
    must(await supabase.from('verifications_caisse').insert({
      caisse_id: form.caisse_id,
      montant_compte: Number(form.montant_compte),
      justification: form.justification || null,
      ajustement: form.ajustement
    }))
    setForm({ caisse_id: '', montant_compte: '', justification: '', ajustement: false })
    q.reload()
    return ecart ? t('verif.savedGap') : t('verif.savedOk')
  }

  if (!q.data) return <Loading error={q.error} />

  return (
    <>
      {can(role, 'caisse.verify') && (
        <FormCard title={t('verif.new')} icon="wallet" onSubmit={submit} startOpen>
          <div className="grid-2">
            <Field label={t('argent.caisseLabel')}>
              <select required value={form.caisse_id} onChange={(e) => setForm({ ...form, caisse_id: e.target.value })}>
                <option value="" disabled>{t('saisie.choose')}</option>
                {q.data.soldes.map((c) => <option key={c.caisse_id} value={c.caisse_id}>{t(`types.${c.activite}_pl`)} · {t(`modes.${c.mode}`)}</option>)}
              </select>
            </Field>
            <Field label={t('verif.counted')} className="big">
              <input type="number" min="0" required value={form.montant_compte} onChange={(e) => setForm({ ...form, montant_compte: e.target.value })} />
            </Field>
          </div>
          {form.caisse_id && (
            <div className="facts">
              <div className="fact"><span>{t('verif.theoretical')}</span><strong>{money(theorique, lang)}</strong></div>
              {ecart !== null && (
                <div className={`fact ${ecart !== 0 ? 'bad' : ''}`}><span>{t('verif.gap')}</span><strong>{ecart > 0 ? '+' : ''}{money(ecart, lang)}</strong></div>
              )}
            </div>
          )}
          {ecart !== null && ecart !== 0 && (
            <>
              <Field label={t('verif.justification')}><textarea rows="2" required value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></Field>
              {can(role, 'caisse.adjust') && (
                <label className="check">
                  <input type="checkbox" checked={form.ajustement} onChange={(e) => setForm({ ...form, ajustement: e.target.checked })} />
                  {t('verif.adjust')}
                </label>
              )}
            </>
          )}
        </FormCard>
      )}

      <Panel icon="clock" tone="sky" title={t('verif.history')}>
        {q.data.verifs.length === 0 ? <p className="muted">{t('verif.none')}</p> : (
          <ul className="list">
            {q.data.verifs.map((v) => (
              <li key={v.id}>
                <div className="grow">
                  <strong>{t(`types.${v.caisse.activite}_pl`)} · {t(`modes.${v.caisse.mode}`)}</strong>
                  <div className="muted small">{day(v.date_verification, lang)} · {t('verif.theoretical')} {money(v.solde_theorique, lang)} · {t('verif.counted')} {money(v.montant_compte, lang)}</div>
                  {v.justification && <div className="small">{v.justification}</div>}
                </div>
                <div className="right">
                  <span className={`tag ${Number(v.ecart) === 0 ? 'ok' : 'danger'}`}>
                    {Number(v.ecart) === 0 ? t('verif.noGap') : `${Number(v.ecart) > 0 ? '+' : ''}${money(v.ecart, lang)}`}
                  </span>
                  {v.ajustement && <span className="tag muted"><Icon name="check" size={12} /> {t('verif.adjusted')}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
