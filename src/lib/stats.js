import { supabase } from './supabase'

// Dashboard figures, cached so the dashboard still shows the last known values offline.
const CACHE_KEY = 'henzo.dashboard.v4'

export const localDate = (d = new Date()) => d.toLocaleDateString('en-CA') // YYYY-MM-DD, local time

export function readCachedStats() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) } catch { return null }
}

export function saveCachedStats(stats) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(stats)) } catch {}
}

const must = (r) => { if (r.error) throw r.error; return r.data }

export async function loadStats(role) {
  const stats = role === 'employe' ? await loadEmployee() : await loadManager()
  stats.at = new Date().toISOString()
  saveCachedStats(stats)
  return stats
}

// Employee: tasks of the day (planned for him) + his own entries of the day
async function loadEmployee() {
  const today = localDate()
  const count = (table, dateField) =>
    supabase.from(table).select('id', { count: 'exact', head: true }).eq(dateField, today)
  const [m, p, w, a, v, o, taches] = await Promise.all([
    count('mortalites', 'date_constat'), count('pontes', 'date_ponte'), count('pesees', 'date_pesee'),
    count('mouvements_stock', 'date_mouvement'), count('ventes', 'date_vente'), count('observations', 'date_observation'),
    supabase.from('taches').select('id, titre, type_tache, date_prevue, produit, description, bande:bandes(code), lot:lots_pondeuses(code)')
      .eq('statut', 'a_faire').lte('date_prevue', today).order('date_prevue')
  ])
  for (const r of [m, p, w, a, v, o]) if (r.error) throw r.error
  return {
    kind: 'employe',
    taches: must(taches),
    mine: { mortalite: m.count, ponte: p.count, pesee: w.count, aliment: a.count, vente: v.count, observation: o.count }
  }
}

async function loadManager() {
  const since = new Date()
  since.setDate(since.getDate() - 6)
  // Sales of the last 12 months (current month included) for the chart, and this month's expenses by category
  const debut6 = new Date()
  debut6.setDate(1)
  debut6.setMonth(debut6.getMonth() - 11)
  const debutMois = new Date()
  debutMois.setDate(1)
  const [bandes, lots, pontes, pesees, caisses, creances, capitaux, alertes, oeufs, ventes6, depMois] = await Promise.all([
    supabase.from('effectif_bandes').select('bande_id, code, statut, age_jours, restants, morts, nombre_initial, date_vente_prevue')
      .neq('statut', 'cloturee').order('date_arrivee'),
    supabase.from('effectif_lots').select('lot_id, code, effectif').eq('statut', 'en_production'),
    supabase.from('ponte_journaliere').select('date_ponte, oeufs_collectes, oeufs_casses').gte('date_ponte', localDate(since)),
    supabase.from('pesees').select('bande_id, poids_moyen_g, date_pesee').order('date_pesee', { ascending: false }).limit(200),
    supabase.from('soldes_caisses').select('activite, mode, solde'),
    supabase.from('creances_clients').select('reste'),
    supabase.from('capitaux_engages').select('*').maybeSingle(),
    supabase.from('alertes_responsables').select('*').order('niveau').order('date_ref'),
    supabase.from('stock_oeufs').select('stock_oeufs, plateaux, oeufs_isoles').maybeSingle(),
    supabase.from('ventes').select('date_vente, montant').eq('annulee', false).gte('date_vente', localDate(debut6)).limit(20000),
    supabase.from('depenses').select('categorie, montant').eq('annulee', false).neq('statut', 'rejetee').gte('date_depense', localDate(debutMois)).limit(5000)
  ])
  // one bar per month; a role that cannot read the sales simply gets no chart
  const mois = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(debut6)
    d.setMonth(d.getMonth() + i)
    return { mois: localDate(d).slice(0, 7), total: 0 }
  })
  for (const v of ventes6.data ?? []) {
    const m = mois.find((x) => x.mois === String(v.date_vente).slice(0, 7))
    if (m) m.total += Number(v.montant)
  }

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

  return {
    kind: 'manager',
    chair,
    pondeuse: { effectif: effectifPondeuses, lots: must(lots).length, days, stock: oeufs.data ?? null },
    caisses: caisseRows,
    soldes,
    creances: { total: must(creances).reduce((s, c) => s + Number(c.reste), 0) },
    capitaux: must(capitaux),
    alertes: must(alertes),
    ventes: ventes6.error ? null : mois,
    depensesMois: depMois.error ? null : Object.entries((depMois.data ?? []).reduce((a, d) => ({ ...a, [d.categorie]: (a[d.categorie] ?? 0) + Number(d.montant) }), {}))
      .map(([categorie, total]) => ({ categorie, total })).sort((a, b) => b.total - a.total)
  }
}

