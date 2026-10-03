import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enqueue } from '../lib/offlineQueue'
import { loadBandesActives } from '../lib/referenceData'
import { localDate } from '../lib/stats'
import { TABLES } from '../config'
import Icon from '../components/Icon'

// Offline-first field entry forms. saisi_par is filled by the database default (auth.uid()).
// Each form only lists the flocks of the matching production type.
const FORMS = {
  oeufs: {
    table: TABLES.ramassages,
    icon: 'egg',
    tone: 'yolk',
    type: 'pondeuse',
    dateField: 'date_ramassage',
    fields: [
      { name: 'oeufs_ramasses', label: 'saisie.eggs', big: true },
      { name: 'oeufs_casses', label: 'saisie.broken', big: true, initial: '0' }
    ]
  },
  mortalite: {
    table: TABLES.mortalites,
    icon: 'alert',
    tone: 'rose',
    type: null,
    dateField: 'date_constat',
    fields: [
      { name: 'nombre', label: 'saisie.deaths', big: true, min: 1 },
      { name: 'cause', label: 'saisie.cause', text: true, optional: true }
    ]
  },
  pesee: {
    table: TABLES.pesees,
    icon: 'scale',
    tone: 'green',
    type: 'chair',
    dateField: 'date_pesee',
    fields: [
      { name: 'poids_moyen_g', label: 'saisie.avgWeight', big: true, min: 1, step: '0.1' },
      { name: 'nombre_peses', label: 'saisie.sampleSize', big: true, min: 1, initial: '10' }
    ]
  }
}

function emptyForm(kind, bande_id = '') {
  const def = FORMS[kind]
  const form = { bande_id, [def.dateField]: localDate(), notes: '' }
  for (const f of def.fields) form[f.name] = f.initial ?? ''
  return form
}

export default function Saisie() {
  const { t } = useTranslation()
  const [kind, setKind] = useState('oeufs')
  const [bandes, setBandes] = useState([])
  const [form, setForm] = useState(() => emptyForm('oeufs'))
  const [saved, setSaved] = useState(false)

  useEffect(() => { loadBandesActives().then(setBandes) }, [])

  const def = FORMS[kind]
  const choices = bandes.filter((b) => !def.type || b.type_production === def.type)

  const switchKind = (k) => { setKind(k); setForm(emptyForm(k)); setSaved(false) }
  const set = (key) => (e) => { setSaved(false); setForm({ ...form, [key]: e.target.value }) }

  const submit = async (e) => {
    e.preventDefault()
    const row = { ...form, notes: form.notes || null }
    for (const f of def.fields) {
      row[f.name] = f.text ? (form[f.name] || null) : Number(form[f.name])
    }
    await enqueue(def.table, row)
    setForm(emptyForm(kind, form.bande_id))
    setSaved(true)
  }

  return (
    <div className="stack">
      <div className="segmented" role="tablist">
        {Object.entries(FORMS).map(([k, f]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k}
            className={kind === k ? 'active' : ''} onClick={() => switchKind(k)}>
            <Icon name={f.icon} size={18} />{t(`saisie.kinds.${k}`)}
          </button>
        ))}
      </div>

      <form className="panel form" onSubmit={submit}>
        <div className="panel-head">
          <span className={`kpi-icon ${def.tone}`}><Icon name={def.icon} size={22} /></span>
          <div>
            <h2>{t(`saisie.titles.${kind}`)}</h2>
            <p className="muted">{t(`saisie.hints.${kind}`)}</p>
          </div>
        </div>

        <div className="grid-2">
          <label className="field">
            <span>{t('saisie.date')}</span>
            <input type="date" required value={form[def.dateField]} onChange={set(def.dateField)} />
          </label>
          <label className="field">
            <span>{t('saisie.bande')}</span>
            <select required value={form.bande_id} onChange={set('bande_id')}>
              <option value="" disabled>{choices.length ? t('saisie.choose') : t('saisie.noBande')}</option>
              {choices.map((b) => (
                <option key={b.id} value={b.id}>{b.code} · {t(`types.${b.type_production}`)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid-2">
          {def.fields.map((f) => (
            <label key={f.name} className={`field ${f.big ? 'big' : ''}`}>
              <span>{t(f.label)}</span>
              {f.text ? (
                <input value={form[f.name]} onChange={set(f.name)} />
              ) : (
                <input type="number" inputMode="decimal" min={f.min ?? 0} step={f.step ?? '1'}
                  required={!f.optional} placeholder="0" value={form[f.name]} onChange={set(f.name)} />
              )}
            </label>
          ))}
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
    </div>
  )
}
