import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { usePendingCount } from '../hooks'
import { loadStats, readCachedStats } from '../lib/stats'
import Icon from '../components/Icon'

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const pending = usePendingCount()
  const [stats, setStats] = useState(readCachedStats)
  const [stale, setStale] = useState(true)

  useEffect(() => {
    if (!navigator.onLine) return
    loadStats().then((s) => { setStats(s); setStale(false) }).catch(() => {})
  }, [])

  const lang = i18n.resolvedLanguage
  const fmt = (n) => (n ?? 0).toLocaleString(lang)
  const today = stats?.days.at(-1)
  const brokenRate = today?.eggs ? ((today.broken / today.eggs) * 100).toFixed(1) : '0'
  const max = Math.max(1, ...(stats?.days ?? []).map((d) => d.eggs))
  const firstName = (profile.nom_complet || '').split(' ')[0]

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <p className="hero-date">
            {new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1>{t('dashboard.welcome', { name: firstName })}</h1>
          <span className="chip">{t(`roles.${profile.role}`)}</span>
        </div>
        <Link to="/saisie" className="btn yolk">
          <Icon name="plus" size={18} />{t('dashboard.newEntry')}
        </Link>
      </section>

      {stale && stats && (
        <p className="note"><Icon name="clock" size={16} />
          {t('dashboard.cached', { date: new Date(stats.at).toLocaleString(lang) })}
        </p>
      )}

      <section className="kpis">
        <Kpi icon="egg" tone="yolk" label={t('dashboard.eggsToday')} value={fmt(today?.eggs)} />
        <Kpi icon="broken" tone="rose" label={t('dashboard.broken')} value={fmt(today?.broken)}
          hint={t('dashboard.rate', { rate: brokenRate })} />
        <Kpi icon="hen" tone="green" label={t('dashboard.flock')} value={fmt(stats?.effectif)} />
        <Kpi icon="cloud" tone="sky" label={t('dashboard.pending')} value={fmt(pending)}
          to={pending > 0 ? '/sync' : undefined} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('dashboard.last7')}</h2>
          <span className="muted">{t('dashboard.total', { n: fmt(stats?.days.reduce((s, d) => s + d.eggs, 0)) })}</span>
        </div>
        {stats ? (
          <div className="bars">
            {stats.days.map((d, i) => (
              <div key={d.date} className={`bar-col ${i === 6 ? 'today' : ''}`}>
                <span className="bar-val">{d.eggs ? fmt(d.eggs) : ''}</span>
                <div className="bar-track">
                  <div className="bar" style={{ height: `${(d.eggs / max) * 100}%` }} />
                </div>
                <span className="bar-label">
                  {new Date(`${d.date}T00:00`).toLocaleDateString(lang, { weekday: 'short' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{t('dashboard.noData')}</p>
        )}
      </section>
    </div>
  )
}

function Kpi({ icon, tone, label, value, hint, to }) {
  const body = (
    <>
      <span className={`kpi-icon ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  )
  return to ? <Link to={to} className="kpi link">{body}</Link> : <div className="kpi">{body}</div>
}
