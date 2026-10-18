-- =====================================================================
-- HENZO AGRO – Vente de plusieurs produits, frais de livraison, bénéfices
--   * Une seule vente pour plusieurs produits (ex. 10 sacs de démarrage,
--     5 sacs de croissance, un vaccin), avec des frais de livraison chez
--     l'éleveur si besoin : une seule facture pour le tout.
--   * Paiement comptant, ou à crédit avec un acompte (client autorisé).
--   * Bénéfices : ventes − prix d'achat des marchandises vendues (coût
--     moyen des achats) + livraisons + commissions − charges, par période,
--     et le détail par article.
--   * Comptabilité : frais de livraison facturés (7071).
-- À exécuter une fois dans Supabase > SQL Editor, après 0052.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Les frais de livraison sont une ligne de vente
-- ---------------------------------------------------------------------
alter table public.ventes drop constraint ventes_produit_check;
alter table public.ventes add constraint ventes_produit_check
  check (produit in ('poulets', 'oeufs', 'plateaux', 'poules_reformees', 'fientes', 'autre', 'marchandise', 'livraison'));
alter table public.ventes drop constraint ventes_origine_check;
alter table public.ventes add constraint ventes_origine_check check (
  (produit = 'marchandise' and article_id is not null and num_nonnulls(bande_id, lot_id) = 0)
  or (produit = 'livraison' and article_id is null and num_nonnulls(bande_id, lot_id) = 0)
  or (produit not in ('marchandise', 'livraison') and article_id is null and num_nonnulls(bande_id, lot_id) = 1));

create or replace function public.designation_vente(v public.ventes)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case v.produit
           when 'poulets' then 'Poulets de chair'
           when 'oeufs' then 'Œufs'
           when 'plateaux' then 'Plateaux d''œufs'
           when 'poules_reformees' then 'Poules réformées'
           when 'fientes' then 'Fientes'
           when 'marchandise' then coalesce((select nom from public.articles where id = v.article_id), 'Marchandise')
           when 'livraison' then 'Frais de livraison'
           else 'Produits de la ferme'
         end
         || coalesce(' (bande ' || (select code from public.bandes where id = v.bande_id) || ')', '')
         || coalesce(' (lot ' || (select code from public.lots_pondeuses where id = v.lot_id) || ')', '')
         || case when v.unite = 'kg' and v.nombre_sujets is not null then ' – ' || v.nombre_sujets || ' sujets' else '' end
$$;

create or replace function public.plan_comptable_defaut()
returns table (cle text, numero text, intitule text)
language sql
immutable
set search_path = ''
as $$
  values
    ('caisse_especes_chair', '5711', 'Caisse espèces – chair'), ('caisse_especes_pondeuse', '5712', 'Caisse espèces – pondeuses'),
    ('caisse_banque_chair', '5211', 'Banque – chair'), ('caisse_banque_pondeuse', '5212', 'Banque – pondeuses'),
    ('caisse_mobile_money_chair', '5521', 'Mobile Money – chair'), ('caisse_mobile_money_pondeuse', '5522', 'Mobile Money – pondeuses'),
    ('caisse_boutiques', '5713', 'Caisses des boutiques'), ('virements_internes', '5851', 'Virements de fonds'),
    ('clients', '4111', 'Clients'), ('fournisseurs', '4011', 'Fournisseurs'),
    ('personnel', '4221', 'Personnel, rémunérations dues'), ('cnps', '4311', 'CNPS'),
    ('etat_impots_salaires', '4471', 'État, impôts retenus sur salaires'), ('etat_is', '4411', 'État, impôt sur les bénéfices'),
    ('etat_tva_due', '4441', 'État, TVA due'), ('tva_collectee', '4431', 'TVA facturée sur ventes'),
    ('associes', '4621', 'Associés, comptes courants'), ('investisseurs', '1681', 'Autres emprunts et dettes – investisseurs'),
    ('emprunts', '1621', 'Emprunts auprès des établissements de crédit'),
    ('achat_poussins', '6021', 'Achats de poussins'), ('achat_aliment', '6022', 'Achats d''aliment'),
    ('achat_medicaments', '6023', 'Achats de produits vétérinaires'), ('main_oeuvre_ext', '6371', 'Personnel extérieur'),
    ('transport', '6181', 'Transports'), ('entretien', '6241', 'Entretien et réparations'), ('loyers', '6222', 'Locations de bâtiments'),
    ('eau_electricite', '6051', 'Eau et électricité'), ('fonctionnement', '6388', 'Autres charges externes'),
    ('autres_charges', '6588', 'Autres charges diverses'), ('impots_taxes', '6418', 'Impôts et taxes'),
    ('salaires', '6611', 'Rémunérations du personnel'), ('charges_sociales', '6641', 'Charges sociales (CNPS employeur)'),
    ('taxes_salaires', '6413', 'Taxes sur salaires (CFC, FNE)'), ('remuneration_investisseurs', '6711', 'Rémunération des investisseurs (10 %)'),
    ('ecarts_negatifs', '6581', 'Écarts de caisse négatifs'), ('produits_divers', '7588', 'Produits divers (écarts, retenues)'),
    ('vente_poulets', '7021', 'Ventes de poulets'), ('vente_oeufs', '7022', 'Ventes d''œufs'),
    ('vente_reformees', '7023', 'Ventes de poules réformées'), ('vente_fientes', '7024', 'Ventes de fientes'),
    ('vente_autres', '7028', 'Autres ventes de produits'), ('vente_marchandises', '7011', 'Ventes de marchandises'),
    ('clients_avances', '4191', 'Clients, avances et acomptes reçus'), ('commissions', '7072', 'Commissions et courtages'),
    ('frais_livraison', '7071', 'Ports et frais accessoires facturés')
$$;

insert into public.plan_comptable (ferme_id, cle, numero, intitule)
select f.id, d.cle, d.numero, d.intitule
from public.fermes f cross join public.plan_comptable_defaut() d
where d.cle = 'frais_livraison'
on conflict (ferme_id, cle) do nothing;

-- ---------------------------------------------------------------------
-- 2. Une vente de plusieurs produits = une seule facture
-- ---------------------------------------------------------------------
create or replace function public.facture_auto_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.boutique_id is not null or new.annulee then return null; end if;   -- boutique : une facture pour toute la vente, plus bas
  if coalesce(current_setting('henzo.facture_groupee', true), '') = 'on' then return null; end if;   -- vente de plusieurs produits : une facture à la fin
  begin
    perform public.facturer_ventes(array[new.id], current_date, case when new.client_id is null then 'Client comptant' end, null);
  exception when others then
    perform public.notifier(new.ferme_id, 'directeur', 'facture_auto', 'Facture non créée pour une vente : ' || sqlerrm, '/argent');
  end;
  return null;
end;
$$;

-- p_lignes : [{ "article_id": "…", "quantite": 10, "prix": 16200 }, …] ; renvoie la première vente (sa facture couvre toute la vente)
create function public.vendre_marchandises(p_client uuid, p_lignes jsonb, p_livraison numeric default 0, p_mode public.mode_paiement default 'especes',
                                           p_a_credit boolean default false, p_acompte numeric default 0, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_acompte numeric := round(coalesce(p_acompte, 0));
  v_montant numeric;
  v_encaisse numeric;
  v_groupe boolean;
begin
  if not public.a_role('exploitation', 'employe') then raise exception 'Seuls l''exploitation et les employés vendent la marchandise'; end if;
  if (select type_activite from public.fermes where id = public.ferme_actuelle()) <> 'negoce' then raise exception 'Cette vente se fait dans HENZO AGRO'; end if;
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) = 0 then raise exception 'Ajoutez au moins un produit'; end if;
  if v_acompte < 0 or coalesce(p_livraison, 0) < 0 then raise exception 'Montant impossible'; end if;
  select ferme_liee_id is not null into v_groupe from public.tiers where id = p_client;
  if coalesce(v_groupe, false) and coalesce(p_livraison, 0) > 0 then raise exception 'Pas de frais de livraison pour une société du groupe'; end if;

  perform set_config('henzo.facture_groupee', 'on', true);
  for l in select * from jsonb_array_elements(p_lignes) loop
    if coalesce((l ->> 'quantite')::numeric, 0) <= 0 then raise exception 'Indiquez la quantité de chaque produit'; end if;
    if coalesce((l ->> 'prix')::numeric, -1) < 0 then raise exception 'Indiquez le prix de chaque produit'; end if;
    v_montant := round((l ->> 'quantite')::numeric * (l ->> 'prix')::numeric);
    v_encaisse := case when p_a_credit then least(v_acompte, v_montant) else 0 end;
    v_acompte := v_acompte - v_encaisse;
    insert into public.ventes (client_id, produit, article_id, unite, quantite, prix_unitaire, date_vente, a_credit, montant_encaisse, mode_paiement)
    values (p_client, 'marchandise', (l ->> 'article_id')::uuid, 'piece', (l ->> 'quantite')::numeric, round((l ->> 'prix')::numeric),
            coalesce(p_date, current_date), p_a_credit, v_encaisse, p_mode)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  if coalesce(p_livraison, 0) > 0 then
    v_encaisse := case when p_a_credit then least(v_acompte, round(p_livraison)) else 0 end;
    v_acompte := v_acompte - v_encaisse;
    insert into public.ventes (client_id, produit, unite, quantite, prix_unitaire, date_vente, a_credit, montant_encaisse, mode_paiement, notes)
    values (p_client, 'livraison', 'piece', 1, round(p_livraison), coalesce(p_date, current_date), p_a_credit, v_encaisse, p_mode, 'Livraison chez le client')
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_acompte > 0 then raise exception 'L''acompte dépasse le total de la vente'; end if;
  perform set_config('henzo.facture_groupee', 'off', true);

  begin
    perform public.facturer_ventes(v_ids, current_date, case when p_client is null then 'Client comptant' end, null);
  exception when others then
    perform public.notifier(public.ferme_actuelle(), 'directeur', 'facture_auto', 'Facture non créée pour une vente : ' || sqlerrm, '/argent');
  end;
  return v_ids[1];
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Bénéfices
-- ---------------------------------------------------------------------
-- By article: sold, sales, purchase cost of what was sold (average purchase cost), margin
create function public.benefices_articles(p_debut date, p_fin date)
returns table (article_id uuid, nom text, categorie text, unite text, quantite numeric, ventes numeric, cout numeric, marge numeric, cout_connu boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.nom, a.categorie, a.unite, sum(v.quantite), sum(v.montant),
         round(sum(v.quantite) * coalesce(c.cout_unitaire_moyen, 0)),
         sum(v.montant) - round(sum(v.quantite) * coalesce(c.cout_unitaire_moyen, 0)),
         c.cout_unitaire_moyen is not null
  from public.ventes v
  join public.articles a on a.id = v.article_id
  left join public.cout_moyen_articles c on c.article_id = a.id
  where public.a_role('directeur', 'exploitation', 'finance', 'comptable')
    and v.ferme_id = public.ferme_actuelle() and v.produit = 'marchandise' and not v.annulee
    and v.date_vente between p_debut and p_fin
  group by a.id, a.nom, a.categorie, a.unite, c.cout_unitaire_moyen
  order by sum(v.montant) desc
$$;

-- The period at a glance
create function public.resume_benefices(p_debut date, p_fin date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ventes numeric; v_cout numeric; v_livraisons numeric; v_commissions numeric; v_charges numeric; v_inconnu integer;
begin
  if not public.a_role('directeur', 'exploitation', 'finance', 'comptable') then raise exception 'Accès refusé'; end if;
  select coalesce(sum(ventes), 0), coalesce(sum(cout), 0), count(*) filter (where not cout_connu)
  into v_ventes, v_cout, v_inconnu from public.benefices_articles(p_debut, p_fin);
  select coalesce(sum(montant), 0) into v_livraisons from public.ventes
  where ferme_id = public.ferme_actuelle() and produit = 'livraison' and not annulee and date_vente between p_debut and p_fin;
  select coalesce(sum(commission_montant), 0) into v_commissions from public.commandes_eleveurs
  where ferme_id = public.ferme_actuelle() and statut = 'livree' and livree_le::date between p_debut and p_fin;
  -- charges: every validated expense except stock purchases (counted in the cost of what is sold) and partners' withdrawals
  select coalesce(sum(montant), 0) into v_charges from public.depenses
  where ferme_id = public.ferme_actuelle() and statut = 'validee' and not annulee and article_id is null
    and categorie <> 'retrait_associe' and date_depense between p_debut and p_fin;
  return jsonb_build_object('ventes', v_ventes, 'cout', v_cout, 'marge', v_ventes - v_cout, 'livraisons', v_livraisons,
    'commissions', v_commissions, 'charges', v_charges, 'benefice', v_ventes - v_cout + v_livraisons + v_commissions - v_charges,
    'articles_sans_cout', v_inconnu);
end;
$$;

revoke execute on function public.vendre_marchandises(uuid, jsonb, numeric, public.mode_paiement, boolean, numeric, date),
                          public.benefices_articles(date, date), public.resume_benefices(date, date) from public, anon;
grant execute on function public.vendre_marchandises(uuid, jsonb, numeric, public.mode_paiement, boolean, numeric, date),
                          public.benefices_articles(date, date), public.resume_benefices(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Journal comptable : frais de livraison facturés
-- ---------------------------------------------------------------------
create or replace view public.journal_comptable_brut with (security_invoker = true) as
with
-- Comptes des caisses
cx as (select id, ferme_id, 'caisse_' || mode || '_' || activite as cle,
              case mode when 'especes' then 'CA' when 'banque' then 'BQ' else 'MM' end as journal
       from public.caisses),
-- Usage d'un impôt payé
imp as (select depense_id, type_impot from public.paiements_impots),
-- Dépenses de salaires liées à une paie ou à une avance
sal as (select depense_id from public.paies where depense_id is not null
        union select depense_id from public.avances_salaire where depense_id is not null),
-- Compte de contrepartie de chaque mouvement de caisse (une annulation reprend celui de l'opération d'origine ;
-- une correction manuelle du directeur est un écart de caisse)
ec as (
  select e.*, coalesce(o.nature, e.nature) as nature_origine, coalesce(o.libelle, e.libelle) as libelle_origine,
         coalesce(e.depense_id, o.depense_id) as dep_id
  from public.ecritures e
  left join public.ecritures o on o.id = e.ecriture_corrigee_id and e.nature = 'annulation'
),
ec2 as (
  select ec.*, cx.cle as cle_caisse, cx.journal,
    case ec.nature_origine
      when 'vente' then 'clients'
      when 'encaissement_creance' then 'clients'
      when 'paiement_fournisseur' then 'fournisseurs'
      when 'depense' then
        case
          when d.categorie = 'salaires' then 'personnel'
          when d.categorie = 'retrait_associe' then 'associes'
          when d.categorie = 'cotisations_sociales' then 'cnps'
          when d.categorie = 'impots_taxes' and imp.type_impot = 'impots_salaires' then 'etat_impots_salaires'
          when d.categorie = 'impots_taxes' and imp.type_impot in ('acompte_is', 'solde_is') then 'etat_is'
          when d.categorie = 'impots_taxes' and imp.type_impot = 'tva' then 'etat_tva_due'
          else 'fournisseurs'
        end
      when 'solde_initial' then
        case when ec.libelle_origine like 'Démarrage : investissement%' then 'investisseurs'
             when ec.libelle_origine like 'Démarrage : prêt%' then 'emprunts'
             else 'associes' end
      when 'apport_investisseur' then 'investisseurs'
      when 'retrait_investisseur' then 'investisseurs'
      when 'versement_investisseur' then 'remuneration_investisseurs'
      when 'pret_recu' then 'emprunts'
      when 'remboursement_pret' then 'emprunts'
      when 'transfert' then 'virements_internes'
      when 'versement_boutique' then 'caisse_boutiques'
      when 'avance_client' then 'clients_avances'
      when 'remboursement_avance' then 'clients_avances'
      when 'commission' then 'commissions'
      when 'ajustement_caisse' then case when ec.sens = 'entree' then 'produits_divers' else 'ecarts_negatifs' end
      when 'correction' then case when ec.sens = 'entree' then 'produits_divers' else 'ecarts_negatifs' end
      else 'autres_charges'
    end as cle_contrepartie
  from ec
  join cx on cx.id = ec.caisse_id
  left join public.depenses d on d.id = ec.dep_id
  left join imp on imp.depense_id = ec.dep_id
),
mouvements as (
  select ferme_id, date_operation as date_ecriture, journal, 'E-' || left(id::text, 8) as piece, coalesce(libelle, libelle_origine) as libelle,
         cle_caisse as cle, case when sens = 'entree' then montant else 0 end as debit, case when sens = 'sortie' then montant else 0 end as credit,
         'ecriture' as source, id as source_id
  from ec2
  union all
  select ferme_id, date_operation, journal, 'E-' || left(id::text, 8), coalesce(libelle, libelle_origine),
         cle_contrepartie, case when sens = 'sortie' then montant else 0 end, case when sens = 'entree' then montant else 0 end,
         'ecriture', id
  from ec2
),
-- Ventes : clients (ou caisse des boutiques) / ventes de produits (+ TVA si facture avec TVA)
vt as (
  select v.*, case v.produit when 'poulets' then 'vente_poulets' when 'oeufs' then 'vente_oeufs' when 'plateaux' then 'vente_oeufs'
                             when 'poules_reformees' then 'vente_reformees' when 'fientes' then 'vente_fientes' when 'marchandise' then 'vente_marchandises' when 'livraison' then 'frais_livraison' else 'vente_autres' end as cle_produit,
         case when fa.tva_applicable then round(v.montant / (1 + fa.taux_tva / 100)) else v.montant end as ht
  from public.ventes v
  left join public.facture_lignes fl on fl.vente_id = v.id and fl.active
  left join public.factures fa on fa.id = fl.facture_id and not fa.annulee
  where not v.annulee
),
ventes as (
  select ferme_id, date_vente, case when boutique_id is null then 'VT' else 'BO' end, 'V-' || left(id::text, 8),
         'Vente ' || produit, case when boutique_id is null then 'clients' else 'caisse_boutiques' end, montant, 0::numeric, 'vente', id
  from vt
  union all
  select ferme_id, date_vente, case when boutique_id is null then 'VT' else 'BO' end, 'V-' || left(id::text, 8),
         'Vente ' || produit, cle_produit, 0, ht, 'vente', id
  from vt
  union all
  select ferme_id, date_vente, 'VT', 'V-' || left(id::text, 8), 'TVA sur vente ' || produit, 'tva_collectee', 0, montant - ht, 'vente', id
  from vt where montant - ht > 0
),
-- Achats et charges : charge / fournisseurs (les paiements sans charge – salaires payés, retraits, CNPS, impôts reversés – n'en ont pas)
ac as (
  select d.*, case d.categorie
           when 'poussins' then 'achat_poussins' when 'aliment' then 'achat_aliment' when 'medicament' then 'achat_medicaments'
           when 'main_oeuvre' then 'main_oeuvre_ext' when 'transport' then 'transport' when 'entretien' then 'entretien'
           when 'loyer' then 'loyers' when 'charges' then 'eau_electricite' when 'fonctionnement' then 'fonctionnement'
           when 'impots_taxes' then 'impots_taxes' when 'salaires' then 'salaires' else 'autres_charges' end as cle_charge,
         case when d.categorie = 'salaires' then 'personnel' else 'fournisseurs' end as cle_tiers
  from public.depenses d
  left join imp on imp.depense_id = d.id
  where d.statut = 'validee' and not d.annulee
    and d.categorie not in ('retrait_associe', 'cotisations_sociales')
    and not (d.categorie = 'impots_taxes' and coalesce(imp.type_impot, '') in ('impots_salaires', 'acompte_is', 'solde_is', 'tva'))
    and not (d.categorie = 'salaires' and d.id in (select depense_id from sal))
),
achats as (
  select ferme_id, date_depense, 'AC', 'D-' || left(id::text, 8), libelle, cle_charge, montant, 0::numeric, 'depense', id from ac
  union all
  select ferme_id, date_depense, 'AC', 'D-' || left(id::text, 8), libelle, cle_tiers, 0, montant, 'depense', id from ac
),
-- Salaires : brut / personnel ; retenues légales et charges de l'employeur / CNPS et État
pa as (
  select p.*, b.id as bulletin_id, b.cnps_salarie, b.irpp + b.cac + b.cfc_salarie + b.rav + b.tdl as impots_salarie,
         b.cnps_vieillesse_pat + b.cnps_allocations + b.cnps_accidents as cnps_patronal, b.cfc_patronal + b.fne as taxes_patronales,
         (select nom from public.employes where id = p.employe_id) as nom
  from public.paies p left join public.bulletins_paie b on b.paie_id = p.id
  where not p.annulee
),
paie as (
  select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Salaire ' || to_char(mois, 'MM/YYYY') || ' – ' || nom, 'salaires', salaire_base + primes, 0::numeric, 'paie', id from pa
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Salaire ' || to_char(mois, 'MM/YYYY') || ' – ' || nom, 'personnel', 0, salaire_base + primes, 'paie', id from pa
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Retenues légales – ' || nom, 'personnel', retenues_legales, 0, 'paie', id from pa where retenues_legales > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'CNPS salarié – ' || nom, 'cnps', 0, cnps_salarie, 'paie', id from pa where coalesce(cnps_salarie, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Impôts sur salaire – ' || nom, 'etat_impots_salaires', 0, impots_salarie, 'paie', id from pa where coalesce(impots_salarie, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Charges CNPS employeur – ' || nom, 'charges_sociales', cnps_patronal, 0, 'paie', id from pa where coalesce(cnps_patronal, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Charges CNPS employeur – ' || nom, 'cnps', 0, cnps_patronal, 'paie', id from pa where coalesce(cnps_patronal, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'CFC et FNE employeur – ' || nom, 'taxes_salaires', taxes_patronales, 0, 'paie', id from pa where coalesce(taxes_patronales, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'CFC et FNE employeur – ' || nom, 'etat_impots_salaires', 0, taxes_patronales, 'paie', id from pa where coalesce(taxes_patronales, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Retenue – ' || nom, 'personnel', retenues, 0, 'paie', id from pa where retenues > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Retenue – ' || nom, 'produits_divers', 0, retenues, 'paie', id from pa where retenues > 0
),
-- 10 % réinvestis : rémunération / dette envers l'investisseur
od as (
  select ferme_id, coalesce(decide_le, created_at)::date as d, 'OD' as j, 'R-' || left(id::text, 8) as piece,
         '10 % réinvestis' as lib, 'remuneration_investisseurs' as cle, montant as debit, 0::numeric as credit, 'distribution' as source, id
  from public.distributions_investisseurs where statut = 'reinvesti' and montant > 0
  union all
  select ferme_id, coalesce(decide_le, created_at)::date, 'OD', 'R-' || left(id::text, 8), '10 % réinvestis', 'investisseurs', 0, montant, 'distribution', id
  from public.distributions_investisseurs where statut = 'reinvesti' and montant > 0
  -- deposit paid on a chick order, used on its sale: the client owes that much less
  union all
  select ferme_id, date_vente, 'OD', 'V-' || left(id::text, 8), 'Avance déduite', 'clients_avances', avance_imputee, 0, 'vente', id
  from public.ventes where avance_imputee > 0 and not annulee
  union all
  select ferme_id, date_vente, 'OD', 'V-' || left(id::text, 8), 'Avance déduite', 'clients', 0, avance_imputee, 'vente', id
  from public.ventes where avance_imputee > 0 and not annulee
  -- deposit kept when an order is cancelled
  union all
  select ferme_id, annulee_le::date, 'OD', 'C-' || left(id::text, 8), 'Avance conservée (commande annulée)', 'clients_avances', avance_conservee, 0, 'commande', id
  from public.commandes_eleveurs where avance_conservee > 0
  union all
  select ferme_id, annulee_le::date, 'OD', 'C-' || left(id::text, 8), 'Avance conservée (commande annulée)', 'produits_divers', 0, avance_conservee, 'commande', id
  from public.commandes_eleveurs where avance_conservee > 0
)
select * from mouvements
union all select * from ventes
union all select * from achats
union all select * from paie
union all select * from od;
