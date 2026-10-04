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

// ---------- Phase B: flock indicators and frozen closing report ----------
try {
  await db.exec(readFileSync(new URL('0003_phase_b_bandes.sql', MIG), 'utf8'))
  ok('migration 0003 runs', true)
} catch (e) { ok('migration 0003 runs', false, e.message); process.exit(1) }

await expectOk('kenfack creates bande C3', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('C3', current_date - 30, 200)`)
await expectOk('kenfack creates 50 kg feed bag', 'kenfack', `insert into public.articles (nom, categorie, unite, poids_unitaire_kg) values ('Aliment finition', 'aliment', 'sac', 50)`)
const C3 = (await db.query(`select id from public.bandes where code = 'C3'`)).rows[0].id
const ART2 = (await db.query(`select id from public.articles where nom = 'Aliment finition'`)).rows[0].id
await expectOk('dahirou buys 10 bags', 'dahirou', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, article_id, quantite) values ('ferme', 'chair', 'aliment', '10 sacs finition', 200000, 'banque', $1, 10)`, [ART2])
await expectOk('employe uses 2 bags on C3', 'employe', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, bande_id) values ($1, 'sortie', 2, $2)`, [ART2, C3])
await expectOk('dahirou pays chicks of C3', 'dahirou', `insert into public.depenses (portee, activite, bande_id, categorie, libelle, montant, mode_paiement) values ('ferme', 'chair', $1, 'poussins', 'Poussins C3', 100000, 'banque')`, [C3])
await expectOk('employe mortality C3', 'employe', `insert into public.mortalites (bande_id, nombre) values ($1, 10)`, [C3])
await expectOk('employe weighs C3', 'employe', `insert into public.pesees (bande_id, nombre_peses, poids_moyen_g) values ($1, 10, 2000)`, [C3])
await expectOk('kenfack sells 50 birds of C3', 'kenfack', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 50, 3000, 50, 'especes')`, [C3])

const ind = await one('kenfack', `select * from public.indicateurs_bandes where code = 'C3'`)
ok('C3 remaining = 140', ind?.restants === 140, JSON.stringify({ r: ind?.restants }))
ok('C3 feed = 100 kg, cost 40000', Number(ind?.aliment_kg) === 100 && Number(ind?.cout_aliment) === 40000, `${ind?.aliment_kg} kg / ${ind?.cout_aliment}`)
ok('C3 total cost = 140000', Number(ind?.cout_total) === 140000, String(ind?.cout_total))
ok('C3 turnover 150000, margin 10000', Number(ind?.chiffre_affaires) === 150000 && Number(ind?.marge_brute) === 10000)
ok('C3 live weight 380 kg, FCR 0.26', Number(ind?.poids_vif_kg) === 380 && Number(ind?.fcr) === 0.26, `${ind?.poids_vif_kg} / ${ind?.fcr}`)
ok('C3 mortality rate 5 %', Number(ind?.taux_mortalite) === 5)
ok('C3 cost per bird sold 2800', Number(ind?.cout_par_poulet_vendu) === 2800, String(ind?.cout_par_poulet_vendu))
ok('employe cannot see indicators', (await as('employe', `select * from public.indicateurs_bandes`)).rows.length === 0)
await expectErr('base view not exposed', 'kenfack', `select * from public.indicateurs_bandes_base`, [], 'permission denied')

await expectOk('kenfack requests C3 closure', 'kenfack', `update public.bandes set statut = 'cloture_demandee' where code = 'C3'`)
await expectOk('dahirou validates C3 closure', 'dahirou', `update public.bandes set statut = 'cloturee' where code = 'C3'`)
const bilan = await one('ali', `select * from public.bilans_bandes where code = 'C3'`)
ok('closing report frozen', Number(bilan?.cout_total) === 140000 && Number(bilan?.marge_brute) === 10000 && bilan?.valide_par === U.dahirou, JSON.stringify({ c: bilan?.cout_total, v: bilan?.valide_par }))
ok('directeur notified of report', (await as('ali', `select * from public.notifications where type_notification = 'bilan_bande'`)).rows.length === 1)
await expectNoRows('report cannot be edited by RLS', 'ali', `update public.bilans_bandes set cout_total = 1 returning bande_id`)
try { await db.query(`update public.bilans_bandes set cout_total = 1`); ok('report immutable even for db owner', false) }
catch (e) { ok('report immutable even for db owner', true, e.message) }
ok('employe cannot read reports', (await as('employe', `select * from public.bilans_bandes`)).rows.length === 0)

const res = Object.fromEntries((await as('dahirou', `select * from public.resultat_activites`)).rows.map((r) => [r.activite, r]))
ok('activity results computed', res.chair && res.pondeuse && Number(res.chair.chiffre_affaires) > 0, JSON.stringify(res.chair))
ok('withdrawals shown apart', Number(res.chair.retraits_associes) === 15000, String(res.chair.retraits_associes))
const lot = await one('kenfack', `select * from public.indicateurs_lots where code = 'P1'`)
ok('layer indicators: laying rate 82 %', Number(lot?.taux_ponte_7j) === 82, JSON.stringify({ t: lot?.taux_ponte_7j, ca: lot?.chiffre_affaires }))

// ---------- Phase C: investors, loans, cash check ----------
try {
  await db.exec(readFileSync(new URL('0004_phase_c_argent.sql', MIG), 'utf8'))
  ok('migration 0004 runs', true)
} catch (e) { ok('migration 0004 runs', false, e.message); process.exit(1) }

const solde = async (activite, mode) => Number((await one('ali', `select solde from public.soldes_caisses where activite = '${activite}' and mode = '${mode}'`)).solde)
const closeBande = async (code, n) => {
  await as('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('${code}', current_date - 40, ${n})`)
  await as('kenfack', `update public.bandes set statut = 'cloture_demandee' where code = '${code}'`)
  await as('dahirou', `update public.bandes set statut = 'cloturee' where code = '${code}'`)
}

await expectOk('dahirou creates investor', 'dahirou', `insert into public.investisseurs (nom, telephone) values ('Investisseur A', '690000000')`)
await expectErr('kenfack cannot create investor', 'kenfack', `insert into public.investisseurs (nom) values ('X')`)
const INV = (await db.query(`select id from public.investisseurs where nom = 'Investisseur A'`)).rows[0].id
const bankBefore = await solde('chair', 'banque')
await expectOk('dahirou records capital contribution', 'dahirou', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant, activite, mode_paiement) values ($1, 'apport', 1000000, 'chair', 'banque')`, [INV])
ok('contribution enters the cash box', (await solde('chair', 'banque')) - bankBefore === 1000000)
await expectErr('kenfack cannot record contribution', 'kenfack', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant, activite, mode_paiement) values ($1, 'apport', 1, 'chair', 'banque')`, [INV])
await expectErr('manual reinvestment not allowed', 'dahirou', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant) values ($1, 'reinvestissement', 1)`, [INV])
await expectErr('withdrawal above capital rejected', 'dahirou', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant, activite, mode_paiement) values ($1, 'retrait_capital', 2000000, 'chair', 'banque')`, [INV], 'capital')
ok('kenfack reads investors', (await as('kenfack', `select * from public.situation_investisseurs`)).rows.length === 1)
ok('employe reads no investor', (await as('employe', `select * from public.situation_investisseurs`)).rows.length === 0)

await closeBande('C4', 100)
const dist = await one('dahirou', `select * from public.distributions_investisseurs`)
ok('10 % due at flock closure', Number(dist?.montant) === 100000 && dist?.statut === 'en_attente', JSON.stringify({ m: dist?.montant }))
ok('finance notified of 10 %', (await as('dahirou', `select * from public.notifications where type_notification = 'distribution'`)).rows.length === 1)
await expectNoRows('kenfack cannot decide 10 %', 'kenfack', `update public.distributions_investisseurs set statut = 'retire', mode_paiement = 'especes' returning id`)
await expectErr('payout needs a payment mode', 'dahirou', `update public.distributions_investisseurs set statut = 'retire'`, [], 'mode')
const cashBefore = await solde('chair', 'especes')
await expectOk('investor takes the 10 % in cash', 'dahirou', `update public.distributions_investisseurs set statut = 'retire', mode_paiement = 'especes'`)
ok('payout leaves the cash box', cashBefore - (await solde('chair', 'especes')) === 100000)
await expectErr('decision taken only once', 'dahirou', `update public.distributions_investisseurs set statut = 'reinvesti'`, [], 'une seule fois')

await expectOk('second investor contributes', 'dahirou', `insert into public.investisseurs (nom) values ('Investisseur B')`)
const INVB = (await db.query(`select id from public.investisseurs where nom = 'Investisseur B'`)).rows[0].id
await as('dahirou', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant, activite, mode_paiement) values ($1, 'apport', 500000, 'chair', 'mobile_money')`, [INVB])
await closeBande('C5', 100)
ok('10 % computed for each investor', Number((await one('dahirou', `select montant from public.distributions_investisseurs where investisseur_id = '${INVB}'`)).montant) === 50000)
await expectOk('investor B reinvests', 'dahirou', `update public.distributions_investisseurs set statut = 'reinvesti' where investisseur_id = '${INVB}'`)
const sitB = await one('kenfack', `select * from public.situation_investisseurs where investisseur_id = '${INVB}'`)
ok('reinvested 10 % added to capital', Number(sitB.capital_restant) === 550000 && Number(sitB.capital_reinvesti) === 50000, JSON.stringify(sitB))
await expectErr('reinvestment cannot be cancelled alone', 'ali', `update public.operations_investisseurs set annulee = true, motif_annulation = 'x' where type_operation = 'reinvestissement'`, [], 'réinvestissement')
await expectNoRows('dahirou cannot cancel a contribution', 'dahirou', `update public.operations_investisseurs set annulee = true, motif_annulation = 'x' where investisseur_id = '${INVB}' and type_operation = 'apport' returning id`)

// Loans
await expectOk('dahirou records bank loan', 'dahirou', `insert into public.prets (type_preteur, preteur, montant_initial, interets, activite, mode_paiement) values ('banque', 'Banque X', 2000000, 200000, 'pondeuse', 'banque')`)
const PRET = (await db.query(`select id from public.prets`)).rows[0].id
await expectOk('dahirou plans due dates', 'dahirou', `insert into public.echeances_prets (pret_id, date_echeance, montant) values ($1, current_date - 5, 1100000), ($1, current_date + 60, 1100000)`, [PRET])
await expectOk('dahirou repays 500000', 'dahirou', `insert into public.remboursements_prets (pret_id, montant, mode_paiement) values ($1, 500000, 'banque')`, [PRET])
let sp = await one('kenfack', `select * from public.situation_prets`)
ok('loan balance 1700000, late', Number(sp.solde) === 1700000 && sp.en_retard === true, JSON.stringify({ s: sp.solde, r: sp.en_retard, n: sp.prochaine_echeance }))
await expectErr('overpayment of loan rejected', 'dahirou', `insert into public.remboursements_prets (pret_id, montant, mode_paiement) values ($1, 9999999, 'banque')`, [PRET], 'solde')
await expectErr('kenfack cannot repay loan', 'kenfack', `insert into public.remboursements_prets (pret_id, montant, mode_paiement) values ($1, 1, 'banque')`, [PRET])
await expectErr('loan with repayments cannot be cancelled', 'ali', `update public.prets set annulee = true, motif_annulation = 'Erreur'`, [], 'remboursements')
await expectOk('ali cancels repayment', 'ali', `update public.remboursements_prets set annulee = true, motif_annulation = 'Erreur'`)
sp = await one('kenfack', `select * from public.situation_prets`)
ok('balance restored after cancellation', Number(sp.solde) === 2200000)
const layerBank = await solde('pondeuse', 'banque')
await expectOk('ali cancels loan', 'ali', `update public.prets set annulee = true, motif_annulation = 'Erreur de saisie'`)
ok('cancelled loan reversed in cash', layerBank - (await solde('pondeuse', 'banque')) === 2000000)

// Cash check
const caisseEsp = (await db.query(`select id from public.caisses where activite = 'chair' and mode = 'especes'`)).rows[0].id
await as('dahirou', `insert into public.ecritures (caisse_id, sens, montant, nature, libelle) values ($1, 'entree', 300000, 'solde_initial', 'Fonds de caisse')`, [caisseEsp])
const theo = await solde('chair', 'especes')
await expectOk('cash check without gap', 'dahirou', `insert into public.verifications_caisse (caisse_id, montant_compte) values ($1, ${theo})`, [caisseEsp])
await expectErr('gap needs justification', 'dahirou', `insert into public.verifications_caisse (caisse_id, montant_compte) values ($1, ${theo + 5000})`, [caisseEsp], 'justification')
await expectErr('finance cannot adjust cash', 'dahirou', `insert into public.verifications_caisse (caisse_id, montant_compte, justification, ajustement) values ($1, ${theo + 5000}, 'Oubli', true)`, [caisseEsp], 'directeur')
await expectOk('ali adjusts cash after count', 'ali', `insert into public.verifications_caisse (caisse_id, montant_compte, justification, ajustement) values ($1, ${theo + 5000}, 'Vente non saisie', true)`, [caisseEsp])
ok('cash box now matches the count', (await solde('chair', 'especes')) === theo + 5000)
ok('gap recorded = 5000', Number((await one('ali', `select ecart from public.verifications_caisse order by created_at desc limit 1`)).ecart) === 5000)
ok('cash gap notified to directeur', (await as('ali', `select * from public.notifications where type_notification = 'ecart_caisse'`)).rows.length >= 1)
const cap = await one('kenfack', `select * from public.capitaux_engages`)
ok('committed capital = 1550000, no loan', Number(cap.capital_investisseurs) === 1550000 && Number(cap.solde_prets) === 0, JSON.stringify(cap))

// ---------- Phase D: planning, employee tasks, alerts ----------
try {
  await db.exec(readFileSync(new URL('0005_phase_d_organisation.sql', MIG), 'utf8'))
  ok('migration 0005 runs', true)
} catch (e) { ok('migration 0005 runs', false, e.message); process.exit(1) }

ok('default programme seeded', (await as('kenfack', `select * from public.modeles_taches`)).rows.length === 5)
await expectOk('kenfack creates bande C6 with planned sale', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial, date_vente_prevue) values ('C6', current_date - 3, 200, current_date + 40)`)
const C6 = (await db.query(`select id from public.bandes where code = 'C6'`)).rows[0].id
const t6 = (await as('kenfack', `select titre, date_prevue - current_date as dans, assigne_role from public.taches where bande_id = $1 order by date_prevue`, [C6])).rows
ok('5 tasks generated for C6', t6.length === 5, JSON.stringify(t6.map((t) => `${t.titre}@${t.dans}`)))
ok('Newcastle planned at day 7 (in 3 days)', t6.some((t) => t.titre === 'Vaccin Newcastle' && t.dans === 3))
ok('employe sees only his tasks', (await as('employe', `select * from public.taches where bande_id = $1`, [C6])).rows.length === 4)
const pesee6 = (await db.query(`select id, date_prevue from public.taches where bande_id = $1 and type_tache = 'pesee'`, [C6])).rows[0]
await expectOk('employe ticks the weighing', 'employe', `insert into public.taches_realisations (tache_id, note) values ($1, 'ok')`, [pesee6.id])
ok('task marked done', (await one('kenfack', `select statut from public.taches where id = '${pesee6.id}'`)).statut === 'fait')
ok('next weighing created 7 days later', (await as('kenfack', `select * from public.taches where bande_id = $1 and type_tache = 'pesee' and statut = 'a_faire' and date_prevue = $2::date + 7`, [C6, pesee6.date_prevue])).rows.length === 1)
await expectErr('task cannot be ticked twice', 'employe', `insert into public.taches_realisations (tache_id) values ($1)`, [pesee6.id], 'plus à faire')
const vente6 = (await db.query(`select id from public.taches where bande_id = $1 and type_tache = 'vente_prevue'`, [C6])).rows[0].id
await expectErr('employe cannot tick an exploitation task', 'employe', `insert into public.taches_realisations (tache_id) values ($1)`, [vente6], 'attribuée')
await expectErr('employe cannot plan tasks', 'employe', `insert into public.taches (titre, type_tache, date_prevue) values ('x', 'autre', current_date)`)
await expectOk('kenfack plans a treatment tomorrow', 'kenfack', `insert into public.taches (titre, type_tache, date_prevue, bande_id, assigne_role) values ('Vitamines', 'traitement', current_date + 1, $1, 'employe')`, [C6])

await expectOk('employe records 3 deaths (1.5 %)', 'employe', `insert into public.mortalites (bande_id, nombre) values ($1, 3)`, [C6])
await expectOk('employe records 1 more death', 'employe', `insert into public.mortalites (bande_id, nombre) values ($1, 1)`, [C6])
ok('abnormal mortality notified once to exploitation', (await as('kenfack', `select * from public.notifications where type_notification = 'mortalite_anormale'`)).rows.length === 1)
const al = (await as('kenfack', `select type_alerte from public.alertes_responsables`)).rows.map((r) => r.type_alerte)
ok('alerts include mortality and upcoming care', al.includes('mortalite') && al.includes('soin_proche'), JSON.stringify(al))
ok('employe sees no alerts', (await as('employe', `select * from public.alertes_responsables`)).rows.length === 0)
await expectErr('raw alert view not exposed', 'kenfack', `select * from public.alertes`, [], 'permission denied')

await as('kenfack', `update public.bandes set statut = 'cloture_demandee' where code = 'C6'`)
await as('dahirou', `update public.bandes set statut = 'cloturee' where code = 'C6'`)
ok('closure cancels remaining tasks', (await as('kenfack', `select * from public.taches where bande_id = $1 and statut = 'a_faire'`, [C6])).rows.length === 0)

// ---------- Phase E: starting data and monthly report ----------
try {
  await db.exec(readFileSync(new URL('0006_phase_e_analyses.sql', MIG), 'utf8'))
  ok('migration 0006 runs', true)
} catch (e) { ok('migration 0006 runs', false, e.message); process.exit(1) }

const totalCash = async () => Number((await one('ali', `select sum(solde) s from public.soldes_caisses`)).s)
let cashE = await totalCash()
await expectOk('existing investor capital recorded', 'dahirou', `insert into public.investisseurs (nom) values ('Investisseur C')`)
const INVC = (await db.query(`select id from public.investisseurs where nom = 'Investisseur C'`)).rows[0].id
await expectOk('initial capital without cash movement', 'dahirou', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant) values ($1, 'capital_initial', 2000000)`, [INVC])
ok('cash unchanged by initial capital', (await totalCash()) === cashE)
ok('initial capital counted in capital', Number((await one('kenfack', `select capital_restant, capital_apporte from public.situation_investisseurs where investisseur_id = '${INVC}'`)).capital_apporte) === 2000000)
await expectErr('kenfack cannot record initial capital', 'kenfack', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant) values ($1, 'capital_initial', 1)`, [INVC])

cashE = await totalCash()
await expectOk('existing loan recorded', 'dahirou', `insert into public.prets (type_preteur, preteur, montant_initial, interets, activite, mode_paiement, existant, deja_rembourse) values ('particulier', 'M. Y', 1000000, 100000, 'chair', 'especes', true, 400000)`)
ok('existing loan does not touch cash', (await totalCash()) === cashE)
ok('existing loan balance = 700000', Number((await one('kenfack', `select solde from public.situation_prets where preteur = 'M. Y'`)).solde) === 700000)
await expectErr('repayment capped by real balance', 'dahirou', `insert into public.remboursements_prets (pret_id, montant, mode_paiement) select id, 800000, 'especes' from public.prets where preteur = 'M. Y'`, [], 'solde')
await expectErr('already-repaid cannot exceed amount due', 'dahirou', `insert into public.prets (type_preteur, preteur, montant_initial, activite, mode_paiement, existant, deja_rembourse) values ('banque', 'Z', 100, 'chair', 'banque', true, 200)`)

const rep = (await as('dahirou', `select public.rapport_mensuel(current_date) r`)).rows[0].r
ok('monthly report has every section', ['production', 'mortalite', 'ventes', 'depenses', 'resultat', 'tresorerie', 'stocks', 'creances', 'dettes', 'investisseurs', 'prets', 'bandes_cloturees', 'bandes_en_cours', 'lots'].every((k) => k in rep), Object.keys(rep).join(','))
ok('report counts birds sold this month', Number(rep.production.poulets_vendus) > 0, String(rep.production.poulets_vendus))
ok('report lists flocks closed this month', rep.bandes_cloturees.some((b) => b.code === 'C3'), rep.bandes_cloturees.map((b) => b.code).join(','))
ok('report treasury: 6 cash boxes', rep.tresorerie.length === 6)
await expectErr('employe cannot get the report', 'employe', `select public.rapport_mensuel(current_date)`, [], 'responsables')

// ---------- Complements before going live ----------
try {
  await db.exec(readFileSync(new URL('0007_complements.sql', MIG), 'utf8'))
  ok('migration 0007 runs', true)
} catch (e) { ok('migration 0007 runs', false, e.message); process.exit(1) }

await expectOk('kenfack creates bande C7', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('C7', current_date - 30, 1000)`)
const C7 = (await db.query(`select id from public.bandes where code = 'C7'`)).rows[0].id
await expectErr('big anonymous sale refused', 'employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 50, 3000, 50, 'especes')`, [C7], 'client')
await expectOk('big sale with client accepted', 'employe', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, (select id from public.tiers where nom = 'Client B'), 'poulets', 'piece', 50, 3000, 50, 'especes')`, [C7])
await expectOk('small anonymous sale still fine', 'employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 2, 3000, 2, 'especes')`, [C7])
await expectErr('big purchase without supplier refused', 'dahirou', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('generale', 'chair', 'loyer', 'Loyer', 150000, 'banque')`, [], 'fournisseur')
await expectOk('salaries need no supplier', 'dahirou', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('generale', 'chair', 'salaires', 'Salaires', 150000, 'banque')`)

const rb = await one('kenfack', `select * from public.resultat_bandes where code = 'C7'`)
ok('general charges allocated to running flocks', Number(rb?.charges_generales) > 0 && Number(rb.benefice_net) === Number(rb.marge_brute) - Number(rb.charges_generales), JSON.stringify(rb))
const rb4 = await one('dahirou', `select * from public.resultat_bandes where code = 'C4'`)
ok('available profit deducts the 10 %', Number(rb4.dix_pourcent_investisseurs) === 100000 && Number(rb4.benefice_disponible) === Number(rb4.benefice_net) - 100000, JSON.stringify(rb4))
ok('employe cannot see flock profit', (await as('employe', `select * from public.resultat_bandes`)).rows.length === 0)

const cEsp = (await db.query(`select id from public.caisses where activite = 'chair' and mode = 'especes'`)).rows[0].id
const cBank = (await db.query(`select id from public.caisses where activite = 'chair' and mode = 'banque'`)).rows[0].id
const espBefore = await solde('chair', 'especes'), bankBefore2 = await solde('chair', 'banque')
await expectOk('dahirou deposits cash at the bank', 'dahirou', `insert into public.transferts_caisses (caisse_source, caisse_destination, montant, motif) values ($1, $2, 50000, 'Dépôt banque')`, [cEsp, cBank])
ok('transfer moves money between boxes', espBefore - (await solde('chair', 'especes')) === 50000 && (await solde('chair', 'banque')) - bankBefore2 === 50000)
ok('total cash unchanged by transfer', (await solde('chair', 'especes')) + (await solde('chair', 'banque')) === espBefore + bankBefore2)
await expectErr('transfer above balance refused', 'dahirou', `insert into public.transferts_caisses (caisse_source, caisse_destination, montant, motif) values ($1, $2, 999999999, 'x')`, [cEsp, cBank], 'ne contient')
await expectErr('kenfack cannot transfer', 'kenfack', `insert into public.transferts_caisses (caisse_source, caisse_destination, montant, motif) values ($1, $2, 1, 'x')`, [cEsp, cBank])
await expectOk('ali cancels the transfer', 'ali', `update public.transferts_caisses set annulee = true, motif_annulation = 'Erreur'`)
ok('cancelled transfer restored both boxes', (await solde('chair', 'especes')) === espBefore && (await solde('chair', 'banque')) === bankBefore2)

ok('login names filled in profiles', (await as('ali', `select identifiant from public.profiles order by identifiant`)).rows.map((r) => r.identifiant).join(',') === 'ali,dahirou,employe,kenfack')
await expectErr('directeur cannot demote himself', 'ali', `update public.profiles set role = 'employe' where id = auth.uid()`, [], 'propre')
await expectOk('directeur changes an employee role', 'ali', `update public.profiles set nom_complet = 'Employé 1' where identifiant = 'employe'`)
await expectNoRows('kenfack cannot change roles', 'kenfack', `update public.profiles set role = 'directeur' where identifiant = 'employe' returning id`)

// ---------- Function privileges hardening: everything must still work ----------
try {
  await db.exec(readFileSync(new URL('0008_securite_fonctions.sql', MIG), 'utf8'))
  ok('migration 0008 runs', true)
} catch (e) { ok('migration 0008 runs', false, e.message); process.exit(1) }

await expectErr('internal function no longer callable', 'kenfack', `select public.solde_caisse(id) from public.caisses limit 1`, [], 'permission denied')
await expectErr('trigger function not callable by anon', null, `select public.ecrire_source(null, null, 'entree', 1, 'vente', 'x', current_date, null)`, [], 'permission denied')
await expectOk('after hardening: employe mortality', 'employe', `insert into public.mortalites (bande_id, nombre) values ($1, 1)`, [C7])
await expectOk('after hardening: employe laying', 'employe', `insert into public.pontes (lot_id, oeufs_collectes) values ($1, 500)`, [P1])
await expectOk('after hardening: employe feed used', 'employe', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, bande_id) values ($1, 'sortie', 1, $2)`, [ART2, C7])
await expectOk('after hardening: employe sale', 'employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 1, 3000, 1, 'especes')`, [C7])
await expectOk('after hardening: kenfack expense', 'kenfack', `insert into public.depenses (portee, activite, bande_id, categorie, libelle, montant, mode_paiement) values ('ferme', 'chair', $1, 'transport', 'Transport', 5000, 'especes')`, [C7])
await expectOk('after hardening: dahirou client payment', 'dahirou', `insert into public.paiements_clients (vente_id, montant, mode_paiement) select vente_id, 1000, 'especes' from public.creances_clients limit 1`)
await expectOk('after hardening: task ticked', 'employe', `insert into public.taches_realisations (tache_id) select id from public.taches where statut = 'a_faire' and (assigne_role = 'employe' or assigne_role is null) limit 1`)
for (const [who, view] of [['employe', 'effectif_bandes'], ['employe', 'effectif_lots'], ['kenfack', 'stock_articles'], ['kenfack', 'indicateurs_bandes'],
  ['kenfack', 'indicateurs_lots'], ['dahirou', 'resultat_activites'], ['kenfack', 'alertes_responsables'], ['dahirou', 'resultat_bandes'],
  ['dahirou', 'creances_clients'], ['dahirou', 'dettes_fournisseurs'], ['kenfack', 'soldes_caisses'], ['kenfack', 'situation_investisseurs'],
  ['kenfack', 'situation_prets'], ['kenfack', 'capitaux_engages'], ['employe', 'prix_actuels'], ['kenfack', 'ponte_journaliere']]) {
  await expectOk(`after hardening: ${who} reads ${view}`, who, `select * from public.${view} limit 5`)
}
await expectOk('after hardening: monthly report', 'dahirou', `select public.rapport_mensuel(current_date)`)
ok('after hardening: employe still blocked from indicators', (await as('employe', `select * from public.indicateurs_bandes`)).rows.length === 0)

// ---------- Journal ----------
ok('journal visible to directeur', (await as('ali', `select * from public.journal_activite`)).rows.length > 10)
ok('journal hidden from finance', (await as('dahirou', `select * from public.journal_activite`)).rows.length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
