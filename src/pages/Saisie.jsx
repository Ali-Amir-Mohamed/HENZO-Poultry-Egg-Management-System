import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { enqueue } from '../lib/offlineQueue'
import { TABLES } from '../config'

const today = () => new Date().toISOString().slice(0, 10)
const empty = () => ({ collected_on: today(), building: '', eggs_collected: '', eggs_broken: '0', notes: '' })

// Demo offline-first form. TODO(schema étape 1): column names must match the real table.
export default function Saisie() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const [form, setForm] = useState(empty)
  const [saved, setSaved] = useState(false)

  const set = (key) => (e) => { setSaved(false); setForm({ ...form, [key]: e.target.value }) }

  const submit = async (e) => {
    e.preventDefault()
    await enqueue(TABLES.eggCollections, {
      ...form,
      eggs_collected: Number(form.eggs_collected),
      eggs_broken: Number(form.eggs_broken),
      recorded_by: session.user.id
    })
    setForm(empty())
    setSaved(true)
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('saisie.title')}</h2>
      <label>{t('saisie.date')}
        <input type="date" required value={form.collected_on} onChange={set('collected_on')} />
      </label>
      <label>{t('saisie.building')}
        <input required value={form.building} onChange={set('building')} />
      </label>
      <label>{t('saisie.eggs')}
        <input type="number" inputMode="numeric" min="0" required value={form.eggs_collected} onChange={set('eggs_collected')} />
      </label>
      <label>{t('saisie.broken')}
        <input type="number" inputMode="numeric" min="0" required value={form.eggs_broken} onChange={set('eggs_broken')} />
      </label>
      <label>{t('saisie.notes')}
        <textarea rows="2" value={form.notes} onChange={set('notes')} />
      </label>
      <button type="submit">{t('saisie.save')}</button>
      {saved && <p className="success">{t('saisie.saved')}</p>}
    </form>
  )
}
