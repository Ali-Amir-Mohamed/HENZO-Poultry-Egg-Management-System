import { supabase } from './supabase'

// Reference lists used by the field forms. They are cached so the forms keep working offline.
const CACHE_KEY = 'henzo.ref.v3'

export function readCachedReference() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? empty()
  } catch {
    return empty()
  }
}

function empty() {
  return { bandes: [], lots: [], articles: [], clients: [], prix: [], seuilTiers: null }
}

export function saveReference(ref) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(ref)) } catch {}
}

export async function loadReference() {
  if (!navigator.onLine) return readCachedReference()
  const [bandes, lots, articles, clients, prix, ferme] = await Promise.all([
    // Oldest flock first: it is the one preselected for a sale
    supabase.from('effectif_bandes').select('bande_id, code, statut, date_arrivee, restants, age_jours')
      .neq('statut', 'cloturee').order('date_arrivee'),
    supabase.from('effectif_lots').select('lot_id, code, statut, date_arrivee, effectif')
      .eq('statut', 'en_production').order('date_arrivee'),
    supabase.from('articles').select('id, nom, categorie, unite').eq('actif', true).order('nom'),
    supabase.from('tiers').select('id, nom, type_tiers, credit_autorise, plafond_credit')
      .in('type_tiers', ['client', 'client_fournisseur']).order('nom'),
    supabase.from('prix_actuels').select('produit, unite, prix'),
    supabase.from('fermes').select('seuil_tiers_obligatoire').limit(1)
  ])
  if ([bandes, lots, articles, clients, prix, ferme].some((r) => r.error)) return readCachedReference()
  const ref = {
    bandes: bandes.data, lots: lots.data, articles: articles.data, clients: clients.data, prix: prix.data,
    seuilTiers: ferme.data[0]?.seuil_tiers_obligatoire ?? null
  }
  saveReference(ref)
  return ref
}

export const prixDuMoment = (ref, produit, unite) =>
  ref.prix.find((p) => p.produit === produit && p.unite === unite)?.prix ?? ''
