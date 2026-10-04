import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { day, Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Egg stock: good eggs collected − eggs sold ± adjustments (broken in store, own use, stock count)
export default function StockOeufs() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const manage = can(role, 'bande.create')
  const q = useQuery(async () => {
    const [s, a] = await Promise.all([
      supabase.from('stock_oeufs').select('*').maybeSingle(),
      supabase.from('ajustements_oeufs').select('*').order('created_at', { ascending: false }).limit(10)
    ])
    return { stock: must(s), ajustements: must(a) }
  })

  const ajuster = async () => {
    const v = await ask.form({ title: t('oeufs.adjustTitle'), icon: 'egg', submit: t('dialog.save'), fields: [
      { name: 'sens', label: t('oeufs.direction'), type: 'select', value: 'moins',
        options: [{ value: 'moins', label: t('oeufs.remove') }, { value: 'plus', label: t('oeufs.add') }] },
      { name: 'quantite', label: t('oeufs.quantity'), type: 'number', min: 1, required: true },
      { name: 'unite', label: t('saisie.unite'), type: 'select', value: 'oeufs',
        options: [{ value: 'oeufs', label: t('oeufs.eggs') }, { value: 'plateaux', label: t('oeufs.trays', { n: q.data.stock?.oeufs_par_plateau ?? 30 }) }] },
      { name: 'motif', label: t('dialog.reason'), type: 'text', required: true, placeholder: t('oeufs.reasonPh') }
    ] })
    if (!v) return
    const n = v.quantite * (v.unite === 'plateaux' ? (q.data.stock?.oeufs_par_plateau ?? 30) : 1)
    await run(supabase.from('ajustements_oeufs').insert({ quantite: v.sens === 'moins' ? -n : n, motif: v.motif }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const s = q.data.stock
  if (!s) return null
  const n = (v) => Number(v ?? 0).toLocaleString(lang)
  return (
    <Panel icon="egg" tone="yolk" title={t('oeufs.title')}
      actions={manage ? <button className="btn ghost sm" onClick={ajuster}><Icon name="sync" size={14} />{t('oeufs.adjust')}</button> : null}>
      <div className="stock-level">
        <strong className={s.stock_oeufs < 0 ? 'error' : ''}>{n(s.plateaux)}</strong>
        <span>{t('oeufs.traysLabel')}</span>
        {s.oeufs_isoles > 0 && <span className="muted">+ {n(s.oeufs_isoles)} {t('oeufs.eggs')}</span>}
      </div>
      <div className="facts">
        <div className="fact"><span>{t('oeufs.collected')}</span><strong>{n(s.oeufs_bons)}</strong></div>
        <div className="fact"><span>{t('oeufs.sold')}</span><strong>{n(s.oeufs_vendus)}</strong></div>
        <div className="fact"><span>{t('oeufs.adjustments')}</span><strong>{n(s.ajustements)}</strong></div>
        <div className="fact"><span>{t('oeufs.total')}</span><strong>{n(s.stock_oeufs)}</strong></div>
      </div>
      {s.stock_oeufs < 0 && <div className="alert warn"><Icon name="alert" size={16} />{t('oeufs.negative')}</div>}
      {q.data.ajustements.length > 0 && (
        <details>
          <summary>{t('oeufs.history', { count: q.data.ajustements.length })}</summary>
          <ul className="list">
            {q.data.ajustements.map((a) => (
              <li key={a.id}>
                <div className="grow"><strong>{a.quantite > 0 ? '+' : ''}{n(a.quantite)} {t('oeufs.eggs')}</strong><div className="muted small">{day(a.date_ajustement, lang)} · {a.motif}</div></div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  )
}
