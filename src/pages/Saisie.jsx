import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enqueue } from '../lib/offlineQueue'
import { loadBandesActives } from '../lib/referenceData'
import { localDate } from '../lib/stats'
import { TABLES } from '../config'
import Icon from '../components/Icon'

const empty = (bande_id = '') => ({ bande_id, date_ramassage: localDate(), oeufs_ramasses: '', oeufs_casses: '0', notes: '' })

// Offline-first egg collection form (table ramassages_oeufs).
// saisi_par is filled by the database default (auth.uid()).
export default function Saisie() {
  const { t } = useTranslation()
  const [bandes, setBandes] = useState([])
  const [form, setForm] = useState(empty)
  const [saved, setSaved] = useState(false)

  useEffect(() => { loadBandesActives().then(setBandes) }, [])

  const set = (key) => (e) => { setSaved(false); setForm({ ...form, [key]: e.target.value }) }

  const submit = async (e) => {
    e.preventDefault()
    await enqueue(TABLES.ramassages, {
      ...form,
      oeufs_ramasses: Number(form.oeufs_ramasses),
      oeufs_casses: Number(form.oeufs_casses),
      notes: form.notes || null
    })
    setForm(empty(form.bande_id))
    setSaved(true)
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <div className="panel-head">
        <span className="kpi-icon yolk"><Icon name="egg" size={22} /></span>
        <div>
          <h2>{t('saisie.title')}</h2>
          <p className="muted">{t('saisie.subtitle')}</p>
        </div>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>{t('saisie.date')}</span>
          <input type="date" required value={form.date_ramassage} onChange={set('date_ramassage')} />
        </label>
        <label className="field">
          <span>{t('saisie.bande')}</span>
          <select required value={form.bande_id} onChange={set('bande_id')}>
            <option value="" disabled>{bandes.length ? t('saisie.choose') : t('saisie.noBande')}</option>
            {bandes.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </select>
        </label>
      </div>

      <div className="grid-2">
        <label className="field big">
          <span>{t('saisie.eggs')}</span>
          <input type="number" inputMode="numeric" min="0" required placeholder="0"
            value={form.oeufs_ramasses} onChange={set('oeufs_ramasses')} />
        </label>
        <label className="field big">
          <span>{t('saisie.broken')}</span>
          <input type="number" inputMode="numeric" min="0" required
            value={form.oeufs_casses} onChange={set('oeufs_casses')} />
        </label>
      </div>

      <label className="field">
        <span>{t('saisie.notes')}</span>
        <textarea rows="2" value={form.notes} onChange={set('notes')} />
      </label>

      {saved && <div className="alert success"><Icon name="check" size={18} />{t('saisie.saved')}</div>}
      <button type="submit" className="btn primary block">
        <Icon name="check" size={18} />{t('saisie.save')}
      </button>
    </form>
  )
}
