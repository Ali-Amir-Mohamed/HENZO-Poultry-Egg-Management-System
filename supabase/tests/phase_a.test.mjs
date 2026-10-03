// Test harness: runs HENZO migrations on PGlite with a minimal Supabase-like auth stub,
// then exercises role permissions and business rules.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const MIG = new URL('../migrations/', import.meta.url)
const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`) }

const U = {
  ali: '11111111-1111-1111-1111-111111111111',
  kenfack: '22222222-2222-2222-2222-222222222222',
  dahirou: '33333333-3333-3333-3333-333333333333',
  employe: '44444444-4444-4444-4444-444444444444'
}

async function as(user, sql, params) {
  await db.exec(`reset role; set request.jwt.claim.sub = '${user ? U[user] : ''}'; set role ${user ? 'authenticated' : 'anon'};`)
  try { return await db.query(sql, params) } finally { await db.exec(`reset role; set request.jwt.claim.sub = '';`) }
}
async function expectOk(name, user, sql, params) {
  try { const r = await as(user, sql, params); ok(name, true); return r } catch (e) { ok(name, false, e.message); return null }
}
async function expectErr(name, user, sql, params, match) {
  try { const r = await as(user, sql, params); ok(name, false, `no error (rows affected: ${r.affectedRows})`) }
  catch (e) { ok(name, !match || e.message.includes(match), e.message) }
}
async function expectNoRows(name, user, sql) {
  try { const r = await as(user, sql); ok(name, (r.affectedRows ?? r.rows.length) === 0 && r.rows.length === 0, `affected=${r.affectedRows} rows=${r.rows.length}`) }
  catch (e) { ok(name, true, 'error: ' + e.message) }
}
const one = async (user, sql) => (await as(user, sql)).rows[0]

// ---------- Supabase stub ----------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create table auth.identities (user_id uuid, provider text, identity_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`)

// ---------- Step 1 schema + accounts + old test data ----------
await db.exec(readFileSync(new URL('0001_schema_etape1.sql', MIG), 'utf8').replace(/create extension[^;]*;/i, ''))
for (const [name, id] of Object.entries(U)) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@henzo.local`])
}
await db.exec(`
  update public.profiles set role = 'directeur', nom_complet = 'Ali' where id = '${U.ali}';
  update public.profiles set role = 'exploitation', nom_complet = 'Kenfack' where id = '${U.kenfack}';
  update public.profiles set role = 'finance', nom_complet = 'Dahirou' where id = '${U.dahirou}';
  insert into public.batiments (nom) values ('Bâtiment 1');
  insert into public.bandes (batiment_id, code, date_arrivee, effectif_initial) select id, 'B1-TEST', current_date - 100, 1000 from public.batiments;
  insert into public.ramassages_oeufs (bande_id, oeufs_ramasses, saisi_par) select id, 850, '${U.ali}' from public.bandes;
`)

// ---------- Step 2: refonte ----------
try {
  await db.exec(readFileSync(new URL('0002_refonte_phase_a.sql', MIG), 'utf8'))
  ok('migration 0002 runs', true)
} catch (e) { ok('migration 0002 runs', false, e.message); process.exit(1) }

const prof = await db.query(`select p.role, p.ferme_id is not null as ferme from public.profiles p order by role`)
ok('profiles kept with farm', prof.rows.length === 4 && prof.rows.every((r) => r.ferme), JSON.stringify(prof.rows))
ok('6 caisses created', (await db.query(`select count(*)::int n from public.caisses`)).rows[0].n === 6)

// ---------- Anonymous ----------
await expectErr('anon cannot read bandes', null, `select * from public.bandes`, [], 'permission denied')

// ---------- Setup by Kenfack ----------
await expectOk('kenfack creates bande', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('C1', current_date - 20, 500)`)
await expectOk('kenfack creates bande 2', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('C2', current_date - 5, 300)`)
await expectOk('kenfack creates lot', 'kenfack', `insert into public.lots_pondeuses (code, date_arrivee, effectif_initial, age_arrivee_semaines) values ('P1', current_date - 70, 1000, 18)`)
await expectErr('employe cannot create bande', 'employe', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('X', current_date, 10)`)
await expectErr('dahirou cannot create bande', 'dahirou', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('X', current_date, 10)`)
await expectOk('kenfack creates article', 'kenfack', `insert into public.articles (nom, categorie, unite, seuil_minimum) values ('Aliment chair', 'aliment', 'sac', 10)`)
await expectOk('kenfack creates client with credit', 'kenfack', `insert into public.tiers (type_tiers, nom, credit_autorise, plafond_credit) values ('client', 'Client A', true, 100000)`)
await expectOk('employe creates client without credit', 'employe', `insert into public.tiers (type_tiers, nom) values ('client', 'Client B')`)
await expectErr('employe cannot grant credit', 'employe', `insert into public.tiers (type_tiers, nom, credit_autorise, plafond_credit) values ('client', 'Client C', true, 50000)`, [], 'crédit')
await expectErr('dahirou cannot grant credit', 'dahirou', `update public.tiers set credit_autorise = true, plafond_credit = 1 where nom = 'Client B'`, [], 'crédit')
await expectOk('kenfack creates fournisseur', 'kenfack', `insert into public.tiers (type_tiers, nom) values ('fournisseur', 'Provenderie X')`)
await expectOk('kenfack sets price', 'kenfack', `insert into public.prix_vente (produit, unite, prix) values ('poulets', 'piece', 3000)`)
await expectErr('employe cannot set price', 'employe', `insert into public.prix_vente (produit, unite, prix) values ('poulets', 'piece', 1)`)

const C1 = (await db.query(`select id from public.bandes where code = 'C1'`)).rows[0].id
const P1 = (await db.query(`select id from public.lots_pondeuses where code = 'P1'`)).rows[0].id
const ART = (await db.query(`select id from public.articles limit 1`)).rows[0].id
const CLA = (await db.query(`select id from public.tiers where nom = 'Client A'`)).rows[0].id
const FOU = (await db.query(`select id from public.tiers where nom = 'Provenderie X'`)).rows[0].id

// ---------- Field entries ----------
await expectOk('employe records mortality', 'employe', `insert into public.mortalites (bande_id, nombre) values ($1, 5)`, [C1])
await expectOk('kenfack records mortality', 'kenfack', `insert into public.mortalites (bande_id, nombre) values ($1, 2)`, [C1])
await expectErr('dahirou cannot record mortality', 'dahirou', `insert into public.mortalites (bande_id, nombre) values ($1, 1)`, [C1])
ok('employe sees only own mortality', (await as('employe', `select * from public.mortalites`)).rows.length === 1)
ok('dahirou reads all mortality', (await as('dahirou', `select * from public.mortalites`)).rows.length === 2)
await expectNoRows('employe cannot delete mortality', 'employe', `delete from public.mortalites returning id`)
await expectOk('employe records laying', 'employe', `insert into public.pontes (lot_id, oeufs_collectes, oeufs_casses) values ($1, 820, 10)`, [P1])
await expectErr('broken > collected rejected', 'employe', `insert into public.pontes (lot_id, oeufs_collectes, oeufs_casses) values ($1, 5, 10)`, [P1])
await expectOk('employe records weighing', 'employe', `insert into public.pesees (bande_id, nombre_peses, poids_moyen_g) values ($1, 10, 850)`, [C1])
const taux = await one('kenfack', `select taux_ponte, effectif from public.ponte_journaliere`)
ok('laying rate computed', Number(taux.taux_ponte) === 82, JSON.stringify(taux))

// ---------- Sales ----------
await expectOk('employe cash sale', 'employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 10, 3000, 10, 'especes')`, [C1])
await expectOk('employe sale by kg', 'employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'kg', 25, 1500, 10, 'mobile_money')`, [C1])
await expectOk('employe sale off-price', 'employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 1, 2500, 1, 'especes')`, [C1])
ok('price deviation notified to directeur', (await as('ali', `select * from public.notifications where type_notification = 'ecart_prix'`)).rows.length === 1)
ok('kenfack does not see directeur notifications', (await as('kenfack', `select * from public.notifications`)).rows.length === 0)
await expectErr('sale without payment mode rejected', 'employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets) values ($1, 'poulets', 'piece', 1, 3000, 1)`, [C1], 'mode')
await expectErr('credit sale above ceiling rejected', 'employe', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, a_credit) values ($1, $2, 'poulets', 'piece', 50, 3000, 50, true)`, [C1, CLA], 'Plafond')
await expectErr('credit to non-authorized client rejected', 'employe', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, a_credit) values ($1, (select id from public.tiers where nom='Client B'), 'poulets', 'piece', 1, 3000, 1, true)`, [C1], 'crédit')
await expectOk('credit sale with deposit', 'employe', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, a_credit, montant_encaisse, mode_paiement) values ($1, $2, 'poulets', 'piece', 20, 3000, 20, true, 10000, 'mobile_money')`, [C1, CLA])
await expectErr('oversell rejected', 'kenfack', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 1000, 3000, 1000, 'especes')`, [C1], 'reste')
await expectErr('dahirou cannot enter sale', 'dahirou', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 1, 3000, 1, 'especes')`, [C1])
await expectErr('eggs cannot be sold from a broiler flock', 'kenfack', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, mode_paiement) values ($1, 'oeufs', 'plateau', 1, 2000, 'especes')`, [C1])
await expectOk('egg sale from layer lot', 'kenfack', `insert into public.ventes (lot_id, produit, unite, quantite, prix_unitaire, mode_paiement) values ($1, 'plateaux', 'plateau', 10, 2000, 'banque')`, [P1])
ok('employe sees only own sales', (await as('employe', `select * from public.ventes`)).rows.length === 4)
ok('employe sees no caisse', (await as('employe', `select * from public.soldes_caisses`)).rows.length === 0)
const cre = await one('dahirou', `select reste from public.creances_clients`)
ok('receivable = 50000', Number(cre?.reste) === 50000, JSON.stringify(cre))
await expectOk('dahirou records client payment', 'dahirou', `insert into public.paiements_clients (vente_id, montant, mode_paiement) select vente_id, 20000, 'especes' from public.creances_clients`)
await expectErr('overpayment rejected', 'dahirou', `insert into public.paiements_clients (vente_id, montant, mode_paiement) select vente_id, 999999, 'especes' from public.creances_clients`, [], 'reste')
const eff = await one('employe', `select restants, morts, vendus, age_jours from public.effectif_bandes where code = 'C1'`)
ok('broiler flock headcount (500-7-41)', eff?.restants === 452, JSON.stringify(eff))

// ---------- Expenses & stock ----------
await expectOk('kenfack buys feed (stock in)', 'kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, article_id, quantite, fournisseur_id) values ('ferme', 'chair', 'aliment', '20 sacs aliment', 40000, 'especes', $1, 20, $2)`, [ART, FOU])
let st = await one('kenfack', `select stock from public.stock_articles`)
ok('stock = 20 after purchase', Number(st.stock) === 20, JSON.stringify(st))
await expectOk('employe records feed used', 'employe', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, bande_id) values ($1, 'sortie', 5, $2)`, [ART, C1])
await expectErr('employe cannot add stock', 'employe', `insert into public.mouvements_stock (article_id, type_mouvement, quantite) values ($1, 'entree', 5)`, [ART])
st = await one('kenfack', `select stock, autonomie_jours from public.stock_articles`)
ok('stock = 15 after use', Number(st.stock) === 15, JSON.stringify(st))
ok('employe cannot see stock view', (await as('employe', `select * from public.stock_articles`)).rows.length === 0)
await expectErr('employe cannot enter expense', 'employe', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('ferme', 'chair', 'transport', 'x', 1000, 'especes')`)
await expectErr('kenfack cannot enter general expense', 'kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('generale', 'chair', 'loyer', 'loyer', 1000, 'especes')`)
await expectOk('kenfack big expense -> to validate', 'kenfack', `insert into public.depenses (portee, activite, bande_id, categorie, libelle, montant, mode_paiement) values ('ferme', 'chair', $1, 'medicament', 'Vaccins', 80000, 'especes')`, [C1])
let dep = await one('ali', `select statut from public.depenses where libelle = 'Vaccins'`)
ok('big expense is a_valider', dep.statut === 'a_valider')
ok('finance notified', (await as('dahirou', `select * from public.notifications where type_notification = 'depense_a_valider'`)).rows.length === 1)
await expectNoRows('kenfack cannot validate', 'kenfack', `update public.depenses set statut = 'validee' where libelle = 'Vaccins' returning id`)
await expectErr('dahirou cannot edit amount', 'dahirou', `update public.depenses set montant = 1 where libelle = 'Vaccins'`, [], 'modifie')
await expectOk('dahirou validates', 'dahirou', `update public.depenses set statut = 'validee' where libelle = 'Vaccins'`)
await expectOk('dahirou general expense', 'dahirou', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('generale', 'pondeuse', 'loyer', 'Loyer octobre', 60000, 'banque')`)
dep = await one('ali', `select statut from public.depenses where libelle = 'Loyer octobre'`)
ok('dahirou big expense not blocked', dep.statut === 'validee')
await expectOk('dahirou partner withdrawal', 'dahirou', `insert into public.depenses (portee, activite, categorie, categorie_retrait, beneficiaire, libelle, montant, mode_paiement) values ('generale', 'chair', 'retrait_associe', 'frais_medicaux', 'Associé 1', 'Retrait', 15000, 'especes')`)
ok('withdrawal waits for directeur', (await one('ali', `select statut from public.depenses where libelle = 'Retrait'`)).statut === 'a_valider')
await expectErr('dahirou cannot confirm withdrawal', 'dahirou', `update public.depenses set statut = 'validee' where libelle = 'Retrait'`, [], 'directeur')
await expectOk('ali confirms withdrawal', 'ali', `update public.depenses set statut = 'validee' where libelle = 'Retrait'`)
await expectOk('kenfack buys on credit', 'kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, a_credit, fournisseur_id) values ('ferme', 'chair', 'poussins', 'Poussins C2', 30000, true, $1)`, [FOU])
await expectOk('dahirou pays supplier', 'dahirou', `insert into public.paiements_fournisseurs (depense_id, montant, mode_paiement) select depense_id, 10000, 'especes' from public.dettes_fournisseurs`)
ok('supplier debt = 20000', Number((await one('dahirou', `select reste from public.dettes_fournisseurs`)).reste) === 20000)

// ---------- Cash balances ----------
// chair especes: +30000 (sale) +2500 (sale) +20000 (client) -40000 (feed) -80000 (vaccins) -15000 (withdrawal) -10000 (supplier) = -92500
// chair mobile_money: +37500 (kg sale) +10000 (deposit) = 47500 ; pondeuse banque: +20000 -60000 = -40000
const sold = Object.fromEntries((await as('kenfack', `select activite || '/' || mode k, solde from public.soldes_caisses`)).rows.map((r) => [r.k, Number(r.solde)]))
ok('chair cash balance', sold['chair/especes'] === -92500, JSON.stringify(sold))
ok('chair mobile money balance', sold['chair/mobile_money'] === 47500)
ok('layer bank balance', sold['pondeuse/banque'] === -40000)

// ---------- Immutability & corrections ----------
await expectNoRows('ali cannot update an écriture', 'ali', `update public.ecritures set montant = 1 returning id`)
try { await db.query(`delete from public.ecritures`); ok('even db owner cannot delete an écriture', false) }
catch (e) { ok('even db owner cannot delete an écriture', e.message.includes('ne se modifient pas'), e.message) }
await expectNoRows('kenfack cannot cancel sale', 'kenfack', `update public.ventes set annulee = true, motif_annulation = 'x' where prix_unitaire = 2500 returning id`)
await expectErr('ali cannot edit sale amount', 'ali', `update public.ventes set prix_unitaire = 1 where prix_unitaire = 2500`, [], 'modifie')
await expectErr('cancel without reason rejected', 'ali', `update public.ventes set annulee = true where prix_unitaire = 2500`)
await expectOk('ali cancels sale with reason', 'ali', `update public.ventes set annulee = true, motif_annulation = 'Erreur de saisie' where prix_unitaire = 2500`)
const after = Number((await one('ali', `select solde from public.soldes_caisses where activite = 'chair' and mode = 'especes'`)).solde)
ok('cancellation reversed in cash', after === -95000, String(after))
ok('cancelled sale frees the bird', (await one('employe', `select restants from public.effectif_bandes where code = 'C1'`)).restants === 453)
await expectErr('dahirou cannot post correction', 'dahirou', `insert into public.ecritures (caisse_id, sens, montant, nature, libelle, ecriture_corrigee_id) select caisse_id, 'entree', 100, 'correction', 'x', id from public.ecritures limit 1`)
await expectOk('ali posts correction', 'ali', `insert into public.ecritures (caisse_id, sens, montant, nature, libelle, ecriture_corrigee_id) select caisse_id, 'entree', 100, 'correction', 'Erreur de caisse', id from public.ecritures limit 1`)
await expectOk('dahirou posts opening balance', 'dahirou', `insert into public.ecritures (caisse_id, sens, montant, nature, libelle) select id, 'entree', 500000, 'solde_initial', 'Solde initial' from public.caisses where activite = 'chair' and mode = 'banque'`)
await expectOk('ali cancels feed purchase', 'ali', `update public.depenses set annulee = true, motif_annulation = 'Doublon' where libelle = '20 sacs aliment'`)
st = await one('kenfack', `select stock from public.stock_articles`)
ok('stock adjusted after cancelled purchase', Number(st.stock) === -5, JSON.stringify(st))

// ---------- Flock closure ----------
await expectNoRows('employe cannot request closure', 'employe', `update public.bandes set statut = 'cloture_demandee' where code = 'C2' returning id`)
await expectErr('kenfack cannot close directly', 'kenfack', `update public.bandes set statut = 'cloturee' where code = 'C2'`, [], 'non autorisé')
await expectOk('kenfack requests closure', 'kenfack', `update public.bandes set statut = 'cloture_demandee' where code = 'C2'`)
await expectErr('dahirou cannot edit flock data', 'dahirou', `update public.bandes set nombre_initial = 1 where code = 'C2'`, [], 'finance')
await expectOk('dahirou validates closure', 'dahirou', `update public.bandes set statut = 'cloturee' where code = 'C2'`)
await expectErr('kenfack cannot edit closed flock', 'kenfack', `update public.bandes set notes = 'x' where code = 'C2'`, [], 'clôturée')
await expectErr('no sale on closed flock', 'kenfack', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) select id, 'poulets', 'piece', 1, 3000, 1, 'especes' from public.bandes where code = 'C2'`, [], 'clôturée')

// ---------- Journal ----------
ok('journal visible to directeur', (await as('ali', `select * from public.journal_activite`)).rows.length > 10)
ok('journal hidden from finance', (await as('dahirou', `select * from public.journal_activite`)).rows.length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
