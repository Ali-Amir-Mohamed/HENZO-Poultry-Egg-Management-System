-- =====================================================================
-- HENZO – Améliorations : corrections tracées, stock d'œufs, bâtiments,
-- connexions, notifications sur téléphone, plusieurs fermes
-- À exécuter une fois dans Supabase > SQL Editor, après 0012.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Corrections des saisies de terrain : tracées dans le journal
--    (modifier / supprimer : directeur et exploitation, règles RLS existantes)
-- ---------------------------------------------------------------------
create trigger journal after update or delete on public.mortalites
  for each row execute function public.journaliser();
create trigger journal after update or delete on public.pontes
  for each row execute function public.journaliser();
create trigger journal after update or delete on public.pesees
  for each row execute function public.journaliser();
create trigger journal after update or delete on public.observations
  for each row execute function public.journaliser();
create trigger journal after update or delete on public.mouvements_stock
  for each row execute function public.journaliser();
create trigger journal after insert or update on public.articles
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 2. Stock d'œufs
--   stock = œufs bons ramassés (collectés − cassés) − œufs vendus
--           (pièces + plateaux × œufs par plateau) ± ajustements (casse en
--           magasin, consommation, inventaire)
-- ---------------------------------------------------------------------
alter table public.fermes
  add column oeufs_par_plateau integer not null default 30 check (oeufs_par_plateau > 0);

create table public.ajustements_oeufs (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  date_ajustement  date not null default current_date,
  quantite         integer not null check (quantite <> 0),     -- en œufs, + ou −
  motif            text not null,
  saisi_par        uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now()
);
create trigger journal after insert or delete on public.ajustements_oeufs
  for each row execute function public.journaliser();
alter table public.ajustements_oeufs enable row level security;
create policy ajustements_oeufs_select on public.ajustements_oeufs for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy ajustements_oeufs_insert on public.ajustements_oeufs for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));
create policy ajustements_oeufs_delete on public.ajustements_oeufs for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

create view public.stock_oeufs as
with f as (select id, oeufs_par_plateau as opp from public.fermes where id = public.ferme_actuelle()),
calc as (
  select f.opp,
         coalesce((select sum(oeufs_collectes - oeufs_casses) from public.pontes p where p.ferme_id = f.id), 0) as oeufs_bons,
         coalesce((select sum(case v.produit when 'oeufs' then v.quantite when 'plateaux' then v.quantite * f.opp end)
                   from public.ventes v where v.ferme_id = f.id and not v.annulee and v.produit in ('oeufs', 'plateaux')), 0) as oeufs_vendus,
         coalesce((select sum(quantite) from public.ajustements_oeufs a where a.ferme_id = f.id), 0) as ajustements
  from f
)
select oeufs_bons::integer, oeufs_vendus::integer, ajustements::integer,
       (oeufs_bons - oeufs_vendus + ajustements)::integer as stock_oeufs,
       floor((oeufs_bons - oeufs_vendus + ajustements) / opp)::integer as plateaux,
       mod((oeufs_bons - oeufs_vendus + ajustements)::integer, opp) as oeufs_isoles,
       opp as oeufs_par_plateau
from calc
where public.a_role('directeur', 'exploitation', 'finance');
revoke all on public.stock_oeufs from anon;

-- ---------------------------------------------------------------------
-- 3. Bâtiments : affectation des commandes, occupation
-- ---------------------------------------------------------------------
alter table public.commandes_poussins add column batiment_id uuid references public.batiments (id);
create trigger journal after insert or update on public.batiments
  for each row execute function public.journaliser();

create view public.occupation_batiments as
select b.id as batiment_id, b.ferme_id, b.nom, b.capacite, b.actif,
       coalesce((select jsonb_agg(jsonb_build_object('id', e.bande_id, 'code', e.code, 'type', 'chair', 'effectif', e.restants))
                 from public.effectif_bandes e join public.bandes x on x.id = e.bande_id
                 where x.batiment_id = b.id and e.statut <> 'cloturee'), '[]'::jsonb)
       || coalesce((select jsonb_agg(jsonb_build_object('id', e.lot_id, 'code', e.code, 'type', 'pondeuse', 'effectif', e.effectif))
                    from public.effectif_lots e join public.lots_pondeuses x on x.id = e.lot_id
                    where x.batiment_id = b.id and e.statut = 'en_production'), '[]'::jsonb) as occupants,
       coalesce((select sum(e.restants) from public.effectif_bandes e join public.bandes x on x.id = e.bande_id
                 where x.batiment_id = b.id and e.statut <> 'cloturee'), 0)
       + coalesce((select sum(e.effectif) from public.effectif_lots e join public.lots_pondeuses x on x.id = e.lot_id
                   where x.batiment_id = b.id and e.statut = 'en_production'), 0) as oiseaux
from public.batiments b
where b.ferme_id = public.ferme_actuelle();
revoke all on public.occupation_batiments from anon;

-- La réception d'une commande place la bande dans le bâtiment prévu
create or replace function public.receptionner_livraison(p_livraison uuid, p_nombre integer, p_date date, p_date_reste date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.livraisons_poussins;
  c public.commandes_poussins;
  v_bande uuid;
  v_reste integer;
begin
  if not public.a_role('directeur', 'exploitation') then
    raise exception 'Seuls l''exploitation et le directeur réceptionnent les poussins';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  if p_nombre is null or p_nombre <= 0 then raise exception 'Indiquez le nombre de poussins reçus'; end if;
  select * into c from public.commandes_poussins where id = l.commande_id for update;
  v_reste := greatest(l.nombre - p_nombre, 0);

  if c.bande_id is null then
    perform set_config('henzo.reception_commande', 'on', true);
    insert into public.bandes (ferme_id, code, fournisseur_id, souche, date_arrivee, nombre_initial, batiment_id)
    values (c.ferme_id, c.code_bande, c.fournisseur_id, c.souche, p_date, p_nombre, c.batiment_id)
    returning id into v_bande;
    perform set_config('henzo.reception_commande', 'off', true);
    update public.commandes_poussins set bande_id = v_bande where id = c.id;
  else
    v_bande := c.bande_id;
  end if;

  update public.livraisons_poussins
  set statut = 'livree', nombre = p_nombre, date_livraison = p_date, bande_id = v_bande,
      notes = format('Livrée (%s prévus le %s)', l.nombre, to_char(l.date_prevue, 'DD/MM/YYYY'))
  where id = l.id;
  update public.taches set statut = 'fait' where id = l.tache_id and statut = 'a_faire';

  if v_reste > 0 and p_date_reste is not null then
    perform public.prevoir_livraison(c.id, v_reste, p_date_reste, v_bande);
  end if;
  perform public.maj_statut_commande(c.id);
  return v_bande;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Historique des connexions (consulté par le directeur)
-- ---------------------------------------------------------------------
create table public.connexions (
  id          bigint generated always as identity primary key,
  ferme_id    uuid default public.ferme_actuelle() references public.fermes (id),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  evenement   text not null check (evenement in ('connexion', 'deconnexion', 'expiration')),
  appareil    text,
  created_at  timestamptz not null default now()
);
create index on public.connexions (ferme_id, created_at desc);
alter table public.connexions enable row level security;
create policy connexions_insert on public.connexions for insert to authenticated
  with check (user_id = auth.uid());
create policy connexions_select on public.connexions for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

-- ---------------------------------------------------------------------
-- 5. Notifications sur téléphone : abonnements des appareils
--    (l'envoi est fait par la fonction Supabase « envoyer-notifications »)
-- ---------------------------------------------------------------------
create table public.abonnements_push (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  appareil    text,
  created_at  timestamptz not null default now()
);
alter table public.abonnements_push enable row level security;
create policy abonnements_select on public.abonnements_push for select to authenticated using (user_id = auth.uid());
create policy abonnements_insert on public.abonnements_push for insert to authenticated with check (user_id = auth.uid());
create policy abonnements_update on public.abonnements_push for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy abonnements_delete on public.abonnements_push for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. Plusieurs fermes
--   membres_fermes : à quelles fermes appartient chaque compte, avec quel rôle.
--   profiles.ferme_id / profiles.role = la ferme active et le rôle dans cette ferme
--   (toutes les règles de sécurité existantes continuent de s'appuyer dessus).
-- ---------------------------------------------------------------------
create table public.membres_fermes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  ferme_id    uuid not null references public.fermes (id),
  role        public.role_utilisateur not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, ferme_id)
);
insert into public.membres_fermes (user_id, ferme_id, role) select id, ferme_id, role from public.profiles;
alter table public.membres_fermes enable row level security;
create policy membres_select on public.membres_fermes for select to authenticated using (user_id = auth.uid());

-- Le profil (ferme active, rôle) et l'appartenance restent synchronisés
create function public.synchro_membre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.membres_fermes (user_id, ferme_id, role) values (new.id, new.ferme_id, new.role)
  on conflict (user_id, ferme_id) do update set role = excluded.role;
  return null;
end;
$$;
create trigger synchro_membre after insert or update of role, ferme_id on public.profiles
  for each row execute function public.synchro_membre();

-- Protection du profil : le changement de ferme passe par changer_ferme()
create or replace function public.controle_profil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('henzo.changement_ferme', true) = 'on' or auth.uid() is null then
    return new;
  end if;
  if old.id = auth.uid() and (new.role is distinct from old.role or new.actif is distinct from old.actif) then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte';
  end if;
  if new.ferme_id is distinct from old.ferme_id or new.identifiant is distinct from old.identifiant then
    raise exception 'La ferme et l''identifiant d''un compte ne se modifient pas ici';
  end if;
  return new;
end;
$$;

-- Mes fermes (pour le sélecteur)
create function public.mes_fermes()
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

-- Passer à une autre ferme dont on est membre
create function public.changer_ferme(p_ferme uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.role_utilisateur;
begin
  select role into v_role from public.membres_fermes where user_id = auth.uid() and ferme_id = p_ferme;
  if v_role is null then raise exception 'Vous n''êtes pas membre de cette ferme'; end if;
  perform set_config('henzo.changement_ferme', 'on', true);
  update public.profiles set ferme_id = p_ferme, role = v_role where id = auth.uid();
  perform set_config('henzo.changement_ferme', 'off', true);
  insert into public.connexions (ferme_id, user_id, evenement, appareil) values (p_ferme, auth.uid(), 'connexion', 'Changement de ferme');
end;
$$;

-- Créer une nouvelle ferme (directeur) : caisses, programme de soins et paramètres repris de la ferme active
create function public.creer_ferme(p_nom text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid := public.ferme_actuelle();
  v_new uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur crée une ferme'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de la ferme'; end if;
  insert into public.fermes (nom, seuil_validation_depense, taux_investisseurs, seuil_mortalite_pct, alerte_autonomie_jours,
                             seuil_tiers_obligatoire, session_minutes, oeufs_par_plateau)
  select trim(p_nom), seuil_validation_depense, taux_investisseurs, seuil_mortalite_pct, alerte_autonomie_jours,
         seuil_tiers_obligatoire, session_minutes, oeufs_par_plateau
  from public.fermes where id = v_old
  returning id into v_new;
  insert into public.caisses (ferme_id, activite, mode)
  select v_new, a, m from unnest(enum_range(null::public.activite)) a, unnest(enum_range(null::public.mode_paiement)) m;
  insert into public.modeles_taches (ferme_id, type_production, jour, type_tache, titre, produit, assigne_role, repeter_jours, actif)
  select v_new, type_production, jour, type_tache, titre, produit, assigne_role, repeter_jours, actif
  from public.modeles_taches where ferme_id = v_old;
  insert into public.membres_fermes (user_id, ferme_id, role) values (auth.uid(), v_new, 'directeur');
  return v_new;
end;
$$;

-- Comptes de la ferme active (directeur), y compris ceux qui travaillent aussi ailleurs
create function public.membres_ferme()
returns table (user_id uuid, identifiant text, nom_complet text, role public.role_utilisateur, actif boolean, ferme_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.identifiant, p.nom_complet, m.role, p.actif, p.ferme_id = m.ferme_id
  from public.membres_fermes m join public.profiles p on p.id = m.user_id
  where m.ferme_id = public.ferme_actuelle() and public.a_role('directeur')
  order by m.role, p.nom_complet
$$;

-- Rôle d'un compte dans la ferme active (directeur)
create function public.definir_role(p_user uuid, p_role public.role_utilisateur)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur modifie les rôles'; end if;
  if p_user = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle'; end if;
  update public.membres_fermes set role = p_role where user_id = p_user and ferme_id = public.ferme_actuelle();
  if not found then raise exception 'Ce compte n''est pas membre de cette ferme'; end if;
  perform set_config('henzo.changement_ferme', 'on', true);
  update public.profiles set role = p_role where id = p_user and ferme_id = public.ferme_actuelle();
  perform set_config('henzo.changement_ferme', 'off', true);
end;
$$;

-- Ajouter un compte existant (d'une autre ferme) à la ferme active (directeur)
create function public.ajouter_membre(p_identifiant text, p_role public.role_utilisateur)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur ajoute des membres'; end if;
  select id into v_user from public.profiles where lower(identifiant) = lower(trim(p_identifiant));
  if v_user is null then raise exception 'Aucun compte avec l''identifiant %', p_identifiant; end if;
  insert into public.membres_fermes (user_id, ferme_id, role) values (v_user, public.ferme_actuelle(), p_role)
  on conflict (user_id, ferme_id) do update set role = excluded.role;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Droits
-- ---------------------------------------------------------------------
revoke execute on function public.synchro_membre() from public, anon, authenticated;
grant execute on function public.mes_fermes(), public.changer_ferme(uuid), public.creer_ferme(text),
                          public.membres_ferme(), public.definir_role(uuid, public.role_utilisateur),
                          public.ajouter_membre(text, public.role_utilisateur)
  to authenticated;
revoke all on public.ajustements_oeufs, public.connexions, public.abonnements_push, public.membres_fermes from anon;
