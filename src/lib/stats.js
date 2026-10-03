import { supabase } from './supabase'

// Dashboard figures, cached so the dashboard still shows the last known values offline.
const CACHE_KEY = 'henzo.stats'

export const localDate = (d = new Date()) => d.toLocaleDateString('en-CA') // YYYY-MM-DD, local time

export function readCachedStats() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) } catch { return null }
}

export async function loadStats() {
  const since = new Date()
  since.setDate(since.getDate() - 6)
  const [prod, eff] = await Promise.all([
    supabase.from('production_journaliere')
      .select('date_ramassage, oeufs_ramasses, oeufs_casses')
      .gte('date_ramassage', localDate(since)),
    supabase.from('effectif_bandes').select('effectif_actuel')
  ])
  if (prod.error || eff.error) throw prod.error || eff.error

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 6 + i)
    return { date: localDate(d), eggs: 0, broken: 0 }
  })
  for (const r of prod.data) {
    const day = days.find((d) => d.date === r.date_ramassage)
    if (day) { day.eggs += r.oeufs_ramasses; day.broken += r.oeufs_casses }
  }
  const stats = {
    days,
    effectif: eff.data.reduce((sum, r) => sum + r.effectif_actuel, 0),
    at: new Date().toISOString()
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(stats)) } catch {}
  return stats
}
