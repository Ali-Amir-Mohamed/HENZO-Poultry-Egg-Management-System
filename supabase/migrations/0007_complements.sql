-- =====================================================================
-- HENZO – Compléments avant la mise en ligne
-- À exécuter une fois dans Supabase > SQL Editor, après 0006.
--
--   * aucune vente / aucun achat important anonyme : au-delà d'un seuil
--     (100 000 FCFA par défaut), client ou fournisseur obligatoire ;
--   * bénéfice net et bénéfice disponible par bande de chair ;
--   * transferts entre caisses (dépôt en banque, passage chair ↔ pondeuses) ;
--   * identifiant de connexion visible dans les profils ; personne ne peut
--     modifier son propre rôle ni se désactiver ;
--   * durée d'inactivité avant déconnexion automatique (réglage de la ferme).
-- =====================================================================

alter table public.fermes
  add column seuil_tiers_obligatoire numeric(14, 0) not null default 100000 check (seuil_tiers_obligatoire >= 0),
  add column session_minutes integer not null default 30 check (session_minutes between 5 and 1440);

-- ---------------------------------------------------------------------
-- 1. Client / fournisseur obligatoire au-delà du seuil
-- ---------------------------------------------------------------------
create function public.tiers_obligatoire()
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
    v_montant := round((to_jsonb(new) ->> 'quantite')::numeric * (to_jsonb(new) ->> 'prix_unitaire')::numeric);
    if (to_jsonb(new) ->> 'client_id') is null and v_montant > v_seuil then
      raise exception 'Vente de % FCFA : indiquez le client (obligatoire au-delà de % FCFA)', v_montant, v_seuil;
    end if;
  else
    v_montant := (to_jsonb(new) ->> 'montant')::numeric;
    if (to_jsonb(new) ->> 'fournisseur_id') is null and v_montant > v_seuil
       and (to_jsonb(new) ->> 'categorie') not in ('salaires', 'retrait_associe') then
      raise exception 'Dépense de % FCFA : indiquez le fournisseur (obligatoire au-delà de % FCFA)', v_montant, v_seuil;
    end if;
  end if;
  return new;
end;
$$;
-- (déclenché après « avant_vente » / « avant_depense », ordre alphabétique)
create trigger controle_tiers before insert on public.ventes
  for each row execute function public.tiers_obligatoire();
create trigger controle_tiers before insert on public.depenses
  for each row execute function public.tiers_obligatoire();

-- ---------------------------------------------------------------------
-- 2. Bénéfice net et bénéfice disponible par bande de chair
--   charges générales de l'activité chair (hors retraits, hors achats stockés,
--   hors dépenses rattachées à une bande / un lot) réparties, à la date de
--   chaque dépense, entre les bandes présentes ce jour-là, au prorata de leur
--   nombre initial de poulets ;
--   bénéfice net = marge brute − charges générales réparties ;
--   bénéfice disponible = bénéfice net − 10 % dus aux investisseurs pour la
--   bande − remboursements de prêt rattachés à la bande.
-- ---------------------------------------------------------------------
create view public.charges_generales_bandes as
with generales as (
  select id, ferme_id, date_depense, montant
  from public.depenses
  where activite = 'chair' and bande_id is null and lot_id is null and article_id is null
    and not annulee and statut = 'validee' and categorie <> 'retrait_associe'
),
reparties as (
  select g.id, g.montant, b.id as bande_id, b.nombre_initial,
         sum(b.nombre_initial) over (partition by g.id) as total
  from generales g
  join public.bandes b on b.ferme_id = g.ferme_id
                      and b.date_arrivee <= g.date_depense
                      and g.date_depense <= coalesce(b.date_cloture, current_date)
)
select bande_id, sum(montant * nombre_initial / total) as charges_generales
from reparties group by bande_id;

create view public.resultat_bandes as
select i.bande_id, i.ferme_id, i.code, i.statut,
       coalesce(bb.marge_brute, i.marge_brute) as marge_brute,
       round(coalesce(cg.charges_generales, 0)) as charges_generales,
       coalesce(bb.marge_brute, i.marge_brute) - round(coalesce(cg.charges_generales, 0)) as benefice_net,
       coalesce(d.dix, 0) as dix_pourcent_investisseurs,
       coalesce(r.rembourse, 0) as remboursements_prets,
       coalesce(bb.marge_brute, i.marge_brute) - round(coalesce(cg.charges_generales, 0))
         - coalesce(d.dix, 0) - coalesce(r.rembourse, 0) as benefice_disponible
from public.indicateurs_bandes_base i
left join public.bilans_bandes bb on bb.bande_id = i.bande_id
left join public.charges_generales_bandes cg on cg.bande_id = i.bande_id
left join (select bande_id, sum(montant) as dix from public.distributions_investisseurs group by bande_id) d on d.bande_id = i.bande_id
left join (select bande_id, sum(montant) as rembourse from public.remboursements_prets
           where not annulee and bande_id is not null group by bande_id) r on r.bande_id = i.bande_id
where i.ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance');

-- ---------------------------------------------------------------------
-- 3. Transferts entre caisses
-- ---------------------------------------------------------------------
alter table public.ecritures drop constraint ecritures_nature_check;
alter table public.ecritures add constraint ecritures_nature_check
  check (nature in ('vente', 'encaissement_creance', 'depense', 'paiement_fournisseur', 'solde_initial', 'correction', 'annulation',
                    'apport_investisseur', 'retrait_investisseur', 'versement_investisseur',
                    'pret_recu', 'remboursement_pret', 'ajustement_caisse', 'transfert'));

create table public.transferts_caisses (
  id                   uuid primary key default gen_random_uuid(),
  ferme_id             uuid not null default public.ferme_actuelle() references public.fermes (id),
  date_transfert       date not null default current_date,
  caisse_source        uuid not null references public.caisses (id),
  caisse_destination   uuid not null references public.caisses (id),
  montant              numeric(16, 0) not null check (montant > 0),
  motif                text not null,
  annulee              boolean not null default false,
  annulee_par          uuid references public.profiles (id),
  annulee_le           timestamptz,
  motif_annulation     text,
  saisi_par            uuid not null default auth.uid() references public.profiles (id),
  created_at           timestamptz not null default now(),
  check (caisse_source <> caisse_destination)
);

create function public.avant_transfert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.montant > public.solde_caisse(new.caisse_source) then
    raise exception 'La caisse de départ ne contient que % FCFA', public.solde_caisse(new.caisse_source);
  end if;
  new.ferme_id := (select ferme_id from public.caisses where id = new.caisse_source);
  if new.ferme_id <> (select ferme_id from public.caisses where id = new.caisse_destination) then
    raise exception 'Les deux caisses doivent appartenir à la même ferme';
  end if;
  new.annulee := false;
  new.annulee_par := null; new.annulee_le := null; new.motif_annulation := null;
  return new;
end;
$$;
create trigger avant_transfert before insert on public.transferts_caisses
  for each row execute function public.avant_transfert();

create function public.apres_transfert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ecrire_source(new.ferme_id, new.caisse_source, 'sortie', new.montant, 'transfert',
                               'Transfert : ' || new.motif, new.date_transfert, new.id);
  perform public.ecrire_source(new.ferme_id, new.caisse_destination, 'entree', new.montant, 'transfert',
                               'Transfert : ' || new.motif, new.date_transfert, new.id);
  return null;
end;
$$;
create trigger apres_transfert after insert on public.transferts_caisses
  for each row execute function public.apres_transfert();
create trigger controle_annulation before update or delete on public.transferts_caisses
  for each row execute function public.controle_annulation();
create trigger apres_annulation after update of annulee on public.transferts_caisses
  for each row when (new.annulee and not old.annulee) execute function public.apres_annulation_source();
create trigger journal after insert or update on public.transferts_caisses
  for each row execute function public.journaliser();

alter table public.transferts_caisses enable row level security;
create policy transferts_select on public.transferts_caisses for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy transferts_insert on public.transferts_caisses for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('directeur', 'finance'));
create policy transferts_update on public.transferts_caisses for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

-- ---------------------------------------------------------------------
-- 4. Comptes : identifiant de connexion, protection contre l'auto-blocage
-- ---------------------------------------------------------------------
alter table public.profiles add column identifiant text;
update public.profiles p set identifiant = split_part(u.email, '@', 1) from auth.users u where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nom_complet, ferme_id, identifiant)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'nom_complet', ''),
          (select id from public.fermes order by created_at limit 1),
          split_part(new.email, '@', 1));
  return new;
end;
$$;

create function public.controle_profil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and old.id = auth.uid()
     and (new.role is distinct from old.role or new.actif is distinct from old.actif) then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte';
  end if;
  if new.ferme_id is distinct from old.ferme_id or new.identifiant is distinct from old.identifiant then
    if auth.uid() is not null then
      raise exception 'La ferme et l''identifiant d''un compte ne se modifient pas ici';
    end if;
  end if;
  return new;
end;
$$;
create trigger controle_profil before update on public.profiles
  for each row execute function public.controle_profil();

-- ---------------------------------------------------------------------
-- 5. Accès
-- ---------------------------------------------------------------------
revoke all on public.charges_generales_bandes from anon, authenticated;
revoke all on public.resultat_bandes, public.transferts_caisses from anon;
