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

// ---------- 0009: low-stock alert only when a threshold is set ----------
try {
  await db.exec(readFileSync(new URL('0009_alerte_stock.sql', MIG), 'utf8'))
  ok('migration 0009 runs', true)
} catch (e) { ok('migration 0009 runs', false, e.message); process.exit(1) }
await expectOk('product without threshold', 'kenfack', `insert into public.articles (nom, categorie, unite) values ('Vaccin X', 'medicament', 'flacon')`)
await expectOk('product with threshold 5', 'kenfack', `insert into public.articles (nom, categorie, unite, seuil_minimum, poids_unitaire_kg) values ('Aliment Y', 'aliment', 'sac', 5, 50)`)
const stockAlerts = (await as('kenfack', `select params->>'nom' nom from public.alertes_responsables where type_alerte = 'stock_bas'`)).rows.map((r) => r.nom)
ok('no false alert for product without threshold', !stockAlerts.includes('Vaccin X'), stockAlerts.join(','))
ok('alert kept when stock under threshold', stockAlerts.includes('Aliment Y'), stockAlerts.join(','))

// ---------- 0010: chicks delivered in several times ----------
try {
  await db.exec(readFileSync(new URL('0010_livraisons_poussins.sql', MIG), 'utf8'))
  ok('migration 0010 runs', true)
} catch (e) { ok('migration 0010 runs', false, e.message); process.exit(1) }
ok('existing flocks got their first delivery', Number((await db.query(`select count(*) n from public.livraisons_poussins where bande_id = '${C7}'`)).rows[0].n) === 1)
await expectOk('flock created with first half', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('L1', current_date - 2, 250)`)
const L1 = (await db.query(`select id from public.bandes where code = 'L1'`)).rows[0].id
ok('first delivery recorded automatically', Number((await db.query(`select sum(nombre) n from public.livraisons_poussins where bande_id = '${L1}'`)).rows[0].n) === 250)
await expectOk('second half delivered later', 'kenfack', `insert into public.livraisons_poussins (bande_id, nombre, notes) values ($1, 250, 'Deuxième moitié')`, [L1])
ok('initial number = 500 after second delivery', (await one('kenfack', `select nombre_initial from public.bandes where code = 'L1'`)).nombre_initial === 500)
ok('headcount follows deliveries', (await one('employe', `select restants from public.effectif_bandes where code = 'L1'`)).restants === 500)
await expectErr('delivery before arrival refused', 'kenfack', `insert into public.livraisons_poussins (bande_id, date_livraison, nombre) values ($1, current_date - 10, 10)`, [L1], 'précéder')
await expectErr('employe cannot add a delivery', 'employe', `insert into public.livraisons_poussins (bande_id, nombre) values ($1, 10)`, [L1])
await expectOk('wrong delivery removed', 'kenfack', `delete from public.livraisons_poussins where bande_id = $1 and notes = 'Deuxième moitié'`, [L1])
ok('initial number back to 250', (await one('kenfack', `select nombre_initial from public.bandes where code = 'L1'`)).nombre_initial === 250)
await expectErr('last delivery cannot be removed', 'kenfack', `delete from public.livraisons_poussins where bande_id = $1`, [L1], 'au moins une')

// ---------- 0011: chick orders, planned deliveries, tick « Livré » ----------
try {
  await db.exec(readFileSync(new URL('0011_commandes_poussins.sql', MIG), 'utf8'))
  ok('migration 0011 runs', true)
} catch (e) { ok('migration 0011 runs', false, e.message); process.exit(1) }

await expectOk('kenfack orders 1000 chicks', 'kenfack', `insert into public.commandes_poussins (fournisseur_id, code_bande, souche, nombre_commande, date_livraison_prevue) values ($1, 'CMD1', 'Cobb 500', 1000, current_date)`, [FOU])
await expectErr('dahirou cannot order chicks', 'dahirou', `insert into public.commandes_poussins (code_bande, nombre_commande, date_livraison_prevue) values ('X', 1, current_date)`)
const liv1 = await one('kenfack', `select l.id, l.nombre, l.statut, l.tache_id from public.livraisons_poussins l join public.commandes_poussins c on c.id = l.commande_id where c.code_bande = 'CMD1'`)
ok('planned delivery of 1000 created', liv1?.nombre === 1000 && liv1.statut === 'prevue', JSON.stringify(liv1))
ok('delivery task in exploitation planning', (await one('kenfack', `select assigne_role, type_tache from public.taches where id = '${liv1.tache_id}'`)).type_tache === 'arrivee_poussins')
ok('no flock before first reception', (await as('kenfack', `select * from public.bandes where code = 'CMD1'`)).rows.length === 0)
await expectErr('employe cannot receive chicks', 'employe', `select public.receptionner_livraison($1, 500, current_date, current_date + 3)`, [liv1.id], 'réceptionnent')
await expectOk('kenfack ticks « Livré »: 500 received, rest in 3 days', 'kenfack', `select public.receptionner_livraison($1, 500, current_date, current_date + 3)`, [liv1.id])
const b1 = await one('kenfack', `select id, nombre_initial, statut from public.bandes where code = 'CMD1'`)
ok('flock created with 500 chicks', b1?.nombre_initial === 500, JSON.stringify(b1))
ok('first delivery task done', (await one('kenfack', `select statut from public.taches where id = '${liv1.tache_id}'`)).statut === 'fait')
ok('vaccination programme generated for the new flock', (await as('kenfack', `select * from public.taches where bande_id = $1 and type_tache = 'vaccination'`, [b1.id])).rows.length === 3)
const liv2 = await one('kenfack', `select id, nombre, statut, date_prevue - current_date as dans from public.livraisons_poussins where commande_id = (select id from public.commandes_poussins where code_bande = 'CMD1') and statut = 'prevue'`)
ok('rest of 500 planned in 3 days', liv2?.nombre === 500 && liv2.dans === 3, JSON.stringify(liv2))
ok('order is partial', (await one('kenfack', `select statut from public.commandes_poussins where code_bande = 'CMD1'`)).statut === 'partielle')
await expectErr('cannot tick twice', 'kenfack', `select public.receptionner_livraison($1, 500, current_date, null)`, [liv1.id], 'plus en attente')
await expectOk('supplier postpones the rest', 'kenfack', `select public.reporter_livraison($1, current_date + 5)`, [liv2.id])
await expectOk('kenfack ticks the rest: 480 received, no more expected', 'kenfack', `select public.receptionner_livraison($1, 480, current_date + 5, null)`, [liv2.id])
ok('flock now 980 chicks', (await one('kenfack', `select nombre_initial from public.bandes where code = 'CMD1'`)).nombre_initial === 980)
ok('order delivered', (await one('kenfack', `select statut from public.commandes_poussins where code_bande = 'CMD1'`)).statut === 'livree')
ok('flock headcount 980', (await one('employe', `select restants from public.effectif_bandes where code = 'CMD1'`)).restants === 980)
await expectOk('second order', 'kenfack', `insert into public.commandes_poussins (code_bande, nombre_commande, date_livraison_prevue) values ('CMD2', 300, current_date + 10)`)
const liv3 = await one('kenfack', `select id from public.livraisons_poussins where commande_id = (select id from public.commandes_poussins where code_bande = 'CMD2')`)
await expectOk('order cancelled before delivery', 'kenfack', `select public.annuler_livraison_prevue($1)`, [liv3.id])
ok('cancelled order status', (await one('kenfack', `select statut from public.commandes_poussins where code_bande = 'CMD2'`)).statut === 'annulee')
await expectErr('internal planning function not callable', 'kenfack', `select public.prevoir_livraison(null, 1, current_date, null)`, [], 'permission denied')

// ---------- 0012: one order for several flocks ----------
try {
  await db.exec(readFileSync(new URL('0012_commandes_multi_bandes.sql', MIG), 'utf8'))
  ok('migration 0012 runs', true)
} catch (e) { ok('migration 0012 runs', false, e.message); process.exit(1) }
ok('existing orders got a reference', (await as('kenfack', `select * from public.commandes_poussins where reference is null`)).rows.length === 0)
await expectOk('one order for 3 flocks', 'kenfack', `insert into public.commandes_poussins (reference, fournisseur_id, code_bande, nombre_commande, date_livraison_prevue) values
  ('CMD-TRIO', $1, 'T1', 1000, current_date), ('CMD-TRIO', $1, 'T2', 1000, current_date), ('CMD-TRIO', $1, 'T3', 1000, current_date)`, [FOU])
ok('3 planned deliveries for the order', (await as('kenfack', `select l.* from public.livraisons_poussins l join public.commandes_poussins c on c.id = l.commande_id where c.reference = 'CMD-TRIO' and l.statut = 'prevue'`)).rows.length === 3)
const lt1 = await one('kenfack', `select l.id from public.livraisons_poussins l join public.commandes_poussins c on c.id = l.commande_id where c.code_bande = 'T1'`)
const lt2 = await one('kenfack', `select l.id from public.livraisons_poussins l join public.commandes_poussins c on c.id = l.commande_id where c.code_bande = 'T2'`)
await expectOk('T1 fully delivered', 'kenfack', `select public.receptionner_livraison($1, 1000, current_date, null)`, [lt1.id])
await expectOk('T2 half delivered, rest later', 'kenfack', `select public.receptionner_livraison($1, 500, current_date, current_date + 4)`, [lt2.id])
const trio = (await as('kenfack', `select code_bande, statut from public.commandes_poussins where reference = 'CMD-TRIO' order by code_bande`)).rows.map((r) => `${r.code_bande}:${r.statut}`).join(',')
ok('each flock of the order has its own status', trio === 'T1:livree,T2:partielle,T3:en_attente', trio)
ok('flocks T1 and T2 created', (await as('kenfack', `select code from public.bandes where code in ('T1', 'T2', 'T3') order by code`)).rows.map((r) => r.code).join(',') === 'T1,T2')
await expectErr('code already used by a flock refused', 'kenfack', `insert into public.commandes_poussins (reference, code_bande, nombre_commande, date_livraison_prevue) values ('X', 't1', 10, current_date)`, [], 'déjà utilisé')
await expectErr('code already planned refused', 'kenfack', `insert into public.commandes_poussins (reference, code_bande, nombre_commande, date_livraison_prevue) values ('X', 'T3', 10, current_date)`, [], 'déjà prévu')

// ---------- 0013: corrections, eggs stock, buildings, logins, push, several farms ----------
try {
  await db.exec(readFileSync(new URL('0013_ameliorations.sql', MIG), 'utf8'))
  ok('migration 0013 runs', true)
} catch (e) { ok('migration 0013 runs', false, e.message); process.exit(1) }

// Corrections of field entries
const mort = await one('employe', `insert into public.mortalites (bande_id, nombre, cause) values ('${C7}', 10, 'typo') returning id`)
await expectOk('kenfack corrects a mortality (10 → 1)', 'kenfack', `update public.mortalites set nombre = 1 where id = $1`, [mort.id])
ok('correction is in the journal', (await as('ali', `select * from public.journal_activite where table_nom = 'mortalites' and action = 'UPDATE'`)).rows.length >= 1)
await expectNoRows('employe cannot correct', 'employe', `update public.mortalites set nombre = 5 where id = '${mort.id}' returning id`)
await expectOk('kenfack deletes a wrong entry', 'kenfack', `delete from public.mortalites where id = $1`, [mort.id])

// Eggs stock
const eggs0 = await one('kenfack', `select * from public.stock_oeufs`)
await expectOk('egg laying 900 (10 broken)', 'employe', `insert into public.pontes (lot_id, oeufs_collectes, oeufs_casses) values ($1, 900, 10)`, [P1])
await expectOk('sale of 2 trays', 'kenfack', `insert into public.ventes (lot_id, produit, unite, quantite, prix_unitaire, mode_paiement) values ($1, 'plateaux', 'plateau', 2, 2000, 'especes')`, [P1])
await expectOk('adjustment: 5 eggs broken in store', 'kenfack', `insert into public.ajustements_oeufs (quantite, motif) values (-5, 'Casse au magasin')`)
const eggs1 = await one('kenfack', `select * from public.stock_oeufs`)
ok('egg stock = +890 − 60 − 5', eggs1.stock_oeufs - eggs0.stock_oeufs === 825, JSON.stringify({ before: eggs0.stock_oeufs, after: eggs1.stock_oeufs }))
ok('trays computed', eggs1.plateaux === Math.floor(eggs1.stock_oeufs / 30))
ok('employe cannot see egg stock (before 0014)', (await as('employe', `select * from public.stock_oeufs`)).rows.length === 0)

// Buildings
await expectOk('kenfack creates building', 'kenfack', `insert into public.batiments (nom, capacite) values ('Bâtiment A', 1200)`)
const BAT = (await db.query(`select id from public.batiments where nom = 'Bâtiment A'`)).rows[0].id
await expectOk('order placed in building A', 'kenfack', `insert into public.commandes_poussins (reference, code_bande, nombre_commande, date_livraison_prevue, batiment_id) values ('CMD-BAT', 'BA1', 800, current_date, $1)`, [BAT])
const lba = await one('kenfack', `select l.id from public.livraisons_poussins l join public.commandes_poussins c on c.id = l.commande_id where c.code_bande = 'BA1'`)
await expectOk('reception', 'kenfack', `select public.receptionner_livraison($1, 800, current_date, null)`, [lba.id])
const occ = await one('kenfack', `select * from public.occupation_batiments where nom = 'Bâtiment A'`)
ok('flock placed in building, occupancy 800', Number(occ.oiseaux) === 800 && occ.occupants[0]?.code === 'BA1', JSON.stringify(occ))

// Logins history
await expectOk('login recorded', 'kenfack', `insert into public.connexions (evenement, appareil) values ('connexion', 'test')`)
ok('directeur sees logins', (await as('ali', `select * from public.connexions`)).rows.length >= 1)
ok('kenfack does not see logins', (await as('kenfack', `select * from public.connexions`)).rows.length === 0)

// Push subscriptions
await expectOk('device subscription saved', 'kenfack', `insert into public.abonnements_push (endpoint, p256dh, auth) values ('https://push.example/1', 'k', 'a')`)
ok('only own subscriptions visible', (await as('ali', `select * from public.abonnements_push`)).rows.length === 0)

// Several farms
ok('memberships backfilled', (await as('ali', `select * from public.mes_fermes()`)).rows.length === 1)
const F2 = (await as('ali', `select public.creer_ferme('Ferme Nord') as id`)).rows[0].id
ok('new farm created with 6 cash boxes', Number((await db.query(`select count(*) n from public.caisses where ferme_id = '${F2}'`)).rows[0].n) === 6)
ok('programme copied to new farm', Number((await db.query(`select count(*) n from public.modeles_taches where ferme_id = '${F2}'`)).rows[0].n) > 0)
await expectErr('kenfack cannot create a farm', 'kenfack', `select public.creer_ferme('X')`, [], 'directeur')
const fermeAli = (await as('ali', `select ferme_id from public.mes_fermes() where active`)).rows[0].ferme_id
await expectOk('ali switches to the new farm', 'ali', `select public.changer_ferme($1)`, [F2])
ok('new farm has no flock', (await as('ali', `select * from public.bandes`)).rows.length === 0)
ok('new farm cash at 0', Number((await one('ali', `select sum(solde) s from public.soldes_caisses`)).s) === 0)
await expectOk('ali adds kenfack to the new farm as employee', 'ali', `select public.ajouter_membre('kenfack', 'employe')`)
ok('members of new farm', (await as('ali', `select identifiant, role from public.membres_ferme()`)).rows.map((r) => `${r.identifiant}:${r.role}`).sort().join(',') === 'ali:directeur,kenfack:employe')
await expectOk('kenfack switches to new farm', 'kenfack', `select public.changer_ferme($1)`, [F2])
ok('kenfack is employee in the new farm', (await one('kenfack', `select role from public.profiles where id = auth.uid()`)).role === 'employe')
await expectErr('as employee he cannot create a flock there', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('N1', current_date, 10)`)
await expectOk('kenfack back to first farm', 'kenfack', `select public.changer_ferme($1)`, [fermeAli])
ok('kenfack is exploitation again', (await one('kenfack', `select role from public.profiles where id = auth.uid()`)).role === 'exploitation')
await expectErr('switch to a farm you do not belong to', 'dahirou', `select public.changer_ferme($1)`, [F2], 'membre')
await expectOk('ali changes kenfack role in new farm', 'ali', `select public.definir_role($1, 'exploitation')`, [U.kenfack])
await expectErr('ali cannot change own role', 'ali', `select public.definir_role($1, 'employe')`, [U.ali], 'propre')
await expectOk('ali back to first farm', 'ali', `select public.changer_ferme($1)`, [fermeAli])
ok('first farm data visible again', (await as('ali', `select * from public.bandes`)).rows.length > 0)

// ---------- 0014: egg stock for everyone, accounts limited to the active farm ----------
try {
  await db.exec(readFileSync(new URL('0014_stock_oeufs_comptes.sql', MIG), 'utf8'))
  ok('migration 0014 runs', true)
} catch (e) { ok('migration 0014 runs', false, e.message); process.exit(1) }
ok('employe now sees egg stock (sale warning)', (await as('employe', `select * from public.stock_oeufs`)).rows.length === 1)
ok('anon still sees nothing', await as(null, `select * from public.stock_oeufs`).then((r) => r.rows.length === 0, () => true))
await expectOk('ali switches to Ferme Nord', 'ali', `select public.changer_ferme($1)`, [F2])
ok('ali sees kenfack (member, active elsewhere)', (await as('ali', `select id from public.profiles where id = '${U.kenfack}'`)).rows.length === 1)
ok('ali does not see dahirou (not a member)', (await as('ali', `select id from public.profiles where id = '${U.dahirou}'`)).rows.length === 0)
await expectNoRows('ali cannot deactivate a non-member', 'ali', `update public.profiles set actif = false where id = '${U.dahirou}' returning id`)
ok('ali can deactivate a member active elsewhere', (await as('ali', `update public.profiles set actif = false where id = '${U.kenfack}' returning id`)).rows.length === 1)
await db.exec(`update public.profiles set actif = true where id = '${U.kenfack}'`)
await expectOk('ali back to first farm', 'ali', `select public.changer_ferme($1)`, [fermeAli])
ok('ali sees all 4 accounts of first farm', (await as('ali', `select id from public.profiles`)).rows.length === 4)
await expectNoRows('kenfack still cannot change accounts', 'kenfack', `update public.profiles set nom_complet = 'x' where id = '${U.employe}' returning id`)

// ---------- 0015: correction requests, probable duplicates ----------
try {
  await db.exec(readFileSync(new URL('0015_demandes_doublons.sql', MIG), 'utf8'))
  ok('migration 0015 runs', true)
} catch (e) { ok('migration 0015 runs', false, e.message); process.exit(1) }
const vReq = await one('kenfack', `insert into public.ventes (lot_id, produit, unite, quantite, prix_unitaire, mode_paiement) values ('${P1}', 'oeufs', 'piece', 7, 100, 'especes') returning id`)
await expectNoRows('kenfack still cannot cancel a sale himself', 'kenfack', `update public.ventes set annulee = true, motif_annulation = 'x' where id = '${vReq.id}' returning id`)
const dem = await expectOk('kenfack requests the cancellation', 'kenfack', `insert into public.demandes_correction (cible_table, cible_id, action, resume, motif) values ('ventes', '${vReq.id}', 'annuler', '7 œufs', 'Client a rendu les œufs') returning id`)
await expectErr('second request on same sale refused', 'dahirou', `insert into public.demandes_correction (cible_table, cible_id, action, resume, motif) values ('ventes', '${vReq.id}', 'annuler', '7 œufs', 'x')`, [], 'déjà en attente')
await expectErr('employe cannot request', 'employe', `insert into public.demandes_correction (cible_table, cible_id, action, resume, motif) values ('ventes', '${vReq.id}', 'annuler', 'x', 'x')`)
ok('directeur notified of the request', (await as('ali', `select * from public.notifications where type_notification = 'demande_correction'`)).rows.length >= 1)
ok('kenfack sees his request', (await as('kenfack', `select * from public.demandes_correction`)).rows.length === 1)
ok('dahirou does not see kenfack request', (await as('dahirou', `select * from public.demandes_correction`)).rows.length === 0)
await expectNoRows('kenfack cannot approve by editing', 'kenfack', `update public.demandes_correction set statut = 'acceptee' returning id`)
await expectErr('kenfack cannot decide', 'kenfack', `select public.decider_demande($1, true)`, [dem.rows[0].id], 'directeur')
await expectOk('ali accepts', 'ali', `select public.decider_demande($1, true)`, [dem.rows[0].id])
const vAfter = await one('ali', `select annulee, motif_annulation, annulee_par from public.ventes where id = '${vReq.id}'`)
ok('sale cancelled with the requester reason, by ali', vAfter.annulee && vAfter.motif_annulation.includes('Client a rendu') && vAfter.motif_annulation.includes('Kenfack') && vAfter.annulee_par === U.ali, JSON.stringify(vAfter))
ok('kenfack notified', (await as('kenfack', `select * from public.notifications where type_notification = 'demande_correction'`)).rows.length >= 1)
await expectErr('decided request cannot be decided again', 'ali', `select public.decider_demande($1, false, 'x')`, [dem.rows[0].id], 'plus en attente')
// Cash correction requested by finance, then refused / accepted
const ecr = await one('dahirou', `select e.id, e.caisse_id from public.ecritures e where e.nature = 'vente' limit 1`)
const solde0 = Number((await one('ali', `select solde from public.soldes_caisses where caisse_id = '${ecr.caisse_id}'`)).solde)
const d2 = (await as('dahirou', `insert into public.demandes_correction (cible_table, cible_id, action, sens, montant, resume, motif) values ('ecritures', '${ecr.id}', 'corriger', 'sortie', 500, 'vente', 'Montant tapé trop haut') returning id`)).rows[0].id
await expectErr('refusal needs a reason', 'ali', `select public.decider_demande($1, false, '')`, [d2], 'motif')
await expectOk('ali refuses', 'ali', `select public.decider_demande($1, false, 'Le montant est juste')`, [d2])
const d3 = (await as('dahirou', `insert into public.demandes_correction (cible_table, cible_id, action, sens, montant, resume, motif) values ('ecritures', '${ecr.id}', 'corriger', 'sortie', 500, 'vente', 'Vraiment trop haut') returning id`)).rows[0].id
await expectOk('ali accepts the cash correction', 'ali', `select public.decider_demande($1, true)`, [d3])
ok('cash corrected by −500 with a linked correction', Number((await one('ali', `select solde from public.soldes_caisses where caisse_id = '${ecr.caisse_id}'`)).solde) === solde0 - 500)
await expectErr('correction on a sale (not an entry) refused', 'kenfack', `insert into public.demandes_correction (cible_table, cible_id, action, sens, montant, resume, motif) values ('ventes', '${vReq.id}', 'corriger', 'sortie', 5, 'x', 'x')`)
// Probable duplicates
const nb0 = (await as('kenfack', `select * from public.notifications where type_notification = 'doublon'`)).rows.length
await expectOk('laying entered by employee', 'employe', `insert into public.pontes (lot_id, date_ponte, oeufs_collectes) values ($1, current_date - 3, 777)`, [P1])
ok('no duplicate warning for a single entry', (await as('kenfack', `select * from public.notifications where type_notification = 'doublon'`)).rows.length === nb0)
await expectOk('same laying entered again by kenfack', 'kenfack', `insert into public.pontes (lot_id, date_ponte, oeufs_collectes) values ($1, current_date - 3, 777)`, [P1])
ok('duplicate laying flagged to exploitation', (await as('kenfack', `select * from public.notifications where type_notification = 'doublon'`)).rows.length === nb0 + 1)
await expectOk('same sale twice', 'kenfack', `insert into public.ventes (lot_id, produit, unite, quantite, prix_unitaire, mode_paiement) values ('${P1}', 'oeufs', 'piece', 33, 100, 'especes'), ('${P1}', 'oeufs', 'piece', 33, 100, 'especes')`)
ok('duplicate sale flagged', (await as('ali', `select * from public.notifications where type_notification = 'doublon' and message like 'Vente%'`)).rows.length >= 1)
await expectOk('same mortality twice', 'employe', `insert into public.mortalites (bande_id, nombre, date_constat) values ('${C7}', 4, current_date - 2), ('${C7}', 4, current_date - 2)`)
// ---------- 0016: finance has a read-only stock ----------
try {
  await db.exec(readFileSync(new URL('0016_stock_lecture_finance.sql', MIG), 'utf8'))
  ok('migration 0016 runs', true)
} catch (e) { ok('migration 0016 runs', false, e.message); process.exit(1) }
await expectNoRows('dahirou cannot create a stock product', 'dahirou', `insert into public.articles (nom, categorie, unite) select 'X', categorie, unite from public.articles limit 1 returning id`)
await expectNoRows('dahirou cannot edit a stock product', 'dahirou', `update public.articles set seuil_minimum = 1 returning id`)
await expectErr('dahirou cannot record a feed purchase', 'dahirou', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, montant_paye) values ('ferme', 'chair', 'aliment', 'Aliment', 1000, 'especes', 1000)`, [], 'exploitation')
await expectOk('dahirou still records a general expense', 'dahirou', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, montant_paye) values ('generale', 'chair', 'charges', 'Électricité', 1000, 'especes', 1000)`)
await expectOk('kenfack still records a feed purchase', 'kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, montant_paye) values ('ferme', 'chair', 'aliment', 'Aliment', 1000, 'especes', 1000)`)
ok('dahirou still reads the stock', (await as('dahirou', `select * from public.articles`)).rows.length > 0)
ok('duplicate mortality flagged', (await as('kenfack', `select * from public.notifications where type_notification = 'doublon' and message like 'Mortalité%'`)).rows.length >= 1)

// ---------- 0017: finance reads the planning ----------
try {
  await db.exec(readFileSync(new URL('0017_planning_lecture_finance.sql', MIG), 'utf8'))
  ok('migration 0017 runs', true)
} catch (e) { ok('migration 0017 runs', false, e.message); process.exit(1) }
await expectErr('dahirou cannot plan a task', 'dahirou', `insert into public.taches (titre, type_tache, date_prevue) values ('X', 'autre', current_date)`)
const tFin = await one('kenfack', `insert into public.taches (titre, type_tache, date_prevue, assigne_role) values ('Rembourser prêt', 'remboursement', current_date, 'finance') returning id`)
const tEmp = await one('kenfack', `insert into public.taches (titre, type_tache, date_prevue, assigne_role) values ('Nettoyer', 'nettoyage', current_date, 'employe') returning id`)
await expectNoRows('dahirou cannot postpone a task', 'dahirou', `update public.taches set date_prevue = current_date + 1 where id = '${tFin.id}' returning id`)
ok('dahirou still sees the planning', (await as('dahirou', `select * from public.taches where id in ('${tFin.id}', '${tEmp.id}')`)).rows.length === 2)
await expectOk('dahirou ticks his own task', 'dahirou', `insert into public.taches_realisations (tache_id) values ($1)`, [tFin.id])
await expectErr('dahirou cannot tick an employee task', 'dahirou', `insert into public.taches_realisations (tache_id) values ($1)`, [tEmp.id])
await expectOk('employe still ticks his task', 'employe', `insert into public.taches_realisations (tache_id) values ($1)`, [tEmp.id])

// ---------- 0018: alert when a cash box goes negative ----------
try {
  await db.exec(readFileSync(new URL('0018_alerte_caisse_negative.sql', MIG), 'utf8'))
  ok('migration 0018 runs', true)
} catch (e) { ok('migration 0018 runs', false, e.message); process.exit(1) }
const negCount = async () => (await as('dahirou', `select * from public.notifications where type_notification = 'caisse_negative'`)).rows.length
const cx = await one('ali', `select activite, mode, solde from public.soldes_caisses where solde >= 0 order by solde limit 1`)
const soldeCx = Number(cx.solde)
const n0 = await negCount()
await expectOk('expense larger than the cash box is not blocked', 'kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('ferme', '${cx.activite}', 'transport', 'Transport avancé', ${soldeCx + 1000}, '${cx.mode}')`)
ok('cash box is now negative', Number((await one('ali', `select solde from public.soldes_caisses where activite = '${cx.activite}' and mode = '${cx.mode}'`)).solde) === -1000)
ok('finance and director alerted once', (await negCount()) === n0 + 1 && (await as('ali', `select * from public.notifications where type_notification = 'caisse_negative'`)).rows.length >= 1)
await expectOk('second expense on a negative box', 'kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('ferme', '${cx.activite}', 'transport', 'Transport 2', 500, '${cx.mode}')`)
ok('no repeated alert while already negative', (await negCount()) === n0 + 1)

// ---------- 0019: start-up by origin of the money ----------
try {
  await db.exec(readFileSync(new URL('0019_demarrage_par_origine.sql', MIG), 'utf8'))
  ok('migration 0019 runs', true)
} catch (e) { ok('migration 0019 runs', false, e.message); process.exit(1) }
const caisseSum = async () => Number((await one('ali', `select coalesce(sum(solde), 0) s from public.soldes_caisses`)).s)
const cash0 = await caisseSum()
const demarrage = { date: '2026-10-01',
  associes: [{ activite: 'chair', mode: 'especes', montant: 5000000 }],
  investisseurs: [{ nom: 'Investisseur Démarrage', montant: 1000000, activite: 'chair', mode: 'banque' }],
  prets: [{ preteur: 'Banque Démarrage', type_preteur: 'banque', montant: 2000000, interets: 200000, deja_rembourse: 0, activite: 'pondeuse', mode: 'banque', disponible: 1500000 }] }
const tot = await expectOk('dahirou records the start-up in one go', 'dahirou', `select public.enregistrer_demarrage($1::jsonb) as t`, [JSON.stringify(demarrage)])
ok('total in cash = 5 000 000 + 1 000 000 + 1 500 000', Number(tot?.rows[0].t) === 7500000 && (await caisseSum()) - cash0 === 7500000, `total=${tot?.rows[0].t} delta=${(await caisseSum()) - cash0}`)
ok('investor capital counted (for the 10 %)', Number((await one('ali', `select capital_apporte from public.situation_investisseurs where nom = 'Investisseur Démarrage'`))?.capital_apporte) === 1000000)
const pretD = await one('ali', `select montant_initial, existant from public.prets where preteur = 'Banque Démarrage'`)
ok('loan to repay = full 2 000 000, marked as existing', Number(pretD?.montant_initial) === 2000000 && pretD?.existant === true)
await expectErr('kenfack cannot record a start-up', 'kenfack', `select public.enregistrer_demarrage($1::jsonb)`, [JSON.stringify({ associes: [{ activite: 'chair', mode: 'especes', montant: 10 }] })])
const cash1 = await caisseSum()
await expectErr('one wrong line cancels everything', 'dahirou', `select public.enregistrer_demarrage($1::jsonb)`, [JSON.stringify({ associes: [{ activite: 'chair', mode: 'especes', montant: 999 }], prets: [{ preteur: 'X', montant: 100, disponible: 500, activite: 'chair', mode: 'especes' }] })], 'encore en caisse')
ok('nothing recorded after the error', (await caisseSum()) === cash1)

// ---------- 0020: investor capital allocated per flock ----------
try {
  await db.exec(readFileSync(new URL('0020_capital_par_bande.sql', MIG), 'utf8'))
  ok('migration 0020 runs', true)
} catch (e) { ok('migration 0020 runs', false, e.message); process.exit(1) }
const newInv = async (nom, montant) => {
  const id = (await as('dahirou', `insert into public.investisseurs (nom) values ($1) returning id`, [nom])).rows[0].id
  await as('dahirou', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant, activite, mode_paiement) values ($1, 'apport', $2, 'chair', 'banque')`, [id, montant])
  return id
}
const IA = await newInv('Invest A', 1000000), IB = await newInv('Invest B', 500000), IC = await newInv('Invest C', 300000)
const notif0 = (await as('dahirou', `select * from public.notifications where type_notification = 'capital_bande'`)).rows.length
const BX1 = (await one('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('BX1', current_date, 1000) returning id`)).id
const BX2 = (await one('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('BX2', current_date, 500) returning id`)).id
ok('finance reminded to allocate capital for a new flock', (await as('dahirou', `select * from public.notifications where type_notification = 'capital_bande'`)).rows.length > notif0)
const allocFn = (who, b, i, m) => as(who, `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, $3) returning id`, [b, i, m])
await expectOk('A: 600 000 in BX1', 'dahirou', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 600000)`, [BX1, IA])
await expectOk('A: 400 000 in BX2', 'ali', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 400000)`, [BX2, IA])
await expectErr('more than the free capital refused', 'dahirou', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 600000)`, [BX2, IB], 'Capital libre insuffisant')
await expectOk('B: all 500 000 in BX1 (100 / 0)', 'dahirou', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 500000)`, [BX1, IB])
await expectErr('employe cannot allocate capital', 'employe', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 1000)`, [BX2, IC])
await expectOk('kenfack allocates capital too', 'kenfack', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 100000)`, [BX2, IC])
await expectNoRows('kenfack cannot cancel an allocation', 'kenfack', `update public.capital_bandes set annulee = true, motif_annulation = 'x' where investisseur_id = '${IC}' returning id`)
const libA = await one('ali', `select capital, place, libre from public.capital_libre_investisseurs where investisseur_id = '${IA}'`)
ok('A: capital 1 000 000, placed 1 000 000, free 0', Number(libA.capital) === 1000000 && Number(libA.place) === 1000000 && Number(libA.libre) === 0, JSON.stringify(libA))
await expectErr('withdrawal of placed capital refused', 'dahirou', `insert into public.operations_investisseurs (investisseur_id, type_operation, montant, activite, mode_paiement) values ($1, 'retrait_capital', 100000, 'chair', 'banque')`, [IA], 'Retrait impossible')
const allocA1 = (await one('ali', `select id from public.capital_bandes where bande_id = '${BX1}' and investisseur_id = '${IA}'`)).id
await expectErr('allocation is locked (amount cannot change)', 'ali', `update public.capital_bandes set montant = 1 where id = $1`, [allocA1], 'bloquée')
await expectNoRows('dahirou cannot cancel an allocation', 'dahirou', `update public.capital_bandes set annulee = true, motif_annulation = 'x' where id = '${allocA1}' returning id`)
await expectErr('cancellation needs a reason', 'ali', `update public.capital_bandes set annulee = true where id = $1`, [allocA1], 'motif')
await expectOk('ali cancels with a reason', 'ali', `update public.capital_bandes set annulee = true, motif_annulation = 'Erreur de montant' where id = $1`, [allocA1])
await expectOk('A re-allocated: 600 000 in BX1', 'dahirou', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 600000)`, [BX1, IA])
// C keeps his 300 000 unallocated: earns nothing
await as('kenfack', `update public.bandes set statut = 'cloture_demandee' where id = '${BX1}'`)
await expectOk('BX1 closure validated', 'dahirou', `update public.bandes set statut = 'cloturee' where id = $1`, [BX1])
const dists = Object.fromEntries((await as('ali', `select investisseur_id, montant, capital_base from public.distributions_investisseurs where bande_id = '${BX1}'`)).rows.map((r) => [r.investisseur_id, Number(r.montant)]))
ok('BX1: A gets 10 % of 600 000, B 10 % of 500 000', dists[IA] === 60000 && dists[IB] === 50000, JSON.stringify(dists))
ok('C (nothing placed in BX1) gets nothing from BX1', !(IC in dists))
ok('after closure A has 600 000 free again', Number((await one('ali', `select libre from public.capital_libre_investisseurs where investisseur_id = '${IA}'`)).libre) === 600000)
await expectErr('no allocation on a closed flock', 'dahirou', `insert into public.capital_bandes (bande_id, investisseur_id, montant) values ($1, $2, 1000)`, [BX1, IC], 'clôturée')
await as('kenfack', `update public.bandes set statut = 'cloture_demandee' where id = '${BX2}'`)
await as('dahirou', `update public.bandes set statut = 'cloturee' where id = '${BX2}'`)
const distBX2 = (await as('ali', `select investisseur_id, montant from public.distributions_investisseurs where bande_id = '${BX2}'`)).rows
const dBX2 = Object.fromEntries(distBX2.map((r) => [r.investisseur_id, Number(r.montant)]))
ok('BX2: A 10 % of 400 000, C 10 % of 100 000 (A total = 10 % of his capital)', dBX2[IA] === 40000 && dBX2[IC] === 10000 && !(IB in dBX2), JSON.stringify(dBX2))

// ---------- 0021: chick reception creates the expense ----------
try {
  await db.exec(readFileSync(new URL('0021_poussins_depense_auto.sql', MIG), 'utf8'))
  ok('migration 0021 runs', true)
} catch (e) { ok('migration 0021 runs', false, e.message); process.exit(1) }
const FOUR = (await one('kenfack', `insert into public.tiers (type_tiers, nom) values ('fournisseur', 'Couvoir Test') returning id`)).id
const order = async (code, prix, fournisseur) => {
  await as('kenfack', `insert into public.commandes_poussins (reference, code_bande, nombre_commande, date_livraison_prevue, prix_unitaire, fournisseur_id) values ($1, $2, 300, current_date, $3, $4)`, ['REF-' + code, code, prix, fournisseur])
  return (await one('kenfack', `select l.id from public.livraisons_poussins l join public.commandes_poussins c on c.id = l.commande_id where c.code_bande = '${code}' and l.statut = 'prevue'`)).id
}
const soldeEsp = async () => Number((await one('ali', `select solde from public.soldes_caisses where activite = 'chair' and mode = 'especes'`)).solde)
const lP1 = await order('PX1', 500, FOUR)
const esp0 = await soldeEsp()
await expectOk('kenfack receives 300 chicks paid in cash', 'kenfack', `select public.receptionner_livraison($1, 300, current_date, null, 'especes')`, [lP1])
const depP1 = await one('ali', `select d.* from public.depenses d join public.livraisons_poussins l on l.depense_id = d.id where l.id = '${lP1}'`)
ok('expense created: 300 × 500 = 150 000, chicks, linked to the flock and supplier', Number(depP1?.montant) === 150000 && depP1?.categorie === 'poussins' && depP1?.bande_id && depP1?.fournisseur_id === FOUR, JSON.stringify(depP1 && { m: depP1.montant, c: depP1.categorie }))
ok('expense waits for finance validation, cash untouched', depP1?.statut === 'a_valider' && (await soldeEsp()) === esp0)
await expectOk('dahirou validates the chick expense', 'dahirou', `update public.depenses set statut = 'validee' where id = $1`, [depP1.id])
ok('cash goes out after validation', (await soldeEsp()) === esp0 - 150000)
const lP2 = await order('PX2', 400, FOUR)
await expectOk('chicks received on credit', 'kenfack', `select public.receptionner_livraison($1, 250, current_date, null, 'credit')`, [lP2])
const depP2 = await one('ali', `select d.a_credit, d.montant, d.montant_paye from public.depenses d join public.livraisons_poussins l on l.depense_id = d.id where l.id = '${lP2}'`)
ok('credit purchase: 250 × 400 = 100 000 owed to the supplier', depP2?.a_credit === true && Number(depP2.montant) === 100000 && Number(depP2.montant_paye) === 0, JSON.stringify(depP2))
const nP0 = (await as('dahirou', `select * from public.notifications where type_notification = 'depense_poussins'`)).rows.length
const lP3 = await order('PX3', null, null)
await expectOk('reception without a price still works', 'kenfack', `select public.receptionner_livraison($1, 300, current_date, null, 'especes')`, [lP3])
// ---------- 0022: employees and salaries ----------
try {
  await db.exec(readFileSync(new URL('0022_salaires.sql', MIG), 'utf8'))
  ok('migration 0022 runs', true)
} catch (e) { ok('migration 0022 runs', false, e.message); process.exit(1) }
const EMP = (await one('dahirou', `insert into public.employes (nom, poste, activite, salaire_mensuel) values ('Moussa Test', 'Gardien', 'chair', 60000) returning id`)).id
ok('kenfack cannot see salaries', (await as('kenfack', `select * from public.employes`)).rows.length === 0)
await expectErr('kenfack cannot pay an advance', 'kenfack', `select public.verser_avance($1, 10000, 'especes')`, [EMP], 'salaires')
const espS0 = await soldeEsp()
await expectOk('dahirou pays an advance of 15 000', 'dahirou', `select public.verser_avance($1, 15000, 'especes', 'Urgence')`, [EMP])
ok('advance leaves the cash at once', (await soldeEsp()) === espS0 - 15000)
await expectErr('deduction needs a reason', 'dahirou', `select public.payer_salaire($1, '2026-10-15', 'especes', 0, 5000, null)`, [EMP], 'motif')
const paie = await expectOk('dahirou pays October: 60 000 + 5 000 bonus − 2 000 deduction − 15 000 advance', 'dahirou', `select public.payer_salaire($1, '2026-10-15', 'especes', 5000, 2000, 'Absence') as id`, [EMP])
const p = await one('dahirou', `select * from public.paies where id = '${paie.rows[0].id}'`)
ok('net paid = 48 000, month stored as 01/10', Number(p.net) === 48000 && String(p.mois).startsWith('2026-10-01') || new Date(p.mois).getDate() === 1, JSON.stringify({ net: p.net, mois: p.mois }))
ok('cash: advance + net = 63 000 out in total', (await soldeEsp()) === espS0 - 63000)
ok('advance marked as deducted', (await one('dahirou', `select paie_id from public.avances_salaire where employe_id = '${EMP}'`)).paie_id === p.id)
await expectErr('same month cannot be paid twice', 'dahirou', `select public.payer_salaire($1, '2026-10-28', 'especes')`, [EMP], 'déjà payé')
await expectOk('ali cancels the salary expense', 'ali', `update public.depenses set annulee = true, motif_annulation = 'Erreur' where id = $1`, [p.depense_id])
ok('salary cancelled too, advance to deduct again', (await one('dahirou', `select annulee from public.paies where id = '${p.id}'`)).annulee === true
  && (await one('dahirou', `select paie_id from public.avances_salaire where employe_id = '${EMP}'`)).paie_id === null)
await expectOk('october can be paid again after the cancellation', 'dahirou', `select public.payer_salaire($1, '2026-10-01', 'mobile_money')`, [EMP])

ok('no price: no expense, finance reminded to enter it',!(await one('ali', `select depense_id from public.livraisons_poussins where id = '${lP3}'`)).depense_id
  && (await as('dahirou', `select * from public.notifications where type_notification = 'depense_poussins'`)).rows.length === nP0 + 1)

// ---------- 0025 + 0026: shops ----------
const oneP = async (u, sql, params) => (await as(u, sql, params)).rows[0]
try {
  await db.exec(readFileSync(new URL('0025_role_vendeur.sql', MIG), 'utf8'))
  await db.exec(readFileSync(new URL('0026_boutiques.sql', MIG), 'utf8'))
  ok('migrations 0025 + 0026 run', true)
} catch (e) { ok('migrations 0025 + 0026 run', false, e.message); process.exit(1) }
U.vendeur = '66666666-6666-6666-6666-666666666666'
await db.query(`insert into auth.users (id, email) values ($1, 'vendeurtest@henzo.local')`, [U.vendeur])
await db.exec(`update public.profiles set role = 'vendeur', nom_complet = 'Vendeur Test' where id = '${U.vendeur}'`)
const BQ = (await one('ali', `insert into public.boutiques (nom, adresse) values ('Boutique Marché', 'Garoua') returning id`)).id
const BQ2 = (await one('ali', `insert into public.boutiques (nom) values ('Boutique Gare') returning id`)).id
await expectErr('kenfack cannot create a shop', 'kenfack', `insert into public.boutiques (nom) values ('X')`)
await expectErr('kenfack cannot assign a seller', 'kenfack', `select public.affecter_boutique('vendeurtest', $1)`, [BQ], 'directeur')
await expectOk('ali assigns the seller to « Boutique Marché »', 'ali', `select public.affecter_boutique('vendeurtest', $1)`, [BQ])
const vSees = async (sql) => (await as('vendeur', sql)).rows
ok('seller sees only his shop', (await vSees(`select id from public.boutiques`)).map((r) => r.id).join() === BQ)
for (const tb of ['bandes', 'ventes', 'depenses', 'ecritures', 'soldes_caisses', 'tiers', 'mortalites', 'employes', 'investisseurs', 'journal_activite', 'notifications']) {
  ok(`seller sees nothing in ${tb}`, (await vSees(`select * from public.${tb}`)).length === 0)
}
// prices (the seller never sets them)
await expectErr('seller cannot set a price', 'vendeur', `insert into public.prix_boutique (produit, forme, unite, prix) values ('poulet', 'vivant', 'piece', 1)`)
for (const [pr, fo, un, px] of [['poulet', 'vivant', 'piece', 3500], ['poulet', 'abattu', 'kg', 2500], ['poulet', 'decoupe', 'piece', 4500], ['oeufs', '-', 'plateau', 2500], ['oeufs', '-', 'piece', 100]]) {
  await as('kenfack', `insert into public.prix_boutique (produit, forme, unite, prix) values ($1, $2, $3, $4)`, [pr, fo, un, px])
}
ok('seller sees the shop prices', (await vSees(`select * from public.prix_boutique_actuels`)).length === 5)
// shipment farm → shop
const BS1 = (await one('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('BS1', current_date - 40, 200) returning id`)).id
const eggsBefore = Number((await one('kenfack', `select stock_oeufs from public.stock_oeufs`)).stock_oeufs)
await expectErr('cannot send more birds than the flock has', 'kenfack', `select public.creer_envoi($1, $2::jsonb)`, [BQ, JSON.stringify([{ produit: 'poulet', bande_id: BS1, quantite: 500 }])], 'disponibles')
await expectErr('seller cannot create a shipment', 'vendeur', `select public.creer_envoi($1, $2::jsonb)`, [BQ, JSON.stringify([{ produit: 'poulet', bande_id: BS1, quantite: 5 }])])
const ENV = (await oneP('kenfack', `select public.creer_envoi($1, $2::jsonb) as id`, [BQ, JSON.stringify([{ produit: 'poulet', bande_id: BS1, quantite: 50 }, { produit: 'oeufs', lot_id: P1, quantite: 600 }])])).id
ok('shipment created: 50 chickens + 600 eggs', !!ENV)
ok('eggs leave the farm egg stock at once', Number((await one('kenfack', `select stock_oeufs from public.stock_oeufs`)).stock_oeufs) === eggsBefore - 600)
await expectErr('nothing to sell before reception', 'vendeur', `insert into public.ventes_boutique (boutique_id, produit, forme, unite, quantite, nombre_sujets, mode_paiement) values ($1, 'poulet', 'vivant', 'piece', 1, 1, 'especes')`, [BQ], 'Stock insuffisant')
const ligneP = (await one('vendeur', `select id from public.envois_lignes where envoi_id = '${ENV}' and produit = 'poulet'`)).id
const mort0 = Number((await one('ali', `select coalesce(sum(nombre), 0) n from public.mortalites where bande_id = '${BS1}'`)).n)
await expectOk('seller receives: 48 chickens (2 missing), all eggs', 'vendeur', `select public.recevoir_envoi($1, $2::jsonb)`, [ENV, JSON.stringify([{ ligne_id: ligneP, recu: 48 }])])
ok('2 missing chickens counted as losses of the flock', Number((await one('ali', `select coalesce(sum(nombre), 0) n from public.mortalites where bande_id = '${BS1}'`)).n) === mort0 + 2)
ok('direction and exploitation alerted of the gap', (await as('kenfack', `select * from public.notifications where type_notification = 'ecart_envoi'`)).rows.length >= 1)
const stockOf = async (pr) => Number((await one('vendeur', `select coalesce(sum(stock), 0) s from public.stock_boutiques where produit = '${pr}'`)).s)
ok('shop stock: 48 chickens, 600 eggs', (await stockOf('poulet')) === 48 && (await stockOf('oeufs')) === 600)
await expectErr('shipment cannot be received twice', 'vendeur', `select public.recevoir_envoi($1)`, [ENV], 'déjà')
// sales at the fixed price
const caisseFerme0 = await caisseSum()
const sell = (who, sql, params) => as(who, `insert into public.ventes_boutique ${sql} returning id, montant, prix_unitaire`, params)
const s1 = (await sell('vendeur', `(boutique_id, produit, forme, unite, quantite, nombre_sujets, prix_unitaire, mode_paiement, client_nom) values ($1, 'poulet', 'vivant', 'piece', 3, 3, 1, 'especes', 'Client A')`, [BQ])).rows[0]
ok('price typed by the seller is ignored: 3 × 3 500 = 10 500', Number(s1.prix_unitaire) === 3500 && Number(s1.montant) === 10500, JSON.stringify(s1))
const s2 = (await sell('vendeur', `(boutique_id, produit, forme, unite, quantite, nombre_sujets, mode_paiement) values ($1, 'poulet', 'abattu', 'kg', 4.5, 2, 'especes')`, [BQ])).rows[0]
ok('2 slaughtered chickens, 4.5 kg × 2 500 = 11 250', Number(s2.montant) === 11250)
const s3 = (await sell('vendeur', `(boutique_id, produit, unite, quantite, mode_paiement) values ($1, 'oeufs', 'plateau', 2, 'mobile_money')`, [BQ])).rows[0]
ok('2 trays (60 eggs) × 2 500 = 5 000', Number(s3.montant) === 5000)
ok('shop stock now 43 chickens, 540 eggs', (await stockOf('poulet')) === 43 && (await stockOf('oeufs')) === 540)
const vBS1 = await one('ali', `select coalesce(sum(nombre_sujets), 0) n, coalesce(sum(montant), 0) m from public.ventes where bande_id = '${BS1}' and boutique_id is not null and not annulee`)
ok('shop sales counted in the origin flock (5 birds, 21 750 F)', Number(vBS1.n) === 5 && Number(vBS1.m) === 21750, JSON.stringify(vBS1))
ok('farm cash boxes untouched by shop sales', (await caisseSum()) === caisseFerme0)
const sol = Object.fromEntries((await vSees(`select mode || '/' || activite k, solde from public.soldes_boutiques`)).map((r) => [r.k, Number(r.solde)]))
ok('shop cash: 21 750 cash (chicken), 5 000 Mobile Money (eggs)', sol['especes/chair'] === 21750 && sol['mobile_money/pondeuse'] === 5000, JSON.stringify(sol))
await expectErr('no price fixed → refused', 'vendeur', `insert into public.ventes_boutique (boutique_id, produit, unite, quantite, nombre_sujets, mode_paiement) values ($1, 'poule_reformee', 'piece', 1, 1, 'especes')`, [BQ], 'Pas de prix')
await expectErr('more than the stock → refused', 'vendeur', `insert into public.ventes_boutique (boutique_id, produit, forme, unite, quantite, nombre_sujets, mode_paiement) values ($1, 'poulet', 'vivant', 'piece', 100, 100, 'especes')`, [BQ], 'Stock insuffisant')
await expectErr('credit sale impossible', 'vendeur', `insert into public.ventes_boutique (boutique_id, produit, forme, unite, quantite, nombre_sujets, mode_paiement) values ($1, 'poulet', 'vivant', 'piece', 1, 1, 'credit')`, [BQ])
await expectErr('seller cannot sell for another shop', 'vendeur', `insert into public.ventes_boutique (boutique_id, produit, forme, unite, quantite, nombre_sujets, mode_paiement) values ($1, 'poulet', 'vivant', 'piece', 1, 1, 'especes')`, [BQ2])
await expectNoRows('seller cannot cancel a sale', 'vendeur', `update public.ventes_boutique set annulee = true, motif_annulation = 'x' where id = '${s1.id}' returning id`)
await expectErr('flock cannot be closed while its birds are in the shop', 'kenfack', `update public.bandes set statut = 'cloture_demandee' where id = $1`, [BS1], 'en boutique')
// losses, inventory
await expectErr('loss needs a reason', 'vendeur', `select public.declarer_perte_boutique($1, 'poulet', 1, '')`, [BQ], 'motif')
await expectOk('seller declares 1 dead chicken', 'vendeur', `select public.declarer_perte_boutique($1, 'poulet', 1, 'Mort dans la cage')`, [BQ])
await expectOk('inventory: 40 chickens counted (2 missing)', 'vendeur', `select public.inventaire_boutique($1, 'poulet', 40)`, [BQ])
ok('stock 40, the 3 lost birds are losses of the flock', (await stockOf('poulet')) === 40
  && Number((await one('ali', `select coalesce(sum(nombre), 0) n from public.mortalites where bande_id = '${BS1}'`)).n) === mort0 + 5)
// evening closing
const ec = (await as('vendeur', `select public.cloturer_journee($1, 21000, 'Billet abîmé') as e`, [BQ])).rows[0].e
ok('closing: 21 000 counted for 21 750 expected → gap −750 reported', Number(ec) === -750
  && (await as('dahirou', `select * from public.notifications where type_notification = 'ecart_caisse_boutique'`)).rows.length >= 1)
// deposit to the farm, validated by finance
await expectErr('deposit above the shop cash refused', 'vendeur', `select public.demander_versement($1, 'especes', 30000, 0)`, [BQ], 'supérieur')
const VER = (await oneP('vendeur', `select public.demander_versement($1, 'especes', 21750, 0) as id`, [BQ])).id
await expectErr('kenfack cannot validate a deposit', 'kenfack', `select public.valider_versement($1, true)`, [VER], 'finance')
const espF0 = await soldeEsp()
await expectOk('dahirou validates the deposit', 'dahirou', `select public.valider_versement($1, true)`, [VER])
ok('farm cash chicken/cash +21 750, shop cash chicken back to 0', (await soldeEsp()) === espF0 + 21750
  && Number((await one('vendeur', `select solde from public.soldes_boutiques where mode = 'especes' and activite = 'chair'`)).solde) === 0)
// cancellation by the director
await expectOk('ali cancels the egg sale', 'ali', `update public.ventes_boutique set annulee = true, motif_annulation = 'Erreur de produit' where id = $1`, [s3.id])
ok('egg sale cancelled: origin sale cancelled, 60 eggs back, shop Mobile Money back to 0', (await stockOf('oeufs')) === 600
  && (await one('ali', `select bool_and(annulee) a from public.ventes where vente_boutique_id = '${s3.id}'`)).a === true
  && Number((await one('vendeur', `select solde from public.soldes_boutiques where mode = 'mobile_money' and activite = 'pondeuse'`)).solde) === 0)
ok('staff still see the farm normally', (await as('kenfack', `select * from public.bandes`)).rows.length > 2 && (await as('ali', `select * from public.ventes`)).rows.length > 0)

// ---------- 0027: who ships, who confirms ----------
try {
  await db.exec(readFileSync(new URL('0027_envois_roles.sql', MIG), 'utf8'))
  ok('migration 0027 runs', true)
} catch (e) { ok('migration 0027 runs', false, e.message); process.exit(1) }
const lignes1 = JSON.stringify([{ produit: 'poulet', bande_id: BS1, quantite: 2 }])
await expectErr('ali does not ship goods', 'ali', `select public.creer_envoi($1, $2::jsonb)`, [BQ, lignes1], 'exploitation')
await expectOk('an employee can ship goods', 'employe', `select public.creer_envoi($1, $2::jsonb)`, [BQ, lignes1])
const ENV2 = (await oneP('kenfack', `select public.creer_envoi($1, $2::jsonb) as id`, [BQ, lignes1])).id
await expectErr('ali does not confirm a reception', 'ali', `select public.recevoir_envoi($1)`, [ENV2], 'vendeur')
await expectErr('kenfack does not confirm a reception', 'kenfack', `select public.recevoir_envoi($1)`, [ENV2], 'vendeur')
await expectOk('the seller confirms the reception', 'vendeur', `select public.recevoir_envoi($1)`, [ENV2])

// ---------- 0028: price typed on the spot, within a range ----------
try {
  await db.exec(readFileSync(new URL('0028_prix_boutique_plages.sql', MIG), 'utf8'))
  ok('migration 0028 runs', true)
} catch (e) { ok('migration 0028 runs', false, e.message); process.exit(1) }
const plage = await one('vendeur', `select prix_min, prix_max from public.prix_boutique_actuels where produit = 'poulet' and forme = 'vivant' and unite = 'piece'`)
ok('starting range for a whole chicken: 3 500 – 5 000', Number(plage.prix_min) === 3500 && Number(plage.prix_max) === 5000, JSON.stringify(plage))
const VB = `insert into public.ventes_boutique (boutique_id, produit, forme, unite, quantite, nombre_sujets, prix_unitaire, mode_paiement) values ($1, $2, $3, $4, $5, $6, $7, 'especes') returning montant`
const r1 = await as('vendeur', VB, [BQ, 'poulet', 'vivant', 'piece', 1, 1, 4200])
ok('seller sells a chicken at 4 200 (inside the range)', Number(r1.rows[0].montant) === 4200)
await expectErr('price under 3 500 refused', 'vendeur', VB, [BQ, 'poulet', 'vivant', 'piece', 1, 1, 3000], 'entre')
await expectErr('price over 5 000 refused', 'vendeur', VB, [BQ, 'poulet', 'abattu', 'piece', 1, 1, 5500], 'entre')
await expectErr('price missing refused', 'vendeur', VB, [BQ, 'poulet', 'decoupe', 'piece', 1, 1, null], 'Entrez')
const r2 = await as('kenfack', VB, [BQ, 'poulet', 'abattu', 'kg', 4, 2, 2800])
ok('kenfack sells by the kilo at the price he types: 4 kg × 2 800 = 11 200', Number(r2.rows[0].montant) === 11200)
await expectErr('kilo price missing refused', 'vendeur', VB, [BQ, 'poulet', 'vivant', 'kg', 3, 1, null], 'kilo')
await expectErr('seller cannot set a range', 'vendeur', `insert into public.prix_boutique (produit, forme, unite, prix_min, prix_max) values ('oeufs', '-', 'plateau', 1, 9999)`)
await expectErr('no range by the kilo', 'kenfack', `insert into public.prix_boutique (produit, forme, unite, prix_min, prix_max) values ('poulet', 'vivant', 'kg', 1000, 3000)`)
await expectOk('kenfack sets the egg tray range 2 000 – 2 600', 'kenfack', `insert into public.prix_boutique (produit, forme, unite, prix_min, prix_max) values ('oeufs', '-', 'plateau', 2000, 2600)`)
const r3 = await as('vendeur', VB, [BQ, 'oeufs', null, 'plateau', 1, null, 2400])
ok('egg tray sold at 2 400', Number(r3.rows[0].montant) === 2400)
await expectErr('egg tray at 3 000 refused', 'vendeur', VB, [BQ, 'oeufs', null, 'plateau', 1, null, 3000], 'entre')

// ---------- 0029: the director neither sells nor validates ----------
try {
  await db.exec(readFileSync(new URL('0029_boutique_sans_directeur.sql', MIG), 'utf8'))
  ok('migration 0029 runs', true)
} catch (e) { ok('migration 0029 runs', false, e.message); process.exit(1) }
await expectErr('ali does not sell in a shop', 'ali', VB, [BQ, 'poulet', 'vivant', 'piece', 1, 1, 4000], 'vendre')
await expectOk('kenfack still sells in a shop', 'kenfack', VB, [BQ, 'poulet', 'vivant', 'piece', 1, 1, 4000])
const VER2 = (await oneP('vendeur', `select public.demander_versement($1, 'especes', 1000, 0) as id`, [BQ])).id
await expectErr('ali does not validate a deposit', 'ali', `select public.valider_versement($1, true)`, [VER2], 'Dahirou')
await expectOk('dahirou validates it', 'dahirou', `select public.valider_versement($1, true)`, [VER2])
ok('shop access is a clear no for a non-seller', (await one('employe', `select public.acces_boutique('${BQ}') a`)).a === false)
await expectErr('employee cannot declare a shop loss', 'employe', `select public.declarer_perte_boutique($1, 'poulet', 1, 'x')`, [BQ])
await expectErr('employee cannot close the shop day', 'employe', `select public.cloturer_journee($1, 0, null)`, [BQ])
await expectErr('employee cannot request a deposit', 'employe', `select public.demander_versement($1, 'especes', 100, 0)`, [BQ])

// ---------- 0030: salaries paid by finance only, administration space ----------
try {
  await db.exec(readFileSync(new URL('0030_salaires_finance_administration.sql', MIG), 'utf8'))
  ok('migration 0030 runs', true)
} catch (e) { ok('migration 0030 runs', false, e.message); process.exit(1) }
await expectErr('ali does not pay an advance', 'ali', `select public.verser_avance($1, 5000, 'especes')`, [EMP], 'Dahirou')
await expectErr('ali does not pay a salary', 'ali', `select public.payer_salaire($1, '2026-12-01', 'especes')`, [EMP], 'Dahirou')
await expectOk('dahirou still pays an advance', 'dahirou', `select public.verser_avance($1, 5000, 'especes')`, [EMP])
ok('ali still sees the salaries', (await as('ali', `select * from public.paies`)).rows.length > 0)
await expectErr('kenfack cannot add a deadline', 'kenfack', `insert into public.admin_echeances (titre, date_echeance) values ('x', current_date)`)
await expectErr('dahirou cannot add a document', 'dahirou', `insert into public.admin_documents (titre) values ('x')`)
await expectOk('ali adds a deadline in 3 days (reminder 7 days before)', 'ali', `insert into public.admin_echeances (titre, categorie, date_echeance, rappel_jours, montant) values ('Impôt libératoire', 'impots', current_date + 3, 7, 50000)`)
await expectOk('ali adds a yearly deadline due today', 'ali', `insert into public.admin_echeances (titre, date_echeance, recurrence) values ('Patente', current_date, 'annuelle')`)
await expectOk('ali adds a document expiring in 10 days', 'ali', `insert into public.admin_documents (titre, categorie, date_expiration) values ('Attestation de conformité fiscale', 'impots', current_date + 10)`)
await expectOk('ali adds a land', 'ali', `insert into public.admin_terrains (nom, localisation, surface_m2, prix, statut) values ('Terrain Nkolbisson', 'Yaoundé', 2500, 15000000, 'en_cours')`)
await expectOk('ali adds a bank account', 'ali', `insert into public.admin_comptes_bancaires (banque, intitule, agence) values ('Afriland', 'HENZO SARL', 'Yaoundé centre')`)
ok('dahirou sees nothing of the administration', (await as('dahirou', `select * from public.admin_echeances`)).rows.length === 0
  && (await as('dahirou', `select * from public.admin_terrains`)).rows.length === 0 && (await as('kenfack', `select * from public.admin_comptes_bancaires`)).rows.length === 0)
ok('dahirou cannot trigger the reminders', Number((await one('dahirou', `select public.rappels_administration() n`)).n) === 0)
const nRap = Number((await one('ali', `select public.rappels_administration() n`)).n)
ok('3 reminders sent (2 deadlines, 1 document)', nRap === 3, String(nRap))
ok('the director is notified', (await as('ali', `select * from public.notifications where type_notification in ('echeance_admin', 'document_expire')`)).rows.length === 3)
ok('no second reminder the same day', Number((await one('ali', `select public.rappels_administration() n`)).n) === 0)
await expectOk('ali ticks the yearly deadline as done', 'ali', `update public.admin_echeances set faite = true where titre = 'Patente'`)
const suiv = await as('ali', `select date_echeance = (current_date + interval '1 year')::date bon, faite from public.admin_echeances where titre = 'Patente' order by date_echeance`)
ok('next year\'s deadline created automatically', suiv.rows.length === 2 && suiv.rows[0].faite === true && suiv.rows[1].bon === true && suiv.rows[1].faite === false, JSON.stringify(suiv.rows))
await expectOk('ali moves the tax deadline', 'ali', `update public.admin_echeances set date_echeance = current_date + 2 where titre = 'Impôt libératoire'`)
ok('moving a deadline sends its reminder again', Number((await one('ali', `select public.rappels_administration() n`)).n) === 1)

// ---------- 0031: finance sees the bank accounts ----------
try {
  await db.exec(readFileSync(new URL('0031_banques_finance.sql', MIG), 'utf8'))
  ok('migration 0031 runs', true)
} catch (e) { ok('migration 0031 runs', false, e.message); process.exit(1) }
ok('dahirou sees the bank accounts', (await as('dahirou', `select * from public.admin_comptes_bancaires`)).rows.length === 1)
await expectOk('dahirou adds a bank account', 'dahirou', `insert into public.admin_comptes_bancaires (banque, intitule) values ('UBA', 'HENZO SARL')`)
await expectOk('dahirou edits a bank account', 'dahirou', `update public.admin_comptes_bancaires set agence = 'Bastos' where banque = 'UBA'`)
ok('kenfack still sees no bank account', (await as('kenfack', `select * from public.admin_comptes_bancaires`)).rows.length === 0)
ok('dahirou still sees no deadline nor document', (await as('dahirou', `select * from public.admin_echeances`)).rows.length === 0
  && (await as('dahirou', `select * from public.admin_documents`)).rows.length === 0)

// ---------- 0032: land visible to operations and finance (read-only) ----------
try {
  await db.exec(readFileSync(new URL('0032_terrains_lecture.sql', MIG), 'utf8'))
  ok('migration 0032 runs', true)
} catch (e) { ok('migration 0032 runs', false, e.message); process.exit(1) }
ok('kenfack and dahirou see the land', (await as('kenfack', `select * from public.admin_terrains`)).rows.length === 1
  && (await as('dahirou', `select * from public.admin_terrains`)).rows.length === 1)
await expectErr('kenfack cannot add land', 'kenfack', `insert into public.admin_terrains (nom) values ('x')`)
await expectNoRows('dahirou cannot edit land', 'dahirou', `update public.admin_terrains set prix = 1 returning id`)
await expectNoRows('kenfack cannot delete land', 'kenfack', `delete from public.admin_terrains returning id`)
await expectOk('ali still edits land', 'ali', `update public.admin_terrains set statut = 'achete'`)
ok('the employee sees no land', (await as('employe', `select * from public.admin_terrains`)).rows.length === 0)

// ---------- 0033: everyone in their own domain ----------
try {
  await db.exec(readFileSync(new URL('0033_domaines.sql', MIG), 'utf8'))
  ok('migration 0033 runs', true)
} catch (e) { ok('migration 0033 runs', false, e.message); process.exit(1) }
const DOM = (await one('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('DOM1', current_date - 10, 300) returning id`)).id
ok('kenfack still creates a flock', !!DOM)
await expectErr('ali does not create a flock', 'ali', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('DOM2', current_date, 100)`)
await expectErr('ali does not record a mortality', 'ali', `insert into public.mortalites (bande_id, nombre) values ($1, 1)`, [DOM])
await expectOk('kenfack still records a mortality', 'kenfack', `insert into public.mortalites (bande_id, nombre) values ($1, 1)`, [DOM])
await expectOk('the employee still records a mortality', 'employe', `insert into public.mortalites (bande_id, nombre) values ($1, 1)`, [DOM])
await expectNoRows('ali does not correct a mortality', 'ali', `update public.mortalites set nombre = 9 where bande_id = '${DOM}' returning id`)
await expectErr('ali does not record a farm sale', 'ali', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, 'poulets', 'piece', 1, 3000, 1, 'especes')`, [DOM])
await expectErr('ali does not create a stock product', 'ali', `insert into public.articles (nom, categorie, unite) values ('x', 'autre', 'piece')`)
await expectErr('ali does not add a building', 'ali', `insert into public.batiments (nom) values ('Bâtiment Ali')`)
await expectErr('ali does not plan a task', 'ali', `insert into public.taches (titre, type_tache, date_prevue) values ('x', 'autre', current_date)`)
await expectErr('ali does not edit a flock', 'ali', `update public.bandes set nombre_initial = 1 where id = $1`, [DOM], 'exploitation')
await expectErr('ali does not request a closure', 'ali', `update public.bandes set statut = 'cloture_demandee' where id = $1`, [DOM])
await expectOk('kenfack requests the closure', 'kenfack', `update public.bandes set statut = 'cloture_demandee' where id = $1`, [DOM])
await expectOk('ali can still refuse a closure (finance side)', 'ali', `update public.bandes set statut = 'en_cours' where id = $1`, [DOM])
await expectErr('ali does not grant client credit', 'ali', `update public.tiers set credit_autorise = true, plafond_credit = 1000 where nom = 'Client B'`, [], 'Kenfack')
await expectErr('ali does not buy feed into stock', 'ali', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, article_id, quantite, fournisseur_id) values ('ferme', 'chair', 'aliment', 'x', 1000, 'especes', $1, 1, $2)`, [ART, FOU], 'Kenfack')
await expectOk('ali still records a general expense (finance side)', 'ali', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('generale', 'chair', 'fonctionnement', 'Frais de banque', 2000, 'banque')`)
ok('ali still sees everything on the farm', (await as('ali', `select * from public.mortalites`)).rows.length > 0 && (await as('ali', `select * from public.lots_pondeuses`)).rows.length > 0
  && (await as('ali', `select * from public.articles`)).rows.length > 0)
const TD = (await one('kenfack', `insert into public.taches (titre, type_tache, date_prevue, assigne_role) values ('Signer le contrat', 'autre', current_date, 'directeur') returning id`)).id
const TE = (await one('kenfack', `insert into public.taches (titre, type_tache, date_prevue, assigne_role) values ('Nettoyer', 'nettoyage', current_date, 'employe') returning id`)).id
await expectErr('ali does not tick an employee task', 'ali', `insert into public.taches_realisations (tache_id) values ($1)`, [TE])
await expectOk('ali ticks a task assigned to the direction', 'ali', `insert into public.taches_realisations (tache_id) values ($1)`, [TD])
// team managed by kenfack, salaries hidden
const NEW = (await oneP('kenfack', `select public.ajouter_employe($1, $2, $3) as id`, ['Moussa', '690000000', 'Gardien'])).id
ok('kenfack adds an employee', !!NEW)
const eq = await as('kenfack', `select * from public.equipe where id = $1`, [NEW])
ok('kenfack sees the team without salaries', eq.rows.length === 1 && !('salaire_mensuel' in eq.rows[0]) && eq.rows[0].poste === 'Gardien')
ok('kenfack still cannot read the salary table', (await as('kenfack', `select * from public.employes`)).rows.length === 0)
ok('dahirou is told to set the salary', (await as('dahirou', `select * from public.notifications where type_notification = 'nouvel_employe'`)).rows.length === 1)
await expectOk('kenfack changes the job', 'kenfack', `select public.modifier_employe($1, 'Moussa', '690000000', 'Chef d''équipe', true)`, [NEW])
ok('dahirou is told about the new job', (await as('dahirou', `select * from public.notifications where type_notification = 'poste_employe'`)).rows.length === 1)
await expectNoRows('kenfack cannot change a salary', 'kenfack', `update public.employes set salaire_mensuel = 999999 where id = '${NEW}' returning id`)
await expectErr('dahirou does not use the team form', 'dahirou', `select public.ajouter_employe('x')`, [], 'Kenfack')
await expectOk('dahirou sets the salary', 'dahirou', `update public.employes set salaire_mensuel = 50000 where id = $1`, [NEW])
ok('the employee account sees no team', (await as('employe', `select * from public.equipe`)).rows.length === 0)

// ---------- 0034: shop closing by the seller, employees, farm prices ----------
try {
  await db.exec(readFileSync(new URL('0034_domaines_fin.sql', MIG), 'utf8'))
  ok('migration 0034 runs', true)
} catch (e) { ok('migration 0034 runs', false, e.message); process.exit(1) }
await expectErr('dahirou does not close the shop day', 'dahirou', `select public.cloturer_journee($1, 0, null)`, [BQ], 'vendeur')
await expectErr('ali does not close the shop day', 'ali', `select public.cloturer_journee($1, 0, null)`, [BQ], 'vendeur')
await expectErr('dahirou does not declare a deposit', 'dahirou', `select public.demander_versement($1, 'especes', 100, 0)`, [BQ], 'vendeur')
await expectOk('the seller closes the day', 'vendeur', `select public.cloturer_journee($1, 0, null)`, [BQ])
const VER3 = (await oneP('vendeur', `select public.demander_versement($1, 'especes', 500, 0) as id`, [BQ])).id
await expectOk('dahirou validates the seller deposit', 'dahirou', `select public.valider_versement($1, true)`, [VER3])
await expectErr('dahirou does not add an employee directly', 'dahirou', `insert into public.employes (nom, salaire_mensuel) values ('x', 1000)`)
await expectErr('ali does not add an employee', 'ali', `insert into public.employes (nom, salaire_mensuel) values ('x', 1000)`)
await expectErr('dahirou does not change the job', 'dahirou', `update public.employes set poste = 'Chauffeur' where id = $1`, [NEW], 'Kenfack')
await expectOk('dahirou changes the salary', 'dahirou', `update public.employes set salaire_mensuel = 55000, activite = 'pondeuse' where id = $1`, [NEW])
await expectNoRows('ali does not change a salary', 'ali', `update public.employes set salaire_mensuel = 1 where id = '${NEW}' returning id`)
ok('ali still sees the employees', (await as('ali', `select * from public.employes`)).rows.length > 0)
await expectOk('kenfack still changes the job', 'kenfack', `select public.modifier_employe($1, 'Moussa', null, 'Chauffeur', true)`, [NEW])
await expectOk('kenfack still sets a farm price', 'kenfack', `insert into public.prix_vente (produit, unite, prix) values ('poulets', 'piece', 3200)`)
await expectErr('dahirou does not set a farm price', 'dahirou', `insert into public.prix_vente (produit, unite, prix) values ('poulets', 'piece', 1)`)
await expectErr('ali does not set a farm price', 'ali', `insert into public.prix_vente (produit, unite, prix) values ('poulets', 'piece', 1)`)
await expectOk('dahirou still sets a shop price range', 'dahirou', `insert into public.prix_boutique (produit, forme, unite, prix_min, prix_max) values ('poule_reformee', 'vivant', 'piece', 2000, 3000)`)

// ---------- 0035: invoices and taxes ----------
try {
  await db.exec(readFileSync(new URL('0035_factures_impots.sql', MIG), 'utf8'))
  ok('migration 0035 runs', true)
} catch (e) { ok('migration 0035 runs', false, e.message); process.exit(1) }
await expectErr('kenfack cannot edit the company sheet', 'kenfack', `select public.maj_societe('{"niu":"X"}'::jsonb)`, [], 'finance')
await expectOk('dahirou fills the company sheet', 'dahirou', `select public.maj_societe($1::jsonb)`, [JSON.stringify({ raison_sociale: 'HENZO SARL', niu: 'M012345678901A', rccm: 'RC/YAO/2026/B/1234', capital_social: '1500000', adherent_cga: true })])
const soc = await one('ali', `select raison_sociale, niu, capital_social, adherent_cga, regime_fiscal, assujetti_tva from public.fermes where id = public.ferme_actuelle()`)
ok('company sheet saved', soc.raison_sociale === 'HENZO SARL' && soc.niu === 'M012345678901A' && Number(soc.capital_social) === 1500000 && soc.adherent_cga === true && soc.regime_fiscal === 'reel' && soc.assujetti_tva === false, JSON.stringify(soc))
await expectOk('an empty legal form keeps SARL', 'dahirou', `select public.maj_societe('{"forme_juridique":"","taux_tva":""}'::jsonb)`)
ok('legal form still SARL', (await one('ali', `select forme_juridique from public.fermes where id = public.ferme_actuelle()`)).forme_juridique === 'SARL')
await expectOk('client gets a NIU', 'kenfack', `update public.tiers set niu = 'P098765432109Z' where nom = 'Client B'`)
const CLB = (await one('kenfack', `select id from public.tiers where nom = 'Client B'`)).id
const vente = async (n, prix, client = CLB) => (await oneP('kenfack', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement, montant_encaisse) values ($1, $2, 'poulets', 'piece', $3, $4, $6, 'especes', $5) returning id`, [DOM, client, n, prix, n * prix, n])).id
const VF1 = await vente(10, 3500), VF2 = await vente(4, 3500)
await expectErr('the employee cannot invoice', 'employe', `select public.creer_facture($1::uuid[])`, [[VF1]])
const F1 = (await oneP('kenfack', `select public.creer_facture($1::uuid[]) as id`, [[VF1, VF2]])).id
const f1 = await oneP('dahirou', `select numero, client_nom, client_niu, total_ht, total_tva, total_ttc, tva_applicable from public.factures where id = $1`, [F1])
ok('invoice FA-<year>-0001 for Client B, 49 000 F, no VAT', /^FA-\d{4}-0001$/.test(f1.numero) && f1.client_nom === 'Client B' && f1.client_niu === 'P098765432109Z'
  && Number(f1.total_ttc) === 49000 && Number(f1.total_ht) === 49000 && Number(f1.total_tva) === 0 && f1.tva_applicable === false, JSON.stringify(f1))
ok('two lines with a clear description', (await as('dahirou', `select designation from public.facture_lignes where facture_id = $1 order by ordre`, [F1])).rows.every((r) => r.designation.startsWith('Poulets de chair (bande DOM1)')))
ok('nothing left to collect (paid cash)', Number((await oneP('dahirou', `select reste from public.factures_situation where id = $1`, [F1])).reste) === 0)
await expectErr('a sale is invoiced only once', 'kenfack', `select public.creer_facture($1::uuid[])`, [[VF1]], 'déjà facturée')
const VOther = (await oneP('kenfack', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement, montant_encaisse) values ($1, 'poulets', 'piece', 1, 3500, 1, 'especes', 3500) returning id`, [DOM])).id
await expectErr('one invoice = one client', 'kenfack', `select public.creer_facture($1::uuid[])`, [[VF1, VOther]], 'même client')
await expectErr('a walk-in sale needs a client name', 'kenfack', `select public.creer_facture($1::uuid[])`, [[VOther]], 'nom du client')
await expectErr('a date before the last invoice is refused', 'kenfack', `select public.creer_facture($1::uuid[], current_date - 1, 'Passant')`, [[VOther]])
await expectOk('walk-in sale invoiced with a name', 'kenfack', `select public.creer_facture($1::uuid[], current_date, 'Restaurant Le Palmier')`, [[VOther]])
await expectErr('an invoiced sale cannot be cancelled', 'ali', `update public.ventes set annulee = true, motif_annulation = 'x' where id = $1`, [VF1], 'facture')
await expectOk('dahirou turns VAT on', 'dahirou', `select public.maj_societe('{"assujetti_tva":true}'::jsonb)`)
const VF3 = await vente(10, 3500)
const F3 = (await oneP('dahirou', `select public.creer_facture($1::uuid[]) as id`, [[VF3]])).id
const f3 = await oneP('dahirou', `select numero, total_ht, total_tva, total_ttc from public.factures where id = $1`, [F3])
ok('with VAT 19.25 %: 35 000 TTC = 29 350 HT + 5 650 VAT, number 0003', Number(f3.total_ttc) === 35000 && Number(f3.total_ht) === 29350 && Number(f3.total_tva) === 5650 && /-0003$/.test(f3.numero), JSON.stringify(f3))
await expectErr('kenfack cannot cancel an invoice', 'kenfack', `select public.annuler_facture($1, 'x')`, [F1], 'directeur')
await expectErr('cancelling needs a reason', 'ali', `select public.annuler_facture($1, '')`, [F1], 'motif')
await expectOk('ali cancels the invoice', 'ali', `select public.annuler_facture($1, 'Erreur de client')`, [F1])
await expectOk('the sale can be invoiced again', 'kenfack', `select public.creer_facture($1::uuid[])`, [[VF1]])
ok('numbers never reuse a cancelled one', (await as('ali', `select numero from public.factures where ferme_id = public.ferme_actuelle() order by sequence`)).rows.map((r) => r.numero.slice(-4)).join(',') === '0001,0002,0003,0004')
await expectOk('dahirou turns VAT back off', 'dahirou', `select public.maj_societe('{"assujetti_tva":false}'::jsonb)`)
ok('monthly turnover is available', Number((await one('dahirou', `select coalesce(sum(chiffre_affaires), 0) ca from public.chiffre_affaires_mensuel where mois = date_trunc('month', current_date)::date`)).ca) >= 87500)
ok('IGS scale has 10 classes', (await as('dahirou', `select * from public.bareme_igs`)).rows.length === 10)
await expectErr('kenfack cannot pay a tax', 'kenfack', `select public.payer_impot('acompte_is', current_date, 1925, 'especes')`, [], 'finance')
const PI = (await oneP('dahirou', `select public.payer_impot('acompte_is', current_date, 1925, 'banque', 'chair', current_date, 'Q-2026-001') as id`)).id
const depImpot = await oneP('dahirou', `select d.categorie, d.statut, d.montant, d.montant_paye, d.fournisseur_id from public.paiements_impots p join public.depenses d on d.id = p.depense_id where p.id = $1`, [PI])
ok('a tax payment is a validated "taxes" expense without supplier', depImpot.categorie === 'impots_taxes' && depImpot.statut === 'validee' && Number(depImpot.montant_paye) === 1925 && depImpot.fournisseur_id === null, JSON.stringify(depImpot))
await expectOk('a big tax payment needs no supplier', 'dahirou', `select public.payer_impot('solde_is', current_date, 900000, 'banque')`)
ok('the employee sees no invoice', (await as('employe', `select * from public.factures`)).rows.length === 0)

// ---------- 0036: payslips ----------
try {
  await db.exec(readFileSync(new URL('0036_paie.sql', MIG), 'utf8'))
  ok('migration 0036 runs', true)
} catch (e) { ok('migration 0036 runs', false, e.message); process.exit(1) }
const calc = async (base, primes = 0) => (await db.query(`select public.calculer_paie((select id from public.fermes order by created_at limit 1), $1, $2) as b`, [base, primes])).rows[0].b
const b100 = await calc(100000)
ok('100 000 F: CNPS 4 200, IRPP 2 413, CAC 241, CFC 1 000, RAV 750, TDL 500 = 9 104 withheld',
  b100.cnps_salarie === 4200 && b100.irpp === 2413 && b100.cac === 241 && b100.cfc_salarie === 1000 && b100.rav === 750 && b100.tdl === 500 && b100.total_retenues === 9104, JSON.stringify(b100))
ok('100 000 F: employer pays 15 450 (CNPS 4 200 + 7 000 + 1 750, CFC 1 500, FNE 1 000)', b100.total_patronal === 15450, JSON.stringify(b100))
const b1m = await calc(900000, 100000)
ok('1 000 000 F: CNPS capped at 750 000 (31 500), IRPP 144 392 (progressive scale)', b1m.base_cnps === 750000 && b1m.cnps_salarie === 31500 && b1m.irpp === 144392 && b1m.rav === 12350 && b1m.tdl === 2500, JSON.stringify(b1m))
const b50 = await calc(50000)
ok('50 000 F: no IRPP, RAV or TDL (below thresholds)', b50.irpp === 0 && b50.rav === 0 && b50.tdl === 0 && b50.total_retenues === 2600, JSON.stringify(b50))
await expectErr('kenfack cannot preview a payslip', 'kenfack', `select public.simuler_paie($1)`, [NEW])
const sim = (await oneP('dahirou', `select public.simuler_paie($1) as s`, [NEW])).s
ok('dahirou previews Moussa (55 000 F): 3 610 withheld', sim.declare_cnps === true && sim.total_retenues === 3610, JSON.stringify(sim))
const PAIE = (await oneP('dahirou', `select public.payer_salaire($1, '2026-11-01', 'especes') as id`, [NEW])).id
const pa = await oneP('dahirou', `select p.net, p.retenues_legales, d.montant from public.paies p join public.depenses d on d.id = p.depense_id where p.id = $1`, [PAIE])
ok('the cash box pays only the net: 55 000 − 3 610 = 51 390', Number(pa.net) === 51390 && Number(pa.retenues_legales) === 3610 && Number(pa.montant) === 51390, JSON.stringify(pa))
const bu = await oneP('ali', `select brut, net_a_payer, total_patronal from public.bulletins_paie where paie_id = $1`, [PAIE])
ok('a payslip is kept, ali sees it', Number(bu.brut) === 55000 && Number(bu.net_a_payer) === 51390, JSON.stringify(bu))
ok('kenfack sees no payslip', (await as('kenfack', `select * from public.bulletins_paie`)).rows.length === 0)
const ch = await one('dahirou', `select a_reverser_cnps, a_reverser_impots from public.charges_salaires_mensuelles where mois = '2026-11-01'`)
ok('to pay over: CNPS 2 310 + 2 310 + 3 850 + 963 = 9 433; taxes 550 + 825 + 550 + 750 = 2 675', Number(ch.a_reverser_cnps) === 9433 && Number(ch.a_reverser_impots) === 2675, JSON.stringify(ch))
await expectOk('dahirou pays the CNPS for November', 'dahirou', `select public.payer_impot('cnps', '2026-11-01', 9433, 'banque')`)
ok('the CNPS payment is a "social contributions" expense', (await one('dahirou', `select d.categorie from public.paiements_impots p join public.depenses d on d.id = p.depense_id where p.type_impot = 'cnps'`)).categorie === 'cotisations_sociales')
await expectOk('dahirou marks an employee as not declared', 'dahirou', `update public.employes set declare_cnps = false, numero_cnps = null where id = $1`, [EMP])
await expectNoRows('kenfack cannot change the CNPS declaration', 'kenfack', `update public.employes set declare_cnps = false where id = '${NEW}' returning id`)
await expectOk('dahirou sets a CNPS number', 'dahirou', `update public.employes set numero_cnps = '123456789' where id = $1`, [NEW])
await expectErr('kenfack cannot change pay settings', 'kenfack', `select public.maj_parametres_paie('{"taux_accidents_travail":"2.5"}'::jsonb)`, [], 'finance')
await expectOk('dahirou sets the accident rate to 2.5 %', 'dahirou', `select public.maj_parametres_paie('{"taux_accidents_travail":"2.5"}'::jsonb)`)
ok('the new rate is used', (await calc(100000)).cnps_accidents === 2500)
await expectErr('an empty scale is refused', 'dahirou', `select public.maj_parametres_paie('{"bareme_irpp":[]}'::jsonb)`, [], 'Barème')
await expectOk('dahirou puts the rate back', 'dahirou', `select public.maj_parametres_paie('{"taux_accidents_travail":"1.75"}'::jsonb)`)

// ---------- 0037: accounting ----------
try {
  await db.exec(readFileSync(new URL('0037_comptabilite.sql', MIG), 'utf8'))
  ok('migration 0037 runs', true)
} catch (e) { ok('migration 0037 runs', false, e.message); process.exit(1) }
const totJ = await one('ali', `select count(*) n, sum(debit) d, sum(credit) c from public.journal_comptable`)
ok('the journal has entries and is balanced (debit = credit)', Number(totJ.n) > 100 && Number(totJ.d) === Number(totJ.c), JSON.stringify(totJ))
ok('every piece is balanced', (await as('ali', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0)
ok('every entry has a real account number', (await as('ali', `select * from public.journal_comptable where compte = '0'`)).rows.length === 0)
const ecartsCaisses = await as('ali', `with j as (select cle, sum(debit - credit) s from public.journal_comptable group by cle),
  c as (select 'caisse_' || mode || '_' || activite as cle, solde from public.soldes_caisses where ferme_id = public.ferme_actuelle())
  select c.cle, c.solde, coalesce(j.s, 0) as compta from c left join j on j.cle = c.cle where coalesce(j.s, 0) <> c.solde`)
ok('each cash box account equals the cash box balance', ecartsCaisses.rows.length === 0, JSON.stringify(ecartsCaisses.rows))
const bq = await one('ali', `select (select coalesce(sum(debit - credit), 0) from public.journal_comptable where cle = 'caisse_boutiques') compta,
  (select coalesce(sum(solde), 0) from public.soldes_boutiques sb join public.boutiques b on b.id = sb.boutique_id where b.ferme_id = public.ferme_actuelle()) reel`)
ok('shop cash account equals the shops cash', Number(bq.compta) === Number(bq.reel), JSON.stringify(bq))
const cl = await one('ali', `select (select coalesce(sum(debit - credit), 0) from public.journal_comptable where cle = 'clients') compta,
  (select coalesce(sum(public.reste_a_payer_vente(id)), 0) from public.ventes where not annulee and boutique_id is null and ferme_id = public.ferme_actuelle()) reel`)
ok('customers account equals what customers still owe', Number(cl.compta) === Number(cl.reel), JSON.stringify(cl))
const pe = await one('dahirou', `select (select coalesce(sum(debit - credit), 0) from public.journal_comptable where cle = 'personnel') compta,
  (select coalesce(sum(montant), 0) from public.avances_salaire where not annulee and paie_id is null and ferme_id = public.ferme_actuelle()) avances`)
ok('staff account = advances not yet deducted', Number(pe.compta) === Number(pe.avances), JSON.stringify(pe))
const cn = await one('dahirou', `select coalesce(sum(credit - debit), 0) s from public.journal_comptable where cle = 'cnps'`)
ok('CNPS account is 0 once November is paid over', Number(cn.s) === 0, JSON.stringify(cn))
const vtp = await one('dahirou', `select count(*) n from public.journal_comptable where journal = 'PA' and cle = 'salaires'`)
ok('payroll entries are in the PA journal', Number(vtp.n) > 0)
ok('VAT invoices put VAT in its own account (2 × 5 650)', Number((await one('dahirou', `select coalesce(sum(credit), 0) s from public.journal_comptable where cle = 'tva_collectee'`)).s) === 11300)
ok('kenfack sees no accounting', (await as('kenfack', `select * from public.journal_comptable`)).rows.length === 0)
await expectErr('kenfack cannot read the balance', 'kenfack', `select * from public.soldes_comptables(current_date - 365, current_date)`)
const bal = await as('dahirou', `select sum(debit_cumule) d, sum(credit_cumule) c, count(*) n from public.soldes_comptables('2000-01-01', current_date)`)
ok('the trial balance is balanced', Number(bal.rows[0].d) === Number(bal.rows[0].c) && Number(bal.rows[0].n) > 10, JSON.stringify(bal.rows[0]))
await expectErr('an invalid account number is refused', 'dahirou', `select public.maj_compte('achat_aliment', '60A', null)`, [], 'invalide')
await expectErr('kenfack cannot change the chart of accounts', 'kenfack', `select public.maj_compte('achat_aliment', '60221', null)`, [], 'finance')
await expectOk('dahirou renumbers feed purchases to 60221', 'dahirou', `select public.maj_compte('achat_aliment', '60221', 'Aliment chair et ponte')`)
ok('the journal uses the new number', (await as('dahirou', `select distinct compte, intitule from public.journal_comptable where cle = 'achat_aliment'`)).rows.every((r) => r.compte === '60221' && r.intitule === 'Aliment chair et ponte'))
ok('a new farm gets its chart of accounts', (await db.query(`select count(*) n from public.plan_comptable where ferme_id = (select id from public.fermes order by created_at desc limit 1)`)).rows[0].n > 30)

// ---------- 0038: two companies ----------
try {
  await db.exec(readFileSync(new URL('0038_deux_societes.sql', MIG), 'utf8'))
  ok('migration 0038 runs', true)
} catch (e) { ok('migration 0038 runs', false, e.message); process.exit(1) }
const NEG = (await as('ali', `select public.creer_ferme('HENZO AGRO', 'negoce') as id`)).rows[0].id
const neg = (await db.query(`select f.type_activite, (select numero from public.plan_comptable where ferme_id = f.id and cle = 'achat_aliment') n from public.fermes f where id = $1`, [NEG])).rows[0]
ok('ali creates a trading company with trading accounts (6012)', neg.type_activite === 'negoce' && neg.n === '6012', JSON.stringify(neg))
await expectOk('ali opens the trading company', 'ali', `select public.changer_ferme($1)`, [NEG])
await expectOk('ali adds kenfack (operations)', 'ali', `select public.ajouter_membre('kenfack', 'exploitation')`)
await expectOk('ali adds dahirou (finance)', 'ali', `select public.ajouter_membre('dahirou', 'finance')`)
await expectOk('kenfack opens the trading company', 'kenfack', `select public.changer_ferme($1)`, [NEG])
await expectOk('dahirou opens the trading company', 'dahirou', `select public.changer_ferme($1)`, [NEG])
const ARTN = (await one('kenfack', `insert into public.articles (nom, categorie, unite) values ('Aliment démarrage', 'aliment', 'sac') returning id`)).id
await expectOk('chicks can be a stock product of the trading company', 'kenfack', `insert into public.articles (nom, categorie, unite) values ('Poussins chair', 'poussins', 'piece')`)
await expectOk('100 bags enter the stock', 'kenfack', `insert into public.mouvements_stock (article_id, type_mouvement, quantite) values ($1, 'entree', 100)`, [ARTN])
const CLH = (await one('kenfack', `insert into public.tiers (type_tiers, nom) values ('client', 'HENZO SARL') returning id`)).id
const CLX = (await one('kenfack', `insert into public.tiers (type_tiers, nom) values ('client', 'Éleveur Mbarga') returning id`)).id
await expectErr('kenfack cannot link a group company', 'kenfack', `select public.lier_tiers($1, $2)`, [CLH, fermeAli], 'finance')
await expectErr('a company cannot be linked to itself', 'dahirou', `select public.lier_tiers($1, $2)`, [CLH, NEG], 'autre')
await expectOk('dahirou links the client to HENZO SARL', 'dahirou', `select public.lier_tiers($1, $2)`, [CLH, fermeAli])
const VM = `insert into public.ventes (client_id, produit, article_id, unite, quantite, prix_unitaire, mode_paiement) values ($1, 'marchandise', $2, 'sac', $3, $4, 'especes') returning id, a_credit, montant_encaisse, unite`
await expectErr('cannot sell more than the stock', 'kenfack', VM, [CLX, ARTN, 500, 16200], 'Stock insuffisant')
const vg = (await as('kenfack', VM, [CLH, ARTN, 10, 16200])).rows[0]
ok('a sale to HENZO SARL is on credit, nothing cashed', vg.a_credit === true && Number(vg.montant_encaisse) === 0 && vg.unite === 'sac', JSON.stringify(vg))
const vx = (await as('kenfack', VM, [CLX, ARTN, 5, 16200])).rows[0]
ok('a cash sale to another farmer is cashed', vx.a_credit === false && Number(vx.montant_encaisse) === 81000)
const stockN = async () => Number((await db.query(`select coalesce(sum(case type_mouvement when 'sortie' then -quantite else quantite end), 0) s from public.mouvements_stock where article_id = $1`, [ARTN])).rows[0].s)
ok('stock goes down to 85 bags', (await stockN()) === 85)
await expectErr('the buyer pays, not a manual receipt at the seller', 'kenfack', `insert into public.paiements_clients (vente_id, montant, mode_paiement) values ($1, 1000, 'especes')`, [vg.id], 'groupe')
const FN = (await oneP('kenfack', `select public.creer_facture($1::uuid[]) as id`, [[vg.id]])).id
ok('the trading company invoices the bags', (await oneP('kenfack', `select designation from public.facture_lignes where facture_id = $1`, [FN])).designation === 'Aliment démarrage')
const ventesM = Number((await one('dahirou', `select coalesce(sum(credit - debit), 0) s from public.journal_comptable where cle = 'vente_marchandises'`)).s)
ok('trading company accounts: goods sales 162 000 + 81 000', ventesM === 243000, String(ventesM))
ok('trading company journal is balanced', (await as('dahirou', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0)
// buyer side
await expectOk('kenfack back to HENZO SARL', 'kenfack', `select public.changer_ferme($1)`, [fermeAli])
await expectOk('dahirou back to HENZO SARL', 'dahirou', `select public.changer_ferme($1)`, [fermeAli])
const liv = (await as('kenfack', `select * from public.achats_intersocietes where statut = 'en_attente'`)).rows
ok('HENZO SARL sees the delivery to receive', liv.length === 1 && Number(liv[0].montant) === 162000 && liv[0].article_nom === 'Aliment démarrage', JSON.stringify(liv))
ok('kenfack and dahirou are told', (await as('kenfack', `select * from public.notifications where type_notification = 'livraison_groupe'`)).rows.length >= 1)
await expectErr('dahirou does not receive goods', 'dahirou', `select public.receptionner_livraison_groupe($1)`, [liv[0].id], 'exploitation')
const DEPG = (await oneP('kenfack', `select public.receptionner_livraison_groupe($1) as id`, [liv[0].id])).id
const dg = await oneP('dahirou', `select d.categorie, d.montant, d.a_credit, d.statut, t.nom four, t.ferme_liee_id, a.nom art from public.depenses d join public.tiers t on t.id = d.fournisseur_id left join public.articles a on a.id = d.article_id where d.id = $1`, [DEPG])
ok('reception creates a credit feed purchase from HENZO AGRO, waiting for dahirou', dg.categorie === 'aliment' && Number(dg.montant) === 162000 && dg.a_credit === true && dg.statut === 'a_valider'
  && dg.four === 'HENZO AGRO' && dg.ferme_liee_id === NEG && dg.art === 'Aliment démarrage', JSON.stringify(dg))
await expectErr('a delivery is received only once', 'kenfack', `select public.receptionner_livraison_groupe($1)`, [liv[0].id], 'déjà')
await expectOk('dahirou validates the purchase', 'dahirou', `update public.depenses set statut = 'validee' where id = $1`, [DEPG])
ok('the bags enter HENZO SARL stock', Number((await one('kenfack', `select stock from public.stock_articles where nom = 'Aliment démarrage'`)).stock) === 10)
await expectOk('dahirou pays HENZO AGRO 100 000', 'dahirou', `insert into public.paiements_fournisseurs (depense_id, montant, mode_paiement) values ($1, 100000, 'banque')`, [DEPG])
ok('the trading company has received 100 000, 62 000 still due', Number((await db.query(`select public.reste_a_payer_vente($1) r`, [vg.id])).rows[0].r) === 62000
  && Number((await db.query(`select solde from public.soldes_caisses where ferme_id = $1 and mode = 'banque' and activite = 'chair'`, [NEG])).rows[0].solde) === 100000)
await expectErr('the seller cannot cancel a received delivery', 'ali', `update public.ventes set annulee = true, motif_annulation = 'x' where id = '${vg.id}'`)
// refusal
await expectOk('kenfack goes back to the trading company', 'kenfack', `select public.changer_ferme($1)`, [NEG])
const vg2 = (await as('kenfack', VM, [CLH, ARTN, 2, 16200])).rows[0]
await expectOk('kenfack back to HENZO SARL', 'kenfack', `select public.changer_ferme($1)`, [fermeAli])
const livG2 = (await as('kenfack', `select id from public.achats_intersocietes where vente_id = $1`, [vg2.id])).rows[0].id
await expectErr('a refusal needs a reason', 'kenfack', `select public.refuser_livraison_groupe($1, '')`, [livG2], 'motif')
await expectOk('kenfack refuses a damaged delivery', 'kenfack', `select public.refuser_livraison_groupe($1, 'Sacs abîmés')`, [livG2])
ok('the seller is told', Number((await db.query(`select count(*) n from public.notifications where ferme_id = $1 and type_notification = 'livraison_refusee'`, [NEG])).rows[0].n) >= 1)
await expectOk('ali back to HENZO SARL', 'ali', `select public.changer_ferme($1)`, [fermeAli])
ok('HENZO SARL journal is still balanced', (await as('dahirou', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0)

// ---------- 0039: several sites for one company ----------
try {
  await db.exec(readFileSync(new URL('0039_sites.sql', MIG), 'utf8'))
  ok('migration 0039 runs', true)
} catch (e) { ok('migration 0039 runs', false, e.message); process.exit(1) }
await expectErr('kenfack cannot add a site', 'kenfack', `select public.creer_ferme('X', 'elevage', $1)`, [fermeAli], 'directeur')
await expectErr('a site cannot be added to the trading company', 'ali', `select public.creer_ferme('X', 'elevage', $1)`, [NEG], 'élevage')
const SITE = (await oneP('ali', `select public.creer_ferme('HENZO Garoua', 'elevage', $1) as id`, [fermeAli])).id
const site = (await db.query(`select societe_id, type_activite from public.fermes where id = $1`, [SITE])).rows[0]
ok('HENZO Garoua is a site of HENZO SARL', site.societe_id === fermeAli && site.type_activite === 'elevage', JSON.stringify(site))
ok('the site takes the company chart of accounts (60221)', (await db.query(`select numero from public.plan_comptable where ferme_id = $1 and cle = 'achat_aliment'`, [SITE])).rows[0].numero === '60221')
await expectOk('ali opens the site', 'ali', `select public.changer_ferme($1)`, [SITE])
await expectOk('ali adds kenfack to the site', 'ali', `select public.ajouter_membre('kenfack', 'exploitation')`)
await expectOk('ali adds dahirou to the site', 'ali', `select public.ajouter_membre('dahirou', 'finance')`)
await expectOk('kenfack opens the site', 'kenfack', `select public.changer_ferme($1)`, [SITE])
await expectOk('dahirou opens the site', 'dahirou', `select public.changer_ferme($1)`, [SITE])
const fiche = (await one('dahirou', `select public.fiche_societe() f`)).f
ok('the site shows the company sheet (HENZO SARL, NIU) and its own name', fiche.raison_sociale === 'HENZO SARL' && fiche.niu === 'M012345678901A' && fiche.site === 'HENZO Garoua' && Number(fiche.nombre_sites) === 2, JSON.stringify(fiche))
await expectErr('the trading company sheet is not reachable from the site', 'dahirou', `select public.fiche_societe($1)`, [NEG], 'introuvable')
await expectOk('dahirou edits the company sheet from the site', 'dahirou', `select public.maj_societe('{"telephone_societe":"699000000"}'::jsonb)`)
ok('the change is on HENZO SARL itself', (await db.query(`select telephone_societe t from public.fermes where id = $1`, [fermeAli])).rows[0].t === '699000000')
const BSG = (await one('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('G1', current_date - 30, 400) returning id`)).id
const CLG = (await one('kenfack', `insert into public.tiers (type_tiers, nom) values ('client', 'Restaurant Garoua') returning id`)).id
const VSG = (await oneP('kenfack', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, $2, 'poulets', 'piece', 20, 3500, 20, 'especes') returning id`, [BSG, CLG])).id
const FSG = (await oneP('kenfack', `select public.creer_facture($1::uuid[]) as id`, [[VSG]])).id
ok('a site invoice continues the company numbering (0005)', /-0005$/.test((await oneP('dahirou', `select numero from public.factures where id = $1`, [FSG])).numero))
const sf = (await oneP('dahirou', `select public.situation_fiscale(extract(year from current_date)::int) s`)).s
const caMois = Number(sf.ca[new Date().toISOString().slice(0, 7)] ?? 0)
ok('company taxes add up both sites', Number(sf.sites) === 2 && caMois >= 70000 + 87500, JSON.stringify({ sites: sf.sites, caMois }))
const solSite = await as('dahirou', `select sum(credit_periode) c from public.soldes_comptables('2000-01-01', current_date) where cle = 'vente_poulets'`)
const solSoc = await as('dahirou', `select sum(credit_periode) c, sum(debit_cumule) d, sum(credit_cumule) cc from public.soldes_comptables('2000-01-01', current_date, true)`)
ok('accounts: the site alone, or the whole company', Number(solSite.rows[0].c) === 70000 && Number(solSoc.rows[0].d) === Number(solSoc.rows[0].cc)
  && Number(solSoc.rows[0].c) > Number(solSite.rows[0].c), JSON.stringify({ site: solSite.rows[0], soc: solSoc.rows[0] }))
const js = await as('dahirou', `select distinct site from public.journal_societe('2000-01-01', current_date)`)
ok('company journal shows the lines of both sites', js.rows.length === 2, JSON.stringify(js.rows))
ok('the company journal never shows the trading company', !js.rows.some((r) => r.site === 'HENZO AGRO'))
await expectErr('kenfack cannot read the company journal', 'kenfack', `select * from public.journal_societe('2000-01-01', current_date)`)
await expectOk('dahirou renumbers a account from the site', 'dahirou', `select public.maj_compte('transport', '61811', null)`)
ok('the whole company gets the new number', (await db.query(`select count(*) n from public.plan_comptable where cle = 'transport' and numero = '61811' and ferme_id in ($1, $2)`, [fermeAli, SITE])).rows[0].n === 2)
await expectOk('dahirou sets the accident rate from the site', 'dahirou', `select public.maj_parametres_paie('{"taux_accidents_travail":"2.5"}'::jsonb)`)
ok('payroll settings are the company ones', Number((await db.query(`select taux_accidents_travail t from public.parametres_paie where ferme_id = $1`, [fermeAli])).rows[0].t) === 2.5)
ok('dahirou reads the company payroll settings from the site', (await as('dahirou', `select ferme_id from public.parametres_paie`)).rows.map((r) => r.ferme_id).join() === fermeAli)
await expectOk('dahirou puts the rate back', 'dahirou', `select public.maj_parametres_paie('{"taux_accidents_travail":"1.75"}'::jsonb)`)
for (const u of ['ali', 'kenfack', 'dahirou']) await expectOk(`${u} back to the main site`, u, `select public.changer_ferme($1)`, [fermeAli])

// ---------- 0040: site names on the portal, before signing in ----------
try {
  await db.exec(readFileSync(new URL('0040_portail_sites.sql', MIG), 'utf8'))
  ok('migration 0040 runs', true)
} catch (e) { ok('migration 0040 runs', false, e.message); process.exit(1) }
const ps = await as(null, `select * from public.portail_sites()`)
ok('before signing in, the portal sees only farm site names', ps.rows.length >= 2 && ps.rows.every((r) => Object.keys(r).join() === 'ferme_id,nom') && !ps.rows.some((r) => r.nom === 'HENZO AGRO'), JSON.stringify(ps.rows))
await expectNoRows('an anonymous visitor still sees no farm data', null, `select * from public.fermes`)

// ---------- 0041: attach a farm as a site, cash of all sites ----------
try {
  await db.exec(readFileSync(new URL('0041_regrouper_sites.sql', MIG), 'utf8'))
  ok('migration 0041 runs', true)
} catch (e) { ok('migration 0041 runs', false, e.message); process.exit(1) }
await expectErr('kenfack cannot attach a site', 'kenfack', `select public.rattacher_site($1, $2)`, [F2, fermeAli], 'directeur')
await expectErr('the trading company cannot become a farm site', 'ali', `select public.rattacher_site($1, $2)`, [NEG, fermeAli], 'élevage')
await expectErr('a site is attached only once', 'ali', `select public.rattacher_site($1, $2)`, [SITE, fermeAli], 'déjà')
await expectOk('ali attaches Ferme Nord to HENZO SARL', 'ali', `select public.rattacher_site($1, $2)`, [F2, fermeAli])
ok('Ferme Nord is now a site of HENZO SARL', (await db.query(`select societe_id from public.fermes where id = $1`, [F2])).rows[0].societe_id === fermeAli)
ok('it takes the company chart of accounts', (await db.query(`select numero from public.plan_comptable where ferme_id = $1 and cle = 'transport'`, [F2])).rows[0].numero === '61811')
const cs = await as('dahirou', `select distinct site from public.caisses_societe()`)
ok('cash boxes of all the company sites (3 sites, not HENZO AGRO)', cs.rows.length === 3 && !cs.rows.some((r) => r.site === 'HENZO AGRO'), JSON.stringify(cs.rows))
const totCaisses = { groupe: (await one('dahirou', `select sum(solde) s from public.caisses_societe()`)).s, reel: (await db.query(`select sum(sc.solde) s from public.soldes_caisses sc join public.fermes f on f.id = sc.ferme_id where coalesce(f.societe_id, f.id) = $1`, [fermeAli])).rows[0].s }
ok('their total is the real total', Number(totCaisses.groupe) === Number(totCaisses.reel), JSON.stringify(totCaisses))
await expectErr('kenfack cannot see all the cash boxes', 'kenfack', `select * from public.caisses_societe()`)

// ---------- 0042-0043: accountant role ----------
try {
  await db.exec(readFileSync(new URL('0042_role_comptable.sql', MIG), 'utf8'))
  await db.exec(readFileSync(new URL('0043_comptable.sql', MIG), 'utf8'))
  ok('migrations 0042 and 0043 run', true)
} catch (e) { ok('migrations 0042 and 0043 run', false, e.message); process.exit(1) }
U.comptable = '77777777-7777-7777-7777-777777777777'
await db.query(`insert into auth.users (id, email) values ($1, 'comptable@henzo.local')`, [U.comptable])
await db.query(`update public.profiles set role = 'comptable', nom_complet = 'Cabinet comptable', ferme_id = $2 where id = $1`, [U.comptable, fermeAli])
await db.query(`insert into public.membres_fermes (user_id, ferme_id, role) values ($1, $2, 'comptable') on conflict (user_id, ferme_id) do update set role = 'comptable'`, [U.comptable, fermeAli])
const balC = await as('comptable', `select sum(debit_cumule) d, sum(credit_cumule) c, count(*) n from public.soldes_comptables('2000-01-01', current_date, true)`)
ok('the accountant reads the trial balance of the whole company', Number(balC.rows[0].n) > 10 && Number(balC.rows[0].d) === Number(balC.rows[0].c), JSON.stringify(balC.rows[0]))
const jsC = await as('comptable', `select distinct site from public.journal_societe('2000-01-01', current_date)`)
ok('the accountant reads the journal of every site', ['Ferme HENZO', 'HENZO Garoua'].every((n) => jsC.rows.some((r) => r.site === n)) && !jsC.rows.some((r) => r.site === 'HENZO AGRO'), JSON.stringify(jsC.rows))
ok('or of one site only', (await as('comptable', `select distinct site from public.journal_societe('2000-01-01', current_date, null, null, 3000, $1)`, [SITE])).rows.map((r) => r.site).join() === 'HENZO Garoua')
await expectErr('but not of the trading company', 'comptable', `select * from public.journal_societe('2000-01-01', current_date, null, null, 3000, $1)`, [NEG], 'introuvable')
ok('the accountant reads the taxes of the whole company', Number((await one('comptable', `select public.situation_fiscale(extract(year from current_date)::int) s`)).s.sites) === 3)
ok('the accountant reads the invoices', (await as('comptable', `select * from public.factures`)).rows.length > 0)
const totaux = await as('comptable', `select * from public.charges_salaires_societe('2000-01-01')`)
ok('the accountant reads payroll totals (November: CNPS 9 433, paid)', totaux.rows.some((r) => new Date(r.mois).toISOString().startsWith('2026-11') && Number(r.a_reverser_cnps) === 9433 && Number(r.paye_cnps) === 9433), JSON.stringify(totaux.rows))
ok('but no payslip and no salary', (await as('comptable', `select * from public.bulletins_paie`)).rows.length === 0 && (await as('comptable', `select * from public.employes`)).rows.length === 0)
ok('and no field entries nor stock movements', (await as('comptable', `select * from public.mortalites`)).rows.length === 0 && (await as('comptable', `select * from public.mouvements_stock`)).rows.length === 0)
await expectOk('the accountant corrects the advance rate', 'comptable', `select public.maj_societe('{"taux_acompte":"2.2"}'::jsonb)`)
await expectOk('the accountant corrects a payroll rate', 'comptable', `select public.maj_parametres_paie('{"taux_accidents_travail":"1.75"}'::jsonb)`)
await expectOk('the accountant renumbers an account', 'comptable', `select public.maj_compte('entretien', '62411', null)`)
ok('the accountant reads the payroll settings and the chart of accounts', (await as('comptable', `select * from public.parametres_paie`)).rows.length === 1 && (await as('comptable', `select * from public.plan_comptable`)).rows.length > 30)
await expectErr('the accountant cannot pay a tax', 'comptable', `select public.payer_impot('acompte_is', current_date, 1000, 'banque')`)
await expectErr('the accountant cannot make an invoice', 'comptable', `select public.creer_facture($1::uuid[])`, [[VSG]])
await expectErr('the accountant cannot record an expense', 'comptable', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement) values ('generale', 'chair', 'fonctionnement', 'x', 1000, 'especes')`)
await expectErr('the accountant cannot pay a salary', 'comptable', `select public.payer_salaire($1, '2026-12-01', 'especes')`, [NEW])
await expectNoRows('the accountant cannot validate an expense', 'comptable', `update public.depenses set statut = 'validee' where statut = 'a_valider' returning id`)
await expectErr('the accountant cannot cancel an invoice', 'comptable', `select public.annuler_facture($1, 'x')`, [FSG])

// ---------- 0044: pick any site in the accounts ----------
try {
  await db.exec(readFileSync(new URL('0044_perimetre_sites.sql', MIG), 'utf8'))
  ok('migration 0044 runs', true)
} catch (e) { ok('migration 0044 runs', false, e.message); process.exit(1) }
const ficheC = (await one('comptable', `select public.fiche_societe() f`)).f
ok('the company sheet lists its sites by name', ficheC.sites.map((x) => x.nom).join() === 'Ferme HENZO,Ferme Nord,HENZO Garoua', JSON.stringify(ficheC.sites))
const garoua = await as('comptable', `select sum(credit_periode) c from public.soldes_comptables('2000-01-01', current_date, false, $1) where cle = 'vente_poulets'`, [SITE])
ok('the balance of another site, without opening it (Garoua: 70 000)', Number(garoua.rows[0].c) === 70000, JSON.stringify(garoua.rows))
await expectErr('not the trading company', 'comptable', `select * from public.soldes_comptables('2000-01-01', current_date, false, $1)`, [NEG], 'introuvable')

// ---------- 0045: invoice made at the time of the sale ----------
try {
  await db.exec(readFileSync(new URL('0045_facture_a_la_vente.sql', MIG), 'utf8'))
  ok('migration 0045 runs', true)
} catch (e) { ok('migration 0045 runs', false, e.message); process.exit(1) }
const factureDe = async (who, vente) => (await oneP(who, `select public.facture_pour($1) as id`, [vente])).id
const VA1 = (await oneP('kenfack', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement) values ($1, $2, 'poulets', 'piece', 3, 3500, 3, 'especes') returning id`, [DOM, CLB])).id
const FA1 = await factureDe('kenfack', VA1)
const fa1 = (await oneP('kenfack', `select public.facture_complete($1) as f`, [FA1])).f
ok('a farm sale gets its invoice at once (Client B, 10 500)', !!FA1 && fa1.facture.client_nom === 'Client B' && Number(fa1.facture.total_ttc) === 10500 && fa1.lignes.length === 1, JSON.stringify(fa1.facture))
const VA2 = (await oneP('employe', `insert into public.ventes (bande_id, produit, unite, quantite, prix_unitaire, nombre_sujets, mode_paiement, date_vente) values ($1, 'poulets', 'piece', 1, 3500, 1, 'especes', current_date - 3) returning id`, [DOM])).id
const FA2 = await factureDe('employe', VA2)
ok('a walk-in sale typed by the employee, even back-dated, gets an invoice to "Client comptant"', !!FA2
  && (await oneP('employe', `select public.facture_complete($1) as f`, [FA2])).f.facture.client_nom === 'Client comptant')
await expectErr('the employee cannot open an invoice of somebody else', 'employe', `select public.facture_complete($1)`, [FA1], 'introuvable')
const VBQ = (await as('vendeur', `insert into public.ventes_boutique (boutique_id, produit, forme, unite, quantite, nombre_sujets, prix_unitaire, mode_paiement, client_nom) values ($1, 'poulet', 'vivant', 'piece', 2, 2, 4000, 'especes', 'Mme Ngo') returning id`, [BQ])).rows[0].id
const FBQ = (await oneP('vendeur', `select public.facture_pour(null, $1) as id`, [VBQ])).id
const fbq = (await oneP('vendeur', `select public.facture_complete($1) as f`, [FBQ])).f
ok('a shop sale gets one invoice to the name typed (Mme Ngo, 8 000), the seller opens it', fbq.facture.client_nom === 'Mme Ngo' && Number(fbq.facture.total_ttc) === 8000 && fbq.societe.raison_sociale === 'HENZO SARL', JSON.stringify(fbq.facture))
await expectErr('the seller cannot open a farm invoice', 'vendeur', `select public.facture_complete($1)`, [FA1], 'introuvable')
const numeros = (await as('ali', `select numero from public.factures where id in ($1, $2) order by sequence`, [FA1, FA2])).rows.map((r) => Number(r.numero.slice(-4)))
ok('automatic invoices keep the company numbering', numeros.length === 2 && numeros[1] === numeros[0] + 1, JSON.stringify(numeros))
await expectOk('ali cancels a farm sale', 'ali', `update public.ventes set annulee = true, motif_annulation = 'Erreur' where id = $1`, [VA1])
ok('its invoice is cancelled with it', (await oneP('ali', `select annulee from public.factures where id = $1`, [FA1])).annulee === true)
await expectOk('ali cancels the shop sale', 'ali', `update public.ventes_boutique set annulee = true, motif_annulation = 'Erreur de prix' where id = $1`, [VBQ])
ok('the shop invoice is cancelled too', (await oneP('ali', `select annulee from public.factures where id = $1`, [FBQ])).annulee === true)
ok('the journal stays balanced', (await as('dahirou', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0)

// ---------- 0046: payment mode and cashier on the invoice ----------
try {
  await db.exec(readFileSync(new URL('0046_facture_paiement_caissier.sql', MIG), 'utf8'))
  ok('migration 0046 runs', true)
} catch (e) { ok('migration 0046 runs', false, e.message); process.exit(1) }
const fb2 = (await oneP('vendeur', `select public.facture_complete($1) as f`, [FBQ])).f
ok('the shop invoice shows cash and the seller as cashier', JSON.stringify(fb2.paiement) === '["especes"]' && fb2.caissier === 'Vendeur Test', JSON.stringify([fb2.paiement, fb2.caissier]))
const VA3 = (await oneP('kenfack', `insert into public.ventes (bande_id, client_id, produit, unite, quantite, prix_unitaire, nombre_sujets, a_credit, montant_encaisse, mode_paiement) values ($1, (select id from public.tiers where nom = 'Client A' and ferme_id = public.ferme_actuelle()), 'poulets', 'piece', 2, 3500, 2, true, 2000, 'mobile_money') returning id`, [DOM])).id
const fa3 = (await oneP('kenfack', `select public.facture_complete(public.facture_pour($1)) as f`, [VA3])).f
ok('a credit sale with a Mobile Money deposit shows both modes', fa3.paiement.includes('credit') && fa3.paiement.includes('mobile_money') && fa3.paiement.length === 2, JSON.stringify(fa3.paiement))

// ---------- 0047: Ali and Dahirou add employees too ----------
try {
  await db.exec(readFileSync(new URL('0047_equipe_associes.sql', MIG), 'utf8'))
  ok('migration 0047 runs', true)
} catch (e) { ok('migration 0047 runs', false, e.message); process.exit(1) }
await db.exec(`delete from public.notifications`)
const CPT = (await oneP('dahirou', `select public.ajouter_employe($1, $2, $3) as id`, ['Mme Comptable', '691000000', 'Comptable'])).id
ok('dahirou adds the accountant to the team, with no salary yet', Number((await oneP('dahirou', `select salaire_mensuel from public.employes where id = $1`, [CPT])).salaire_mensuel) === 0)
const avis = async () => (await db.query(`select role_destinataire::text r from public.notifications where type_notification = 'nouvel_employe' order by created_at`)).rows.map((x) => x.r)
ok('kenfack is told, dahirou is not told about his own addition', JSON.stringify(await avis()) === '["exploitation"]', JSON.stringify(await avis()))
const SEC = (await oneP('ali', `select public.ajouter_employe($1) as id`, ['Secrétaire'])).id
ok('ali adds an employee: dahirou (salary) and kenfack are told', !!SEC && (await avis()).filter((r) => r === 'finance').length === 1 && (await avis()).filter((r) => r === 'exploitation').length === 2, JSON.stringify(await avis()))
await expectOk('ali marks a departure', 'ali', `select public.modifier_employe($1, 'Secrétaire', null, null, false)`, [SEC])
await expectErr('the employee still cannot add anyone', 'employe', `select public.ajouter_employe('x')`, [], 'pouvez pas')
await expectErr('the accountant still cannot add anyone', 'comptable', `select public.ajouter_employe('x')`, [], 'pouvez pas')

// ---------- 0048: farm staff (Kenfack) and office staff (Ali, Dahirou) ----------
try {
  await db.exec(readFileSync(new URL('0048_employes_bureau.sql', MIG), 'utf8'))
  ok('migration 0048 runs', true)
} catch (e) { ok('migration 0048 runs', false, e.message); process.exit(1) }
ok('the accountant added in 0047 moves to the office list', (await oneP('dahirou', `select categorie from public.employes where id = $1`, [CPT])).categorie === 'bureau')
ok('the farm team no longer shows the accountant', (await as('kenfack', `select 1 from public.equipe where id = $1`, [CPT])).rows.length === 0)
await expectErr('dahirou no longer adds to the farm team', 'dahirou', `select public.ajouter_employe('x')`, [], 'Kenfack')
await expectErr('ali no longer adds to the farm team', 'ali', `select public.ajouter_employe('x')`, [], 'Kenfack')
await expectOk('kenfack still adds farm staff', 'kenfack', `select public.ajouter_employe('Ouvrier 48', null, 'Ouvrier')`)
const SECB = (await oneP('ali', `select public.ajouter_employe_bureau($1, null, $2) as id`, ['Mme Secrétaire', 'Secrétaire'])).id
ok('ali adds an office employee', (await oneP('ali', `select categorie, salaire_mensuel from public.employes where id = $1`, [SECB])).categorie === 'bureau')
await expectErr('kenfack cannot add office staff', 'kenfack', `select public.ajouter_employe_bureau('x')`, [], 'Ali et Dahirou')
await expectErr('the employee cannot add office staff', 'employe', `select public.ajouter_employe_bureau('x')`, [], 'Ali et Dahirou')
await expectOk('dahirou renames and changes the job of an office employee', 'dahirou', `select public.modifier_employe_bureau($1, 'Mme Secrétaire', '690', 'Assistante', true)`, [SECB])
await expectOk('dahirou sets the office salary', 'dahirou', `update public.employes set salaire_mensuel = 120000 where id = $1`, [SECB])
await expectErr('dahirou still cannot rename a farm employee', 'dahirou', `update public.employes set nom = 'X' where id = $1`, [NEW], 'Kenfack')
await expectErr('kenfack cannot touch an office employee', 'kenfack', `select public.modifier_employe($1, 'X', null, null, true)`, [SECB], 'introuvable')
await expectErr('nobody moves an employee to the other list', 'dahirou', `update public.employes set categorie = 'ferme' where id = $1`, [SECB], 'liste')
const paieB = await expectOk('dahirou pays the office employee by the month', 'dahirou', `select public.payer_salaire($1, date_trunc('month', current_date)::date, 'especes', 0, 0, null)`, [SECB])
ok('the office pay is recorded', !!paieB && (await as('dahirou', `select 1 from public.paies where employe_id = $1 and not annulee`, [SECB])).rows.length === 1)

// ---------- 0049: rename a farm ----------
try {
  await db.exec(readFileSync(new URL('0049_renommer_ferme.sql', MIG), 'utf8'))
  ok('migration 0049 runs', true)
} catch (e) { ok('migration 0049 runs', false, e.message); process.exit(1) }
const nomAvant = (await db.query(`select nom from public.fermes where id = $1`, [fermeAli])).rows[0].nom
await expectOk('ali renames his farm (extra spaces removed)', 'ali', `select public.renommer_ferme($1, '  Ferme   Site-Obala ')`, [fermeAli])
ok('the new name is saved', (await db.query(`select nom from public.fermes where id = $1`, [fermeAli])).rows[0].nom === 'Ferme Site-Obala')
await expectErr('kenfack cannot rename the farm', 'kenfack', `select public.renommer_ferme($1, 'X')`, [fermeAli], 'directeur')
await expectErr('dahirou cannot rename the farm', 'dahirou', `select public.renommer_ferme($1, 'X')`, [fermeAli], 'directeur')
await expectErr('an empty name is refused', 'ali', `select public.renommer_ferme($1, '   ')`, [fermeAli], 'nouveau nom')
await expectErr('the name of another farm is refused', 'ali', `select public.renommer_ferme($1, 'henzo agro')`, [fermeAli], 'déjà ce nom')
await db.query(`update public.fermes set nom = $2 where id = $1`, [fermeAli, nomAvant])

// ---------- 0050: company shops, supplied by every site ----------
try {
  await db.exec(readFileSync(new URL('0050_boutiques_societe.sql', MIG), 'utf8'))
  ok('migration 0050 runs', true)
} catch (e) { ok('migration 0050 runs', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [SITE])
ok('the shop of the company is seen from the site', (await as('kenfack', `select 1 from public.boutiques where id = $1`, [BQ])).rows.length === 1)
const GS = (await oneP('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('GS1', current_date - 40, 60) returning id`)).id
const ENVS = (await oneP('kenfack', `select public.creer_envoi($1, $2::jsonb) as id`, [BQ, JSON.stringify([{ produit: 'poulet', bande_id: GS, quantite: 10 }])])).id
ok('the site ships its own birds to the company shop', (await db.query(`select ferme_id from public.envois_boutique where id = $1`, [ENVS])).rows[0].ferme_id === SITE)
await expectOk('the seller receives the shipment from the site', 'vendeur', `select public.recevoir_envoi($1)`, [ENVS])
const stockQ = (await oneP('vendeur', `select stock from public.stock_boutiques where boutique_id = $1 and produit = 'poulet'`, [BQ])).stock
ok('the shop keeps one stock for all sites', stockQ >= 10, String(stockQ))
const VBS = (await as('vendeur', `insert into public.ventes_boutique (boutique_id, produit, forme, unite, quantite, nombre_sujets, prix_unitaire, mode_paiement, client_nom) values ($1, 'poulet', 'vivant', 'piece', $2, $3, 4000, 'especes', 'Restaurant Test') returning id`, [BQ, stockQ, stockQ])).rows[0].id
const mir = (await db.query(`select ferme_id, bande_id, nombre_sujets from public.ventes where vente_boutique_id = $1`, [VBS])).rows
ok('the sale counts in the site and flock the birds come from', mir.some((r) => r.ferme_id === SITE && r.bande_id === GS && Number(r.nombre_sujets) === 10), JSON.stringify(mir))
ok('the shop sale of birds from two sites gets one invoice', !!(await oneP('vendeur', `select public.facture_pour(null, $1) as id`, [VBS])).id)
ok('the flock of the site counts the birds sold in the shop', (await oneP('kenfack', `select restants from public.effectif_bandes where code = 'GS1'`)).restants === 50)
const VERS = (await oneP('vendeur', `select public.demander_versement($1, 'especes', 1000, 0) as id`, [BQ])).id
const avantV = Number((await db.query(`select coalesce(sum(montant), 0) s from public.ecritures where ferme_id = $1 and nature = 'versement_boutique'`, [SITE])).rows[0].s)
await expectOk('dahirou validates the deposit from the site', 'dahirou', `select public.valider_versement($1, true)`, [VERS])
ok('the deposit goes into the cash boxes of the site', Number((await db.query(`select coalesce(sum(montant), 0) s from public.ecritures where ferme_id = $1 and nature = 'versement_boutique'`, [SITE])).rows[0].s) === avantV + 1000)
await expectOk('kenfack sets a shop price from the site', 'kenfack', `insert into public.prix_boutique (produit, forme, unite, prix_min, prix_max) values ('poulet', 'abattu', 'piece', 4000, 5500)`)
ok('the shop price belongs to the company', (await db.query(`select ferme_id from public.prix_boutique where forme = 'abattu' order by created_at desc limit 1`)).rows[0].ferme_id === fermeAli)
const BQ2 = (await oneP('ali', `insert into public.boutiques (nom) values ('Boutique Centre') returning id`)).id
ok('a shop created from the site belongs to the company', (await db.query(`select ferme_id from public.boutiques where id = $1`, [BQ2])).rows[0].ferme_id === fermeAli)
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
ok('the main farm still sees the shop and the site shipment', (await as('ali', `select 1 from public.envois_boutique where id = $1`, [ENVS])).rows.length === 1)
ok('the journal stays balanced with sites', (await as('dahirou', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0)
}

// ---------- 0051: HENZO AGRO chick orders, deposits, commissions ----------
try {
  await db.exec(readFileSync(new URL('0051_commandes_poussins.sql', MIG), 'utf8'))
  ok('migration 0051 runs', true)
} catch (e) { ok('migration 0051 runs', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [NEG])
const PCH = (await db.query(`select id from public.articles where ferme_id = $1 and categorie = 'poussins' limit 1`, [NEG])).rows[0].id
const COUV = (await oneP('kenfack', `insert into public.tiers (type_tiers, nom) values ('fournisseur', 'Couvoir Sud') returning id`)).id
const ELV = (await oneP('kenfack', `insert into public.tiers (type_tiers, nom, credit_autorise, plafond_credit) values ('client', 'Éleveur Fotso', true, 500000) returning id`)).id
await as('kenfack', `insert into public.mouvements_stock (article_id, type_mouvement, quantite) values ($1, 'entree', 1000)`, [PCH])
const stockP = async () => Number((await db.query(`select coalesce(sum(case type_mouvement when 'sortie' then -quantite else quantite end), 0) s from public.mouvements_stock where article_id = $1`, [PCH])).rows[0].s)
const caisseNeg = async (mode) => Number((await db.query(`select solde from public.soldes_caisses where ferme_id = $1 and mode = $2 and activite = 'chair'`, [NEG, mode])).rows[0].solde)
const equilibre = async () => (await as('dahirou', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0
const CMD = (await oneP('kenfack', `select public.creer_commande_eleveur($1, $2, $3, 'Cobb 500', 500, current_date + 7, 450, 'revente') as id`, [ELV, COUV, PCH])).id
ok('kenfack takes an order of 500 chicks at 450 F', !!CMD)
await expectErr('dahirou does not take orders', 'dahirou', `select public.creer_commande_eleveur($1, $2, $3, 'x', 1, current_date, 1, 'revente')`, [ELV, COUV, PCH], 'exploitation')
const esp0 = await caisseNeg('especes')
await expectOk('the farmer pays a deposit of 100 000', 'kenfack', `select public.verser_avance_commande($1, 100000, 'especes')`, [CMD])
ok('the deposit enters the cash box', (await caisseNeg('especes')) === esp0 + 100000)
await expectErr('a deposit above the order is refused', 'kenfack', `select public.verser_avance_commande($1, 200000, 'especes')`, [CMD], 'dépasse')
const VC = (await oneP('kenfack', `select public.livrer_commande($1, 480, 'mobile_money', 50000) as id`, [CMD])).id
const vc = await oneP('kenfack', `select a_credit, montant_encaisse, avance_imputee, montant, public.reste_a_payer_vente(id) reste from public.ventes where id = $1`, [VC])
ok('delivery of 480: 216 000, deposit 100 000 deducted, 50 000 paid, 66 000 on credit',
  vc.a_credit === true && Number(vc.montant) === 216000 && Number(vc.avance_imputee) === 100000 && Number(vc.montant_encaisse) === 50000 && Number(vc.reste) === 66000, JSON.stringify(vc))
ok('480 chicks leave the stock', (await stockP()) === 520)
ok('the delivery gets its invoice', !!(await oneP('kenfack', `select public.facture_pour($1) as id`, [VC])).id)
ok('the order is delivered', (await oneP('kenfack', `select statut from public.commandes_eleveurs where id = $1`, [CMD])).statut === 'livree')
ok('the deposit account is back to zero', Number((await oneP('dahirou', `select coalesce(sum(credit - debit), 0) s from public.journal_comptable where cle = 'clients_avances'`)).s) === 0)
ok('journal balanced after a delivery with deposit', await equilibre())
// commission orders
const CMC = (await oneP('kenfack', `select public.creer_commande_eleveur($1, $2, null, 'Cobb 500', 1000, current_date + 3, 400, 'commission', 'fixe', 25) as id`, [ELV, COUV])).id
await expectErr('no deposit on a commission order', 'kenfack', `select public.verser_avance_commande($1, 1000, 'especes')`, [CMC], 'couvoir')
await expectOk('commission order delivered (1 000 chicks)', 'kenfack', `select public.livrer_commande($1, 1000)`, [CMC])
ok('fixed commission: 1 000 x 25 = 25 000', Number((await oneP('kenfack', `select commission_montant from public.commandes_eleveurs where id = $1`, [CMC])).commission_montant) === 25000)
const CMP = (await oneP('kenfack', `select public.creer_commande_eleveur($1, $2, null, null, 200, current_date + 3, 400, 'commission', 'pourcentage', 5) as id`, [ELV, COUV])).id
await expectOk('percentage commission order delivered (200 chicks)', 'kenfack', `select public.livrer_commande($1, 200)`, [CMP])
ok('percentage commission: 200 x 400 x 5 % = 4 000', Number((await oneP('kenfack', `select commission_montant from public.commandes_eleveurs where id = $1`, [CMP])).commission_montant) === 4000)
ok('the hatchery owes 29 000', Number((await oneP('dahirou', `select due - recue as r from public.commissions_couvoirs where couvoir_id = $1`, [COUV])).r) === 29000)
await expectErr('kenfack does not record a commission received', 'kenfack', `select public.recevoir_commission($1, 20000, 'banque')`, [COUV], 'finance')
await expectOk('dahirou records 20 000 received from the hatchery', 'dahirou', `select public.recevoir_commission($1, 20000, 'banque')`, [COUV])
ok('9 000 still due by the hatchery', Number((await oneP('dahirou', `select due - recue as r from public.commissions_couvoirs where couvoir_id = $1`, [COUV])).r) === 9000)
ok('the commission is income in the accounts', Number((await oneP('dahirou', `select coalesce(sum(credit - debit), 0) s from public.journal_comptable where cle = 'commissions'`)).s) === 20000)
// cancellations
const CMA = (await oneP('kenfack', `select public.creer_commande_eleveur($1, $2, $3, null, 100, current_date + 10, 450, 'revente') as id`, [ELV, COUV, PCH])).id
await as('kenfack', `select public.verser_avance_commande($1, 20000, 'especes')`, [CMA])
await expectOk('kenfack cancels an order and keeps the deposit', 'kenfack', `select public.annuler_commande($1, 'Client parti', false)`, [CMA])
ok('the kept deposit is recorded', Number((await oneP('kenfack', `select avance_conservee from public.commandes_eleveurs where id = $1`, [CMA])).avance_conservee) === 20000)
const CMR = (await oneP('kenfack', `select public.creer_commande_eleveur($1, $2, $3, null, 100, current_date + 10, 450, 'revente') as id`, [ELV, COUV, PCH])).id
await as('kenfack', `select public.verser_avance_commande($1, 10000, 'especes')`, [CMR])
await expectErr('kenfack does not refund a deposit', 'kenfack', `select public.annuler_commande($1, 'Annulée', true)`, [CMR], 'Dahirou')
const esp1 = await caisseNeg('especes')
await expectOk('dahirou cancels and refunds the deposit', 'dahirou', `select public.annuler_commande($1, 'Annulée', true, 'especes')`, [CMR])
ok('the refund leaves the cash box', (await caisseNeg('especes')) === esp1 - 10000)
// a delivered sale cancelled: the order is open again
await expectOk('ali cancels the delivery sale', 'ali', `update public.ventes set annulee = true, motif_annulation = 'Erreur' where id = $1`, [VC])
ok('the order is open again with its deposit', (await oneP('kenfack', `select statut, avance_disponible from public.commandes_eleveurs_situation where id = $1`, [CMD])).statut === 'en_cours'
  && Number((await oneP('kenfack', `select avance_disponible from public.commandes_eleveurs_situation where id = $1`, [CMD])).avance_disponible) === 100000)
ok('the chicks are back in stock', (await stockP()) === 1000)
ok('journal balanced after commissions and cancellations', await equilibre())
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
}

// ---------- 0052: the client registers himself at the sale ----------
try {
  await db.exec(readFileSync(new URL('0052_client_par_nom.sql', MIG), 'utf8'))
  ok('migration 0052 runs', true)
} catch (e) { ok('migration 0052 runs', false, e.message); process.exit(1) }
{
const nb = async () => (await db.query(`select count(*)::int n from public.tiers where ferme_id = $1`, [fermeAli])).rows[0].n
const avant = await nb()
const C1 = (await oneP('kenfack', `select public.client_par_nom('  Restaurant   Le Baobab ', '690 00 00 01') as id`)).id
ok('a new name typed at the sale creates the client', (await nb()) === avant + 1
  && (await db.query(`select nom, type_tiers, telephone, credit_autorise from public.tiers where id = $1`, [C1])).rows[0].nom === 'Restaurant Le Baobab')
const C2 = (await oneP('employe', `select public.client_par_nom('restaurant le baobab') as id`)).id
ok('the same name with other capitals is the same client', C2 === C1 && (await nb()) === avant + 1)
const C3 = (await oneP('kenfack', `select public.client_par_nom('Éleveur Ndjock') as id`)).id
ok('accents do not matter either', (await oneP('kenfack', `select public.client_par_nom('eleveur ndjock') as id`)).id === C3)
ok('a client created this way has no credit', (await db.query(`select credit_autorise from public.tiers where id = $1`, [C1])).rows[0].credit_autorise === false)
await expectErr('an empty name is refused', 'kenfack', `select public.client_par_nom('   ')`, [], 'nom du client')
await expectErr('the seller of a shop does not create farm clients', 'vendeur', `select public.client_par_nom('X')`, [], 'pouvez pas')
}

// ---------- 0053: several products in one sale, delivery fee, profits ----------
try {
  await db.exec(readFileSync(new URL('0053_vente_multiple_benefices.sql', MIG), 'utf8'))
  ok('migration 0053 runs', true)
} catch (e) { ok('migration 0053 runs', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [NEG])
const art = async (cat) => (await db.query(`select id from public.articles where ferme_id = $1 and categorie = $2 order by created_at limit 1`, [NEG, cat])).rows[0].id
const ALI = await art('aliment'), POU = await art('poussins')
await expectOk('kenfack buys 8 bags at 12 000 (cost known)', 'kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, article_id, quantite) values ('ferme', 'chair', 'aliment', '8 sacs démarrage', 96000, 'especes', $1, 8)`, [ALI])
const caisse = async () => Number((await db.query(`select solde from public.soldes_caisses where ferme_id = $1 and mode = 'especes' and activite = 'chair'`, [NEG])).rows[0].solde)
const c0 = await caisse()
const V1 = (await oneP('kenfack', `select public.vendre_marchandises(null, $1::jsonb, 5000, 'especes') as id`,
  [JSON.stringify([{ article_id: ALI, quantite: 2, prix: 16200 }, { article_id: POU, quantite: 50, prix: 450 }])])).id
const fa = (await oneP('kenfack', `select public.facture_pour($1) as id`, [V1])).id
const lignesF = (await db.query(`select designation, montant from public.facture_lignes where facture_id = $1 order by ordre`, [fa])).rows
ok('one sale of two products + delivery = one invoice with 3 lines', lignesF.length === 3 && lignesF.some((l) => l.designation === 'Frais de livraison' && Number(l.montant) === 5000), JSON.stringify(lignesF))
ok('the cash box receives 59 900', (await caisse()) === c0 + 59900)
const CR = (await oneP('kenfack', `select public.client_par_nom('Éleveur Ngo Bell') as id`)).id
await as('kenfack', `update public.tiers set credit_autorise = true, plafond_credit = 300000 where id = $1`, [CR])
const V2 = (await oneP('kenfack', `select public.vendre_marchandises($1, $2::jsonb, 2000, 'mobile_money', true, 10000) as id`, [CR, JSON.stringify([{ article_id: ALI, quantite: 1, prix: 16200 }])])).id
ok('credit sale 18 200 with a deposit of 10 000: 8 200 owed', Number((await db.query(`select public.encours_client($1) as e`, [CR])).rows[0].e) === 8200)
await expectErr('a deposit above the total is refused', 'kenfack', `select public.vendre_marchandises($1, $2::jsonb, 0, 'especes', true, 99999)`, [CR, JSON.stringify([{ article_id: ALI, quantite: 1, prix: 16200 }])], 'acompte')
const GRP = (await db.query(`select id from public.tiers where ferme_id = $1 and ferme_liee_id is not null limit 1`, [NEG])).rows[0].id
await expectErr('no delivery fee to a group company', 'kenfack', `select public.vendre_marchandises($1, $2::jsonb, 3000)`, [GRP, JSON.stringify([{ article_id: ALI, quantite: 1, prix: 16200 }])], 'groupe')
await expectErr('dahirou does not sell goods', 'dahirou', `select public.vendre_marchandises(null, $1::jsonb)`, [JSON.stringify([{ article_id: ALI, quantite: 1, prix: 16200 }])], 'exploitation')
const ba = (await as('dahirou', `select * from public.benefices_articles(current_date - 30, current_date)`)).rows
const al = ba.find((r) => r.article_id === ALI)
ok('profit by article: feed margin = sales − quantity x 12 000', !!al && al.cout_connu === true && Number(al.marge) === Number(al.ventes) - Math.round(Number(al.quantite) * 12000), JSON.stringify(al))
const rb = (await oneP('dahirou', `select public.resume_benefices(current_date - 30, current_date) as r`)).r
ok('profit summary adds up', Number(rb.benefice) === Number(rb.ventes) - Number(rb.cout) + Number(rb.livraisons) + Number(rb.commissions) - Number(rb.charges) && Number(rb.livraisons) >= 7000, JSON.stringify(rb))
ok('delivery fees are income in the accounts (7071)', Number((await oneP('dahirou', `select coalesce(sum(credit - debit), 0) s from public.journal_comptable where cle = 'frais_livraison'`)).s) === Number(rb.livraisons))
await expectErr('the employee does not see the profits', 'employe', `select public.resume_benefices(current_date - 30, current_date)`, [], '')
ok('journal balanced after multi-product sales', (await as('dahirou', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0)
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
}

// ---------- 0054: feed mill (formulas, production, cost price) ----------
try {
  await db.exec(readFileSync(new URL('0054_provenderie.sql', MIG), 'utf8'))
  ok('migration 0054 runs', true)
} catch (e) { ok('migration 0054 runs', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [NEG])
const article = async (nom, cat, unite, poids) => (await oneP('kenfack', `insert into public.articles (nom, categorie, unite, poids_unitaire_kg) values ($1, $2, $3, $4) returning id`, [nom, cat, unite, poids ?? null])).id
const MAIS = await article('Maïs', 'matiere_premiere', 'kg')
const SOJA = await article('Tourteau de soja', 'matiere_premiere', 'kg')
const SAC = await article('Sac vide 50 kg', 'emballage', 'piece')
const FIN = await article('Aliment finition maison', 'aliment', 'sac', 50)
const achat = (art, q, m, lib) => as('kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, article_id, quantite) values ('ferme', 'chair', 'aliment', $4, $3, 'especes', $1, $2)`, [art, q, m, lib])
await achat(MAIS, 400, 80000, '400 kg maïs')      // 200 F / kg
await achat(SOJA, 200, 60000, '200 kg soja')      // 300 F / kg
await achat(SAC, 40, 8000, '40 sacs vides')       // 200 F / sac
await expectErr('the product must be feed sold by the bag, with its weight', 'kenfack', `select public.creer_formule('X', $1, null, 0, $2::jsonb)`, [MAIS, JSON.stringify([{ article_id: MAIS, quantite_kg: 1000 }])], 'poids du sac')
const FORM = (await oneP('kenfack', `select public.creer_formule('Finition 1 t', $1, $2, 10000, $3::jsonb) as id`,
  [FIN, SAC, JSON.stringify([{ article_id: MAIS, quantite_kg: 650 }, { article_id: SOJA, quantite_kg: 350 }])])).id
ok('kenfack writes a formula for 1 tonne', !!FORM)
await expectErr('dahirou does not produce feed', 'dahirou', `select public.fabriquer($1, 500, 10)`, [FORM], 'exploitation')
const FAB = (await oneP('kenfack', `select public.fabriquer($1, 500, 10) as id`, [FORM])).id
const fb = (await db.query(`select cout_matieres, cout_sacs, cout_frais, prix_revient_sac, cout_incomplet from public.fabrications where id = $1`, [FAB])).rows[0]
ok('500 kg made into 10 bags: raw materials 117 500 + bags 2 000 + running costs 5 000 = 12 450 per bag',
  Number(fb.cout_matieres) === 117500 && Number(fb.cout_sacs) === 2000 && Number(fb.cout_frais) === 5000 && Number(fb.prix_revient_sac) === 12450 && fb.cout_incomplet === false, JSON.stringify(fb))
const st = async (a) => Number((await db.query(`select public.stock_article($1) s`, [a])).rows[0].s)
ok('raw materials and empty bags leave the stock, bags of feed enter it', (await st(MAIS)) === 75 && (await st(SOJA)) === 25 && (await st(SAC)) === 30 && (await st(FIN)) === 10)
await expectErr('not enough maize for another 500 kg', 'kenfack', `select public.fabriquer($1, 500, 10)`, [FORM], 'Pas assez de Maïs')
await as('kenfack', `select public.vendre_marchandises(null, $1::jsonb)`, [JSON.stringify([{ article_id: FIN, quantite: 4, prix: 16000 }])])
const bf = (await as('dahirou', `select * from public.benefices_articles(current_date - 1, current_date)`)).rows.find((r) => r.article_id === FIN)
ok('profit counts raw materials and bags in the cost of the feed sold (4 x 11 950)', !!bf && Number(bf.cout) === 47800 && Number(bf.marge) === 64000 - 47800, JSON.stringify(bf))
await expectErr('a production partly sold cannot be cancelled', 'kenfack', `select public.annuler_fabrication($1, 'Erreur')`, [FAB], 'déjà vendue')
const FAB2 = (await oneP('kenfack', `select public.fabriquer($1, 60, 1) as id`, [FORM])).id
ok('a small production uses 39 kg maize and 21 kg soya', (await st(MAIS)) === 36 && (await st(SOJA)) === 4)
await expectOk('kenfack cancels it', 'kenfack', `select public.annuler_fabrication($1, 'Mauvais mélange')`, [FAB2])
ok('the raw materials come back', (await st(MAIS)) === 75 && (await st(SOJA)) === 25 && (await st(FIN)) === 6)
ok('journal still balanced', (await as('dahirou', `select piece from public.journal_comptable group by piece having sum(debit) <> sum(credit)`)).rows.length === 0)
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
}

// ---------- 0055: chasing clients' debts ----------
try {
  await db.exec(readFileSync(new URL('0055_relances.sql', MIG), 'utf8'))
  ok('migration 0055 runs', true)
} catch (e) { ok('migration 0055 runs', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [NEG])
const rows = (await as('dahirou', `select * from public.creances_par_client order by reste desc`)).rows
const detail = Number((await as('dahirou', `select coalesce(sum(reste), 0) s from public.creances_clients`)).rows[0].s)
ok('debts grouped by client add up to the detail', rows.length > 0 && rows.reduce((s, r) => s + Number(r.reste), 0) === detail, JSON.stringify(rows.map((r) => [r.client, r.reste, r.ventes, r.jours])))
const cl = rows.find((r) => !r.societe_groupe)
await expectOk('kenfack notes a WhatsApp reminder', 'kenfack', `select public.noter_relance($1, $2)`, [cl.client_id, cl.reste])
const apres = (await as('dahirou', `select relances, derniere_relance from public.creances_par_client where client_id = $1`, [cl.client_id])).rows[0]
ok('the reminder shows on the client', Number(apres.relances) === 1 && !!apres.derniere_relance)
await expectErr('the employee does not chase clients', 'employe', `select public.noter_relance($1, 1)`, [cl.client_id], 'pouvez pas')
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
}

// ---------- 0056: partners' dashboard ----------
try {
  await db.exec(readFileSync(new URL('0056_tableau_associes.sql', MIG), 'utf8'))
  ok('migration 0056 runs', true)
} catch (e) { ok('migration 0056 runs', false, e.message); process.exit(1) }
{
const tb = (await oneP('dahirou', `select public.tableau_associes() as t`)).t
const agro = tb.find((x) => x.id === NEG)
const ferme = tb.find((x) => x.type === 'elevage' && x.id === fermeAli)
ok('dahirou sees both companies on one page', !!agro && !!ferme, JSON.stringify(tb.map((x) => [x.nom, x.type, x.sites])))
ok('the farm groups all its sites', Array.isArray(ferme.sites) && ferme.sites.length >= 2, JSON.stringify(ferme.sites))
const caisseAgro = Number((await db.query(`select coalesce(sum(solde), 0) s from public.soldes_caisses where ferme_id = $1`, [NEG])).rows[0].s)
ok('the trading company cash matches its cash boxes', Number(agro.caisse) === caisseAgro, `${agro.caisse} vs ${caisseAgro}`)
const recv = Number((await db.query(`select coalesce(sum(public.reste_a_payer_vente(id)), 0) s from public.ventes where ferme_id = $1 and a_credit and not annulee`, [NEG])).rows[0].s)
ok('to collect matches the unpaid sales', Number(agro.a_recevoir) === recv && Number(agro.groupe_a_recevoir) > 0, JSON.stringify([agro.a_recevoir, recv, agro.groupe_a_recevoir]))
ok('the farm shows its flocks and birds', Number(ferme.bandes) >= 1 && Number(ferme.poulets) >= 0)
await expectErr('the employee does not see the partners dashboard', 'employe', `select public.tableau_associes()`, [], 'associés')
await expectErr('the seller does not see it either', 'vendeur', `select public.tableau_associes()`, [], 'associés')
}

// ---------- 0057: purchase prices and price rise alert ----------
try {
  await db.exec(readFileSync(new URL('0057_prix_achats.sql', MIG), 'utf8'))
  ok('migration 0057 runs', true)
} catch (e) { ok('migration 0057 runs', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [NEG])
const MA = (await db.query(`select id from public.articles where ferme_id = $1 and nom = 'Maïs'`, [NEG])).rows[0].id
const F1 = (await oneP('kenfack', `insert into public.tiers (type_tiers, nom) values ('fournisseur', 'Grossiste Mokolo') returning id`)).id
const F2 = (await oneP('kenfack', `insert into public.tiers (type_tiers, nom) values ('fournisseur', 'Coopérative Obala') returning id`)).id
const achat = (q, m, four) => as('kenfack', `insert into public.depenses (portee, activite, categorie, libelle, montant, mode_paiement, article_id, quantite, fournisseur_id) values ('ferme', 'chair', 'aliment', 'Maïs', $2, 'especes', $1, $3, $4)`, [MA, m, q, four])
await db.exec(`delete from public.notifications where type_notification = 'hausse_prix'`)
await achat(100, 21000, F2)                          // 210 F/kg, close to the 200 F/kg before
ok('a normal price raises no alert', (await db.query(`select count(*)::int n from public.notifications where type_notification = 'hausse_prix'`)).rows[0].n === 0)
await achat(100, 25000, F1)                          // 250 F/kg: about +22 % on the last purchases
const al = (await db.query(`select role_destinataire::text r, message from public.notifications where type_notification = 'hausse_prix'`)).rows
ok('a price 10 % higher alerts ali, kenfack and dahirou', al.length === 3 && al[0].message.includes('Maïs') && al[0].message.includes('Grossiste Mokolo'), JSON.stringify(al[0]))
const hist = (await as('kenfack', `select fournisseur, prix_unitaire from public.prix_achats where article_id = $1 order by date_depense, depense_id`, [MA])).rows
ok('the price history keeps each purchase with its supplier and unit price', hist.length === 3 && hist.some((h) => h.fournisseur === 'Coopérative Obala' && Number(h.prix_unitaire) === 210), JSON.stringify(hist))
ok('the employee does not see purchase prices', (await as('employe', `select * from public.prix_achats`)).rows.length === 0)
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
}

// ---------- 0058: client trust score ----------
try {
  await db.exec(readFileSync(new URL('0058_confiance_clients.sql', MIG), 'utf8'))
  await db.exec(readFileSync(new URL('0058_confiance_clients.sql', MIG), 'utf8'))
  ok('migration 0058 runs (twice without error)', true)
} catch (e) { ok('migration 0058 runs (twice without error)', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [NEG])
const ALI2 = (await db.query(`select id from public.articles where ferme_id = $1 and categorie = 'aliment' order by created_at limit 1`, [NEG])).rows[0].id
await as('kenfack', `insert into public.mouvements_stock (article_id, type_mouvement, quantite) values ($1, 'entree', 50)`, [ALI2])
const client = async (nom) => { const id = (await oneP('kenfack', `select public.client_par_nom($1) as id`, [nom])).id; await as('kenfack', `update public.tiers set credit_autorise = true, plafond_credit = 1000000 where id = $1`, [id]); return id }
const vente = async (cl, jours) => (await oneP('kenfack', `insert into public.ventes (client_id, produit, article_id, unite, quantite, prix_unitaire, a_credit, montant_encaisse, mode_paiement, date_vente) values ($1, 'marchandise', $2, 'sac', 2, 16000, true, 0, null, current_date - $3::int) returning id`, [cl, ALI2, jours])).id
const payer = (v, jours) => as('dahirou', `insert into public.paiements_clients (vente_id, montant, mode_paiement, date_paiement) values ($1, 32000, 'especes', current_date - $2::int)`, [v, jours])
const BON = await client('Bon Payeur Test'); await payer(await vente(BON, 40), 30); await payer(await vente(BON, 20), 12)   // paid in 10 and 8 days
const LENT = await client('Lent Payeur Test'); await payer(await vente(LENT, 80), 30)                                        // paid in 50 days
const MAUVAIS = await client('Mauvais Payeur Test'); await vente(MAUVAIS, 75)                                                // unpaid for 75 days
const NOUVEAU = (await oneP('kenfack', `select public.client_par_nom('Nouveau Test') as id`)).id
const note = async (id) => (await as('kenfack', `select note, delai_moyen, plafond_conseille, achat_mensuel from public.confiance_clients where client_id = $1`, [id])).rows[0]
const nb = await note(BON), nl = await note(LENT), nm = await note(MAUVAIS), nn = await note(NOUVEAU)
ok('a client who pays in about 9 days is rated A', nb.note === 'A' && Number(nb.delai_moyen) === 9, JSON.stringify(nb))
ok('a client who paid in 50 days is rated C', nl.note === 'C', JSON.stringify(nl))
ok('a client with a debt of 75 days is rated D, no credit advised', nm.note === 'D' && Number(nm.plafond_conseille) === 0, JSON.stringify(nm))
ok('a client without credit history is « nouveau »', nn.note === 'nouveau' && nn.plafond_conseille === null, JSON.stringify(nn))
ok('advised ceiling for A = 2 months of purchases', Number(nb.plafond_conseille) === Math.round((2 * Number(nb.achat_mensuel)) / 5000) * 5000, JSON.stringify(nb))
ok('group companies are not rated', (await as('kenfack', `select 1 from public.confiance_clients c join public.tiers t on t.id = c.client_id where t.ferme_liee_id is not null`)).rows.length === 0)
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
}

// ---------- 0059: monthly report ----------
try {
  await db.exec(readFileSync(new URL('0059_rapport_mensuel.sql', MIG), 'utf8'))
  await db.exec(readFileSync(new URL('0059_rapport_mensuel.sql', MIG), 'utf8'))
  ok('migration 0059 runs (twice without error)', true)
} catch (e) { ok('migration 0059 runs (twice without error)', false, e.message); process.exit(1) }
{
const rp = (await oneP('dahirou', `select public.rapport_mois(current_date) as r`)).r
const agro = rp.societes.find((s) => s.id === NEG), ferme = rp.societes.find((s) => s.id === fermeAli)
ok('the report covers the month for both companies', !!agro && !!ferme && rp.debut.endsWith('-01'), JSON.stringify([rp.debut, rp.fin, rp.societes.length]))
const caisseAgro = Number((await db.query(`select coalesce(sum(solde), 0) s from public.soldes_caisses where ferme_id = $1`, [NEG])).rows[0].s)
ok('money at the end of the current month = cash today', Number(agro.argent_fin) === caisseAgro, `${agro.argent_fin} vs ${caisseAgro}`)
const recv = Number((await db.query(`select coalesce(sum(public.reste_a_payer_vente(id)), 0) s from public.ventes where ferme_id = $1 and a_credit and not annulee`, [NEG])).rows[0].s)
ok('to collect at the end of the current month = unpaid today', Number(agro.a_recevoir_fin) === recv, `${agro.a_recevoir_fin} vs ${recv}`)
ok('best clients and products are listed', agro.top_clients.length > 0 && agro.top_produits.length > 0)
ok('the farm shows its production', Number(ferme.mortalite) >= 0 && 'oeufs' in ferme && 'poulets_vendus' in ferme)
const vieux = (await oneP('dahirou', `select public.rapport_mois((current_date - interval '13 months')::date) as r`)).r
ok('an old month without activity shows zero sales', vieux.societes.every((s) => Number(s.ventes) === 0))
await expectErr('the employee cannot read the report', 'employe', `select public.rapport_mois(current_date)`, [], 'associés')
await db.exec(`delete from public.notifications where type_notification = 'rapport_mensuel'`)
await db.exec(`select public.rappel_rapport_mensuel(); select public.rappel_rapport_mensuel();`)
ok('the 1st of the month the partners are told, once', (await db.query(`select count(*)::int n from public.notifications where type_notification = 'rapport_mensuel' and ferme_id = $1`, [fermeAli])).rows[0].n === 3)
}

// ---------- 0060: field measures (spoons, buckets) ----------
try {
  await db.exec(readFileSync(new URL('0060_mesures_terrain.sql', MIG), 'utf8'))
  await db.exec(readFileSync(new URL('0060_mesures_terrain.sql', MIG), 'utf8'))
  ok('migration 0060 runs (twice without error)', true)
} catch (e) { ok('migration 0060 runs (twice without error)', false, e.message); process.exit(1) }
{
for (const who of ['kenfack', 'dahirou', 'ali']) await as(who, `select public.changer_ferme($1)`, [fermeAli])
ok('stock quantities keep 3 decimals', (await db.query(`select numeric_scale s from information_schema.columns where table_schema = 'public' and table_name = 'mouvements_stock' and column_name = 'quantite'`)).rows[0].s === 3)
await expectOk('the rebuilt stock views are still readable', 'kenfack', `select * from public.stock_articles limit 1`)
await expectOk('the rebuilt flock results are still readable', 'dahirou', `select * from public.resultat_bandes limit 1`)
await expectErr('the average cost stays closed to users, as before', 'kenfack', `select * from public.cout_moyen_articles`, [], 'permission denied')
await expectErr('anonymous still cannot read the stock', null, `select * from public.stock_articles`, [], 'permission denied')
const VIT = (await oneP('kenfack', `insert into public.articles (nom, categorie, unite, mesure, mesure_par_unite) values ('Vitamine liquide', 'medicament', 'litre', 'cuillere_cafe', 200) returning id`)).id
const SANS = (await oneP('kenfack', `insert into public.articles (nom, categorie, unite) values ('Désinfectant', 'medicament', 'litre') returning id`)).id
await expectErr('a measure needs its count', 'kenfack', `insert into public.articles (nom, categorie, unite, mesure) values ('X', 'medicament', 'litre', 'seau')`, [], 'articles_mesure_check')
await as('kenfack', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, cout_unitaire) values ($1, 'entree', 2, 8000), ($2, 'entree', 1, 3000)`, [VIT, SANS])
const B = (await db.query(`select id from public.bandes where ferme_id = $1 and statut <> 'cloturee' order by created_at limit 1`, [fermeAli])).rows[0].id
await expectOk('the worker gives 3 teaspoons to a flock', 'employe', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, mesure_nombre, bande_id) values ($1, 'sortie', 0.02, 3, $2)`, [VIT, B])
const mv = (await db.query(`select quantite, mesure from public.mouvements_stock where article_id = $1 and type_mouvement = 'sortie'`, [VIT])).rows[0]
ok('3 teaspoons = 0.015 litre, computed by the database', Number(mv.quantite) === 0.015 && mv.mesure === 'cuillere_cafe', JSON.stringify(mv))
ok('the stock goes down by 0.015 litre', Number((await db.query(`select public.stock_article($1) s`, [VIT])).rows[0].s) === 1.985)
await expectErr('no spoons for a product without a field measure', 'employe', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, mesure_nombre, bande_id) values ($1, 'sortie', 0.01, 3, $2)`, [SANS, B], 'mesure de terrain')
}

// ---------- 0061: syringe measure ----------
try {
  await db.exec(readFileSync(new URL('0061_mesure_seringue.sql', MIG), 'utf8'))
  await db.exec(readFileSync(new URL('0061_mesure_seringue.sql', MIG), 'utf8'))
  ok('migration 0061 runs (twice without error)', true)
} catch (e) { ok('migration 0061 runs (twice without error)', false, e.message); process.exit(1) }
{
const CAL = (await oneP('kenfack', `insert into public.articles (nom, categorie, unite, mesure, mesure_par_unite) values ('Calcium D3', 'medicament', 'litre', 'seringue', 100) returning id`)).id
await as('kenfack', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, cout_unitaire) values ($1, 'entree', 1, 5000)`, [CAL])
const B = (await db.query(`select id from public.bandes where ferme_id = $1 and statut <> 'cloturee' order by created_at limit 1`, [fermeAli])).rows[0].id
await expectOk('the worker gives 4 syringes of 10 ml', 'employe', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, mesure_nombre, bande_id) values ($1, 'sortie', 0.04, 4, $2)`, [CAL, B])
ok('4 syringes = 0.04 litre', Number((await db.query(`select public.stock_article($1) s`, [CAL])).rows[0].s) === 0.96)
}

// ---------- 0062: stock per flock ----------
try {
  await db.exec(readFileSync(new URL('0062_stock_par_bande.sql', MIG), 'utf8'))
  await db.exec(readFileSync(new URL('0062_stock_par_bande.sql', MIG), 'utf8'))
  ok('migration 0062 runs (twice without error)', true)
} catch (e) { ok('migration 0062 runs (twice without error)', false, e.message); process.exit(1) }
{
const BA = (await oneP('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('SB-A', current_date - 10, 1000) returning id`)).id
const BB = (await oneP('kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('SB-B', current_date - 2, 500) returning id`)).id
const ALI = (await oneP('kenfack', `insert into public.articles (nom, categorie, unite, poids_unitaire_kg) values ('Démarrage SB', 'aliment', 'sac', 50) returning id`)).id
const VIT = (await oneP('kenfack', `insert into public.articles (nom, categorie, unite) values ('Vitamine SB', 'medicament', 'litre') returning id`)).id
await as('kenfack', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, cout_unitaire) values ($1, 'entree', 30, 15000), ($2, 'entree', 2, 8000)`, [ALI, VIT])
await as('kenfack', `insert into public.mortalites (bande_id, date_constat, nombre) values ($1, current_date - 5, 50)`, [BA])
await expectErr('finance does not move stock', 'dahirou', `select public.mettre_en_stock_bande($1, $2::jsonb)`, [BA, JSON.stringify([{ article_id: ALI, quantite: 5 }])], 'exploitation')
await expectOk('kenfack puts 20 bags and 1 litre in the stock of SB-A', 'kenfack', `select public.mettre_en_stock_bande($1, $2::jsonb, current_date - 10)`, [BA, JSON.stringify([{ article_id: ALI, quantite: 20 }, { article_id: VIT, quantite: 1 }])])
await expectErr('only 10 bags left in the general stock', 'kenfack', `select public.mettre_en_stock_bande($1, $2::jsonb)`, [BB, JSON.stringify([{ article_id: ALI, quantite: 15 }])], 'Stock général insuffisant')
ok('general stock 10 bags, flock stock 20', Number((await oneP('kenfack', `select public.stock_general($1) g, public.stock_bande($2, $1) b`, [ALI, BA])).g) === 10)
await expectErr('a count above what the flock received is refused', 'kenfack', `select public.compter_stock_bande($1, $2::jsonb)`, [BA, JSON.stringify([{ article_id: ALI, reste: 21 }])], 'mettez d')
const r = (await oneP('kenfack', `select public.compter_stock_bande($1, $2::jsonb) r`, [BA, JSON.stringify([{ article_id: ALI, reste: 4 }, { article_id: VIT, reste: 0.45 }])])).r
ok('counting 4 bags left: 16 bags eaten over 11 days', Number(r[0].consomme) === 16 && r[0].du && Number(r[1].consomme) === 0.55, JSON.stringify(r))
const jours = (await db.query(`select date_mouvement d, quantite q from public.mouvements_stock where article_id = $1 and bande_id = $2 and type_mouvement = 'sortie' order by date_mouvement`, [ALI, BA])).rows
ok('the 16 bags are spread over the 11 days, more at the end than at the start', jours.length === 11 && Math.abs(jours.reduce((s, j) => s + Number(j.q), 0) - 16) < 0.0005 && Number(jours[10].q) > Number(jours[0].q), JSON.stringify(jours.map((j) => j.q)))
const vit = (await db.query(`select quantite q from public.mouvements_stock where article_id = $1 and bande_id = $2 and type_mouvement = 'sortie'`, [VIT, BA])).rows
ok('the vitamin is spread in equal parts', vit.length === 11 && Math.abs(vit.reduce((s, j) => s + Number(j.q), 0) - 0.55) < 0.0005)
ok('the flock stock now shows 4 bags', Number((await oneP('kenfack', `select reste from public.stock_bandes where bande_id = $1 and article_id = $2`, [BA, ALI])).reste) === 4)
await expectOk('a daily entry still lowers the flock stock', 'kenfack', `insert into public.mouvements_stock (article_id, type_mouvement, quantite, bande_id) values ($1, 'sortie', 1, $2)`, [ALI, BA])
const r2 = (await oneP('kenfack', `select public.compter_stock_bande($1, $2::jsonb) r`, [BA, JSON.stringify([{ article_id: ALI, reste: 3 }])])).r
ok('a second count the same day finds nothing more eaten', Number(r2[0].consomme) === 0, JSON.stringify(r2))
await expectErr('cannot move more than what is left', 'kenfack', `select public.deplacer_stock_bande($1, $2, $3, 5)`, [BA, BB, ALI], 'Il ne reste que')
await expectOk('the 3 bags left go to the next flock', 'kenfack', `select public.deplacer_stock_bande($1, $2, $3, 3)`, [BA, BB, ALI])
await expectOk('1 bag goes back to the general stock', 'kenfack', `select public.deplacer_stock_bande($1, null, $2, 1)`, [BB, ALI])
const fin = await oneP('kenfack', `select public.stock_bande($1, $3) a, public.stock_bande($2, $3) b, public.stock_general($3) g, public.stock_article($3) t`, [BA, BB, ALI])
ok('SB-A empty, SB-B 2 bags, general 11, farm total 13', Number(fin.a) === 0 && Number(fin.b) === 2 && Number(fin.g) === 11 && Number(fin.t) === 13, JSON.stringify(fin))
await expectErr('the employee cannot count a flock stock', 'employe', `select public.compter_stock_bande($1, $2::jsonb)`, [BB, JSON.stringify([{ article_id: ALI, reste: 1 }])], 'exploitation')
await expectNoRows('the employee does not see the flocks stocks', 'employe', `select * from public.affectations_stock`)
}

// ---------- Reset tool (supabase/outils/remise_a_zero.sql) ----------
try {
  const res = await db.exec(readFileSync(new URL('../outils/remise_a_zero.sql', MIG), 'utf8'))
  const counts = Object.fromEntries(res.at(-1).rows.map((r) => [r.element, Number(r.nombre)]))
  ok('reset keeps 6 cash boxes and accounts, empties data',
    counts['caisses (6 par ferme)'] % 6 === 0 && counts['caisses (6 par ferme)'] > 0 && counts['écritures'] === 0 && counts['bandes'] === 0 && counts['ventes'] === 0 && counts['comptes conservés'] === 6,
    JSON.stringify(counts))
  ok('cash balances back to 0', (await as('ali', `select sum(solde)::int s from public.soldes_caisses`)).rows[0].s === 0)
  ok('vaccination programme kept', (await as('kenfack', `select * from public.modeles_taches`)).rows.length === 5)
  await expectOk('farm usable after reset: opening balance', 'dahirou', `insert into public.ecritures (caisse_id, sens, montant, nature, libelle) select id, 'entree', 5000000, 'solde_initial', 'Solde initial' from public.caisses where activite = 'chair' and mode = 'especes'`)
  await expectOk('farm usable after reset: new flock', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('B1', current_date, 500)`)
} catch (e) { ok('reset script runs', false, e.message) }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
