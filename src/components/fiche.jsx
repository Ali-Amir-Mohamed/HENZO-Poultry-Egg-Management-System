import Icon from './Icon'
import { day } from './ui'

// Building blocks for the flock / lot files

export function Fact({ label, value, hint, tone = '' }) {
  return (
    <div className={`fact ${tone}`} title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// Chronological history, most recent first
export function Timeline({ events, lang }) {
  const sorted = [...events].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return (
    <ol className="timeline">
      {sorted.map((e, i) => (
        <li key={i} className={e.cancelled ? 'cancelled' : ''}>
          <span className={`kpi-icon ${e.tone} sm`}><Icon name={e.icon} size={16} /></span>
          <div>
            <strong>{e.text}</strong>
            <span className="muted small">{day(e.date, lang)}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

// Small line chart (inline SVG) for weight or laying rate over time
export function WeightCurve({ points, lang, unit = 'g' }) {
  const W = 600, H = 200, P = 28
  const values = points.map((p) => p.value)
  const max = Math.max(...values) * 1.1 || 1
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1)
  const y = (v) => H - P - (v / max) * (H - 2 * P)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="curve">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} className="axis" />
      <path d={`${path} L${x(points.length - 1)},${H - P} L${x(0)},${H - P} Z`} className="area" />
      <path d={path} className="line" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="4" className="dot" />
          <text x={x(i)} y={y(p.value) - 9} textAnchor="middle" className="val">{Math.round(p.value).toLocaleString(lang)}{unit}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" className="lbl">{day(p.date, lang).slice(0, 5)}</text>
        </g>
      ))}
    </svg>
  )
}
