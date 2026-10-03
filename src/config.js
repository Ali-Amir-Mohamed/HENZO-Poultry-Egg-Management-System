// Single place mapping the app to the database schema (supabase/migrations/0001_schema_etape1.sql)
export const TABLES = {
  profiles: 'profiles',           // id (= auth.users.id), nom_complet, role, actif
  bandes: 'bandes',                // type_production: 'chair' | 'pondeuse'
  ramassages: 'ramassages_oeufs',  // pondeuses only (enforced by a DB trigger)
  mortalites: 'mortalites',        // both types
  pesees: 'pesees'                 // broilers only (enforced by a DB trigger)
}

export const ROLES = {
  DIRECTEUR: 'directeur',
  EXPLOITATION: 'exploitation',   // Kenfack Dirand
  FINANCE: 'finance',             // Dahirou Bachar
  EMPLOYE: 'employe'
}

// Which roles can open each section of the app
export const ACCESS = {
  dashboard: Object.values(ROLES),
  saisie: Object.values(ROLES),
  production: [ROLES.DIRECTEUR, ROLES.EXPLOITATION],
  finance: [ROLES.DIRECTEUR, ROLES.FINANCE],
  sync: Object.values(ROLES)
}

// Users sign in with a username; Supabase Auth needs an email, so the username is
// mapped to <username>@LOGIN_DOMAIN. Accounts must be created with that address.
// A full email (containing "@") is still accepted as-is.
export const LOGIN_DOMAIN = 'henzo.local'

export function toLoginEmail(identifier) {
  const id = identifier.trim().toLowerCase()
  if (id.includes('@')) return id
  const username = id.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')
  return `${username}@${LOGIN_DOMAIN}`
}

export const canAccess =(role, section) => !!role && ACCESS[section]?.includes(role)
