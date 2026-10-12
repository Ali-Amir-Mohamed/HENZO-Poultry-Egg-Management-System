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

// ---------- Reset tool (supabase/outils/remise_a_zero.sql) ----------
try {
  const res = await db.exec(readFileSync(new URL('../outils/remise_a_zero.sql', MIG), 'utf8'))
  const counts = Object.fromEntries(res.at(-1).rows.map((r) => [r.element, Number(r.nombre)]))
  ok('reset keeps 6 cash boxes and accounts, empties data',
    counts['caisses (6 par ferme)'] % 6 === 0 && counts['caisses (6 par ferme)'] > 0 && counts['écritures'] === 0 && counts['bandes'] === 0 && counts['ventes'] === 0 && counts['comptes conservés'] === 5,
    JSON.stringify(counts))
  ok('cash balances back to 0', (await as('ali', `select sum(solde)::int s from public.soldes_caisses`)).rows[0].s === 0)
  ok('vaccination programme kept', (await as('kenfack', `select * from public.modeles_taches`)).rows.length === 5)
  await expectOk('farm usable after reset: opening balance', 'dahirou', `insert into public.ecritures (caisse_id, sens, montant, nature, libelle) select id, 'entree', 5000000, 'solde_initial', 'Solde initial' from public.caisses where activite = 'chair' and mode = 'especes'`)
  await expectOk('farm usable after reset: new flock', 'kenfack', `insert into public.bandes (code, date_arrivee, nombre_initial) values ('B1', current_date, 500)`)
} catch (e) { ok('reset script runs', false, e.message) }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
