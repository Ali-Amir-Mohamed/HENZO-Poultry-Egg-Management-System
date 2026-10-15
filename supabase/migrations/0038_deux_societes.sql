-- =====================================================================
-- HENZO – Deux sociétés : élevage (HENZO SARL) et négoce (société d'achat)
--   * Une « ferme » peut être une société de négoce : elle achète
--     poussins, aliment et médicaments, et les revend (stock, caisses,
--     factures, impôts et comptabilité à elle).
--   * Vente de marchandises : sortie de stock, caisse ou crédit, facture.
--   * Clients et fournisseurs « du groupe » : un client lié à une autre
--     société du groupe.
--   * Vente à une société du groupe = livraison à réceptionner chez elle :
--     l'exploitation réceptionne, l'achat (à crédit) est créé et suit la
--     validation habituelle (Dahirou). Quand l'acheteuse paie son
--     fournisseur, l'encaissement est enregistré tout seul chez la
--     vendeuse.
-- À exécuter une fois dans Supabase > SQL Editor, après 0037.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Type de société
-- ---------------------------------------------------------------------
alter table public.fermes add column type_activite text not null default 'elevage' check (type_activite in ('elevage', 'negoce'));

drop function if exists public.creer_ferme(text);
create function public.creer_ferme(p_nom text, p_type text default 'elevage')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid := public.ferme_actuelle();
  v_new uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur crée une ferme ou une société'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom'; end if;
  if coalesce(p_type, 'elevage') not in ('elevage', 'negoce') then raise exception 'Type inconnu'; end if;
  insert into public.fermes (nom, type_activite, seuil_validation_depense, taux_investisseurs, seuil_mortalite_pct, alerte_autonomie_jours,
                             seuil_tiers_obligatoire, session_minutes, oeufs_par_plateau)
  select trim(p_nom), coalesce(p_type, 'elevage'), seuil_validation_depense, taux_investisseurs, seuil_mortalite_pct, alerte_autonomie_jours,
         seuil_tiers_obligatoire, session_minutes, oeufs_par_plateau
  from public.fermes where id = v_old
  returning id into v_new;
  insert into public.caisses (ferme_id, activite, mode)
  select v_new, a, m from unnest(enum_range(null::public.activite)) a, unnest(enum_range(null::public.mode_paiement)) m;
  if coalesce(p_type, 'elevage') = 'elevage' then
    insert into public.modeles_taches (ferme_id, type_production, jour, type_tache, titre, produit, assigne_role, repeter_jours, actif)
    select v_new, type_production, jour, type_tache, titre, produit, assigne_role, repeter_jours, actif
    from public.modeles_taches where ferme_id = v_old;
  end if;
  insert into public.membres_fermes (user_id, ferme_id, role) values (auth.uid(), v_new, 'directeur');
  return v_new;
end;
$$;
revoke execute on function public.creer_ferme(text, text) from public, anon;
grant execute on function public.creer_ferme(text, text) to authenticated;

create or replace function public.mes_fermes()
returns table (ferme_id uuid, nom text, role public.role_utilisateur, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.nom, m.role, f.id = p.ferme_id
  from public.membres_fermes m
  join public.fermes f on f.id = m.ferme_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.actif
  order by f.created_at
$$;

-- Le type de chaque société du membre (pour les écrans)
create function public.mes_societes()
returns table (ferme_id uuid, nom text, type_activite text, role public.role_utilisateur, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.nom, f.type_activite, m.role, f.id = p.ferme_id
  from public.membres_fermes m
  join public.fermes f on f.id = m.ferme_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.actif
  order by f.created_at
$$;
revoke execute on function public.mes_societes() from public, anon;
grant execute on function public.mes_societes() to authenticated;

-- Plan comptable : ventes de marchandises, et achats de marchandises pour une société de négoce
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
    ('vente_autres', '7028', 'Autres ventes de produits'), ('vente_marchandises', '7011', 'Ventes de marchandises')
$$;

create or replace function public.plan_comptable_nouvelle_ferme()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.plan_comptable (ferme_id, cle, numero, intitule)
  select new.id, d.cle,
         case when new.type_activite = 'negoce' and d.cle = 'achat_poussins' then '6011'
              when new.type_activite = 'negoce' and d.cle = 'achat_aliment' then '6012'
              when new.type_activite = 'negoce' and d.cle = 'achat_medicaments' then '6013' else d.numero end,
         case when new.type_activite = 'negoce' and d.cle = 'achat_poussins' then 'Achats de marchandises – poussins'
              when new.type_activite = 'negoce' and d.cle = 'achat_aliment' then 'Achats de marchandises – aliment'
              when new.type_activite = 'negoce' and d.cle = 'achat_medicaments' then 'Achats de marchandises – produits vétérinaires'
              else d.intitule end
  from public.plan_comptable_defaut() d
  on conflict do nothing;
  return new;
end;
$$;
insert into public.plan_comptable (ferme_id, cle, numero, intitule)
select id, 'vente_marchandises', '7011', 'Ventes de marchandises' from public.fermes on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Marchandises : poussins en stock, vente d'un article
-- ---------------------------------------------------------------------
alter table public.articles drop constraint articles_categorie_check;
alter table public.articles add constraint articles_categorie_check check (categorie in ('aliment', 'medicament', 'poussins', 'autre'));

alter table public.ventes add column article_id uuid references public.articles (id);
alter table public.mouvements_stock add column vente_id uuid references public.ventes (id);
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.ventes'::regclass and contype = 'c'
             and (pg_get_constraintdef(oid) like '%num_nonnulls(bande_id, lot_id) = 1%'
                  or conname in ('ventes_produit_check', 'ventes_unite_check'))
  loop
    execute format('alter table public.ventes drop constraint %I', c);
  end loop;
end;
$$;
alter table public.ventes add constraint ventes_produit_check
  check (produit in ('poulets', 'oeufs', 'plateaux', 'poules_reformees', 'fientes', 'autre', 'marchandise'));
alter table public.ventes add constraint ventes_unite_check check (unite in ('piece', 'kg', 'plateau', 'sac', 'litre', 'dose', 'flacon'));
alter table public.ventes add constraint ventes_origine_check check (
  (produit = 'marchandise' and article_id is not null and num_nonnulls(bande_id, lot_id) = 0)
  or (produit <> 'marchandise' and article_id is null and num_nonnulls(bande_id, lot_id) = 1));

create or replace function public.activite_vente(v public.ventes)
returns public.activite
language sql
immutable
as $$ select case when v.lot_id is not null then 'pondeuse'::public.activite else 'chair'::public.activite end $$;

-- Avant la vente d'un article : article de la société, stock suffisant, unité de l'article
create function public.avant_vente_marchandise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.articles;
  v_stock numeric;
begin
  if new.produit <> 'marchandise' then return new; end if;
  select * into a from public.articles where id = new.article_id and ferme_id = new.ferme_id;
  if a.id is null then raise exception 'Article introuvable'; end if;
  select coalesce(sum(case type_mouvement when 'sortie' then -quantite else quantite end), 0) into v_stock
  from public.mouvements_stock where article_id = a.id;
  if new.quantite > v_stock then raise exception 'Stock insuffisant : il reste % % de %', v_stock, a.unite, a.nom; end if;
  new.unite := a.unite;
  new.nombre_sujets := null;
  return new;
end;
$$;
create trigger avant_vente_marchandise before insert on public.ventes
  for each row execute function public.avant_vente_marchandise();

create function public.apres_vente_marchandise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.produit = 'marchandise' then
    insert into public.mouvements_stock (ferme_id, article_id, date_mouvement, type_mouvement, quantite, vente_id, notes, saisi_par)
    values (new.ferme_id, new.article_id, new.date_vente, 'sortie', new.quantite, new.id, 'Vente', new.saisi_par);
  end if;
  return null;
end;
$$;
create trigger apres_vente_marchandise after insert on public.ventes
  for each row execute function public.apres_vente_marchandise();

-- ---------------------------------------------------------------------
-- 3. Sociétés du groupe : client / fournisseur lié
-- ---------------------------------------------------------------------
alter table public.tiers add column ferme_liee_id uuid references public.fermes (id);

create function public.lier_tiers(p_tiers uuid, p_ferme uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance lient une société du groupe'; end if;
  if p_ferme is not null then
    if p_ferme = public.ferme_actuelle() then raise exception 'Choisissez une autre société que celle-ci'; end if;
    if not exists (select 1 from public.membres_fermes where user_id = auth.uid() and ferme_id = p_ferme) then
      raise exception 'Vous n''êtes pas membre de cette société';
    end if;
  end if;
  update public.tiers set ferme_liee_id = p_ferme where id = p_tiers and ferme_id = public.ferme_actuelle();
  if not found then raise exception 'Client ou fournisseur introuvable'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Livraisons entre sociétés du groupe
-- ---------------------------------------------------------------------
create table public.achats_intersocietes (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid not null references public.fermes (id),      -- société qui achète
  ferme_vendeuse_id  uuid not null references public.fermes (id),
  vente_id           uuid not null unique references public.ventes (id),
  date_livraison     date not null,
  article_nom        text not null,
  categorie          text not null,
  quantite           numeric(12, 2) not null,
  unite              text not null,
  prix_unitaire      numeric(14, 0) not null,
  montant            numeric(16, 0) not null,
  statut             text not null default 'en_attente' check (statut in ('en_attente', 'receptionne', 'refuse', 'annule')),
  motif              text,
  depense_id         uuid references public.depenses (id),
  traite_par         uuid references public.profiles (id),
  traite_le          timestamptz,
  created_at         timestamptz not null default now()
);
create index on public.achats_intersocietes (ferme_id, statut);
create trigger journal after insert or update on public.achats_intersocietes for each row execute function public.journaliser();

-- Vente à une société du groupe : toujours à crédit (payée par la société cliente)
CREATE OR REPLACE FUNCTION public.avant_vente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_montant  numeric := round(new.quantite * new.prix_unitaire);
  v_client   public.tiers;
  v_statut   text;
begin
  -- bande / lot vendable
  if new.bande_id is not null then
    select statut into v_statut from public.bandes where id = new.bande_id;
    if v_statut = 'cloturee' then raise exception 'Cette bande est clôturée'; end if;
  end if;
  if new.nombre_sujets is not null and new.nombre_sujets > public.oiseaux_restants(new.bande_id, new.lot_id) then
    raise exception 'Il ne reste que % oiseaux dans cette bande', public.oiseaux_restants(new.bande_id, new.lot_id);
  end if;

  -- vente à une société du groupe : toujours à crédit, payée par la société cliente (pas de plafond)
  select * into v_client from public.tiers where id = new.client_id;
  if v_client.ferme_liee_id is not null then
    new.a_credit := true;
    new.montant_encaisse := 0;
    new.mode_paiement := null;
  elsif not new.a_credit then
    if new.mode_paiement is null then raise exception 'Choisissez le mode de paiement'; end if;
    new.montant_encaisse := v_montant;
  else
    if new.montant_encaisse > v_montant then raise exception 'L''acompte dépasse le montant de la vente'; end if;
    if not v_client.credit_autorise then
      raise exception 'Le crédit n''est pas autorisé pour ce client';
    end if;
    if public.encours_client(new.client_id) + (v_montant - new.montant_encaisse) > v_client.plafond_credit then
      raise exception 'Plafond de crédit dépassé pour ce client (plafond : % FCFA)', v_client.plafond_credit;
    end if;
  end if;

  -- prix du moment
  select prix into new.prix_reference from public.prix_vente
  where ferme_id = new.ferme_id and produit = new.produit and unite = new.unite and date_debut <= new.date_vente
  order by date_debut desc, created_at desc limit 1;

  new.annulee := false;
  new.annulee_par := null; new.annulee_le := null; new.motif_annulation := null;
  return new;
end;
$function$;

-- Désignation sur facture d'une vente de marchandise
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
           else 'Produits de la ferme'
         end
         || coalesce(' (bande ' || (select code from public.bandes where id = v.bande_id) || ')', '')
         || coalesce(' (lot ' || (select code from public.lots_pondeuses where id = v.lot_id) || ')', '')
         || case when v.unite = 'kg' and v.nombre_sujets is not null then ' – ' || v.nombre_sujets || ' sujets' else '' end
$$;

-- Journal : ventes de marchandises
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
                             when 'poules_reformees' then 'vente_reformees' when 'fientes' then 'vente_fientes' when 'marchandise' then 'vente_marchandises' else 'vente_autres' end as cle_produit,
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
)
select * from mouvements
union all select * from ventes
union all select * from achats
union all select * from paie
union all select * from od;

-- Une vente de marchandise à une société du groupe : livraison à réceptionner chez elle
create function public.livraison_intersociete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tiers;
  a public.articles;
  v_nom text;
begin
  if new.produit <> 'marchandise' or new.client_id is null then return null; end if;
  select * into t from public.tiers where id = new.client_id;
  if t.ferme_liee_id is null then return null; end if;
  select * into a from public.articles where id = new.article_id;
  select coalesce(raison_sociale, nom) into v_nom from public.fermes where id = new.ferme_id;
  insert into public.achats_intersocietes (ferme_id, ferme_vendeuse_id, vente_id, date_livraison, article_nom, categorie, quantite, unite, prix_unitaire, montant)
  values (t.ferme_liee_id, new.ferme_id, new.id, new.date_vente, a.nom, a.categorie, new.quantite, new.unite, new.prix_unitaire, new.montant);
  perform public.notifier(t.ferme_liee_id, r, 'livraison_groupe',
    format('Livraison de %s : %s %s de %s (%s FCFA) à réceptionner', v_nom, new.quantite, new.unite, a.nom, new.montant), '/stock')
  from unnest(array['exploitation', 'finance']::public.role_utilisateur[]) r;
  return null;
end;
$$;
create trigger livraison_intersociete after insert on public.ventes
  for each row execute function public.livraison_intersociete();

-- Annuler une vente au groupe : seulement tant que l'acheteuse n'a pas réceptionné
create function public.annulation_vente_groupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai public.achats_intersocietes;
begin
  if new.annulee and not old.annulee then
    select * into ai from public.achats_intersocietes where vente_id = new.id;
    if ai.id is not null then
      if ai.statut = 'receptionne' then
        raise exception 'La société cliente a déjà réceptionné cette livraison : elle doit d''abord annuler son achat';
      end if;
      update public.achats_intersocietes set statut = 'annule', motif = new.motif_annulation, traite_le = now() where id = ai.id and statut = 'en_attente';
    end if;
  end if;
  return new;
end;
$$;
create trigger annulation_vente_groupe before update of annulee on public.ventes
  for each row execute function public.annulation_vente_groupe();

-- Annuler une vente de marchandise : l'article revient en stock
create function public.annulation_vente_marchandise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.produit = 'marchandise' and new.annulee and not old.annulee then
    insert into public.mouvements_stock (ferme_id, article_id, date_mouvement, type_mouvement, quantite, vente_id, notes, saisi_par)
    values (new.ferme_id, new.article_id, current_date, 'entree', new.quantite, new.id, 'Annulation de vente', coalesce(auth.uid(), new.saisi_par));
  end if;
  return null;
end;
$$;
create trigger annulation_vente_marchandise after update of annulee on public.ventes
  for each row execute function public.annulation_vente_marchandise();

-- Réceptionner (exploitation de la société acheteuse) : crée l'achat à crédit chez elle
create function public.receptionner_livraison_groupe(p_achat uuid, p_article uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai public.achats_intersocietes;
  v_four uuid;
  v_article uuid;
  v_cat text;
  v_vendeuse public.fermes;
  v_dep uuid;
begin
  if not public.a_role('exploitation') then raise exception 'Seule l''exploitation réceptionne une livraison'; end if;
  select * into ai from public.achats_intersocietes where id = p_achat and ferme_id = public.ferme_actuelle() for update;
  if ai.id is null then raise exception 'Livraison introuvable'; end if;
  if ai.statut <> 'en_attente' then raise exception 'Cette livraison est déjà traitée'; end if;
  select * into v_vendeuse from public.fermes where id = ai.ferme_vendeuse_id;
  -- le fournisseur = la société vendeuse (créé s'il n'existe pas encore)
  select id into v_four from public.tiers where ferme_id = ai.ferme_id and ferme_liee_id = ai.ferme_vendeuse_id order by created_at limit 1;
  if v_four is null then
    insert into public.tiers (ferme_id, type_tiers, nom, ferme_liee_id, telephone, adresse, niu, rccm, cree_par)
    values (ai.ferme_id, 'fournisseur', coalesce(v_vendeuse.raison_sociale, v_vendeuse.nom), ai.ferme_vendeuse_id,
            v_vendeuse.telephone_societe, v_vendeuse.adresse_siege, v_vendeuse.niu, v_vendeuse.rccm, auth.uid())
    returning id into v_four;
  end if;
  v_cat := case ai.categorie when 'aliment' then 'aliment' when 'medicament' then 'medicament' when 'poussins' then 'poussins' else 'autre_ferme' end;
  if v_cat in ('aliment', 'medicament') then
    if p_article is not null then
      select id into v_article from public.articles where id = p_article and ferme_id = ai.ferme_id and categorie = ai.categorie;
      if v_article is null then raise exception 'Choisissez un produit de stock de la même catégorie'; end if;
    else
      select id into v_article from public.articles where ferme_id = ai.ferme_id and lower(nom) = lower(ai.article_nom);
      if v_article is null then
        insert into public.articles (ferme_id, nom, categorie, unite) values (ai.ferme_id, ai.article_nom, ai.categorie,
          case when ai.unite in ('kg', 'sac', 'litre', 'dose', 'flacon', 'piece') then ai.unite else 'piece' end)
        returning id into v_article;
      end if;
    end if;
  end if;
  insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, fournisseur_id, a_credit, montant_paye,
                               article_id, quantite, notes, saisi_par)
  values (ai.ferme_id, ai.date_livraison, 'ferme', 'chair', v_cat,
          format('%s – %s %s (%s)', ai.article_nom, ai.quantite, ai.unite, coalesce(v_vendeuse.raison_sociale, v_vendeuse.nom)),
          ai.montant, v_four, true, 0, v_article, case when v_article is not null then ai.quantite end,
          'Livraison d''une société du groupe', auth.uid())
  returning id into v_dep;
  update public.achats_intersocietes set statut = 'receptionne', depense_id = v_dep, traite_par = auth.uid(), traite_le = now() where id = ai.id;
  return v_dep;
end;
$$;

create function public.refuser_livraison_groupe(p_achat uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai public.achats_intersocietes;
begin
  if not public.a_role('exploitation', 'finance') then raise exception 'Seules l''exploitation et la finance refusent une livraison'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du refus'; end if;
  update public.achats_intersocietes set statut = 'refuse', motif = trim(p_motif), traite_par = auth.uid(), traite_le = now()
  where id = p_achat and ferme_id = public.ferme_actuelle() and statut = 'en_attente'
  returning * into ai;
  if ai.id is null then raise exception 'Livraison introuvable ou déjà traitée'; end if;
  perform public.notifier(ai.ferme_vendeuse_id, r, 'livraison_refusee',
    format('Livraison refusée par le client du groupe : %s %s de %s (%s)', ai.quantite, ai.unite, ai.article_nom, trim(p_motif)), '/argent')
  from unnest(array['directeur', 'exploitation', 'finance']::public.role_utilisateur[]) r;
end;
$$;

-- L'acheteuse annule son achat : la livraison redevient « à réceptionner » (ou la vendeuse annule sa vente)
create function public.annulation_achat_groupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.annulee and not old.annulee then
    update public.achats_intersocietes set statut = 'en_attente', depense_id = null, traite_par = null, traite_le = null
    where depense_id = new.id and statut = 'receptionne';
  end if;
  return null;
end;
$$;
create trigger annulation_achat_groupe after update of annulee on public.depenses
  for each row execute function public.annulation_achat_groupe();

-- Paiement : quand l'acheteuse paie la société du groupe, l'encaissement est enregistré chez la vendeuse
create function public.paiement_groupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai public.achats_intersocietes;
begin
  select * into ai from public.achats_intersocietes where depense_id = new.depense_id and statut = 'receptionne';
  if ai.id is null then return null; end if;
  perform set_config('henzo.paiement_groupe', 'on', true);
  insert into public.paiements_clients (ferme_id, vente_id, date_paiement, montant, mode_paiement, notes, saisi_par)
  values (ai.ferme_vendeuse_id, ai.vente_id, new.date_paiement, new.montant, new.mode_paiement, 'Payé par la société du groupe', new.saisi_par);
  perform set_config('henzo.paiement_groupe', 'off', true);
  return null;
end;
$$;
create trigger paiement_groupe after insert on public.paiements_fournisseurs
  for each row execute function public.paiement_groupe();

create function public.controle_paiement_groupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('henzo.paiement_groupe', true), 'off') <> 'on'
     and exists (select 1 from public.achats_intersocietes where vente_id = new.vente_id and statut in ('en_attente', 'receptionne')) then
    raise exception 'Cette vente est à une société du groupe : le paiement s''enregistre chez elle (paiement de son fournisseur)';
  end if;
  return new;
end;
$$;
create trigger controle_paiement_groupe before insert on public.paiements_clients
  for each row execute function public.controle_paiement_groupe();

-- ---------------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------------
alter table public.achats_intersocietes enable row level security;
create policy achats_groupe_select on public.achats_intersocietes for select to authenticated
  using ((ferme_id = public.ferme_actuelle() or ferme_vendeuse_id = public.ferme_actuelle()) and public.a_role('directeur', 'exploitation', 'finance'));
revoke all on public.achats_intersocietes from anon;
revoke insert, update, delete on public.achats_intersocietes from authenticated;
revoke execute on function public.avant_vente_marchandise(), public.apres_vente_marchandise(), public.livraison_intersociete(),
                          public.annulation_vente_groupe(), public.annulation_vente_marchandise(), public.annulation_achat_groupe(),
                          public.paiement_groupe(), public.controle_paiement_groupe() from public, anon, authenticated;
revoke execute on function public.lier_tiers(uuid, uuid), public.receptionner_livraison_groupe(uuid, uuid), public.refuser_livraison_groupe(uuid, text) from public, anon;
grant execute on function public.lier_tiers(uuid, uuid), public.receptionner_livraison_groupe(uuid, uuid), public.refuser_livraison_groupe(uuid, text) to authenticated;
