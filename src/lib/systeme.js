import { canAccess } from '../config'

// Two linked systems behind one link: HENZO (poultry farming) and HENZO AGRO (buying and reselling chicks,
// feed and medicines). The active company of the account decides which one is shown.
export const estNegoce = (profile) => profile?.ferme?.type_activite === 'negoce'

// Sections that only make sense for a farm
export const SECTIONS_ELEVAGE = ['saisie', 'ferme', 'planning', 'analyses', 'boutique']

export const sectionVisible = (section, role, profile) =>
  canAccess(role, section) && !(estNegoce(profile) && SECTIONS_ELEVAGE.includes(section))

// The choice screen is shown once per session to accounts working in both systems
const CLE_CHOIX = 'henzo.systeme.choisi'
export const choixFait = () => { try { return sessionStorage.getItem(CLE_CHOIX) === '1' } catch { return true } }
export const marquerChoix = () => { try { sessionStorage.setItem(CLE_CHOIX, '1') } catch { /* ignore */ } }
export const oublierChoix = () => { try { sessionStorage.removeItem(CLE_CHOIX) } catch { /* ignore */ } }
