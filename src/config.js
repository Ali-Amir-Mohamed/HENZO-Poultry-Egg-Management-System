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
  EMPLOYE: 'employe',
  VENDEUR: 'vendeur',             // shop seller: his shop only
  COMPTABLE: 'comptable'          // accountant / CGA: accounts and taxes of the whole company, never moves money
}

const { DIRECTEUR: D, EXPLOITATION: X, FINANCE: F, EMPLOYE: E, VENDEUR: V, COMPTABLE: C } = ROLES

// Which roles can open each section of the app (the database enforces the same rules)
export const ACCESS = {
  dashboard: [D, X, F, E],
  saisie: [X, E],                 // field entries: operations (the director only reads)
  ferme: [D, X, F],
  planning: [D, X, F],
  analyses: [D, X, F],
  argent: [D, X, F],
  compta: [C],                     // accounting, taxes, payroll totals, company sheet: the accountant only
  stock: [D, X, F],
  reglages: [D, X, F],
  boutique: [D, X, F, E, V],
  administration: [D, F, X],      // Ali: everything; Dahirou: land (read) + bank accounts; Kenfack: land (read)
  commandes: [D, X, F, E],        // HENZO AGRO: chick orders from farmers
  benefices: [D, X, F],           // HENZO AGRO: profits by period and by item
  provenderie: [D, X, F, E],      // HENZO AGRO: feed mill (formulas, productions, cost price)
  sync: [D, X, F, E, V]
}

// Actions inside the sections
export const PERMISSIONS = {
  'bande.create': [X],           // flocks, lots, buildings, chicks: operations (Kenfack)
  'bande.requestClose': [X],
  'bande.validateClose': [D, F],
  'depense.ferme': [D, X, F],
  'depense.generale': [D, F],
  'depense.validate': [D, F],
  'retrait.confirm': [D],
  'annuler': [D],
  'paiement': [D, X, F],
  'soldeInitial': [D, F],
  'credit.grant': [X],
  'tiers.edit': [D, X, F],
  'prix.set': [X],               // farm sale prices (Kenfack)
  'article.edit': [X],           // stock product sheets (director, finance: read-only stock)
  'stock.achat': [X],            // purchases that enter stock (feed, medicines)
  'stock.manual': [X],
  'capital.manage': [D, F],      // investors, contributions, withdrawals, 10 % decisions
  'capital.allocate': [D, X, F], // investors' capital placed in each flock
  'salaires': [D, F],            // see employees and pay (confidential)
  'salaires.payer': [F],         // pay advances and salaries (Dahirou only)
  'equipe': [X],                 // farm staff: add, change the job, without salaries (Kenfack)
  'equipe.voir': [D, X, F],      // see the farm team (Ali and Dahirou read only)
  'employes.bureau': [D, F],     // office staff (accountant, secretary…): Argent > Employés
  'admin.complet': [D],          // documents, deadlines, editing land
  'admin.terrains': [D, F, X],   // see the land
  'admin.banques': [D, F],       // bank accounts
  'boutique.admin': [D],         // create / edit shops
  'boutique.vendre': [X, V],  // sell in a shop
  'boutique.envoi': [X, E],   // send goods farm → shop
  'boutique.recevoir': [V], // confirm a shipment
  'boutique.prix': [D, X, F],    // shop prices (the seller never changes them)
  'boutique.caisse': [V],        // shop cash: closing, deposits (the seller)
  'boutique.caisse.voir': [D, F, V], // see the shop cash
  'boutique.valider': [F],    // validate a deposit
  'boutique.ventes': [D, X, F, V], // see the shop sales
  'pret.manage': [D, F],
  'caisse.verify': [D, F],
  'caisse.adjust': [D],
  'tache.plan': [X],             // plan / postpone / cancel tasks (others tick only their own tasks)
  'programme.edit': [X],
  'demarrage': [D, F],          // initial setup (opening balances, existing capital / loans)
  'ferme.settings': [D],
  'comptes': [D],
  'journal': [D],
  'sauvegarde': [D],
  'correction': [D],
  'correction.request': [X, F],  // ask the director to cancel / correct a financial record
  'transfert': [D, F],
  'facture.create': [D, X, F],   // official invoices from sales (Argent > Factures)
  'factures.voir': [D, X, F, C], // see the invoices
  'facture.annuler': [D],        // cancel an invoice (number never reused)
  'impots.payer': [D, F],        // record a tax payment (= taxes expense), in Argent > Impôts
  'societe.edit': [C],           // company legal / tax sheet (the accountant)
  'compta.livres': [C],          // accounting books and chart of accounts
  'compta.paie': [C],            // payroll totals (never individual salaries) and payroll settings
  'vente.marchandise': [X, E],   // HENZO AGRO: sell goods from stock
  'commande.creer': [X, E],      // HENZO AGRO: take a chick order, cash a deposit, deliver
  'commande.annuler': [X, F],    // cancel an order (the deposit is kept, or refunded by finance)
  'commande.rembourser': [F],    // refund a deposit
  'commission.recevoir': [F],    // record a commission paid by a hatchery
  'creances.relancer': [D, X, F], // send a WhatsApp reminder to a client who owes money
  'provenderie.formule': [X, D], // write or retire a feed formula
  'provenderie.fabriquer': [X, E], // record a production of feed
  'provenderie.annuler': [X, D], // cancel a production
  'groupe.receptionner': [X],    // receive a delivery from a group company
  'groupe.refuser': [X, F],      // refuse it
  'groupe.lier': [D, F]          // link a customer / supplier to a group company
}

// Roles automatically signed out after a period of inactivity (employees work offline: not them)
export const SESSION_EXPIRY_ROLES = [D, X, F, C]

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
  generale: ['loyer', 'charges', 'salaires', 'fonctionnement', 'impots_taxes', 'cotisations_sociales', 'retrait_associe', 'autre_general']
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
export const ARTICLE_CATEGORIES = ['aliment', 'medicament', 'poussins', 'matiere_premiere', 'emballage', 'autre']
export const ARTICLE_UNITES = ['kg', 'sac', 'litre', 'dose', 'flacon', 'piece']
