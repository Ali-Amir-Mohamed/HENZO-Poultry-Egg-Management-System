// Single place mapping the app to the database schema (supabase/migrations/0002_refonte_phase_a.sql)
export const TABLES = {
  profiles: 'profiles',
  bandes: 'bandes',                 // broiler flocks
  lots: 'lots_pondeuses',           // layer flocks
  mortalites: 'mortalites',
  pontes: 'pontes',
  pesees: 'pesees',
  observations: 'observations',
  mouvementsStock: 'mouvements_stock',
  ventes: 'ventes',
  depenses: 'depenses',
  paiementsClients: 'paiements_clients',
  paiementsFournisseurs: 'paiements_fournisseurs',
  tiers: 'tiers',
  articles: 'articles',
  prix: 'prix_vente',
  notifications: 'notifications',
  taches: 'taches',
  realisations: 'taches_realisations',   // ticking a task (insert-only: works offline)
  modeles: 'modeles_taches'
}

export const ROLES = {
  DIRECTEUR: 'directeur',
  EXPLOITATION: 'exploitation',   // Kenfack Dirand
  FINANCE: 'finance',             // Dahirou Bachar
  EMPLOYE: 'employe'
}

const { DIRECTEUR: D, EXPLOITATION: X, FINANCE: F, EMPLOYE: E } = ROLES

// Which roles can open each section of the app (the database enforces the same rules)
export const ACCESS = {
  dashboard: [D, X, F, E],
  saisie: [D, X, E],
  ferme: [D, X, F],
  planning: [D, X, F],
  analyses: [D, X, F],
  argent: [D, X, F],
  stock: [D, X, F],
  reglages: [D, X, F],
  sync: [D, X, F, E]
}

// Actions inside the sections
export const PERMISSIONS = {
  'bande.create': [D, X],
  'bande.requestClose': [D, X],
  'bande.validateClose': [D, F],
  'depense.ferme': [D, X, F],
  'depense.generale': [D, F],
  'depense.validate': [D, F],
  'retrait.confirm': [D],
  'annuler': [D],
  'paiement': [D, X, F],
  'soldeInitial': [D, F],
  'credit.grant': [D, X],
  'tiers.edit': [D, X, F],
  'prix.set': [D, X, F],
  'article.edit': [D, X],        // stock product sheets (finance: read-only stock)
  'stock.achat': [D, X],         // purchases that enter stock (feed, medicines)
  'stock.manual': [D, X],
  'capital.manage': [D, F],      // investors, contributions, withdrawals, 10 % decisions
  'pret.manage': [D, F],
  'caisse.verify': [D, F],
  'caisse.adjust': [D],
  'tache.plan': [D, X],          // plan / postpone / cancel tasks (finance: read-only planning)
  'programme.edit': [D, X],
  'demarrage': [D, F],          // initial setup (opening balances, existing capital / loans)
  'ferme.settings': [D],
  'comptes': [D],
  'journal': [D],
  'sauvegarde': [D],
  'correction': [D],
  'correction.request': [X, F],  // ask the director to cancel / correct a financial record
  'transfert': [D, F]
}

// Roles automatically signed out after a period of inactivity (employees work offline: not them)
export const SESSION_EXPIRY_ROLES = [D, X, F]

export const TYPES_TACHE = ['vaccination', 'traitement', 'pesee', 'achat_aliment', 'remboursement', 'arrivee_poussins', 'vente_prevue', 'nettoyage', 'autre']

export const canAccess = (role, section) => !!role && ACCESS[section]?.includes(role)
export const can = (role, action) => !!role && PERMISSIONS[action]?.includes(role)

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

// Choice lists (values match the database CHECK constraints)
export const MODES_PAIEMENT = ['especes', 'mobile_money', 'banque']
export const CATEGORIES_DEPENSE = {
  ferme: ['poussins', 'aliment', 'medicament', 'main_oeuvre', 'transport', 'entretien', 'autre_ferme'],
  generale: ['loyer', 'charges', 'salaires', 'fonctionnement', 'retrait_associe', 'autre_general']
}
export const CATEGORIES_RETRAIT = ['avance_benefice', 'depense_personnelle', 'frais_medicaux', 'urgence_familiale', 'autre']
export const PRODUITS = {
  chair: [{ produit: 'poulets', unites: ['piece', 'kg'], sujets: true }, { produit: 'fientes', unites: ['piece', 'kg'] }],
  pondeuse: [
    { produit: 'plateaux', unites: ['plateau'] },
    { produit: 'oeufs', unites: ['piece'] },
    { produit: 'poules_reformees', unites: ['piece', 'kg'], sujets: true },
    { produit: 'fientes', unites: ['piece', 'kg'] }
  ]
}
export const ARTICLE_CATEGORIES = ['aliment', 'medicament', 'autre']
export const ARTICLE_UNITES = ['kg', 'sac', 'litre', 'dose', 'flacon', 'piece']
