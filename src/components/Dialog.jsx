import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Real form dialogs instead of window.prompt / window.confirm (much better on phones).
//   const dialog = useDialog()
//   const v = await dialog.form({ title, fields: [{ name, label, type, value, required, options, min, hint }], submit })
//   if (!v) return            // cancelled
//   if (await dialog.confirm({ title, message, danger: true })) …
const DialogContext = createContext(null)

export function DialogProvider({ children }) {
  const [current, setCurrent] = useState(null)
  const open = useCallback((spec) => new Promise((resolve) => setCurrent({ ...spec, resolve })), [])
  const close = (result) => { current?.resolve(result); setCurrent(null) }
  const api = useRef({
    form: (spec) => open({ kind: 'form', ...spec }),
    confirm: (spec) => open({ kind: 'confirm', ...(typeof spec === 'string' ? { message: spec } : spec) })
  })
  api.current.form = (spec) => open({ kind: 'form', ...spec })
  api.current.confirm = (spec) => open({ kind: 'confirm', ...(typeof spec === 'string' ? { message: spec } : spec) })
  api.current.alert = (spec) => open({ kind: 'alert', ...(typeof spec === 'string' ? { message: spec } : spec) })

  return (
    <DialogContext.Provider value={api.current}>
      {children}
      {current && <DialogView spec={current} onClose={close} />}
    </DialogContext.Provider>
  )
}

export const useDialog = () => useContext(DialogContext)

// Shortcuts used across the office screens
export function useAsk() {
  const d = useDialog()
  const { t } = useTranslation()
  const modes = ['especes', 'mobile_money', 'banque'].map((m) => ({ value: m, label: t(`modes.${m}`) }))
  return {
    form: d.form,
    confirm: (message, opts = {}) => d.confirm({ message, ...opts }),
    error: (message) => d.alert({ title: t('dialog.errorTitle'), message, icon: 'alert', danger: true }),
    info: (title, message) => d.alert({ title, message, icon: 'check' }),
    // Mandatory reason (cancellation, rejection, correction)
    reason: async (title) => {
      const v = await d.form({ title, icon: 'note', fields: [{ name: 'motif', label: t('dialog.reason'), type: 'textarea', required: true }], submit: t('dialog.confirm') })
      return v?.motif?.trim() || null
    },
    // Amount + payment mode (+ optional date)
    payment: (title, { value = '', max, withDate = false, hint, submit } = {}) => d.form({
      title, icon: 'wallet', submit,
      fields: [
        { name: 'montant', label: t('argent.amount'), type: 'number', value, min: 1, max, required: true, hint },
        { name: 'mode', label: t('saisie.modeAcompte'), type: 'select', value: 'especes', options: modes },
        ...(withDate ? [{ name: 'date', label: t('saisie.date'), type: 'date', value: new Date().toLocaleDateString('en-CA'), required: true }] : [])
      ]
    })
  }
}

// Runs a Supabase call and shows its error in a dialog
export function useRun() {
  const ask = useAsk()
  return async (promise, after) => {
    const { error, data } = await promise
    if (error) { await ask.error(error.message); return null }
    after?.()
    return data ?? true
  }
}

function DialogView({ spec, onClose }) {
  const { t } = useTranslation()
  const fields = spec.fields ?? []
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])))
  const [error, setError] = useState(null)
  const first = useRef(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = (f) => !f.showIf || f.showIf(values)
  const submit = (e) => {
    e.preventDefault()
    if (spec.kind === 'confirm' || spec.kind === 'alert') return onClose(true)
    for (const f of fields.filter(visible)) {
      const v = values[f.name]
      if (f.required && (v === '' || v == null)) return setError(t('dialog.required', { field: f.label }))
      if (f.type === 'number' && v !== '' && f.min != null && Number(v) < f.min) return setError(t('dialog.min', { field: f.label, min: f.min }))
      if (f.type === 'number' && v !== '' && f.max != null && Number(v) > f.max) return setError(t('dialog.max', { field: f.label, max: f.max }))
    }
    const out = {}
    for (const f of fields) out[f.name] = f.type === 'number' && values[f.name] !== '' ? Number(values[f.name]) : values[f.name]
    onClose(out)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(null) }}>
      <form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label={spec.title}>
        <div className="dialog-head">
          {spec.icon && <span className={`kpi-icon ${spec.danger ? 'rose' : 'green'} sm`}><Icon name={spec.icon} size={16} /></span>}
          <h2>{spec.title ?? t('dialog.confirmTitle')}</h2>
          <button type="button" className="icon-btn dark" onClick={() => onClose(null)} aria-label={t('common.close')}>✕</button>
        </div>
        {spec.message && <p className="dialog-message">{spec.message}</p>}
        {fields.filter(visible).map((f, i) => (
          <label key={f.name} className="field">
            <span>{f.label}</span>
            {f.type === 'select' ? (
              <select ref={i === 0 ? first : null} value={values[f.name]} onChange={(e) => { setError(null); setValues({ ...values, [f.name]: e.target.value }) }}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea ref={i === 0 ? first : null} rows="3" value={values[f.name]} onChange={(e) => { setError(null); setValues({ ...values, [f.name]: e.target.value }) }} />
            ) : (
              <input ref={i === 0 ? first : null} type={f.type ?? 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined}
                step={f.step} min={f.min} max={f.max} placeholder={f.placeholder} value={values[f.name]}
                onChange={(e) => { setError(null); setValues({ ...values, [f.name]: e.target.value }) }} />
            )}
            {f.hint && <small className="muted">{f.hint}</small>}
          </label>
        ))}
        {error && <div className="alert danger"><Icon name="alert" size={16} />{error}</div>}
        <div className="dialog-actions">
          {spec.kind !== 'alert' && <button type="button" className="btn ghost" onClick={() => onClose(null)}>{spec.cancel ?? t('dialog.cancel')}</button>}
          <button type="submit" className={`btn ${spec.danger && spec.kind !== 'alert' ? 'danger' : 'primary'}`}>{spec.submit ?? t('dialog.ok')}</button>
        </div>
      </form>
    </div>
  )
}
