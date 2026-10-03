-- =====================================================================
-- HENZO – Étape 2 : distinguer poulets de chair et pondeuses
-- À exécuter une fois dans Supabase > SQL Editor, après 0001.
-- Ne supprime aucune donnée : les bandes existantes deviennent « pondeuse ».
--
-- Règles de saisie des coûts (pour éviter de compter deux fois) :
--   * achat d'aliment          -> mouvements_aliment (type 'entree', cout_total)
--   * vaccins / soins d'une bande -> sante (cout)
--   * achat des poussins, autres frais d'une bande -> depenses avec bande_id
--   * frais généraux (salaires, énergie…) -> depenses sans bande_id
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bandes : type de production
-- ---------------------------------------------------------------------
create type public.type_production as enum ('chair', 'pondeuse');

alter table public.bandes
  add column type_production public.type_production not null default 'pondeuse';
alter table public.bandes alter column type_production drop default;

alter table public.bandes drop constraint bandes_statut_check;
alter table public.bandes add constraint bandes_statut_check
  check (statut in ('active', 'reformee', 'terminee'));  -- reformee : pondeuses ; terminee : chair vendue
comment on column public.bandes.date_reforme is 'Pondeuses : date de réforme. Chair : date de fin de bande.';

-- Une saisie ne peut viser qu'une bande du bon type
create function public.verifier_type_bande()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bandes
    where id = new.bande_id and type_production = tg_argv[0]::public.type_production
  ) then
    raise exception 'Cette saisie est réservée aux bandes de type %', tg_argv[0];
  end if;
  return new;
end;
$$;

create trigger ramassages_pondeuses_seulement
  before insert or update of bande_id on public.ramassages_oeufs
  for each row execute function public.verifier_type_bande('pondeuse');

-- ---------------------------------------------------------------------
-- Poulets de chair : pesées
-- ---------------------------------------------------------------------
create table public.pesees (
  id             uuid primary key default gen_random_uuid(),
  bande_id       uuid not null references public.bandes (id),
  date_pesee     date not null default current_date,
  nombre_peses   integer not null check (nombre_peses > 0),      -- taille de l'échantillon
  poids_moyen_g  numeric(8, 1) not null check (poids_moyen_g > 0),
  notes          text,
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index on public.pesees (bande_id, date_pesee);

create trigger pesees_chair_seulement
  before insert or update of bande_id on public.pesees
  for each row execute function public.verifier_type_bande('chair');

-- ---------------------------------------------------------------------
-- Vaccins et soins (les deux types de bandes)
-- ---------------------------------------------------------------------
create table public.sante (
  id             uuid primary key default gen_random_uuid(),
  bande_id       uuid not null references public.bandes (id),
  type_soin      text not null check (type_soin in ('vaccin', 'traitement', 'vitamine', 'deparasitage', 'autre')),
  produit        text not null,
  voie           text check (voie in ('eau', 'injection', 'oculaire', 'nasale', 'aliment', 'autre')),
  dose           text,
  date_prevue    date,               -- calendrier de vaccination
  date_realisee  date,               -- null tant que ce n'est pas fait
  cout           numeric(14, 2) check (cout >= 0),
  notes          text,
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now(),
  check (date_prevue is not null or date_realisee is not null)
);
create index on public.sante (bande_id, date_prevue);

-- ---------------------------------------------------------------------
-- Ventes : poulets (pièce ou kg) et lien avec la bande
-- ---------------------------------------------------------------------
alter table public.ventes drop constraint ventes_produit_check;
alter table public.ventes add constraint ventes_produit_check
  check (produit in ('oeufs', 'plateaux', 'poulets', 'poules_reformees', 'fientes', 'autre'));

alter table public.ventes
  add column bande_id      uuid references public.bandes (id),
  add column unite_vente   text not null default 'piece' check (unite_vente in ('piece', 'kg', 'plateau')),
  add column nombre_sujets integer check (nombre_sujets > 0);  -- nombre d'oiseaux sortis, même vendus au kg

-- quantite = nombre de pièces, de kg ou de plateaux selon unite_vente ; montant = quantite x prix_unitaire
alter table public.ventes add constraint ventes_oiseaux_check
  check (produit not in ('poulets', 'poules_reformees') or (bande_id is not null and nombre_sujets is not null));
create index on public.ventes (bande_id);

-- ---------------------------------------------------------------------
-- Dépenses : rattachement facultatif à une bande (ex. achat des poussins).
-- La catégorie « aliment » reste acceptée mais l'appli ne la proposera pas :
-- l'aliment se saisit dans mouvements_aliment.
-- ---------------------------------------------------------------------
alter table public.depenses add column bande_id uuid references public.bandes (id);
create index on public.depenses (bande_id);

-- ---------------------------------------------------------------------
-- Vues
-- ---------------------------------------------------------------------
-- Effectif : initial - morts - oiseaux vendus. Vue « propriétaire » (pas security_invoker)
-- pour que tous les rôles voient le même effectif, même sans accès aux ventes ;
-- elle n'expose que des totaux et reste réservée aux utilisateurs actifs.
drop view public.effectif_bandes;
create view public.effectif_bandes as
select b.id as bande_id,
       b.code,
       b.type_production,
       b.statut,
       b.effectif_initial,
       coalesce(m.morts, 0)::integer  as morts,
       coalesce(v.vendus, 0)::integer as vendus,
       (b.effectif_initial - coalesce(m.morts, 0) - coalesce(v.vendus, 0))::integer as effectif_actuel
from public.bandes b
left join (select bande_id, sum(nombre) as morts from public.mortalites group by bande_id) m
  on m.bande_id = b.id
left join (select bande_id, sum(nombre_sujets) as vendus from public.ventes
           where produit in ('poulets', 'poules_reformees') group by bande_id) v
  on v.bande_id = b.id
where public.role_actuel() is not null;

revoke all on public.effectif_bandes from anon;
grant select on public.effectif_bandes to authenticated;

-- Suivi de croissance des poulets de chair
create view public.croissance_chair with (security_invoker = true) as
select b.id as bande_id,
       b.code,
       b.statut,
       b.date_arrivee,
       (current_date - b.date_arrivee) + coalesce(b.age_arrivee_semaines, 0) * 7 as age_jours,
       e.effectif_actuel,
       p.poids_moyen_g,
       p.date_pesee as derniere_pesee,
       coalesce(a.aliment_kg, 0) as aliment_kg,
       -- indice de consommation approximatif : kg d'aliment / kg de poulet vivant
       case when p.poids_moyen_g > 0 and e.effectif_actuel > 0
            then round(coalesce(a.aliment_kg, 0) / (p.poids_moyen_g / 1000.0 * e.effectif_actuel), 2)
       end as indice_consommation
from public.bandes b
join public.effectif_bandes e on e.bande_id = b.id
left join lateral (
  select poids_moyen_g, date_pesee from public.pesees
  where bande_id = b.id order by date_pesee desc, created_at desc limit 1
) p on true
left join (
  select bande_id, sum(quantite_kg) as aliment_kg from public.mouvements_aliment
  where type_mouvement = 'sortie' and bande_id is not null group by bande_id
) a on a.bande_id = b.id
where b.type_production = 'chair';

-- Rentabilité par bande (directeur / finance : les autres rôles n'y voient pas les ventes)
create view public.rentabilite_bandes with (security_invoker = true) as
with prix_aliment as (
  select type_aliment, sum(cout_total) / nullif(sum(quantite_kg), 0) as prix_kg
  from public.mouvements_aliment
  where type_mouvement = 'entree' and cout_total is not null
  group by type_aliment
),
couts as (
  select b.id as bande_id,
         coalesce((select sum(v.montant) from public.ventes v where v.bande_id = b.id), 0) as revenus,
         coalesce((select sum(m.quantite_kg * pa.prix_kg)
                   from public.mouvements_aliment m join prix_aliment pa using (type_aliment)
                   where m.bande_id = b.id and m.type_mouvement = 'sortie'), 0) as cout_aliment,
         coalesce((select sum(s.cout) from public.sante s where s.bande_id = b.id), 0) as cout_sante,
         coalesce((select sum(d.montant) from public.depenses d where d.bande_id = b.id), 0) as autres_couts
  from public.bandes b
)
select b.id as bande_id, b.code, b.type_production, b.statut,
       round(c.revenus, 0)      as revenus,
       round(c.cout_aliment, 0) as cout_aliment,
       round(c.cout_sante, 0)   as cout_sante,
       round(c.autres_couts, 0) as autres_couts,
       round(c.revenus - c.cout_aliment - c.cout_sante - c.autres_couts, 0) as marge
from public.bandes b join couts c on c.bande_id = b.id;

-- ---------------------------------------------------------------------
-- Sécurité (RLS) des nouvelles tables : mêmes règles que les saisies terrain
-- ---------------------------------------------------------------------
alter table public.pesees enable row level security;
alter table public.sante  enable row level security;

create policy pesees_select on public.pesees for select to authenticated
  using (public.role_actuel() is not null);
create policy pesees_insert on public.pesees for insert to authenticated
  with check (public.role_actuel() is not null and saisi_par = auth.uid());
create policy pesees_update on public.pesees for update to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'))
  with check (public.role_actuel() in ('directeur', 'exploitation'));
create policy pesees_delete on public.pesees for delete to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'));

create policy sante_select on public.sante for select to authenticated
  using (public.role_actuel() is not null);
create policy sante_insert on public.sante for insert to authenticated
  with check (public.role_actuel() is not null and saisi_par = auth.uid());
create policy sante_update on public.sante for update to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'))
  with check (public.role_actuel() in ('directeur', 'exploitation'));
create policy sante_delete on public.sante for delete to authenticated
  using (public.role_actuel() in ('directeur', 'exploitation'));
