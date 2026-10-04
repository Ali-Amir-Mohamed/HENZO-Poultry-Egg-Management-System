import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Small shared building blocks for the office screens

export function Tabs({ tabs, value, onChange }) {
  const { t } = useTranslation()
  return (
    <div className="segmented wrap" role="tablist">
      {tabs.map((k) => (
        <button key={k.id ?? k} type="button" role="tab" aria-selected={value === (k.id ?? k)}
          className={value === (k.id ?? k) ? 'active' : ''} onClick={() => onChange(k.id ?? k)}>
          {k.icon && <Icon name={k.icon} size={18} />}{t(k.label ?? k)}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children, className = '' }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>
}

export function Panel({ icon, tone = 'green', title, subtitle, actions, children }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel-head">
          {icon && <span className={`kpi-icon ${tone}`}><Icon name={icon} size={22} /></span>}
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <span className="spacer" />
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

// Collapsible creation form with its own submit / error / success handling
export function FormCard({ title, icon = 'plus', submitLabel, onSubmit, children, startOpen = false }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(startOpen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null); setDone(null)
    try {
      const message = await onSubmit()
      setDone(message || t('common.saved'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn ghost block" onClick={() => setOpen(true)}>
        <Icon name={icon} size={18} />{title}
      </button>
    )
  }
  return (
    <form className="panel form-card" onSubmit={submit}>
      <div className="panel-head">
        <span className="kpi-icon green"><Icon name={icon} size={20} /></span>
        <h2>{title}</h2>
        <span className="spacer" />
        <button type="button" className="icon-btn dark" onClick={() => setOpen(false)} aria-label={t('common.close')}>✕</button>
      </div>
      {children}
      {error && <div className="alert danger"><Icon name="alert" size={18} />{error}</div>}
      {done && <div className="alert success"><Icon name="check" size={18} />{done}</div>}
      <button type="submit" className="btn primary block" disabled={busy}>
        <Icon name="check" size={18} />{busy ? t('common.loading') : submitLabel ?? t('common.save')}
      </button>
    </form>
  )
}

export function Loading({ error }) {
  const { t } = useTranslation()
  if (error) return <div className="alert danger"><Icon name="alert" size={18} />{error}</div>
  return <p className="muted">{t('common.loading')}</p>
}

export function Empty({ icon = 'check', text }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={28} /></span>
      <p>{text}</p>
    </div>
  )
}


export const money = (n, lang) => `${Number(n ?? 0).toLocaleString(lang)} FCFA`
export const day = (d, lang) => (d ? new Date(`${d.slice(0, 10)}T00:00`).toLocaleDateString(lang) : '—')
