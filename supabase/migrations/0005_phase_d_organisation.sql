-- =====================================================================
-- HENZO – Phase D : planification, tâches de l'employé, alertes
-- À exécuter une fois dans Supabase > SQL Editor, après 0004.
--
--   * tâches datées (vaccin, traitement, pesée, achat d'aliment, remboursement,
--     arrivée de poussins, vente prévue…), liées ou non à une bande / un lot,
--     attribuées à un rôle, répétables tous les N jours ;
--   * programmes (modèles) : à la création d'une bande / d'un lot, ses tâches
--     sont générées selon l'âge ; la clôture annule les tâches restantes ;
--   * une tâche se coche via « taches_realisations » (insertion simple :
--     fonctionne hors connexion) ;
--   * mortalité anormale : notification dès que la mortalité du jour dépasse
--     le seuil (1 % par défaut) ;
--   * vue « alertes » regroupant tous les signaux pour l'accueil.
-- =====================================================================

alter table public.fermes
  add column seuil_mortalite_pct numeric(5, 2) not null default 1 check (seuil_mortalite_pct > 0),
  add column alerte_autonomie_jours integer not null default 7 check (alerte_autonomie_jours > 0);

-- ---------------------------------------------------------------------
-- 1. Programmes (modèles de tâches)
-- ---------------------------------------------------------------------
create table public.modeles_taches (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  type_production  text not null check (type_production in ('chair', 'pondeuse')),
  jour             integer not null check (jour >= 0),          -- âge des oiseaux en jours
  type_tache       text not null,
  titre            text not null,
  produit          text,
  assigne_role     public.role_utilisateur,
  repeter_jours    integer check (repeter_jours > 0),
  actif            boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Programme indicatif de départ (à adapter avec le vétérinaire dans Planning > Programmes)
insert into public.modeles_taches (ferme_id, type_production, jour, type_tache, titre, produit, assigne_role, repeter_jours)
select f.id, m.tp, m.jour, m.tt, m.titre, m.produit, m.role::public.role_utilisateur, m.rep
from public.fermes f,
     (values ('chair', 7, 'vaccination', 'Vaccin Newcastle', 'Newcastle (HB1 / La Sota)', 'employe', null::integer),
             ('chair', 14, 'vaccination', 'Vaccin Gumboro', 'Gumboro', 'employe', null),
             ('chair', 21, 'vaccination', 'Rappel Newcastle', 'Newcastle (La Sota)', 'employe', null),
             ('chair', 7, 'pesee', 'Pesée hebdomadaire', null, 'employe', 7),
             ('pondeuse', 0, 'pesee', 'Contrôle du poids du lot', null, 'employe', 28)
     ) as m(tp, jour, tt, titre, produit, role, rep);

-- ---------------------------------------------------------------------
-- 2. Tâches et réalisations
-- ---------------------------------------------------------------------
create table public.taches (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null default public.ferme_actuelle() references public.fermes (id),
  titre          text not null,
  type_tache     text not null check (type_tache in ('vaccination', 'traitement', 'pesee', 'achat_aliment', 'remboursement',
                                                     'arrivee_poussins', 'vente_prevue', 'nettoyage', 'autre')),
  date_prevue    date not null,
  bande_id       uuid references public.bandes (id),
  lot_id         uuid references public.lots_pondeuses (id),
  produit        text,
  description    text,
  assigne_role   public.role_utilisateur,      -- null = tout le monde
  repeter_jours  integer check (repeter_jours > 0),
  statut         text not null default 'a_faire' check (statut in ('a_faire', 'fait', 'annule')),
  fait_le        timestamptz,
  fait_par       uuid references public.profiles (id),
  modele_id      uuid references public.modeles_taches (id),
  cree_par       uuid default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now(),
  check (num_nonnulls(bande_id, lot_id) <= 1)
);
create index on public.taches (ferme_id, statut, date_prevue);
create index on public.taches (bande_id);
create index on public.taches (lot_id);

alter table public.modeles_taches add constraint modeles_type_check
  check (type_tache in ('vaccination', 'traitement', 'pesee', 'achat_aliment', 'remboursement',
                        'arrivee_poussins', 'vente_prevue', 'nettoyage', 'autre'));

create table public.taches_realisations (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null default public.ferme_actuelle() references public.fermes (id),
  tache_id    uuid not null references public.taches (id),
  fait_le     timestamptz not null default now(),
  note        text,
  saisi_par   uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now()
);

-- Génération des tâches d'une bande / d'un lot à partir des programmes
create function public.generer_taches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := case tg_table_name when 'bandes' then 'chair' else 'pondeuse' end;
  v_age integer := case tg_table_name when 'bandes' then (to_jsonb(new) ->> 'age_arrivee_jours')::integer
                                      else (to_jsonb(new) ->> 'age_arrivee_semaines')::integer * 7 end;
begin
  insert into public.taches (ferme_id, titre, type_tache, date_prevue, bande_id, lot_id, produit, assigne_role, repeter_jours, modele_id, cree_par)
  select new.ferme_id, m.titre, m.type_tache, new.date_arrivee + (m.jour - v_age),
         case when v_type = 'chair' then new.id end, case when v_type = 'pondeuse' then new.id end,
         m.produit, m.assigne_role, m.repeter_jours, m.id, auth.uid()
  from public.modeles_taches m
  where m.ferme_id = new.ferme_id and m.actif and m.type_production = v_type and m.jour >= v_age;

  if v_type = 'chair' and (to_jsonb(new) ->> 'date_vente_prevue') is not null then
    insert into public.taches (ferme_id, titre, type_tache, date_prevue, bande_id, assigne_role, cree_par)
    values (new.ferme_id, 'Vente prévue de la bande ' || new.code, 'vente_prevue',
            (to_jsonb(new) ->> 'date_vente_prevue')::date, new.id, 'exploitation', auth.uid());
  end if;
  return null;
end;
$$;
create trigger generer_taches after insert on public.bandes
  for each row execute function public.generer_taches();
create trigger generer_taches after insert on public.lots_pondeuses
  for each row execute function public.generer_taches();

-- Bande clôturée / lot réformé : les tâches restantes sont annulées
create function public.annuler_taches_restantes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.taches set statut = 'annule'
  where statut = 'a_faire'
    and ((tg_table_name = 'bandes' and bande_id = new.id) or (tg_table_name = 'lots_pondeuses' and lot_id = new.id));
  return null;
end;
$$;
create trigger annuler_taches after update of statut on public.bandes
  for each row when (new.statut = 'cloturee' and old.statut <> 'cloturee')
  execute function public.annuler_taches_restantes();
create trigger annuler_taches after update of statut on public.lots_pondeuses
  for each row when (new.statut = 'reforme' and old.statut <> 'reforme')
  execute function public.annuler_taches_restantes();

-- Statut « fait » : qui et quand
create function public.avant_maj_tache()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'fait' and old.statut <> 'fait' then
    new.fait_le := coalesce(new.fait_le, now());
    new.fait_par := coalesce(new.fait_par, auth.uid());
  elsif new.statut <> 'fait' then
    new.fait_le := null;
    new.fait_par := null;
  end if;
  return new;
end;
$$;
create trigger avant_maj_tache before update on public.taches
  for each row execute function public.avant_maj_tache();

-- Tâche répétée : la suivante est créée quand celle-ci est faite
create function public.apres_maj_tache()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.repeter_jours is not null
     and (new.bande_id is null or exists (select 1 from public.bandes where id = new.bande_id and statut <> 'cloturee'))
     and (new.lot_id is null or exists (select 1 from public.lots_pondeuses where id = new.lot_id and statut <> 'reforme')) then
    insert into public.taches (ferme_id, titre, type_tache, date_prevue, bande_id, lot_id, produit, description,
                               assigne_role, repeter_jours, modele_id, cree_par)
    values (new.ferme_id, new.titre, new.type_tache, new.date_prevue + new.repeter_jours, new.bande_id, new.lot_id,
            new.produit, new.description, new.assigne_role, new.repeter_jours, new.modele_id, new.cree_par);
  end if;
  return null;
end;
$$;
create trigger apres_maj_tache after update of statut on public.taches
  for each row when (new.statut = 'fait' and old.statut = 'a_faire') execute function public.apres_maj_tache();

-- Cocher une tâche (aussi depuis l'employé, hors connexion)
create function public.avant_realisation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.taches;
begin
  select * into t from public.taches where id = new.tache_id;
  if t.id is null or t.statut <> 'a_faire' then
    raise exception 'Cette tâche n''est plus à faire';
  end if;
  if public.a_role('employe') and t.assigne_role is not null and t.assigne_role <> 'employe' then
    raise exception 'Cette tâche n''est pas attribuée aux employés';
  end if;
  new.ferme_id := t.ferme_id;
  return new;
end;
$$;
create trigger avant_realisation before insert on public.taches_realisations
  for each row execute function public.avant_realisation();

create function public.apres_realisation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.taches set statut = 'fait', fait_le = new.fait_le, fait_par = new.saisi_par where id = new.tache_id;
  return null;
end;
$$;
create trigger apres_realisation after insert on public.taches_realisations
  for each row execute function public.apres_realisation();

-- ---------------------------------------------------------------------
-- 3. Mortalité anormale : notification immédiate
-- ---------------------------------------------------------------------
create function public.alerte_mortalite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seuil numeric := (select seuil_mortalite_pct from public.fermes where id = new.ferme_id);
  v_jour integer;
  v_base numeric;
  v_code text;
begin
  select coalesce(sum(nombre), 0) into v_jour from public.mortalites
  where date_constat = new.date_constat
    and ((new.bande_id is not null and bande_id = new.bande_id) or (new.lot_id is not null and lot_id = new.lot_id));
  v_base := public.oiseaux_restants(new.bande_id, new.lot_id) + v_jour;   -- effectif au début de la journée
  if v_base <= 0 then return null; end if;

  -- on ne prévient qu'au moment où le seuil est franchi
  if 100.0 * v_jour / v_base > v_seuil and 100.0 * (v_jour - new.nombre) / v_base <= v_seuil then
    v_code := coalesce((select code from public.bandes where id = new.bande_id), (select code from public.lots_pondeuses where id = new.lot_id));
    perform public.notifier(new.ferme_id, r, 'mortalite_anormale',
      format('Mortalité anormale : %s morts aujourd''hui dans %s (%s %%)', v_jour, v_code, round(100.0 * v_jour / v_base, 1)),
      case when new.bande_id is not null then '/ferme/bande/' || new.bande_id else '/ferme/lot/' || new.lot_id end)
    from unnest(array['exploitation', 'directeur']::public.role_utilisateur[]) r;
  end if;
  return null;
end;
$$;
create trigger alerte_mortalite after insert on public.mortalites
  for each row execute function public.alerte_mortalite();

-- ---------------------------------------------------------------------
-- 4. Vue des alertes (directeur / exploitation / finance)
--    type_alerte + paramètres : le texte est traduit dans l'appli
-- ---------------------------------------------------------------------
create view public.alertes as
with f as (
  select id, seuil_mortalite_pct, alerte_autonomie_jours from public.fermes where id = public.ferme_actuelle()
),
mort_jour as (
  select m.bande_id, m.lot_id, m.date_constat, sum(m.nombre) as morts
  from public.mortalites m, f
  where m.ferme_id = f.id and m.date_constat >= current_date - 1
  group by m.bande_id, m.lot_id, m.date_constat
)
-- mortalité anormale (hier / aujourd'hui)
select 'mortalite'::text as type_alerte, 'danger'::text as niveau,
       jsonb_build_object('code', coalesce(b.code, l.code), 'morts', mj.morts,
         'pct', round(100.0 * mj.morts / nullif(public.oiseaux_restants(mj.bande_id, mj.lot_id) + mj.morts, 0), 1), 'date', mj.date_constat) as params,
       case when mj.bande_id is not null then '/ferme/bande/' || mj.bande_id else '/ferme/lot/' || mj.lot_id end as lien,
       mj.date_constat as date_ref
from mort_jour mj
cross join f
left join public.bandes b on b.id = mj.bande_id
left join public.lots_pondeuses l on l.id = mj.lot_id
where 100.0 * mj.morts / nullif(public.oiseaux_restants(mj.bande_id, mj.lot_id) + mj.morts, 0) > f.seuil_mortalite_pct

union all
-- stock sous le seuil
select 'stock_bas', 'danger', jsonb_build_object('nom', s.nom, 'stock', s.stock, 'unite', s.unite), '/stock', current_date
from public.stock_articles s
where s.actif and s.stock <= s.seuil_minimum

union all
-- risque de rupture (autonomie insuffisante)
select 'rupture', 'warn', jsonb_build_object('nom', s.nom, 'jours', s.autonomie_jours), '/stock', current_date
from public.stock_articles s cross join f
where s.actif and s.stock > s.seuil_minimum and s.autonomie_jours is not null and s.autonomie_jours < f.alerte_autonomie_jours

union all
-- vaccinations / traitements dans les 2 jours ou en retard
select case when t.date_prevue < current_date then 'soin_en_retard' else 'soin_proche' end,
       case when t.date_prevue < current_date then 'danger' else 'warn' end,
       jsonb_build_object('titre', t.titre, 'code', coalesce(b.code, l.code), 'date', t.date_prevue),
       '/planning', t.date_prevue
from public.taches t cross join f
left join public.bandes b on b.id = t.bande_id
left join public.lots_pondeuses l on l.id = t.lot_id
where t.ferme_id = f.id and t.statut = 'a_faire' and t.type_tache in ('vaccination', 'traitement')
  and t.date_prevue <= current_date + 2

union all
-- autres tâches en retard
select 'tache_en_retard', 'warn', jsonb_build_object('titre', t.titre, 'date', t.date_prevue), '/planning', t.date_prevue
from public.taches t cross join f
where t.ferme_id = f.id and t.statut = 'a_faire' and t.type_tache not in ('vaccination', 'traitement')
  and t.date_prevue < current_date

union all
-- clients en retard de paiement
select 'client_retard', 'danger', jsonb_build_object('client', c.client, 'reste', c.reste, 'date', c.date_echeance), '/argent', c.date_echeance
from public.creances_clients c cross join f
where c.ferme_id = f.id and c.en_retard

union all
-- dettes fournisseurs échues ou dans les 7 jours
select case when d.en_retard then 'dette_retard' else 'dette_proche' end,
       case when d.en_retard then 'danger' else 'warn' end,
       jsonb_build_object('fournisseur', d.fournisseur, 'reste', d.reste, 'date', d.date_echeance), '/argent', d.date_echeance
from public.dettes_fournisseurs d cross join f
where d.ferme_id = f.id and d.date_echeance is not null and d.date_echeance <= current_date + 7

union all
-- prêts : retard ou échéance dans les 7 jours
select case when p.en_retard then 'pret_retard' else 'pret_proche' end,
       case when p.en_retard then 'danger' else 'warn' end,
       jsonb_build_object('preteur', p.preteur, 'solde', p.solde, 'date', p.prochaine_echeance), '/argent', p.prochaine_echeance
from public.situation_prets p cross join f
where p.ferme_id = f.id and (p.en_retard or p.prochaine_echeance <= current_date + 7)

union all
-- dépenses à valider
select 'depenses_a_valider', 'warn', jsonb_build_object('nombre', count(*)), '/argent', current_date
from public.depenses d cross join f
where d.ferme_id = f.id and d.statut = 'a_valider' and not d.annulee
having count(*) > 0

union all
-- 10 % des investisseurs en attente
select 'dix_pourcent', 'warn', jsonb_build_object('montant', sum(di.montant)), '/argent', current_date
from public.distributions_investisseurs di cross join f
where di.ferme_id = f.id and di.statut = 'en_attente'
having sum(di.montant) > 0;

-- ---------------------------------------------------------------------
-- 5. Sécurité (RLS)
--   modèles / tâches : planifiés par directeur, exploitation, finance ;
--   employé : voit les tâches qui lui sont attribuées et les coche
-- ---------------------------------------------------------------------
alter table public.modeles_taches      enable row level security;
alter table public.taches              enable row level security;
alter table public.taches_realisations enable row level security;

create policy modeles_select on public.modeles_taches for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy modeles_write on public.modeles_taches for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

create policy taches_select on public.taches for select to authenticated
  using (ferme_id = public.ferme_actuelle()
         and (public.a_role('directeur', 'exploitation', 'finance')
              or (public.a_role('employe') and (assigne_role is null or assigne_role = 'employe'))));
create policy taches_insert on public.taches for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy taches_update on public.taches for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

create policy realisations_select on public.taches_realisations for select to authenticated
  using (ferme_id = public.ferme_actuelle()
         and (public.a_role('directeur', 'exploitation', 'finance') or saisi_par = auth.uid()));
create policy realisations_insert on public.taches_realisations for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid());

-- Alertes : vue « propriétaire » limitée à la ferme et aux responsables
create view public.alertes_responsables as
select * from public.alertes where public.a_role('directeur', 'exploitation', 'finance');

revoke all on public.alertes from anon, authenticated;
-- Les fonctions appelées par une vue sont exécutées avec les droits de l'utilisateur :
-- le nombre d'oiseaux restants (aucune donnée financière) doit lui être accessible.
grant execute on function public.oiseaux_restants(uuid, uuid) to authenticated;
revoke all on public.alertes_responsables, public.modeles_taches, public.taches, public.taches_realisations from anon;
