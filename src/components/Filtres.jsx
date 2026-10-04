import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-CA')
}

// Period / activity / text filters shared by the money lists. The period is applied by the database query,
// the activity and the text on the loaded rows.
export function useFiltres() {
  const [f, setF] = useState({ from: daysAgo(30), to: daysAgo(0), activite: '', q: '' })
  const keep = (rows, { activite, text }) => rows.filter((r) =>
    (!f.activite || activite(r) === f.activite) &&
    (!f.q || text(r).toLowerCase().includes(f.q.trim().toLowerCase())))
  return { f, setF, keep }
}

export default function Filtres({ f, setF, onExport, count }) {
  const { t } = useTranslation()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="filters">
      <label><span>{t('filtres.from')}</span><input type="date" value={f.from} max={f.to} onChange={set('from')} /></label>
      <label><span>{t('filtres.to')}</span><input type="date" value={f.to} min={f.from} onChange={set('to')} /></label>
      <label><span>{t('filtres.activity')}</span>
        <select value={f.activite} onChange={set('activite')}>
          <option value="">{t('filtres.both')}</option>
          <option value="chair">{t('types.chair_pl')}</option>
          <option value="pondeuse">{t('types.pondeuse_pl')}</option>
        </select>
      </label>
      <label className="grow"><span>{t('filtres.search')}</span><input type="search" value={f.q} onChange={set('q')} placeholder={t('filtres.searchPh')} /></label>
      {onExport && (
        <button type="button" className="btn ghost sm" onClick={onExport} disabled={!count}>
          <Icon name="download" size={14} />{t('filtres.export')}
        </button>
      )}
    </div>
  )
}
