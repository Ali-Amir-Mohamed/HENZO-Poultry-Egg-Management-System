-- =====================================================================
-- HENZO – Factures et impôts
--   1. Fiche officielle de la société (raison sociale, NIU, RCCM, siège,
--      régime fiscal, CGA, TVA, taux) : directeur et finance.
--   2. NIU et RCCM des clients (factures entre entreprises).
--   3. Factures numérotées sans trou (FA-2026-0001…), faites à partir des
--      ventes : une vente n'est facturée qu'une fois ; une facture ne
--      s'efface pas, seul le directeur l'annule (avec un motif).
--      Montants de la vente = TTC ; si la société est assujettie à la TVA,
--      la facture décompose HT + TVA.
--   4. Impôts : chiffre d'affaires du mois, acompte, IGS (barème 2026),
--      et paiement d'un impôt = dépense « impôts et taxes » + quittance.
--   Tous les taux sont modifiables dans la fiche société : le comptable
--   doit les confirmer.
-- À exécuter une fois dans Supabase > SQL Editor, après 0034.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fiche société
-- ---------------------------------------------------------------------
alter table public.fermes
  add column raison_sociale     text,
  add column forme_juridique    text not null default 'SARL',
  add column capital_social     numeric(16, 0) check (capital_social >= 0),
  add column niu                text,
  add column rccm               text,
  add column adresse_siege      text,
  add column telephone_societe  text,
  add column email_societe      text,
  add column banque_paiement    text,          -- banque et numéro de compte imprimés sur les factures
  add column regime_fiscal      text not null default 'reel' check (regime_fiscal in ('reel', 'simplifie', 'igs')),
  add column adherent_cga       boolean not null default false,
  add column assujetti_tva      boolean not null default false,
  add column taux_tva           numeric(5, 2) not null default 19.25 check (taux_tva between 0 and 100),
  add column taux_acompte       numeric(5, 2) not null default 2.2 check (taux_acompte between 0 and 100),
  add column taux_is            numeric(5, 2) not null default 33 check (taux_is between 0 and 100),
  add column prefixe_facture    text not null default 'FA' check (prefixe_facture ~ '^[A-Z0-9]{1,6}$'),
  add column mentions_facture   text;

create function public.maj_societe(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fermes;
  txt text[] := array['raison_sociale', 'niu', 'rccm','adresse_siege', 'telephone_societe', 'email_societe',
                      'banque_paiement', 'mentions_facture'];
  k text;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance modifient la fiche société'; end if;
  select * into f from public.fermes where id = public.ferme_actuelle() for update;
  if f.id is null then raise exception 'Ferme introuvable'; end if;
  foreach k in array txt loop
    if p ? k then
      execute format('update public.fermes set %I = $1 where id = $2', k) using nullif(trim(p ->> k), ''), f.id;
    end if;
  end loop;
  update public.fermes set
    forme_juridique = coalesce(nullif(trim(p ->> 'forme_juridique'), ''), forme_juridique),
    capital_social  = case when p ? 'capital_social' then nullif(p ->> 'capital_social', '')::numeric else capital_social end,
    regime_fiscal   = coalesce(nullif(p ->> 'regime_fiscal', ''), regime_fiscal),
    adherent_cga    = coalesce((p ->> 'adherent_cga')::boolean, adherent_cga),
    assujetti_tva   = coalesce((p ->> 'assujetti_tva')::boolean, assujetti_tva),
    taux_tva        = coalesce(nullif(p ->> 'taux_tva', '')::numeric, taux_tva),
    taux_acompte    = coalesce(nullif(p ->> 'taux_acompte', '')::numeric, taux_acompte),
    taux_is         = coalesce(nullif(p ->> 'taux_is', '')::numeric, taux_is),
    prefixe_facture = coalesce(upper(nullif(trim(p ->> 'prefixe_facture'), '')), prefixe_facture)
  where id = f.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Clients : NIU et RCCM
-- ---------------------------------------------------------------------
alter table public.tiers add column niu text, add column rccm text;

-- ---------------------------------------------------------------------
-- 3. Factures
-- ---------------------------------------------------------------------
create table public.factures (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null references public.fermes (id),
  numero            text not null,
  annee             integer not null,
  sequence          integer not null check (sequence > 0),
  date_facture      date not null,
  client_id         uuid references public.tiers (id),
  client_nom        text not null,
  client_niu        text,
  client_rccm       text,
  client_adresse    text,
  client_telephone  text,
  tva_applicable    boolean not null,
  taux_tva          numeric(5, 2) not null default 0,
  total_ht          numeric(16, 0) not null check (total_ht >= 0),
  total_tva         numeric(16, 0) not null check (total_tva >= 0),
  total_ttc         numeric(16, 0) not null check (total_ttc >= 0),
  notes             text,
  annulee           boolean not null default false,
  motif_annulation  text,
  annulee_par       uuid references public.profiles (id),
  annulee_le        timestamptz,
  creee_par         uuid default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  unique (ferme_id, annee, sequence),
  unique (ferme_id, numero)
);
create index on public.factures (ferme_id, date_facture desc);

create table public.facture_lignes (
  id             uuid primary key default gen_random_uuid(),
  facture_id     uuid not null references public.factures (id) on delete cascade,
  ferme_id       uuid not null references public.fermes (id),
  ordre          integer not null,
  designation    text not null,
  quantite       numeric(12, 2) not null,
  unite          text,
  prix_unitaire  numeric(14, 0) not null,     -- TTC (ce que paie le client)
  montant        numeric(16, 0) not null,     -- TTC
  vente_id       uuid references public.ventes (id),
  active         boolean not null default true
);
create index on public.facture_lignes (facture_id);
create unique index facture_lignes_vente_active on public.facture_lignes (vente_id) where vente_id is not null and active;

create trigger journal after insert or update on public.factures for each row execute function public.journaliser();

create function public.designation_vente(v public.ventes)
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
           else 'Produits de la ferme'
         end
         || coalesce(' (bande ' || (select code from public.bandes where id = v.bande_id) || ')', '')
         || coalesce(' (lot ' || (select code from public.lots_pondeuses where id = v.lot_id) || ')', '')
         || case when v.unite = 'kg' and v.nombre_sujets is not null then ' – ' || v.nombre_sujets || ' sujets' else '' end
$$;

create function public.creer_facture(p_ventes uuid[], p_date date default current_date, p_client_nom text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fermes;
  v public.ventes;
  c public.tiers;
  v_client uuid;
  v_n integer;
  v_annee integer := extract(year from coalesce(p_date, current_date))::integer;
  v_seq integer;
  v_ttc numeric := 0;
  v_ht numeric;
  v_id uuid;
  v_ordre integer := 0;
  v_derniere date;
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Vous ne pouvez pas faire de facture'; end if;
  if coalesce(array_length(p_ventes, 1), 0) = 0 then raise exception 'Choisissez au moins une vente à facturer'; end if;
  select * into f from public.fermes where id = public.ferme_actuelle() for update;   -- un seul numéro à la fois
  select count(*), count(distinct coalesce(client_id::text, '-')), max(client_id::text)::uuid into v_n, v_seq, v_client
  from public.ventes where id = any (p_ventes) and ferme_id = f.id and not annulee;
  if v_n <> array_length(p_ventes, 1) then raise exception 'Vente introuvable ou annulée'; end if;
  if v_seq > 1 then raise exception 'Une facture ne regroupe que les ventes d''un même client'; end if;
  if exists (select 1 from public.facture_lignes where vente_id = any (p_ventes) and active) then
    raise exception 'Une de ces ventes est déjà facturée';
  end if;
  if v_client is null and coalesce(trim(p_client_nom), '') = '' then raise exception 'Indiquez le nom du client'; end if;
  select max(date_facture) into v_derniere from public.factures where ferme_id = f.id and annee = v_annee;
  if v_derniere is not null and coalesce(p_date, current_date) < v_derniere then
    raise exception 'La date ne peut pas être avant la dernière facture (%)', to_char(v_derniere, 'DD/MM/YYYY');
  end if;
  select * into c from public.tiers where id = v_client;
  select coalesce(sum(montant), 0) into v_ttc from public.ventes where id = any (p_ventes);
  if f.assujetti_tva then v_ht := round(v_ttc / (1 + f.taux_tva / 100)); else v_ht := v_ttc; end if;
  select coalesce(max(sequence), 0) + 1 into v_seq from public.factures where ferme_id = f.id and annee = v_annee;
  insert into public.factures (ferme_id, numero, annee, sequence, date_facture, client_id, client_nom, client_niu, client_rccm,
                               client_adresse, client_telephone, tva_applicable, taux_tva, total_ht, total_tva, total_ttc, notes)
  values (f.id, f.prefixe_facture || '-' || v_annee || '-' || lpad(v_seq::text, 4, '0'), v_annee, v_seq, coalesce(p_date, current_date),
          v_client, coalesce(c.nom, trim(p_client_nom)), c.niu, c.rccm, c.adresse, c.telephone,
          f.assujetti_tva, case when f.assujetti_tva then f.taux_tva else 0 end, v_ht, v_ttc - v_ht, v_ttc, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  for v in select * from public.ventes where id = any (p_ventes) order by date_vente, created_at loop
    v_ordre := v_ordre + 1;
    insert into public.facture_lignes (facture_id, ferme_id, ordre, designation, quantite, unite, prix_unitaire, montant, vente_id)
    values (v_id, f.id, v_ordre, public.designation_vente(v), v.quantite, v.unite, v.prix_unitaire, v.montant, v.id);
  end loop;
  return v_id;
end;
$$;

create function public.annuler_facture(p_facture uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur annule une facture'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de l''annulation'; end if;
  update public.factures set annulee = true, motif_annulation = trim(p_motif), annulee_par = auth.uid(), annulee_le = now()
  where id = p_facture and ferme_id = public.ferme_actuelle() and not annulee;
  if not found then raise exception 'Facture introuvable ou déjà annulée'; end if;
  update public.facture_lignes set active = false where facture_id = p_facture;
end;
$$;

-- Une vente facturée ne s'annule pas tant que sa facture est valable
create function public.controle_vente_facturee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num text;
begin
  if new.annulee and not old.annulee then
    select fa.numero into v_num from public.facture_lignes l join public.factures fa on fa.id = l.facture_id
    where l.vente_id = new.id and l.active limit 1;
    if v_num is not null then raise exception 'Cette vente est sur la facture %, annulez d''abord la facture', v_num; end if;
  end if;
  return new;
end;
$$;
create trigger controle_vente_facturee before update of annulee on public.ventes
  for each row execute function public.controle_vente_facturee();

-- Ce qui reste à encaisser sur chaque facture (à partir des ventes)
create view public.factures_situation with (security_invoker = true) as
select fa.id, fa.total_ttc,
       coalesce(sum(public.reste_a_payer_vente(l.vente_id)) filter (where l.vente_id is not null and not fa.annulee), 0) as reste
from public.factures fa
left join public.facture_lignes l on l.facture_id = fa.id
group by fa.id, fa.total_ttc;

-- ---------------------------------------------------------------------
-- 4. Impôts
-- ---------------------------------------------------------------------
-- Barème IGS 2026 (montant principal par an, avant 10 % de centimes communaux ; −50 % pour un adhérent CGA)
create table public.bareme_igs (
  classe   integer primary key,
  ca_min   numeric(16, 0) not null,
  ca_max   numeric(16, 0),           -- exclu ; null = sans limite (jusqu'au seuil du régime)
  montant  numeric(14, 0) not null
);
insert into public.bareme_igs values
  (1, 0, 500000, 20000), (2, 500000, 1000000, 30000), (3, 1000000, 1500000, 40000), (4, 1500000, 2000000, 50000),
  (5, 2000000, 2500000, 60000), (6, 2500000, 5000000, 150000), (7, 5000000, 10000000, 300000),
  (8, 10000000, 20000000, 500000), (9, 20000000, 30000000, 1000000), (10, 30000000, null, 2000000);

-- Chiffre d'affaires par mois (ventes de la ferme et des boutiques, hors ventes annulées)
create view public.chiffre_affaires_mensuel with (security_invoker = true) as
select ferme_id, date_trunc('month', date_vente)::date as mois, sum(montant) as chiffre_affaires, count(*) as nombre_ventes
from public.ventes
where not annulee
group by ferme_id, date_trunc('month', date_vente);

-- Dépenses : nouvelles catégories « impôts et taxes » et « cotisations sociales »
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.depenses'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%retrait_associe%' and pg_get_constraintdef(oid) like '%portee%'
  loop
    execute format('alter table public.depenses drop constraint %I', c);
  end loop;
end;
$$;
alter table public.depenses add constraint depenses_categorie_check check (
  (portee = 'ferme' and categorie in ('poussins', 'aliment', 'medicament', 'main_oeuvre', 'transport', 'entretien', 'autre_ferme'))
  or (portee = 'generale' and categorie in ('loyer', 'charges', 'salaires', 'fonctionnement', 'retrait_associe', 'autre_general',
                                            'impots_taxes', 'cotisations_sociales')));

create or replace function public.tiers_obligatoire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seuil numeric := (select seuil_tiers_obligatoire from public.fermes where id = new.ferme_id);
  v_montant numeric;
begin
  if tg_table_name = 'ventes' then
    if (to_jsonb(new) ->> 'boutique_id') is not null then return new; end if;   -- vente boutique au comptant
    v_montant := round((to_jsonb(new) ->> 'quantite')::numeric * (to_jsonb(new) ->> 'prix_unitaire')::numeric);
    if (to_jsonb(new) ->> 'client_id') is null and v_montant > v_seuil then
      raise exception 'Vente de % FCFA : indiquez le client (obligatoire au-delà de % FCFA)', v_montant, v_seuil;
    end if;
  else
    v_montant := (to_jsonb(new) ->> 'montant')::numeric;
    if (to_jsonb(new) ->> 'fournisseur_id') is null and v_montant > v_seuil
       and (to_jsonb(new) ->> 'categorie') not in ('salaires', 'retrait_associe', 'impots_taxes', 'cotisations_sociales') then
      raise exception 'Dépense de % FCFA : indiquez le fournisseur (obligatoire au-delà de % FCFA)', v_montant, v_seuil;
    end if;
  end if;
  return new;
end;
$$;

-- Impôts payés (chaque paiement = une dépense « impôts et taxes », annulable par le directeur comme toute dépense)
create table public.paiements_impots (
  id              uuid primary key default gen_random_uuid(),
  ferme_id        uuid not null references public.fermes (id),
  type_impot      text not null check (type_impot in ('acompte_is', 'solde_is', 'igs', 'tva', 'patente', 'autre')),
  periode         date not null,          -- 1er jour du mois (ou du trimestre, ou de l'année) concerné
  montant         numeric(16, 0) not null check (montant > 0),
  date_paiement   date not null,
  reference       text,                   -- numéro de quittance / d'avis
  depense_id      uuid not null references public.depenses (id),
  saisi_par       uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index on public.paiements_impots (ferme_id, periode);

create function public.payer_impot(p_type text, p_periode date, p_montant numeric, p_mode public.mode_paiement,
                                   p_activite public.activite default 'chair', p_date date default current_date, p_reference text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep uuid;
  v_id uuid;
  v_lib text;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance paient les impôts'; end if;
  if coalesce(p_montant, 0) <= 0 then raise exception 'Indiquez le montant payé'; end if;
  v_lib := case p_type when 'acompte_is' then 'Acompte d''impôt' when 'solde_is' then 'Solde de l''impôt sur les sociétés'
                       when 'igs' then 'Impôt général synthétique' when 'tva' then 'TVA' when 'patente' then 'Patente' else 'Impôt' end
           || ' – ' || to_char(p_periode, 'MM/YYYY') || coalesce(' (quittance ' || nullif(trim(p_reference), '') || ')', '');
  insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, montant_paye, saisi_par)
  values (public.ferme_actuelle(), coalesce(p_date, current_date), 'generale', p_activite, 'impots_taxes', v_lib, p_montant, p_mode, p_montant, auth.uid())
  returning id into v_dep;
  insert into public.paiements_impots (ferme_id, type_impot, periode, montant, date_paiement, reference, depense_id)
  values (public.ferme_actuelle(), p_type, date_trunc('month', p_periode)::date, p_montant, coalesce(p_date, current_date),
          nullif(trim(coalesce(p_reference, '')), ''), v_dep)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------------
alter table public.factures enable row level security;
alter table public.facture_lignes enable row level security;
alter table public.bareme_igs enable row level security;
alter table public.paiements_impots enable row level security;
create policy factures_select on public.factures for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy facture_lignes_select on public.facture_lignes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy bareme_igs_select on public.bareme_igs for select to authenticated using (true);
create policy paiements_impots_select on public.paiements_impots for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

revoke all on public.factures, public.facture_lignes, public.bareme_igs, public.paiements_impots,
              public.factures_situation, public.chiffre_affaires_mensuel from anon;
revoke insert, update, delete on public.factures, public.facture_lignes, public.bareme_igs, public.paiements_impots from authenticated;
revoke execute on function public.controle_vente_facturee(), public.designation_vente(public.ventes) from public, anon, authenticated;
revoke execute on function public.maj_societe(jsonb), public.creer_facture(uuid[], date, text, text), public.annuler_facture(uuid, text),
                          public.payer_impot(text, date, numeric, public.mode_paiement, public.activite, date, text) from public, anon;
grant execute on function public.maj_societe(jsonb), public.creer_facture(uuid[], date, text, text), public.annuler_facture(uuid, text),
                          public.payer_impot(text, date, numeric, public.mode_paiement, public.activite, date, text) to authenticated;
