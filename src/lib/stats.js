import { supabase } from './supabase'

// Dashboard figures, cached so the dashboard still shows the last known values offline.
const CACHE_KEY = 'henzo.dashboard.v3'

export const localDate = (d = new Date()) => d.toLocaleDateString('en-CA') // YYYY-MM-DD, local time

export function readCachedStats() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) } catch { return null }
}

const must = (r) => { if (r.error) throw r.error; return r.data }

export async function loadStats(role) {
  const stats = role === 'employe' ? await loadEmployee() : await loadManager(role)
  stats.at = new Date().toISOString()
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(stats)) } catch {}
  return stats
}

// Employee: only his own entries of the day
async function loadEmployee() {
  const today = localDate()
  const count = (table, dateField) =>
    supabase.from(table).select('id', { count: 'exact', head: true }).eq(dateField, today)
  const [m, p, w, a, v, o] = await Promise.all([
    count('mortalites', 'date_constat'), count('pontes', 'date_ponte'), count('pesees', 'date_pesee'),
    count('mouvements_stock', 'date_mouvement'), count('ventes', 'date_vente'), count('observations', 'date_observation')
  ])
  for (const r of [m, p, w, a, v, o]) if (r.error) throw r.error
  return { kind: 'employe', mine: { mortalite: m.count, ponte: p.count, pesee: w.count, aliment: a.count, vente: v.count, observation: o.count } }
}

async function loadManager(role) {
  const since = new Date()
  since.setDate(since.getDate() - 6)
  const [bandes, lots, pontes, pesees, caisses, stock, aValider, creances] = await Promise.all([
    supabase.from('effectif_bandes').select('bande_id, code, statut, age_jours, restants, date_vente_prevue')
      .neq('statut', 'cloturee').order('date_arrivee'),
    supabase.from('effectif_lots').select('lot_id, code, effectif').eq('statut', 'en_production'),
    supabase.from('ponte_journaliere').select('date_ponte, oeufs_collectes, oeufs_casses').gte('date_ponte', localDate(since)),
    supabase.from('pesees').select('bande_id, poids_moyen_g, date_pesee').order('date_pesee', { ascending: false }).limit(200),
    supabase.from('soldes_caisses').select('activite, mode, solde'),
    supabase.from('stock_articles').select('nom, unite, stock, seuil_minimum, autonomie_jours').eq('actif', true),
    supabase.from('depenses').select('id', { count: 'exact', head: true }).eq('statut', 'a_valider').eq('annulee', false),
    supabase.from('creances_clients').select('reste, en_retard')
  ])

  // Broilers: latest weight per flock
  const lastWeight = {}
  for (const p of must(pesees)) if (!(p.bande_id in lastWeight)) lastWeight[p.bande_id] = p.poids_moyen_g
  const chair = must(bandes).map((b) => ({ ...b, poids_moyen_g: lastWeight[b.bande_id] ?? null }))

  // Layers: last 7 days
  const effectifPondeuses = must(lots).reduce((s, l) => s + l.effectif, 0)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 6 + i)
    return { date: localDate(d), eggs: 0, broken: 0 }
  })
  for (const r of must(pontes)) {
    const day = days.find((d) => d.date === r.date_ponte)
    if (day) { day.eggs += r.oeufs_collectes; day.broken += r.oeufs_casses }
  }

  const caisseRows = must(caisses)
  const soldes = { chair: 0, pondeuse: 0 }
  for (const c of caisseRows) soldes[c.activite] += Number(c.solde)

  const creanceRows = must(creances)
  return {
    kind: 'manager',
    chair,
    pondeuse: { effectif: effectifPondeuses, lots: must(lots).length, days },
    caisses: caisseRows,
    soldes,
    stockBas: must(stock).filter((s) => Number(s.stock) <= Number(s.seuil_minimum)),
    aValider: ['directeur', 'finance'].includes(role) ? aValider.count ?? 0 : 0,
    creances: {
      total: creanceRows.reduce((s, c) => s + Number(c.reste), 0),
      retard: creanceRows.filter((c) => c.en_retard).length
    }
  }
}
