// Single place mapping the app to the database schema (supabase/migrations/0001_schema_etape1.sql)
export const TABLES = {
  profiles: 'profiles',           // id (= auth.users.id), nom_complet, role, actif
  bandes: 'bandes',
  ramassages: 'ramassages_oeufs'
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

export const canAccess = (role, section) => !!role && ACCESS[section]?.includes(role)
