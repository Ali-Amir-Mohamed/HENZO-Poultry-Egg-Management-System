import { supabase } from './supabase'

// Client typed by name at the sale: the same comparison as the database (capitals, accents and spaces ignored)
export const nomCompare = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'o')

export const clientConnu = (nom, liste) => (nomCompare(nom) ? liste.find((c) => nomCompare(c.nom) === nomCompare(nom)) : undefined)

// The client's id: an existing one, or a new client registered on the spot (null when no name is typed)
export async function idClient(nom, telephone, liste) {
  if (!nomCompare(nom)) return null
  const connu = clientConnu(nom, liste)
  if (connu) return connu.id
  const { data, error } = await supabase.rpc('client_par_nom', { p_nom: nom, p_telephone: telephone || null })
  if (error) throw error
  return data
}
