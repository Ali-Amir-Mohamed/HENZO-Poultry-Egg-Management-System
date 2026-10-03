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
  const fmt = (n, opts) => (n ?? 0).toLocaleString(lang, opts)
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
      {pending > 0 && (
        <Link to="/sync" className="note link-note"><Icon name="cloud" size={16} />
          {t('status.pending', { count: pending })}
        </Link>
      )}

      {/* ---------- Layers ---------- */}
      <h2 className="section-title"><span className="kpi-icon yolk sm"><Icon name="egg" size={18} /></span>{t('types.pondeuse_pl')}</h2>
      <section className="kpis three">
        <Kpi icon="egg" tone="yolk" label={t('dashboard.eggsToday')} value={fmt(today?.eggs)} />
        <Kpi icon="broken" tone="rose" label={t('dashboard.broken')} value={fmt(today?.broken)}
          hint={t('dashboard.rate', { rate: brokenRate })} />
        <Kpi icon="hen" tone="green" label={t('dashboard.layers')} value={fmt(stats?.effectif.pondeuse)} />
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

      {/* ---------- Broilers ---------- */}
      <h2 className="section-title"><span className="kpi-icon sky sm"><Icon name="drumstick" size={18} /></span>{t('types.chair_pl')}</h2>
      <section className="kpis three">
        <Kpi icon="drumstick" tone="sky" label={t('dashboard.broilers')} value={fmt(stats?.effectif.chair)} />
        <Kpi icon="calendar" tone="green" label={t('dashboard.broilerFlocks')} value={fmt(stats?.chair?.length)} />
        <Kpi icon="scale" tone="yolk" label={t('dashboard.lastWeight')}
          value={stats?.chair?.length ? `${fmt(avgWeight(stats.chair) / 1000, { maximumFractionDigits: 2 })} kg` : '—'} />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{t('dashboard.broilerTable')}</h2></div>
        {stats?.chair?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('saisie.bande')}</th>
                  <th>{t('dashboard.age')}</th>
                  <th>{t('dashboard.birds')}</th>
                  <th>{t('dashboard.weight')}</th>
                  <th title={t('dashboard.fcrHint')}>{t('dashboard.fcr')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.chair.map((b) => (
                  <tr key={b.bande_id}>
                    <td><strong>{b.code}</strong></td>
                    <td>{t('dashboard.days', { n: b.age_jours })}</td>
                    <td>{fmt(b.effectif_actuel)}</td>
                    <td>{b.poids_moyen_g ? `${fmt(b.poids_moyen_g)} g` : '—'}</td>
                    <td>{b.indice_consommation ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{stats ? t('dashboard.noBroilers') : t('dashboard.noData')}</p>
        )}
      </section>
    </div>
  )
}

// Average of the latest weights, weighted by the number of birds of each flock
function avgWeight(rows) {
  const weighed = rows.filter((r) => r.poids_moyen_g)
  const birds = weighed.reduce((s, r) => s + r.effectif_actuel, 0)
  return birds ? weighed.reduce((s, r) => s + r.poids_moyen_g * r.effectif_actuel, 0) / birds : 0
}

function Kpi({ icon, tone, label, value, hint }) {
  return (
    <div className="kpi">
      <span className={`kpi-icon ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  )
}
