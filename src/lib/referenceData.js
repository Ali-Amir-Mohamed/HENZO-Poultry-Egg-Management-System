import { supabase } from './supabase'
import { TABLES } from '../config'

// Reference lists (e.g. active flocks) are cached so forms keep working offline.
const CACHE_PREFIX = 'henzo.ref.'

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)) ?? [] } catch { return [] }
}

export async function loadBandesActives() {
  if (!navigator.onLine) return readCache('bandes')
  const { data, error } = await supabase
    .from(TABLES.bandes)
    .select('id, code')
    .eq('statut', 'active')
    .order('code')
  if (error) return readCache('bandes')
  try { localStorage.setItem(CACHE_PREFIX + 'bandes', JSON.stringify(data)) } catch {}
  return data
}
