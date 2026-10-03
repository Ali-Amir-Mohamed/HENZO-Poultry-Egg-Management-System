-- =====================================================================
-- HENZO – Refonte de la base (phase A), conforme au cahier des charges
-- À exécuter une fois dans Supabase > SQL Editor, après 0001.
--
-- ⚠️ Supprime les tables provisoires de l'étape 1 (données de test).
--    Conserve : comptes (auth.users), profils et rôles.
--
-- Principes :
--   * toutes les données appartiennent à une ferme (prêt pour plusieurs fermes) ;
--   * poulets de chair (bandes) et pondeuses (lots) sont des modules séparés ;
--   * deux caisses par activité (chair / pondeuses) × espèces / Mobile Money / banque ;
--   * les opérations financières ne se modifient ni ne se suppriment :
--     seul le directeur annule ou corrige, par une écriture inverse ;
--   * les achats d'aliment / médicaments alimentent le stock automatiquement ;
--   * dépenses de l'exploitation au-delà du seuil (50 000 FCFA) et retraits
--     d'associés : « à valider » ;
--   * journal d'activité et notifications automatiques.
-- Montants en FCFA (entiers).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Nettoyage de la base provisoire
-- ---------------------------------------------------------------------
drop view if exists public.production_journaliere, public.effectif_bandes, public.stock_aliment;
drop table if exists public.ramassages_oeufs, public.mortalites, public.mouvements_aliment,
  public.ventes, public.depenses, public.bandes, public.batiments cascade;

-- ---------------------------------------------------------------------
-- 1. Fermes et profils
-- ---------------------------------------------------------------------
create table public.fermes (
  id                        uuid primary key default gen_random_uuid(),
  nom                       text not null,
  seuil_validation_depense  numeric(14, 0) not null default 50000 check (seuil_validation_depense >= 0),
  created_at                timestamptz not null default now()
);
insert into public.fermes (nom) values ('Ferme HENZO');

alter table public.profiles add column ferme_id uuid references public.fermes (id);
update public.profiles set ferme_id = (select id from public.fermes order by created_at limit 1);
alter table public.profiles alter column ferme_id set not null;

-- Nouveau compte : rattaché à la ferme (une seule ferme pour l'instant), rôle « employe »
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nom_complet, ferme_id)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'nom_complet', ''),
          (select id from public.fermes order by created_at limit 1));
  return new;
end;
$$;

create function public.ferme_actuelle()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ferme_id from public.profiles where id = auth.uid() and actif
$$;

-- a_role('directeur', 'finance') : l'utilisateur connecté a-t-il l'un de ces rôles ?
create function public.a_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.role_actuel()::text = any (roles), false)
$$;

-- ---------------------------------------------------------------------
-- 2. Types communs
-- ---------------------------------------------------------------------
create type public.activite as enum ('chair', 'pondeuse');
create type public.mode_paiement as enum ('especes', 'mobile_money', 'banque');

-- ---------------------------------------------------------------------
-- 3. Notifications et journal d'activité
-- ---------------------------------------------------------------------
create table public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid not null references public.fermes (id),
  role_destinataire  public.role_utilisateur not null,
  type_notification  text not null,
  message            text not null,
  lien               text,
  lu                 boolean not null default false,
  created_at         timestamptz not null default now()
);
create index on public.notifications (ferme_id, role_destinataire, lu);

create function public.notifier(p_ferme uuid, p_role public.role_utilisateur, p_type text, p_message text, p_lien text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (ferme_id, role_destinataire, type_notification, message, lien)
  values (p_ferme, p_role, p_type, p_message, p_lien)
$$;

create table public.journal_activite (
  id          bigint generated always as identity primary key,
  ferme_id    uuid,
  user_id     uuid,
  action      text not null,
  table_nom   text not null,
  ligne_id    uuid,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index on public.journal_activite (ferme_id, created_at desc);

create function public.journaliser()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ligne jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.journal_activite (ferme_id, user_id, action, table_nom, ligne_id, details)
  values ((ligne ->> 'ferme_id')::uuid, auth.uid(), tg_op, tg_table_name, (ligne ->> 'id')::uuid,
          case when tg_op = 'UPDATE' then jsonb_build_object('avant', to_jsonb(old), 'apres', ligne) else ligne end);
  return null;
end;
$$;

create trigger journal after insert or update or delete on public.profiles
  for each row execute function public.journaliser();
create trigger journal after update on public.fermes
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 4. Référentiels : bâtiments, clients / fournisseurs, articles, prix
-- ---------------------------------------------------------------------
create table public.batiments (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null default public.ferme_actuelle() references public.fermes (id),
  nom         text not null,
  capacite    integer check (capacite > 0),
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (ferme_id, nom)
);

create table public.tiers (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  type_tiers       text not null check (type_tiers in ('client', 'fournisseur', 'client_fournisseur')),
  nom              text not null,
  telephone        text,
  adresse          text,
  credit_autorise  boolean not null default false,
  plafond_credit   numeric(14, 0) not null default 0 check (plafond_credit >= 0),
  notes            text,
  cree_par         uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now()
);
create index on public.tiers (ferme_id, nom);

-- Seuls le directeur et l'exploitation accordent un crédit client
create function public.controle_credit_tiers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.a_role('directeur', 'exploitation') then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.credit_autorise or new.plafond_credit > 0))
     or (tg_op = 'UPDATE' and (new.credit_autorise, new.plafond_credit) is distinct from (old.credit_autorise, old.plafond_credit)) then
    raise exception 'Seuls le directeur et l''exploitation peuvent autoriser un crédit client';
  end if;
  return new;
end;
$$;
create trigger controle_credit before insert or update on public.tiers
  for each row execute function public.controle_credit_tiers();
create trigger journal after insert or update on public.tiers
  for each row execute function public.journaliser();

create table public.articles (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null default public.ferme_actuelle() references public.fermes (id),
  nom            text not null,
  categorie      text not null check (categorie in ('aliment', 'medicament', 'autre')),
  unite          text not null check (unite in ('kg', 'sac', 'litre', 'dose', 'flacon', 'piece')),
  seuil_minimum  numeric(12, 2) not null default 0 check (seuil_minimum >= 0),
  actif          boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (ferme_id, nom)
);

create table public.prix_vente (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null default public.ferme_actuelle() references public.fermes (id),
  produit     text not null check (produit in ('poulets', 'oeufs', 'plateaux', 'poules_reformees', 'fientes')),
  unite       text not null check (unite in ('piece', 'kg', 'plateau')),
  prix        numeric(14, 0) not null check (prix > 0),
  date_debut  date not null default current_date,
  defini_par  uuid default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now()
);
create trigger journal after insert on public.prix_vente
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 5. Bandes de poulets de chair et lots de pondeuses
-- ---------------------------------------------------------------------
create table public.bandes (
  id                    uuid primary key default gen_random_uuid(),
  ferme_id              uuid not null default public.ferme_actuelle() references public.fermes (id),
  code                  text not null,
  batiment_id           uuid references public.batiments (id),
  fournisseur_id        uuid references public.tiers (id),
  souche                text,
  date_arrivee          date not null,
  nombre_initial        integer not null check (nombre_initial > 0),
  age_arrivee_jours     integer not null default 1 check (age_arrivee_jours >= 0),
  date_vente_prevue     date,
  statut                text not null default 'en_cours' check (statut in ('en_cours', 'cloture_demandee', 'cloturee')),
  date_cloture          date,
  cloture_demandee_par  uuid references public.profiles (id),
  cloture_validee_par   uuid references public.profiles (id),
  notes                 text,
  created_at            timestamptz not null default now(),
  unique (ferme_id, code)
);

create table public.lots_pondeuses (
  id                    uuid primary key default gen_random_uuid(),
  ferme_id              uuid not null default public.ferme_actuelle() references public.fermes (id),
  code                  text not null,
  batiment_id           uuid references public.batiments (id),
  fournisseur_id        uuid references public.tiers (id),
  souche                text,
  date_arrivee          date not null,
  effectif_initial      integer not null check (effectif_initial > 0),
  age_arrivee_semaines  integer not null default 0 check (age_arrivee_semaines >= 0),
  statut                text not null default 'en_production' check (statut in ('en_production', 'reforme')),
  date_reforme          date,
  notes                 text,
  created_at            timestamptz not null default now(),
  unique (ferme_id, code)
);

-- Clôture d'une bande : l'exploitation demande, la finance (ou le directeur) valide
create function public.controle_bande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r text := public.role_actuel()::text;
begin
  if auth.uid() is null then return new; end if;  -- administrateur (SQL Editor)

  if r = 'finance' and (to_jsonb(new) - array['statut', 'cloture_validee_par', 'cloture_demandee_par', 'date_cloture'])
                       is distinct from (to_jsonb(old) - array['statut', 'cloture_validee_par', 'cloture_demandee_par', 'date_cloture']) then
    raise exception 'La finance peut seulement valider ou refuser une clôture';
  end if;

  if new.statut is distinct from old.statut then
    if old.statut = 'en_cours' and new.statut = 'cloture_demandee' and r in ('directeur', 'exploitation') then
      new.cloture_demandee_par := auth.uid();
      new.date_cloture := coalesce(new.date_cloture, current_date);
      perform public.notifier(new.ferme_id, 'finance', 'cloture_bande', 'Clôture demandée pour la bande ' || new.code, '/bandes/' || new.id);
      perform public.notifier(new.ferme_id, 'directeur', 'cloture_bande', 'Clôture demandée pour la bande ' || new.code, '/bandes/' || new.id);
    elsif old.statut = 'cloture_demandee' and new.statut = 'cloturee' and r in ('directeur', 'finance') then
      new.cloture_validee_par := auth.uid();
      perform public.notifier(new.ferme_id, 'directeur', 'cloture_bande', 'Bande ' || new.code || ' clôturée', '/bandes/' || new.id);
    elsif old.statut = 'cloture_demandee' and new.statut = 'en_cours' and r in ('directeur', 'finance') then
      new.cloture_demandee_par := null;
      new.date_cloture := null;
    else
      raise exception 'Changement de statut non autorisé (% -> %)', old.statut, new.statut;
    end if;
  elsif old.statut = 'cloturee' and r <> 'directeur' then
    raise exception 'Une bande clôturée ne peut plus être modifiée';
  end if;
  return new;
end;
$$;
create trigger controle_bande before update on public.bandes
  for each row execute function public.controle_bande();
create trigger journal after insert or update on public.bandes
  for each row execute function public.journaliser();
create trigger journal after insert or update on public.lots_pondeuses
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 6. Saisies de terrain
-- ---------------------------------------------------------------------
create table public.mortalites (
  id            uuid primary key default gen_random_uuid(),
  ferme_id      uuid not null default public.ferme_actuelle() references public.fermes (id),
  bande_id      uuid references public.bandes (id),
  lot_id        uuid references public.lots_pondeuses (id),
  date_constat  date not null default current_date,
  nombre        integer not null check (nombre > 0),
  cause         text,
  notes         text,
  saisi_par     uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  check (num_nonnulls(bande_id, lot_id) = 1)
);
create index on public.mortalites (bande_id);
create index on public.mortalites (lot_id);

-- Œufs collectés = tous les œufs ramassés, cassés compris
create table public.pontes (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  lot_id           uuid not null references public.lots_pondeuses (id),
  date_ponte       date not null default current_date,
  oeufs_collectes  integer not null check (oeufs_collectes >= 0),
  oeufs_casses     integer not null default 0 check (oeufs_casses >= 0),
  notes            text,
  saisi_par        uuid not null default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  check (oeufs_casses <= oeufs_collectes)
);
create index on public.pontes (lot_id, date_ponte);

create table public.pesees (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null default public.ferme_actuelle() references public.fermes (id),
  bande_id       uuid not null references public.bandes (id),
  date_pesee     date not null default current_date,
  nombre_peses   integer not null check (nombre_peses > 0),
  poids_moyen_g  numeric(8, 1) not null check (poids_moyen_g > 0),
  notes          text,
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index on public.pesees (bande_id, date_pesee);

create table public.observations (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  bande_id          uuid references public.bandes (id),
  lot_id            uuid references public.lots_pondeuses (id),
  date_observation  date not null default current_date,
  texte             text not null,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  check (num_nonnulls(bande_id, lot_id) <= 1)
);

-- ---------------------------------------------------------------------
-- 7. Caisses et écritures financières (registre non modifiable)
-- ---------------------------------------------------------------------
create table public.caisses (
  id        uuid primary key default gen_random_uuid(),
  ferme_id  uuid not null references public.fermes (id),
  activite  public.activite not null,
  mode      public.mode_paiement not null,
  unique (ferme_id, activite, mode)
);
insert into public.caisses (ferme_id, activite, mode)
select f.id, a, m
from public.fermes f,
     unnest(enum_range(null::public.activite)) a,
     unnest(enum_range(null::public.mode_paiement)) m;

create function public.caisse_de(p_ferme uuid, p_activite public.activite, p_mode public.mode_paiement)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.caisses where ferme_id = p_ferme and activite = p_activite and mode = p_mode
$$;

-- ---------------------------------------------------------------------
-- 8. Ventes et encaissements
-- ---------------------------------------------------------------------
create table public.ventes (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid not null default public.ferme_actuelle() references public.fermes (id),
  date_vente         date not null default current_date,
  bande_id           uuid references public.bandes (id),
  lot_id             uuid references public.lots_pondeuses (id),
  client_id          uuid references public.tiers (id),
  produit            text not null check (produit in ('poulets', 'oeufs', 'plateaux', 'poules_reformees', 'fientes', 'autre')),
  unite              text not null check (unite in ('piece', 'kg', 'plateau')),
  quantite           numeric(12, 2) not null check (quantite > 0),   -- pièces, kg ou plateaux selon l'unité
  prix_unitaire      numeric(14, 0) not null check (prix_unitaire >= 0),
  montant            numeric(16, 0) generated always as (round(quantite * prix_unitaire)) stored,
  nombre_sujets      integer check (nombre_sujets > 0),             -- oiseaux sortis, même vendus au kg
  a_credit           boolean not null default false,
  mode_paiement      public.mode_paiement,                          -- mode de ce qui est encaissé tout de suite
  montant_encaisse   numeric(16, 0) not null default 0 check (montant_encaisse >= 0),
  date_echeance      date,
  prix_reference     numeric(14, 0),                                -- prix du moment (rempli automatiquement)
  annulee            boolean not null default false,
  annulee_par        uuid references public.profiles (id),
  annulee_le         timestamptz,
  motif_annulation   text,
  notes              text,
  saisi_par          uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  check (num_nonnulls(bande_id, lot_id) = 1),
  check (produit <> 'poulets' or bande_id is not null),
  check (produit not in ('oeufs', 'plateaux', 'poules_reformees') or lot_id is not null),
  check (produit not in ('poulets', 'poules_reformees') or nombre_sujets is not null),
  check (not a_credit or client_id is not null),
  check (montant_encaisse = 0 or mode_paiement is not null)
);
create index on public.ventes (bande_id);
create index on public.ventes (lot_id);
create index on public.ventes (client_id);
create index on public.ventes (ferme_id, date_vente);

create table public.paiements_clients (
  id              uuid primary key default gen_random_uuid(),
  ferme_id        uuid not null default public.ferme_actuelle() references public.fermes (id),
  vente_id        uuid not null references public.ventes (id),
  date_paiement   date not null default current_date,
  montant         numeric(16, 0) not null check (montant > 0),
  mode_paiement   public.mode_paiement not null,
  notes           text,
  saisi_par       uuid not null default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index on public.paiements_clients (vente_id);

-- ---------------------------------------------------------------------
-- 9. Dépenses et paiements fournisseurs
-- ---------------------------------------------------------------------
create table public.depenses (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid not null default public.ferme_actuelle() references public.fermes (id),
  date_depense       date not null default current_date,
  portee             text not null check (portee in ('ferme', 'generale')),
  activite           public.activite not null,          -- activité concernée = caisse qui paie
  bande_id           uuid references public.bandes (id),
  lot_id             uuid references public.lots_pondeuses (id),
  categorie          text not null,
  categorie_retrait  text check (categorie_retrait in ('avance_benefice', 'depense_personnelle', 'frais_medicaux', 'urgence_familiale', 'autre')),
  beneficiaire       text,                               -- associé, pour un retrait
  libelle            text not null,
  montant            numeric(16, 0) not null check (montant > 0),
  fournisseur_id     uuid references public.tiers (id),
  a_credit           boolean not null default false,     -- dette fournisseur
  mode_paiement      public.mode_paiement,
  montant_paye       numeric(16, 0) not null default 0 check (montant_paye >= 0),
  date_echeance      date,
  article_id         uuid references public.articles (id),   -- achat stocké (aliment, médicament…)
  quantite           numeric(12, 2) check (quantite > 0),
  statut             text not null default 'validee' check (statut in ('validee', 'a_valider', 'rejetee')),
  valide_par         uuid references public.profiles (id),
  valide_le          timestamptz,
  motif_rejet        text,
  annulee            boolean not null default false,
  annulee_par        uuid references public.profiles (id),
  annulee_le         timestamptz,
  motif_annulation   text,
  notes              text,
  saisi_par          uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  check ((portee = 'ferme' and categorie in ('poussins', 'aliment', 'medicament', 'main_oeuvre', 'transport', 'entretien', 'autre_ferme'))
      or (portee = 'generale' and categorie in ('loyer', 'charges', 'salaires', 'fonctionnement', 'retrait_associe', 'autre_general'))),
  check (categorie <> 'retrait_associe' or (categorie_retrait is not null and beneficiaire is not null)),
  check (num_nonnulls(bande_id, lot_id) <= 1),
  check (portee = 'ferme' or num_nonnulls(bande_id, lot_id) = 0),
  check ((article_id is null) = (quantite is null)),
  check (not a_credit or fournisseur_id is not null),
  check (montant_paye = 0 or mode_paiement is not null)
);
create index on public.depenses (bande_id);
create index on public.depenses (lot_id);
create index on public.depenses (ferme_id, date_depense);

create table public.paiements_fournisseurs (
  id              uuid primary key default gen_random_uuid(),
  ferme_id        uuid not null default public.ferme_actuelle() references public.fermes (id),
  depense_id      uuid not null references public.depenses (id),
  date_paiement   date not null default current_date,
  montant         numeric(16, 0) not null check (montant > 0),
  mode_paiement   public.mode_paiement not null,
  notes           text,
  saisi_par       uuid not null default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index on public.paiements_fournisseurs (depense_id);

-- ---------------------------------------------------------------------
-- 10. Stock
-- ---------------------------------------------------------------------
create table public.mouvements_stock (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  article_id       uuid not null references public.articles (id),
  date_mouvement   date not null default current_date,
  type_mouvement   text not null check (type_mouvement in ('entree', 'sortie', 'ajustement')),
  quantite         numeric(12, 2) not null,             -- > 0 ; signée pour un ajustement
  cout_unitaire    numeric(14, 2) check (cout_unitaire >= 0),
  bande_id         uuid references public.bandes (id),  -- consommation par une bande…
  lot_id           uuid references public.lots_pondeuses (id),  -- …ou par un lot
  depense_id       uuid references public.depenses (id),
  notes            text,
  saisi_par        uuid not null default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  check ((type_mouvement in ('entree', 'sortie') and quantite > 0) or (type_mouvement = 'ajustement' and quantite <> 0)),
  check (num_nonnulls(bande_id, lot_id) <= 1)
);
create index on public.mouvements_stock (article_id, date_mouvement);
create index on public.mouvements_stock (bande_id);
create index on public.mouvements_stock (lot_id);

-- Les mouvements créés par un achat ne se modifient pas à la main
create function public.controle_mouvement_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and old.depense_id is not null then
    raise exception 'Ce mouvement provient d''un achat : il se corrige en annulant la dépense';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger controle_mouvement before update or delete on public.mouvements_stock
  for each row execute function public.controle_mouvement_stock();

-- ---------------------------------------------------------------------
-- 11. Registre des écritures (mouvements de caisse)
-- ---------------------------------------------------------------------
create table public.ecritures (
  id                       uuid primary key default gen_random_uuid(),
  ferme_id                 uuid not null default public.ferme_actuelle() references public.fermes (id),
  date_operation           date not null default current_date,
  caisse_id                uuid not null references public.caisses (id),
  sens                     text not null check (sens in ('entree', 'sortie')),
  montant                  numeric(16, 0) not null check (montant > 0),
  nature                   text not null check (nature in ('vente', 'encaissement_creance', 'depense', 'paiement_fournisseur',
                                                           'solde_initial', 'correction', 'annulation')),
  libelle                  text,
  vente_id                 uuid references public.ventes (id),
  paiement_client_id       uuid references public.paiements_clients (id),
  depense_id               uuid references public.depenses (id),
  paiement_fournisseur_id  uuid references public.paiements_fournisseurs (id),
  ecriture_corrigee_id     uuid references public.ecritures (id),
  saisi_par                uuid default auth.uid() references public.profiles (id),
  created_at               timestamptz not null default now(),
  check (nature <> 'correction' or (ecriture_corrigee_id is not null and libelle is not null))
);
create index on public.ecritures (caisse_id, date_operation);
create index on public.ecritures (vente_id);
create index on public.ecritures (depense_id);

create function public.ecrire(p_ferme uuid, p_caisse uuid, p_sens text, p_montant numeric, p_nature text, p_libelle text,
                              p_date date, p_vente uuid default null, p_paiement_client uuid default null,
                              p_depense uuid default null, p_paiement_fournisseur uuid default null,
                              p_corrigee uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ecritures (ferme_id, caisse_id, sens, montant, nature, libelle, date_operation,
                                vente_id, paiement_client_id, depense_id, paiement_fournisseur_id, ecriture_corrigee_id)
  values (p_ferme, p_caisse, p_sens, p_montant, p_nature, p_libelle, p_date,
          p_vente, p_paiement_client, p_depense, p_paiement_fournisseur, p_corrigee)
$$;

-- Contre-passe toutes les écritures encore actives liées à une vente ou une dépense
create function public.contre_passer(p_vente uuid, p_depense uuid, p_motif text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ecritures (ferme_id, caisse_id, sens, montant, nature, libelle, date_operation,
                                vente_id, depense_id, ecriture_corrigee_id)
  select e.ferme_id, e.caisse_id, case e.sens when 'entree' then 'sortie' else 'entree' end, e.montant,
         'annulation', p_motif, current_date, e.vente_id, e.depense_id, e.id
  from public.ecritures e
  where ((p_vente is not null and e.vente_id = p_vente) or (p_depense is not null and e.depense_id = p_depense))
    and e.nature <> 'annulation'
    and not exists (select 1 from public.ecritures x where x.ecriture_corrigee_id = e.id and x.nature = 'annulation')
$$;

-- Le registre est définitif
create function public.registre_immuable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Les écritures financières ne se modifient pas et ne se suppriment pas : passez une correction';
end;
$$;
create trigger immuable before update or delete on public.ecritures
  for each row execute function public.registre_immuable();

-- Écritures saisies à la main : solde initial (directeur / finance), correction (directeur)
create function public.controle_ecriture_manuelle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nature = 'correction' then
    perform public.notifier(new.ferme_id, 'directeur', 'correction', 'Correction financière de ' || new.montant || ' FCFA : ' || new.libelle);
  end if;
  return new;
end;
$$;
create trigger notifier_correction after insert on public.ecritures
  for each row when (new.nature = 'correction') execute function public.controle_ecriture_manuelle();
create trigger journal after insert on public.ecritures
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 12. Règles automatiques des ventes
-- ---------------------------------------------------------------------
create function public.activite_vente(v public.ventes)
returns public.activite
language sql
immutable
as $$ select case when v.bande_id is not null then 'chair'::public.activite else 'pondeuse'::public.activite end $$;

create function public.reste_a_payer_vente(p_vente uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select v.montant - v.montant_encaisse
         - coalesce((select sum(p.montant) from public.paiements_clients p where p.vente_id = v.id), 0)
  from public.ventes v where v.id = p_vente
$$;

create function public.encours_client(p_client uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(public.reste_a_payer_vente(v.id)), 0)
  from public.ventes v where v.client_id = p_client and v.a_credit and not v.annulee
$$;

create function public.oiseaux_restants(p_bande uuid, p_lot uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_bande is not null then
      (select b.nombre_initial
              - coalesce((select sum(m.nombre) from public.mortalites m where m.bande_id = b.id), 0)
              - coalesce((select sum(v.nombre_sujets) from public.ventes v where v.bande_id = b.id and not v.annulee and v.nombre_sujets is not null), 0)
       from public.bandes b where b.id = p_bande)
    else
      (select l.effectif_initial
              - coalesce((select sum(m.nombre) from public.mortalites m where m.lot_id = l.id), 0)
              - coalesce((select sum(v.nombre_sujets) from public.ventes v where v.lot_id = l.id and not v.annulee and v.nombre_sujets is not null), 0)
       from public.lots_pondeuses l where l.id = p_lot)
  end::integer
$$;

create function public.avant_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  -- paiement
  if not new.a_credit then
    if new.mode_paiement is null then raise exception 'Choisissez le mode de paiement'; end if;
    new.montant_encaisse := v_montant;
  else
    if new.montant_encaisse > v_montant then raise exception 'L''acompte dépasse le montant de la vente'; end if;
    select * into v_client from public.tiers where id = new.client_id;
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
$$;
create trigger avant_vente before insert on public.ventes
  for each row execute function public.avant_vente();

create function public.apres_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.montant_encaisse > 0 then
    perform public.ecrire(new.ferme_id, public.caisse_de(new.ferme_id, public.activite_vente(new), new.mode_paiement),
                          'entree', new.montant_encaisse, 'vente', 'Vente ' || new.produit, new.date_vente, p_vente => new.id);
  end if;
  if new.prix_reference is not null and new.prix_unitaire <> new.prix_reference then
    perform public.notifier(new.ferme_id, 'directeur', 'ecart_prix',
      format('Vente de %s au prix de %s FCFA au lieu de %s FCFA', new.produit, new.prix_unitaire, new.prix_reference));
  end if;
  return null;
end;
$$;
create trigger apres_vente after insert on public.ventes
  for each row execute function public.apres_vente();

-- Une vente ne se modifie pas ; seul le directeur peut l'annuler (avec motif)
create function public.controle_maj_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Une vente ne se supprime pas : le directeur peut l''annuler'; end if;
  if auth.uid() is not null and not public.a_role('directeur') then
    raise exception 'Seul le directeur peut annuler une vente';
  end if;
  -- (« montant » est une colonne calculée, pas encore remplie dans NEW à ce stade)
  if old.annulee or not new.annulee or coalesce(trim(new.motif_annulation), '') = ''
     or (to_jsonb(new) - array['annulee', 'motif_annulation', 'annulee_par', 'annulee_le', 'montant'])
        is distinct from (to_jsonb(old) - array['annulee', 'motif_annulation', 'annulee_par', 'annulee_le', 'montant']) then
    raise exception 'Une vente ne se modifie pas : seule une annulation avec motif est possible';
  end if;
  new.annulee_par := auth.uid();
  new.annulee_le := now();
  return new;
end;
$$;
create trigger controle_maj_vente before update or delete on public.ventes
  for each row execute function public.controle_maj_vente();

create function public.apres_annulation_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.contre_passer(new.id, null, 'Annulation vente : ' || new.motif_annulation);
  perform public.notifier(new.ferme_id, 'directeur', 'annulation', 'Vente annulée : ' || new.motif_annulation);
  return null;
end;
$$;
create trigger apres_annulation_vente after update of annulee on public.ventes
  for each row when (new.annulee and not old.annulee) execute function public.apres_annulation_vente();
create trigger journal after insert or update on public.ventes
  for each row execute function public.journaliser();

-- Encaissement d'une vente à crédit
create function public.avant_paiement_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ventes;
begin
  select * into v from public.ventes where id = new.vente_id;
  if not v.a_credit or v.annulee then raise exception 'Cette vente n''a pas de solde à encaisser'; end if;
  if new.montant > public.reste_a_payer_vente(v.id) then
    raise exception 'Le paiement dépasse le reste à payer (% FCFA)', public.reste_a_payer_vente(v.id);
  end if;
  new.ferme_id := v.ferme_id;
  return new;
end;
$$;
create trigger avant_paiement_client before insert on public.paiements_clients
  for each row execute function public.avant_paiement_client();

create function public.apres_paiement_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ventes;
begin
  select * into v from public.ventes where id = new.vente_id;
  perform public.ecrire(new.ferme_id, public.caisse_de(new.ferme_id, public.activite_vente(v), new.mode_paiement),
                        'entree', new.montant, 'encaissement_creance', 'Paiement client', new.date_paiement,
                        p_vente => v.id, p_paiement_client => new.id);
  return null;
end;
$$;
create trigger apres_paiement_client after insert on public.paiements_clients
  for each row execute function public.apres_paiement_client();
create trigger immuable before update or delete on public.paiements_clients
  for each row execute function public.registre_immuable();
create trigger journal after insert on public.paiements_clients
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 13. Règles automatiques des dépenses
-- ---------------------------------------------------------------------
create function public.avant_depense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seuil numeric;
begin
  -- l'activité suit la bande / le lot
  if new.bande_id is not null then new.activite := 'chair'; end if;
  if new.lot_id is not null then new.activite := 'pondeuse'; end if;

  -- paiement
  if not new.a_credit then
    if new.mode_paiement is null then raise exception 'Choisissez le mode de paiement'; end if;
    new.montant_paye := new.montant;
  elsif new.montant_paye > new.montant then
    raise exception 'Le montant payé dépasse le montant de la dépense';
  end if;

  -- validation
  select seuil_validation_depense into v_seuil from public.fermes where id = new.ferme_id;
  if new.categorie = 'retrait_associe' and not public.a_role('directeur') and auth.uid() is not null then
    new.statut := 'a_valider';
  elsif new.montant > v_seuil and public.a_role('exploitation') then
    new.statut := 'a_valider';
  else
    new.statut := 'validee';
    new.valide_par := auth.uid();
    new.valide_le := now();
  end if;

  new.annulee := false;
  new.annulee_par := null; new.annulee_le := null; new.motif_annulation := null;
  return new;
end;
$$;
create trigger avant_depense before insert on public.depenses
  for each row execute function public.avant_depense();

create function public.payer_depense(d public.depenses)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.ecrire(d.ferme_id, public.caisse_de(d.ferme_id, d.activite, d.mode_paiement), 'sortie', d.montant_paye,
                       'depense', d.libelle, d.date_depense, p_depense => d.id)
  where d.montant_paye > 0
$$;

create function public.apres_depense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- achat stocké : entrée en stock (dès réception, même si la dépense est à valider)
  if new.article_id is not null then
    insert into public.mouvements_stock (ferme_id, article_id, date_mouvement, type_mouvement, quantite,
                                         cout_unitaire, bande_id, lot_id, depense_id, saisi_par, notes)
    values (new.ferme_id, new.article_id, new.date_depense, 'entree', new.quantite,
            round(new.montant / new.quantite, 2), null, null, new.id, new.saisi_par, 'Achat : ' || new.libelle);
  end if;

  if new.statut = 'validee' then
    perform public.payer_depense(new);
  elsif new.categorie = 'retrait_associe' then
    perform public.notifier(new.ferme_id, 'directeur', 'retrait',
      format('Retrait de %s FCFA pour %s à confirmer', new.montant, new.beneficiaire), '/depenses/' || new.id);
  else
    perform public.notifier(new.ferme_id, 'finance', 'depense_a_valider',
      format('Dépense de %s FCFA à valider : %s', new.montant, new.libelle), '/depenses/' || new.id);
    perform public.notifier(new.ferme_id, 'directeur', 'depense_a_valider',
      format('Dépense de %s FCFA à valider : %s', new.montant, new.libelle), '/depenses/' || new.id);
  end if;
  return null;
end;
$$;
create trigger apres_depense after insert on public.depenses
  for each row execute function public.apres_depense();

-- Une dépense ne se modifie pas : validation / rejet, ou annulation par le directeur
create function public.controle_maj_depense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  champs_libres text[] := array['statut', 'valide_par', 'valide_le', 'motif_rejet',
                                'annulee', 'motif_annulation', 'annulee_par', 'annulee_le'];
begin
  if tg_op = 'DELETE' then raise exception 'Une dépense ne se supprime pas : le directeur peut l''annuler'; end if;
  if old.annulee then raise exception 'Cette dépense est annulée'; end if;
  if (to_jsonb(new) - champs_libres) is distinct from (to_jsonb(old) - champs_libres) then
    raise exception 'Une dépense ne se modifie pas : elle se valide, se rejette ou s''annule';
  end if;

  if new.statut is distinct from old.statut then
    if old.statut <> 'a_valider' or new.statut not in ('validee', 'rejetee') then
      raise exception 'Changement de statut non autorisé';
    end if;
    if auth.uid() is not null then
      if old.categorie = 'retrait_associe' and not public.a_role('directeur') then
        raise exception 'Seul le directeur confirme un retrait d''associé';
      end if;
      if not public.a_role('directeur', 'finance') then
        raise exception 'Seuls le directeur et la finance valident une dépense';
      end if;
    end if;
    if new.statut = 'rejetee' and coalesce(trim(new.motif_rejet), '') = '' then
      raise exception 'Indiquez le motif du rejet';
    end if;
    new.valide_par := auth.uid();
    new.valide_le := now();
  end if;

  if new.annulee is distinct from old.annulee then
    if old.annulee or (auth.uid() is not null and not public.a_role('directeur')) then
      raise exception 'Seul le directeur peut annuler une dépense';
    end if;
    if coalesce(trim(new.motif_annulation), '') = '' then raise exception 'Indiquez le motif de l''annulation'; end if;
    new.annulee_par := auth.uid();
    new.annulee_le := now();
  end if;
  return new;
end;
$$;
create trigger controle_maj_depense before update or delete on public.depenses
  for each row execute function public.controle_maj_depense();

create function public.apres_maj_depense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'validee' and old.statut = 'a_valider' and not new.annulee then
    perform public.payer_depense(new);
  end if;

  if (new.statut = 'rejetee' and old.statut <> 'rejetee') or (new.annulee and not old.annulee) then
    perform public.contre_passer(null, new.id, coalesce('Annulation dépense : ' || new.motif_annulation, 'Dépense rejetée'));
    if new.article_id is not null then   -- on retire du stock ce que l'achat avait ajouté
      insert into public.mouvements_stock (ferme_id, article_id, type_mouvement, quantite, notes, saisi_par)
      values (new.ferme_id, new.article_id, 'ajustement', -new.quantite,
              'Annulation achat : ' || new.libelle, coalesce(auth.uid(), new.saisi_par));
    end if;
  end if;

  if new.annulee and not old.annulee then
    perform public.notifier(new.ferme_id, 'directeur', 'annulation', 'Dépense annulée : ' || new.motif_annulation);
  end if;
  return null;
end;
$$;
create trigger apres_maj_depense after update on public.depenses
  for each row execute function public.apres_maj_depense();
create trigger journal after insert or update on public.depenses
  for each row execute function public.journaliser();

-- Paiement d'une dette fournisseur
create function public.reste_a_payer_depense(p_depense uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select d.montant - d.montant_paye
         - coalesce((select sum(p.montant) from public.paiements_fournisseurs p where p.depense_id = d.id), 0)
  from public.depenses d where d.id = p_depense
$$;

create function public.avant_paiement_fournisseur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.depenses;
begin
  select * into d from public.depenses where id = new.depense_id;
  if not d.a_credit or d.annulee or d.statut <> 'validee' then
    raise exception 'Cette dépense n''a pas de dette à payer';
  end if;
  if new.montant > public.reste_a_payer_depense(d.id) then
    raise exception 'Le paiement dépasse la dette restante (% FCFA)', public.reste_a_payer_depense(d.id);
  end if;
  new.ferme_id := d.ferme_id;
  return new;
end;
$$;
create trigger avant_paiement_fournisseur before insert on public.paiements_fournisseurs
  for each row execute function public.avant_paiement_fournisseur();

create function public.apres_paiement_fournisseur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.depenses;
begin
  select * into d from public.depenses where id = new.depense_id;
  perform public.ecrire(new.ferme_id, public.caisse_de(new.ferme_id, d.activite, new.mode_paiement),
                        'sortie', new.montant, 'paiement_fournisseur', 'Paiement : ' || d.libelle, new.date_paiement,
                        p_depense => d.id, p_paiement_fournisseur => new.id);
  return null;
end;
$$;
create trigger apres_paiement_fournisseur after insert on public.paiements_fournisseurs
  for each row execute function public.apres_paiement_fournisseur();
create trigger immuable before update or delete on public.paiements_fournisseurs
  for each row execute function public.registre_immuable();
create trigger journal after insert on public.paiements_fournisseurs
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 14. Vues
-- ---------------------------------------------------------------------
-- Effectifs (vues « propriétaire » limitées à la ferme de l'utilisateur :
-- tous les rôles voient le même effectif, sans accès aux montants des ventes)
create view public.effectif_bandes as
select b.id as bande_id, b.ferme_id, b.code, b.statut, b.date_arrivee, b.date_vente_prevue, b.nombre_initial,
       (current_date - b.date_arrivee) + b.age_arrivee_jours as age_jours,
       coalesce(m.morts, 0)::integer  as morts,
       coalesce(v.vendus, 0)::integer as vendus,
       (b.nombre_initial - coalesce(m.morts, 0) - coalesce(v.vendus, 0))::integer as restants
from public.bandes b
left join (select bande_id, sum(nombre) as morts from public.mortalites group by bande_id) m on m.bande_id = b.id
left join (select bande_id, sum(nombre_sujets) as vendus from public.ventes
           where not annulee and nombre_sujets is not null group by bande_id) v on v.bande_id = b.id
where b.ferme_id = public.ferme_actuelle();

create view public.effectif_lots as
select l.id as lot_id, l.ferme_id, l.code, l.statut, l.date_arrivee, l.effectif_initial,
       ((current_date - l.date_arrivee) / 7) + l.age_arrivee_semaines as age_semaines,
       coalesce(m.morts, 0)::integer  as morts,
       coalesce(v.vendus, 0)::integer as vendus,
       (l.effectif_initial - coalesce(m.morts, 0) - coalesce(v.vendus, 0))::integer as effectif
from public.lots_pondeuses l
left join (select lot_id, sum(nombre) as morts from public.mortalites group by lot_id) m on m.lot_id = l.id
left join (select lot_id, sum(nombre_sujets) as vendus from public.ventes
           where not annulee and nombre_sujets is not null group by lot_id) v on v.lot_id = l.id
where l.ferme_id = public.ferme_actuelle();

-- Ponte quotidienne et taux de ponte (sur l'effectif actuel du lot)
create view public.ponte_journaliere with (security_invoker = true) as
select p.lot_id, p.date_ponte,
       sum(p.oeufs_collectes)::integer as oeufs_collectes,
       sum(p.oeufs_casses)::integer    as oeufs_casses,
       e.effectif,
       case when e.effectif > 0 then round(100.0 * sum(p.oeufs_collectes) / e.effectif, 1) end as taux_ponte
from public.pontes p
join public.effectif_lots e on e.lot_id = p.lot_id
group by p.lot_id, p.date_ponte, e.effectif;

-- Stock restant, seuil et autonomie (consommation moyenne des 14 derniers jours)
create view public.stock_articles as
select a.id as article_id, a.ferme_id, a.nom, a.categorie, a.unite, a.seuil_minimum, a.actif,
       coalesce(sum(case m.type_mouvement when 'sortie' then -m.quantite else m.quantite end), 0) as stock,
       coalesce(sum(m.quantite) filter (where m.type_mouvement = 'sortie' and m.date_mouvement > current_date - 14), 0) / 14.0
         as conso_jour,
       case when coalesce(sum(m.quantite) filter (where m.type_mouvement = 'sortie' and m.date_mouvement > current_date - 14), 0) > 0
            then floor(coalesce(sum(case m.type_mouvement when 'sortie' then -m.quantite else m.quantite end), 0)
                       / (sum(m.quantite) filter (where m.type_mouvement = 'sortie' and m.date_mouvement > current_date - 14) / 14.0))
       end as autonomie_jours
from public.articles a
left join public.mouvements_stock m on m.article_id = a.id
where a.ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance')
group by a.id;

-- Soldes des caisses
create view public.soldes_caisses with (security_invoker = true) as
select c.id as caisse_id, c.ferme_id, c.activite, c.mode,
       coalesce(sum(case e.sens when 'entree' then e.montant else -e.montant end), 0) as solde
from public.caisses c
left join public.ecritures e on e.caisse_id = c.id
group by c.id;

-- Créances clients et dettes fournisseurs
create view public.creances_clients with (security_invoker = true) as
select v.id as vente_id, v.ferme_id, v.client_id, t.nom as client, v.date_vente, v.date_echeance, v.produit,
       v.montant, public.reste_a_payer_vente(v.id) as reste,
       (v.date_echeance is not null and v.date_echeance < current_date) as en_retard
from public.ventes v join public.tiers t on t.id = v.client_id
where v.a_credit and not v.annulee and public.reste_a_payer_vente(v.id) > 0;

create view public.dettes_fournisseurs with (security_invoker = true) as
select d.id as depense_id, d.ferme_id, d.fournisseur_id, t.nom as fournisseur, d.date_depense, d.date_echeance,
       d.libelle, d.montant, public.reste_a_payer_depense(d.id) as reste,
       (d.date_echeance is not null and d.date_echeance < current_date) as en_retard
from public.depenses d join public.tiers t on t.id = d.fournisseur_id
where d.a_credit and not d.annulee and d.statut = 'validee' and public.reste_a_payer_depense(d.id) > 0;

-- Prix du moment
create view public.prix_actuels with (security_invoker = true) as
select distinct on (ferme_id, produit, unite) ferme_id, produit, unite, prix, date_debut
from public.prix_vente
where date_debut <= current_date
order by ferme_id, produit, unite, date_debut desc, created_at desc;

-- ---------------------------------------------------------------------
-- 15. Sécurité (RLS)
--   directeur    : tout
--   exploitation : ferme, ventes, dépenses de la ferme, crédit client, prix ;
--                  lecture des caisses
--   finance      : lecture de la ferme ; dépenses (toutes), validations,
--                  caisses, encaissements, paiements fournisseurs, prix
--   employe      : saisies de terrain et ventes ; ne voit que ses propres saisies
-- ---------------------------------------------------------------------
alter table public.fermes                 enable row level security;
alter table public.notifications          enable row level security;
alter table public.journal_activite       enable row level security;
alter table public.batiments              enable row level security;
alter table public.tiers                  enable row level security;
alter table public.articles               enable row level security;
alter table public.prix_vente             enable row level security;
alter table public.bandes                 enable row level security;
alter table public.lots_pondeuses         enable row level security;
alter table public.mortalites             enable row level security;
alter table public.pontes                 enable row level security;
alter table public.pesees                 enable row level security;
alter table public.observations           enable row level security;
alter table public.caisses                enable row level security;
alter table public.ventes                 enable row level security;
alter table public.paiements_clients      enable row level security;
alter table public.depenses               enable row level security;
alter table public.paiements_fournisseurs enable row level security;
alter table public.mouvements_stock       enable row level security;
alter table public.ecritures              enable row level security;

-- Ferme
create policy fermes_select on public.fermes for select to authenticated
  using (id = public.ferme_actuelle());
create policy fermes_update on public.fermes for update to authenticated
  using (id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (id = public.ferme_actuelle() and public.a_role('directeur'));

-- Notifications : chacun lit et marque comme lues celles de son rôle
create policy notifications_select on public.notifications for select to authenticated
  using (ferme_id = public.ferme_actuelle() and role_destinataire = public.role_actuel());
create policy notifications_update on public.notifications for update to authenticated
  using (ferme_id = public.ferme_actuelle() and role_destinataire = public.role_actuel())
  with check (ferme_id = public.ferme_actuelle() and role_destinataire = public.role_actuel());

-- Journal : directeur
create policy journal_select on public.journal_activite for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

-- Référentiels lisibles par tous les utilisateurs actifs de la ferme
create policy batiments_select on public.batiments for select to authenticated
  using (ferme_id = public.ferme_actuelle());
create policy batiments_write on public.batiments for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

create policy tiers_select on public.tiers for select to authenticated
  using (ferme_id = public.ferme_actuelle());
create policy tiers_insert on public.tiers for insert to authenticated
  with check (ferme_id = public.ferme_actuelle());
create policy tiers_update on public.tiers for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

create policy articles_select on public.articles for select to authenticated
  using (ferme_id = public.ferme_actuelle());
create policy articles_write on public.articles for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

create policy prix_select on public.prix_vente for select to authenticated
  using (ferme_id = public.ferme_actuelle());
create policy prix_insert on public.prix_vente for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

-- Bandes et lots
create policy bandes_select on public.bandes for select to authenticated
  using (ferme_id = public.ferme_actuelle());
create policy bandes_insert on public.bandes for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));
create policy bandes_update on public.bandes for update to authenticated   -- finance : validation de clôture (contrôlée par trigger)
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

create policy lots_select on public.lots_pondeuses for select to authenticated
  using (ferme_id = public.ferme_actuelle());
create policy lots_write on public.lots_pondeuses for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

-- Saisies de terrain (même règle pour les 4 tables)
do $$
declare t text;
begin
  foreach t in array array['mortalites', 'pontes', 'pesees', 'observations'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (ferme_id = public.ferme_actuelle()
               and (public.a_role('directeur', 'exploitation', 'finance') or saisi_par = auth.uid()));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
                    and public.a_role('directeur', 'exploitation', 'employe'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
        with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));
    $f$, t);
  end loop;
end;
$$;

-- Stock : l'employé saisit la consommation (sortie) ; entrées / ajustements manuels par directeur et exploitation
create policy stock_select on public.mouvements_stock for select to authenticated
  using (ferme_id = public.ferme_actuelle()
         and (public.a_role('directeur', 'exploitation', 'finance') or saisi_par = auth.uid()));
create policy stock_insert on public.mouvements_stock for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and depense_id is null
              and (public.a_role('directeur', 'exploitation')
                   or (public.a_role('employe') and type_mouvement = 'sortie')));
create policy stock_update on public.mouvements_stock for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));
create policy stock_delete on public.mouvements_stock for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

-- Caisses et écritures : lecture directeur / exploitation / finance
create policy caisses_select on public.caisses for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy ecritures_select on public.ecritures for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy ecritures_insert on public.ecritures for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and caisse_id in (select id from public.caisses where ferme_id = public.ferme_actuelle())
              and ((nature = 'solde_initial' and public.a_role('directeur', 'finance'))
                   or (nature = 'correction' and public.a_role('directeur'))));

-- Ventes : saisies par directeur, exploitation, employé ; lues par directeur, exploitation, finance
-- (l'employé ne voit que les siennes) ; seul le directeur annule (contrôlé par trigger)
create policy ventes_select on public.ventes for select to authenticated
  using (ferme_id = public.ferme_actuelle()
         and (public.a_role('directeur', 'exploitation', 'finance') or saisi_par = auth.uid()));
create policy ventes_insert on public.ventes for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and public.a_role('directeur', 'exploitation', 'employe'));
create policy ventes_update on public.ventes for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

create policy paiements_clients_select on public.paiements_clients for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy paiements_clients_insert on public.paiements_clients for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and public.a_role('directeur', 'exploitation', 'finance'));

-- Dépenses : de la ferme (directeur, exploitation, finance), générales (directeur, finance)
create policy depenses_select on public.depenses for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy depenses_insert on public.depenses for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and (public.a_role('directeur', 'finance')
                   or (public.a_role('exploitation') and portee = 'ferme')));
create policy depenses_update on public.depenses for update to authenticated   -- validation / annulation (trigger)
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));

create policy paiements_fournisseurs_select on public.paiements_fournisseurs for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy paiements_fournisseurs_insert on public.paiements_fournisseurs for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and public.a_role('directeur', 'exploitation', 'finance'));

-- Profils : rattachés à la ferme
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (ferme_id = public.ferme_actuelle() and public.a_role('directeur')));

-- ---------------------------------------------------------------------
-- 16. Droits d'exécution et accès anonymes
-- ---------------------------------------------------------------------
-- Les fonctions internes ne sont pas appelables depuis l'appli
revoke execute on function public.notifier(uuid, public.role_utilisateur, text, text, text) from public, anon, authenticated;
revoke execute on function public.caisse_de(uuid, public.activite, public.mode_paiement) from public, anon, authenticated;
revoke execute on function public.ecrire(uuid, uuid, text, numeric, text, text, date, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.contre_passer(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.encours_client(uuid) from public, anon, authenticated;
revoke execute on function public.oiseaux_restants(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.payer_depense(public.depenses) from public, anon, authenticated;
-- utilisées par les vues créances / dettes (lues avec les droits de l'utilisateur)
revoke execute on function public.reste_a_payer_vente(uuid) from public, anon;
revoke execute on function public.reste_a_payer_depense(uuid) from public, anon;

-- Aucune donnée pour les visiteurs non connectés
revoke all on all tables in schema public from anon;
