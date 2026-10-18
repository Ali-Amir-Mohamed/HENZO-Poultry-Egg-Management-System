import { canAccess } from '../config'

// Two linked systems behind one link: HENZO (poultry farming) and HENZO AGRO (buying and reselling chicks,
// feed and medicines). The active company of the account decides which one is shown.
export const estNegoce = (profile) => profile?.ferme?.type_activite === 'negoce'

// Sections that only make sense for a farm, and for the trading company
export const SECTIONS_ELEVAGE = ['saisie', 'ferme', 'planning', 'analyses', 'boutique']
export const SECTIONS_NEGOCE = ['commandes']

export const sectionVisible = (section, role, profile) =>
  canAccess(role, section) && !(estNegoce(profile) && SECTIONS_ELEVAGE.includes(section)) && !(!estNegoce(profile) && SECTIONS_NEGOCE.includes(section))

const lire = (k) => { try { return sessionStorage.getItem(k) } catch { return null } }
const ecrire = (k, v) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v) } catch { /* ignore */ } }

// The choice screen after signing in is shown once per session to accounts working in both systems
export const choixFait = () => lire('henzo.systeme.choisi') === '1'
export const marquerChoix = () => ecrire('henzo.systeme.choisi', '1')
export const oublierChoix = () => ecrire('henzo.systeme.choisi', null)

// System picked on the portal before signing in ('elevage' | 'negoce'), applied right after the sign-in
export const lireVise = () => lire('henzo.systeme.vise')
export const ecrireVise = (v) => ecrire('henzo.systeme.vise', v)

// The account had no access to the system picked before signing in: told once, in the app
export const lireRefus = () => lire('henzo.systeme.refus')
export const ecrireRefus = (v) => ecrire('henzo.systeme.refus', v)

// Site picked on the portal before signing in ({ id, nom }), opened right after the sign-in
export const lireViseSite = () => { try { return JSON.parse(lire('henzo.systeme.site')) } catch { return null } }
export const ecrireViseSite = (v) => ecrire('henzo.systeme.site', v ? JSON.stringify(v) : null)
