-- =====================================================================
-- HENZO – Étape 1 : schéma de base (Supabase / PostgreSQL)
-- À exécuter une fois dans Supabase > SQL Editor.
-- Montants en FCFA. Tous les identifiants sont des UUID : les saisies
-- hors connexion génèrent leur `id` sur l'appareil (pas de doublon à la
-- resynchronisation).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Rôles et profils
-- ---------------------------------------------------------------------
create type public.role_utilisateur as enum ('directeur', 'exploitation', 'finance', 'employe');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nom_complet text not null default '',
  role        public.role_utilisateur not null default 'employe',
  actif       boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Profil créé automatiquement à l'inscription (rôle « employe » par défaut ;
-- le directeur attribue ensuite le bon rôle).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nom_complet)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nom_complet', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rôle de l'utilisateur connecté (null si inactif ou inconnu)
create function public.role_actuel()
returns public.role_utilisateur
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and actif
$$;

-- ---------------------------------------------------------------------
-- Exploitation
-- ---------------------------------------------------------------------
create table public.batiments (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null unique,
  capacite   integer check (capacite > 0),
  actif      boolean not null default true,
  notes      text,
  created_at timestamptz not null default now()
);

create table public.bandes (
  id                   uuid primary key default gen_random_uuid(),
  batiment_id          uuid not null references public.batiments (id),
  code                 text not null unique,          -- ex. « B2-2026-03 »
  race                 text,
  date_arrivee         date not null,
  age_arrivee_semaines integer check (age_arrivee_semaines >= 0),
  effectif_initial     integer not null check (effectif_initial > 0),
  statut               text not null default 'active' check (statut in ('active', 'reformee')),
  date_reforme         date,
  notes                text,
  created_at           timestamptz not null default now()
);

create table public.ramassages_oeufs (
  id              uuid primary key default gen_random_uuid(),
  bande_id        uuid not null references public.bandes (id),
  date_ramassage  date not null default current_date,
  oeufs_ramasses  integer not null check (oeufs_ramasses >= 0),
  oeufs_casses    integer not null default 0 check (oeufs_casses >= 0),
  notes           text,
  saisi_par       uuid not null default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index on public.ramassages_oeufs (bande_id, date_ramassage);

create table public.mortalites (
  id            uuid primary key default gen_random_uuid(),
  bande_id      uuid not null references public.bandes (id),
  date_constat  date not null default current_date,
  nombre        integer not null check (nombre > 0),
  cause         text,
  notes         text,
  saisi_par     uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index on public.mortalites (bande_id, date_constat);

-- Aliment : une ligne par entrée en stock (achat) ou sortie (consommation)
create table public.mouvements_aliment (
  id              uuid primary key default gen_random_uuid(),
  type_mouvement  text not null check (type_mouvement in ('entree', 'sortie')),
  date_mouvement  date not null default current_date,
  type_aliment    text not null,                      -- ex. « ponte », « démarrage »
  quantite_kg     numeric(10, 2) not null check (quantite_kg > 0),
  bande_id        uuid references public.bandes (id), -- pour les sorties
  cout_total      numeric(14, 2) check (cout_total >= 0), -- pour les entrées
  fournisseur     text,
  notes           text,
  saisi_par       uuid not null default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index on public.mouvements_aliment (type_aliment, date_mouvement);

-- ---------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------
create table public.ventes (
  id             uuid primary key default gen_random_uuid(),
  date_vente     date not null default current_date,
  produit        text not null check (produit in ('oeufs', 'plateaux', 'poules_reformees', 'fientes', 'autre')),
  quantite       numeric(12, 2) not null check (quantite > 0),
  prix_unitaire  numeric(14, 2) not null check (prix_unitaire >= 0),
  montant        numeric(16, 2) generated always as (quantite * prix_unitaire) stored,
  client         text,
  mode_paiement  text not null default 'especes' check (mode_paiement in ('especes', 'mobile_money', 'virement', 'credit')),
  paye           boolean not null default true,
  notes          text,
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index on public.ventes (date_vente);

create table public.depenses (
  id             uuid primary key default gen_random_uuid(),
  date_depense   date not null default current_date,
  categorie      text not null check (categorie in ('aliment', 'sante', 'salaires', 'energie', 'transport', 'equipement', 'poussins', 'autre')),
  libelle        text not null,
  montant        numeric(14, 2) not null check (montant > 0),
  fournisseur    text,
  mode_paiement  text not null default 'especes' check (mode_paiement in ('especes', 'mobile_money', 'virement', 'credit')),
  notes          text,
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index on public.depenses (date_depense);

-- ---------------------------------------------------------------------
-- Vues (respectent les droits de l'utilisateur qui les lit)
-- ---------------------------------------------------------------------
create view public.effectif_bandes with (security_invoker = true) as
select b.id as bande_id,
       b.code,
       b.effectif_initial,
       coalesce(sum(m.nombre), 0)::integer as morts,
       (b.effectif_initial - coalesce(sum(m.nombre), 0))::integer as effectif_actuel
from public.bandes b
left join public.mortalites m on m.bande_id = b.id
group by b.id;

create view public.production_journaliere with (security_invoker = true) as
select bande_id,
       date_ramassage,
       sum(oeufs_ramasses)::integer as oeufs_ramasses,
       sum(oeufs_casses)::integer   as oeufs_casses
from public.ramassages_oeufs
group by bande_id, date_ramassage;

create view public.stock_aliment with (security_invoker = true) as
select type_aliment,
       sum(case when type_mouvement = 'entree' then quantite_kg else -quantite_kg end) as stock_kg
from public.mouvements_aliment
group by type_aliment;

-- ---------------------------------------------------------------------
-- Sécurité (RLS)
--   directeur    : tout
--   exploitation : bâtiments, bandes, saisies terrain (lecture + correction)
--   finance      : ventes, dépenses ; lecture des données terrain
--   employe      : lecture des bandes, saisie terrain (ses propres lignes)
-- ---------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.batiments          enable row level security;
alter table public.bandes             enable row level security;
alter table public.ramassages_oeufs   enable row level security;
alter table public.mortalites         enable row level security;
alter table public.mouvements_aliment enable row level security;
alter table public.ventes             enable row level security;
alter table public.depenses           enable row level security;

-- profiles : chacun lit le sien, le directeur lit et modifie tout
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.role_actuel() = 'directeur');
create policy profiles_update on public.profiles for update to authenticated
  using (public.role_actuel() = 'directeur')
  with check (public.role_actuel() = 'directeur');

-- bâtiments et bandes
create policy batiments_select on public.batiments for select to authenticated
  using (public.role_actuel() is not null);
create policy batiments_write on public.batiments for all to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'))
  with check (public.role_actuel() in ('directeur', 'exploitation'));

create policy bandes_select on public.bandes for select to authenticated
  using (public.role_actuel() is not null);
create policy bandes_write on public.bandes for all to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'))
  with check (public.role_actuel() in ('directeur', 'exploitation'));

-- saisies terrain : tout rôle actif saisit en son nom ;
-- directeur et exploitation corrigent / suppriment
create policy ramassages_select on public.ramassages_oeufs for select to authenticated
  using (public.role_actuel() is not null);
create policy ramassages_insert on public.ramassages_oeufs for insert to authenticated
  with check (public.role_actuel() is not null and saisi_par = auth.uid());
create policy ramassages_update on public.ramassages_oeufs for update to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'))
  with check (public.role_actuel() in ('directeur', 'exploitation'));
create policy ramassages_delete on public.ramassages_oeufs for delete to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'));

create policy mortalites_select on public.mortalites for select to authenticated
  using (public.role_actuel() is not null);
create policy mortalites_insert on public.mortalites for insert to authenticated
  with check (public.role_actuel() is not null and saisi_par = auth.uid());
create policy mortalites_update on public.mortalites for update to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'))
  with check (public.role_actuel() in ('directeur', 'exploitation'));
create policy mortalites_delete on public.mortalites for delete to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'));

create policy aliment_select on public.mouvements_aliment for select to authenticated
  using (public.role_actuel() is not null);
create policy aliment_insert on public.mouvements_aliment for insert to authenticated
  with check (public.role_actuel() is not null and saisi_par = auth.uid());
create policy aliment_update on public.mouvements_aliment for update to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'))
  with check (public.role_actuel() in ('directeur', 'exploitation'));
create policy aliment_delete on public.mouvements_aliment for delete to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'));

-- finance : directeur et finance uniquement
create policy ventes_all on public.ventes for all to authenticated
  using (public.role_actuel() in ('directeur', 'finance'))
  with check (public.role_actuel() in ('directeur', 'finance'));
create policy depenses_all on public.depenses for all to authenticated
  using (public.role_actuel() in ('directeur', 'finance'))
  with check (public.role_actuel() in ('directeur', 'finance'));

-- ---------------------------------------------------------------------
-- Après exécution : créer les comptes (Authentication > Users > Add user),
-- puis attribuer les rôles, par exemple :
--   update public.profiles p set role = 'directeur',    nom_complet = '…'
--     from auth.users u where u.id = p.id and u.email = 'directeur@…';
--   update public.profiles p set role = 'exploitation', nom_complet = 'Kenfack Dirand'
--     from auth.users u where u.id = p.id and u.email = '…';
--   update public.profiles p set role = 'finance',      nom_complet = 'Dahirou Bachar'
--     from auth.users u where u.id = p.id and u.email = '…';
-- ---------------------------------------------------------------------
