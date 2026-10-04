import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { day, Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Field entries of the last days, with correction / deletion (director, exploitation).
// Every correction is recorded in the activity log.
const TYPES = {
  mortalites: { icon: 'alert', tone: 'rose', date: 'date_constat', fields: [{ name: 'nombre', type: 'number', min: 1 }, { name: 'cause', type: 'text', optional: true }] },
  pontes: { icon: 'egg', tone: 'yolk', date: 'date_ponte', fields: [{ name: 'oeufs_collectes', type: 'number', min: 0 }, { name: 'oeufs_casses', type: 'number', min: 0 }] },
  pesees: { icon: 'scale', tone: 'green', date: 'date_pesee', fields: [{ name: 'poids_moyen_g', type: 'number', min: 1, step: '0.1' }, { name: 'nombre_peses', type: 'number', min: 1 }] },
  mouvements_stock: { icon: 'box', tone: 'sky', date: 'date_mouvement', fields: [{ name: 'quantite', type: 'number', min: 0.01, step: '0.01' }] },
  observations: { icon: 'note', tone: 'sky', date: 'date_observation', fields: [{ name: 'texte', type: 'textarea' }] }
}

export default function Saisies() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const manage = can(role, 'bande.create')
  const [type, setType] = useState('')
  const [days, setDays] = useState(14)

  const q = useQuery(async () => {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const s = since.toLocaleDateString('en-CA')
    const sel = 'bande:bandes(code), lot:lots_pondeuses(code)'
    const [m, p, w, a, o, users] = await Promise.all([
      supabase.from('mortalites').select(`*, ${sel}`).gte('date_constat', s),
      supabase.from('pontes').select('*, lot:lots_pondeuses(code)').gte('date_ponte', s),
      supabase.from('pesees').select('*, bande:bandes(code)').gte('date_pesee', s),
      supabase.from('mouvements_stock').select(`*, article:articles(nom, unite), ${sel}`).eq('type_mouvement', 'sortie').gte('date_mouvement', s),
      supabase.from('observations').select(`*, ${sel}`).gte('date_observation', s),
      supabase.rpc('membres_ferme')
    ])
    const names = Object.fromEntries((users.data ?? []).map((u) => [u.user_id, u.nom_complet || u.identifiant]))
    const tag = (rows, table) => must(rows).map((r) => ({ ...r, table, date: r[TYPES[table].date] }))
    const all = [...tag(m, 'mortalites'), ...tag(p, 'pontes'), ...tag(w, 'pesees'), ...tag(a, 'mouvements_stock'), ...tag(o, 'observations')]
    return { rows: all.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.created_at.localeCompare(x.created_at))), names }
  }, [days])

  const label = (r) => {
    const n = (v) => Number(v).toLocaleString(lang)
    switch (r.table) {
      case 'mortalites': return t('saisies.lines.mortalite', { n: n(r.nombre) }) + (r.cause ? ` · ${r.cause}` : '')
      case 'pontes': return t('saisies.lines.ponte', { n: n(r.oeufs_collectes), c: n(r.oeufs_casses) })
      case 'pesees': return t('saisies.lines.pesee', { g: n(r.poids_moyen_g), n: r.nombre_peses })
      case 'mouvements_stock': return `${n(r.quantite)} ${t(`unites.${r.article?.unite}`)} ${r.article?.nom ?? ''}`
      default: return r.texte
    }
  }

  const corriger = async (r) => {
    const def = TYPES[r.table]
    const v = await ask.form({
      title: t('saisies.editTitle', { type: t(`saisies.types.${r.table}`) }), icon: def.icon, submit: t('dialog.save'),
      fields: [
        { name: 'date', label: t('saisie.date'), type: 'date', value: r.date, required: true },
        ...def.fields.map((f) => ({ name: f.name, label: t(`saisie.fields.${f.name}`), type: f.type, min: f.min, step: f.step, value: r[f.name] ?? '', required: !f.optional }))
      ]
    })
    if (!v) return
    if (r.table === 'pontes' && v.oeufs_casses > v.oeufs_collectes) return ask.error(t('saisies.brokenTooHigh'))
    const patch = { [def.date]: v.date }
    for (const f of def.fields) patch[f.name] = f.type === 'number' ? v[f.name] : (v[f.name] || null)
    await run(supabase.from(r.table).update(patch).eq('id', r.id), q.reload)
  }
  const supprimer = async (r) => {
    if (!(await ask.confirm(t('saisies.confirmDelete', { type: t(`saisies.types.${r.table}`), label: label(r), d: day(r.date, lang) }),
      { title: t('stock.remove'), icon: 'trash', danger: true, submit: t('stock.remove') }))) return
    await run(supabase.from(r.table).delete().eq('id', r.id), q.reload)
  }

  const rows = (q.data?.rows ?? []).filter((r) => !type || r.table === type)
  return (
    <Panel icon="note" tone="sky" title={t('saisies.title')} subtitle={manage ? t('saisies.subtitleEdit') : t('saisies.subtitle')}
      actions={(
        <span className="row">
          <select className="inline-select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('journal.all')}</option>
            {Object.keys(TYPES).map((k) => <option key={k} value={k}>{t(`saisies.types.${k}`)}</option>)}
          </select>
          <select className="inline-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 90].map((d) => <option key={d} value={d}>{t('saisies.lastDays', { n: d })}</option>)}
          </select>
        </span>
      )}>
      {!q.data ? <Loading error={q.error} /> : rows.length === 0 ? <p className="muted">{t('saisies.none')}</p> : (
        <ul className="list">
          {rows.map((r) => (
            <li key={`${r.table}-${r.id}`}>
              <span className={`kpi-icon ${TYPES[r.table].tone} sm`}><Icon name={TYPES[r.table].icon} size={16} /></span>
              <div className="grow">
                <strong>{label(r)}</strong>
                <div className="muted small">
                  {day(r.date, lang)} · {t(`saisies.types.${r.table}`)}
                  {r.bande ? ` · ${r.bande.code}` : r.lot ? ` · ${r.lot.code}` : ''}
                  {q.data.names[r.saisi_par] ? ` · ${q.data.names[r.saisi_par]}` : ''}
                </div>
              </div>
              {manage && (
                <span className="row-actions">
                  <button className="btn ghost sm" onClick={() => corriger(r)} aria-label={t('common.edit')}><Icon name="note" size={14} /></button>
                  <button className="btn ghost sm" onClick={() => supprimer(r)} aria-label={t('stock.remove')}><Icon name="trash" size={14} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
