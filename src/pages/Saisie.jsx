import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enqueue } from '../lib/offlineQueue'
import { loadBandesActives } from '../lib/referenceData'
import { TABLES } from '../config'

const today = () => new Date().toISOString().slice(0, 10)
const empty = (bande_id = '') => ({ bande_id, date_ramassage: today(), oeufs_ramasses: '', oeufs_casses: '0', notes: '' })

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
    <form className="card" onSubmit={submit}>
      <h2>{t('saisie.title')}</h2>
      <label>{t('saisie.date')}
        <input type="date" required value={form.date_ramassage} onChange={set('date_ramassage')} />
      </label>
      <label>{t('saisie.bande')}
        <select required value={form.bande_id} onChange={set('bande_id')}>
          <option value="" disabled>{bandes.length ? t('saisie.choose') : t('saisie.noBande')}</option>
          {bandes.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
        </select>
      </label>
      <label>{t('saisie.eggs')}
        <input type="number" inputMode="numeric" min="0" required value={form.oeufs_ramasses} onChange={set('oeufs_ramasses')} />
      </label>
      <label>{t('saisie.broken')}
        <input type="number" inputMode="numeric" min="0" required value={form.oeufs_casses} onChange={set('oeufs_casses')} />
      </label>
      <label>{t('saisie.notes')}
        <textarea rows="2" value={form.notes} onChange={set('notes')} />
      </label>
      <button type="submit">{t('saisie.save')}</button>
      {saved && <p className="success">{t('saisie.saved')}</p>}
    </form>
  )
}
