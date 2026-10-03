import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { usePendingCount } from '../hooks'
import { loadStats, readCachedStats } from '../lib/stats'
import { canAccess } from '../config'
import Icon from '../components/Icon'

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const { profile, role } = useAuth()
  const pending = usePendingCount()
  const [stats, setStats] = useState(() => {
    const cached = readCachedStats()
    return cached?.kind === (role === 'employe' ? 'employe' : 'manager') ? cached : null
  })
  const [stale, setStale] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!navigator.onLine) return
    loadStats(role).then((s) => { setStats(s); setStale(false) }).catch((e) => setError(e.message))
  }, [role])

  const lang = i18n.resolvedLanguage
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
        {canAccess(role, 'saisie') && (
          <Link to="/saisie" className="btn yolk"><Icon name="plus" size={18} />{t('dashboard.newEntry')}</Link>
        )}
      </section>

      {stale && stats && (
        <p className="note"><Icon name="clock" size={16} />
          {t('dashboard.cached', { date: new Date(stats.at).toLocaleString(lang) })}
        </p>
      )}
      {error && <div className="alert danger"><Icon name="alert" size={18} />{error}</div>}
      {pending > 0 && (
        <Link to="/sync" className="note link-note"><Icon name="cloud" size={16} />{t('status.pending', { count: pending })}</Link>
      )}

      {!stats ? <p className="muted">{t('dashboard.noData')}</p>
        : stats.kind === 'employe' ? <EmployeeHome stats={stats} />
          : <ManagerHome stats={stats} />}
    </div>
  )
}

function EmployeeHome({ stats }) {
  const { t } = useTranslation()
  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('dashboard.myDay')}</h2></div>
      <div className="task-grid">
        {Object.entries(stats.mine).map(([k, n]) => (
          <Link key={k} to="/saisie" className={`task ${n ? 'done' : ''}`}>
            <span className="task-check">{n ? <Icon name="check" size={16} /> : null}</span>
            <span>{t(`saisie.kinds.${k}`)}</span>
            <span className="muted">{n ? t('dashboard.entries', { count: n }) : t('dashboard.todo')}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function ManagerHome({ stats }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const fmt = (n, opts) => Number(n ?? 0).toLocaleString(lang, opts)
  const today = stats.pondeuse.days.at(-1)
  const taux = stats.pondeuse.effectif ? ((today.eggs / stats.pondeuse.effectif) * 100).toFixed(1) : '0'
  const max = Math.max(1, ...stats.pondeuse.days.map((d) => d.eggs))
  const restantsChair = stats.chair.reduce((s, b) => s + b.restants, 0)

  return (
    <>
      {/* ---------- Alerts ---------- */}
      {(stats.aValider > 0 || stats.stockBas.length > 0 || stats.creances.retard > 0) && (
        <section className="alerts">
          {stats.aValider > 0 && (
            <Link to="/argent" className="alert warn"><Icon name="clock" size={18} />{t('dashboard.toValidate', { count: stats.aValider })}</Link>
          )}
          {stats.stockBas.map((s) => (
            <Link key={s.nom} to="/stock" className="alert danger"><Icon name="box" size={18} />
              {t('dashboard.lowStock', { nom: s.nom, stock: fmt(s.stock), unite: t(`unites.${s.unite}`) })}
            </Link>
          ))}
          {stats.creances.retard > 0 && (
            <Link to="/argent" className="alert danger"><Icon name="alert" size={18} />{t('dashboard.lateClients', { count: stats.creances.retard })}</Link>
          )}
        </section>
      )}

      {/* ---------- Cash ---------- */}
      <h2 className="section-title"><span className="kpi-icon green sm"><Icon name="wallet" size={18} /></span>{t('dashboard.cash')}</h2>
      <section className="kpis three">
        <Kpi icon="drumstick" tone="sky" label={t('dashboard.cashChair')} value={`${fmt(stats.soldes.chair)} F`} />
        <Kpi icon="egg" tone="yolk" label={t('dashboard.cashLayers')} value={`${fmt(stats.soldes.pondeuse)} F`} />
        <Kpi icon="wallet" tone="green" label={t('dashboard.cashTotal')} value={`${fmt(stats.soldes.chair + stats.soldes.pondeuse)} F`}
          hint={stats.creances.total ? t('dashboard.receivables', { n: fmt(stats.creances.total) }) : null} />
      </section>

      {/* ---------- Broilers ---------- */}
      <h2 className="section-title"><span className="kpi-icon sky sm"><Icon name="drumstick" size={18} /></span>{t('types.chair_pl')}</h2>
      <section className="kpis three">
        <Kpi icon="drumstick" tone="sky" label={t('dashboard.broilers')} value={fmt(restantsChair)} />
        <Kpi icon="calendar" tone="green" label={t('dashboard.broilerFlocks')} value={fmt(stats.chair.length)} />
        <Kpi icon="scale" tone="yolk" label={t('dashboard.lastWeight')} value={avgWeightLabel(stats.chair, fmt)} />
      </section>
      <section className="panel">
        {stats.chair.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('saisie.bande')}</th><th>{t('dashboard.age')}</th><th>{t('dashboard.birds')}</th>
                  <th>{t('dashboard.weight')}</th><th>{t('dashboard.saleDate')}</th></tr>
              </thead>
              <tbody>
                {stats.chair.map((b) => (
                  <tr key={b.bande_id}>
                    <td><strong>{b.code}</strong>{b.statut === 'cloture_demandee' && <span className="tag warn">{t('ferme.closing')}</span>}</td>
                    <td>{t('dashboard.days', { n: b.age_jours })}</td>
                    <td>{fmt(b.restants)}</td>
                    <td>{b.poids_moyen_g ? `${fmt(b.poids_moyen_g)} g` : '—'}</td>
                    <td>{b.date_vente_prevue ? new Date(`${b.date_vente_prevue}T00:00`).toLocaleDateString(lang) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t('dashboard.noBroilers')}</p>}
      </section>

      {/* ---------- Layers ---------- */}
      <h2 className="section-title"><span className="kpi-icon yolk sm"><Icon name="egg" size={18} /></span>{t('types.pondeuse_pl')}</h2>
      <section className="kpis three">
        <Kpi icon="egg" tone="yolk" label={t('dashboard.eggsToday')} value={fmt(today.eggs)}
          hint={t('dashboard.layingRate', { rate: taux })} />
        <Kpi icon="broken" tone="rose" label={t('dashboard.broken')} value={fmt(today.broken)} />
        <Kpi icon="hen" tone="green" label={t('dashboard.layers')} value={fmt(stats.pondeuse.effectif)} />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('dashboard.last7')}</h2>
          <span className="muted">{t('dashboard.total', { n: fmt(stats.pondeuse.days.reduce((s, d) => s + d.eggs, 0)) })}</span>
        </div>
        <div className="bars">
          {stats.pondeuse.days.map((d, i) => (
            <div key={d.date} className={`bar-col ${i === 6 ? 'today' : ''}`}>
              <span className="bar-val">{d.eggs ? fmt(d.eggs) : ''}</span>
              <div className="bar-track"><div className="bar" style={{ height: `${(d.eggs / max) * 100}%` }} /></div>
              <span className="bar-label">{new Date(`${d.date}T00:00`).toLocaleDateString(lang, { weekday: 'short' })}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function avgWeightLabel(rows, fmt) {
  const weighed = rows.filter((r) => r.poids_moyen_g)
  const birds = weighed.reduce((s, r) => s + r.restants, 0)
  if (!birds) return '—'
  const g = weighed.reduce((s, r) => s + r.poids_moyen_g * r.restants, 0) / birds
  return `${fmt(g / 1000, { maximumFractionDigits: 2 })} kg`
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
