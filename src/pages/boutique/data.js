import { supabase } from '../../lib/supabase'

// Shop reference data (prices, stock, eggs per tray, farm name), cached per shop so selling works offline
const key = (id) => `henzo.boutique.ref.${id}`

export function readRefBoutique(id) {
  try { return JSON.parse(localStorage.getItem(key(id))) } catch { return null }
}

export async function loadRefBoutique(id) {
  if (!navigator.onLine) return readRefBoutique(id)
  const [prix, stock, boutique] = await Promise.all([
    supabase.from('prix_boutique_actuels').select('produit, forme, unite, prix, prix_min, prix_max'),
    supabase.from('stock_boutiques').select('produit, stock').eq('boutique_id', id),
    supabase.from('boutiques').select('id, nom, ferme_id, ferme:fermes(nom, oeufs_par_plateau)').eq('id', id).maybeSingle()
  ])
  if (prix.error || stock.error || boutique.error) return readRefBoutique(id)
  const ref = {
    prix: prix.data,
    stock: Object.fromEntries(stock.data.map((s) => [s.produit, s.stock])),
    nom: boutique.data?.nom,
    ferme: boutique.data?.ferme?.nom,
    opp: boutique.data?.ferme?.oeufs_par_plateau ?? 30,
    at: new Date().toISOString()
  }
  try { localStorage.setItem(key(id), JSON.stringify(ref)) } catch { /* storage full: still works online */ }
  return ref
}

// Offline: keep the cached stock in step with the sales just made on this phone
export function deduireStock(id, produit, n) {
  const ref = readRefBoutique(id)
  if (!ref) return
  ref.stock[produit] = Math.max(0, (ref.stock[produit] ?? 0) - n)
  try { localStorage.setItem(key(id), JSON.stringify(ref)) } catch { /* ignore */ }
}

// Price row of a product: a range (prix_min – prix_max) or an older fixed price; none by the kilo (typed freely)
export const plageDe = (ref, produit, forme, unite) =>
  ref?.prix?.find((p) => p.produit === produit && p.forme === (produit === 'oeufs' ? '-' : forme) && p.unite === unite) ?? null

export const PRODUITS_BOUTIQUE = ['poulet', 'oeufs', 'poule_reformee']
export const FORMES = ['vivant', 'abattu', 'decoupe']
